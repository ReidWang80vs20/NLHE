/**
 * probe-fullscreen.mjs — 全屏状态流转轨迹探针（诊断工具，非验收脚本）
 * probe-fullscreen.mjs — fullscreen state-transition trace probe (a diagnostic tool, not a verification script)
 *
 * 为什么需要它：
 * Why it is needed:
 *   verify-render.mjs 里"全屏时按钮状态同步为已全屏"与"退出全屏后回到未全屏"
 *   In verify-render.mjs the two assertions "button state syncs to fullscreen while fullscreen" and "returns to non-fullscreen after exiting fullscreen"
 *   这两条断言实测**确定性失败**（不是偶发），但 `document.fullscreenElement`
 *   failed **deterministically** in testing (not intermittently), yet `document.fullscreenElement`
 *   确实变成了非空。也就是说"全屏进去了、事件没跟上"或"退出没生效"。
 *   did become non-null. That means either "fullscreen was entered but events lagged" or "exit did not take effect".
 *   光看断言结果无法区分这两者，必须把状态流转逐帧读出来：
 *   The assertion result alone cannot distinguish the two; the state transitions must be read frame by frame:
 *     · requestFullscreen() 返回的 Promise 到底是 resolve 还是 reject，错误是什么
 *     · whether the Promise returned by requestFullscreen() resolves or rejects, and what the error is
 *     · fullscreenchange / webkitfullscreenchange 各自触发了几次、触发时相位是什么
 *     · how many times fullscreenchange / webkitfullscreenchange each fired and what phase they were in when they fired
 *     · 按钮 class 与 title 在每一帧的实际取值
 *     · the actual value of the button's class and title in each frame
 *
 * 本脚本是"取证"用途：只打印事实，不做判定。
 * This script is for "forensics": it only prints facts, it does not make a verdict.
 *
 *   node desktop/probe-fullscreen.mjs            # 不额外处理焦点（复现现状）
 *   node desktop/probe-fullscreen.mjs            # no extra focus handling (reproduces the status quo)
 *   node desktop/probe-fullscreen.mjs focus      # 切换前先 Page.bringToFront
 *   node desktop/probe-fullscreen.mjs focus      # call Page.bringToFront before switching
 *
 * 每次运行只开一个浏览器、只做一轮"进入→退出"，避免上一轮卡住的状态污染下一轮
 * Each run opens only one browser and does just one "enter→exit" cycle, to avoid a stuck previous run polluting the next
 * （实测污染过一次：A 轮卡在全屏后，B 轮的"点击按钮"变成调用 exitFullscreen）。
 * (pollution was observed once: after round A got stuck in fullscreen, round B's "click button" became an exitFullscreen call).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { requireBrowser } from "./browser.mjs";
import { killTree } from "./proc.mjs";

const MODE = process.argv[2] || "plain";   // plain | focus

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PAGE = path.join(ROOT, "poker-trainer.html");
const PAGE_URL = "file:///" + PAGE.split(path.sep).join("/");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath, timeout: 4000 }, (res) => {
      let s = "";
      res.on("data", (d) => (s += d));
      res.on("end", () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("HTTP timeout")));
  });
}

async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = [];
  let seq = 0;
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
    setTimeout(() => reject(new Error("CDP WebSocket 连接超时")), 8000);
  });
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach((fn) => fn(msg));
  });
  return {
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("CDP 超时：" + method)); } }, 20000);
      });
    },
    on(fn) { listeners.push(fn); },
    close() { try { ws.close(); } catch { /* 忽略 / Ignore */ } },
  };
}

/* 在页面里装一个"黑匣子"：包住 requestFullscreen 记录 Promise 结局，
   Install a "black box" in the page: wrap requestFullscreen to record the Promise outcome,
   并给两种 fullscreenchange 各挂一个记录器。返回自增序号方便对齐时间轴。
   and attach a recorder to each of the two fullscreenchange events. Returns an auto-incrementing sequence number for timeline alignment. */
const INSTALL = `(() => {
  window.__fsLog = [];
  const rec = (kind, detail) => window.__fsLog.push({ t: Math.round(performance.now()), kind, detail: detail === undefined ? null : detail });
  rec('install', {
    fullscreenElement: !!document.fullscreenElement,
    displayModeFullscreen: matchMedia('(display-mode: fullscreen)').matches,
    hasRequestFs: typeof document.documentElement.requestFullscreen === 'function',
    hasWebkitRequestFs: typeof document.documentElement.webkitRequestFullscreen === 'function',
    hasExitFs: typeof document.exitFullscreen === 'function',
    hasWebkitExitFs: typeof document.webkitExitFullscreen === 'function',
  });
  const wrap = (obj, prop, label) => {
    const orig = obj[prop];
    if (typeof orig !== 'function') { rec('wrap-skip', label + ' 不存在'); return; }
    obj[prop] = function () {
      rec('call', label);
      let p;
      try { p = orig.apply(this, arguments); }
      catch (e) { rec('throw', label + ' → ' + (e && e.name) + ': ' + (e && e.message)); throw e; }
      if (p && typeof p.then === 'function') {
        p.then(() => rec('resolve', label),
               (e) => rec('reject', label + ' → ' + (e && e.name) + ': ' + (e && e.message)));
      } else { rec('no-promise', label); }
      return p;
    };
  };
  wrap(document.documentElement, 'requestFullscreen', 'requestFullscreen');
  wrap(document.documentElement, 'webkitRequestFullscreen', 'webkitRequestFullscreen');
  wrap(document, 'exitFullscreen', 'exitFullscreen');
  wrap(document, 'webkitExitFullscreen', 'webkitExitFullscreen');
  document.addEventListener('fullscreenchange', () => rec('fullscreenchange', !!document.fullscreenElement));
  document.addEventListener('webkitfullscreenchange', () => rec('webkitfullscreenchange', !!(document.fullscreenElement || document.webkitFullscreenElement)));
  return 'installed';
})()`;

const SNAP = `(() => {
  const btn = document.getElementById('btn-fullscreen');
  const mq = matchMedia('(display-mode: fullscreen)');
  return JSON.stringify({
    t: Math.round(performance.now()),
    pageFs: !!document.fullscreenElement,
    webkitFs: !!document.webkitFullscreenElement,
    mediaFs: mq.matches,
    btnClass: btn ? btn.className : '(无按钮)',
    btnOn: btn ? btn.classList.contains('on') : null,
    btnTitle: btn ? btn.title : '',
    btnAria: btn ? btn.getAttribute('aria-pressed') : '',
    log: (window.__fsLog || []).length,
  });
})()`;

const client = requireBrowser();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nlhe-fsprobe-"));
const portFile = path.join(profile, "DevToolsActivePort");
let proc;

try {
  console.log("启动浏览器 : " + path.basename(client.exe));
  /* 额外启动参数走环境变量传入，便于做"加/不加某个 flag"的对照实验 */
  /* Extra launch arguments are passed via an environment variable, making "with/without a flag" controlled experiments easy */
  const extra = (process.env.NLHE_EXTRA_FLAGS || "").split(/\s+/).filter(Boolean);
  if (extra.length) console.log("额外参数   : " + extra.join(" "));
  proc = spawn(client.exe, [
    "--app=" + PAGE_URL,
    "--window-size=1200,760",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    ...extra,
  ], { detached: false, stdio: "ignore" });

  let port = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    if (fs.existsSync(portFile)) {
      port = Number(fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0].trim());
      if (port > 0) break;
    }
  }
  if (!port) throw new Error("未能获取调试端口");
  console.log("调试端口   : " + port);

  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJson(port, "/json/list");
      target = list.find((t) => t.type === "page" && /poker-trainer\.html/.test(t.url || "")) || list.find((t) => t.type === "page");
      if (target && target.webSocketDebuggerUrl) break;
    } catch { /* 重试 / Retry */ }
    await sleep(400);
  }
  if (!target) throw new Error("未发现页面 target");

  const cdp = await connectCDP(target.webSocketDebuggerUrl);
  const jsErrors = [];
  cdp.on((m) => {
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      jsErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text || "未知异常");
    }
  });
  await cdp.send("Runtime.enable");
  const ev = async (expr) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, userGesture: true });
    return r && r.result ? r.result.value : null;
  };

  /* 等应用就绪（避免在框架还没初始化时下探） */
  /* Wait for the app to be ready (avoid probing before the framework has initialized) */
  for (let i = 0; i < 40; i++) {
    if (await ev("!!(window.PK && PK.fullscreen)")) break;
    await sleep(250);
  }
  console.log("PK.fullscreen 就绪 : " + await ev("!!(window.PK && PK.fullscreen)"));
  console.log("模式       : " + MODE + (MODE === "focus" ? "（切换前先 Page.bringToFront）" : "（不额外处理焦点）"));

  const winInfo = await cdp.send("Browser.getWindowForTarget").catch(() => null);
  console.log("窗口状态   : " + JSON.stringify(winInfo && winInfo.bounds));

  if (MODE === "focus") {
    try { await cdp.send("Page.bringToFront"); } catch (e) { console.log("bringToFront 失败：" + e.message); }
    await sleep(400);
  }
  console.log("document.hasFocus() : " + await ev("document.hasFocus()"));
  console.log("document.visibilityState : " + await ev("document.visibilityState"));

  console.log("\n安装黑匣子 : " + await ev(INSTALL));
  console.log("第 0 帧 : " + await ev(SNAP));

  console.log("\n---- 进入：PK.fullscreen.toggle() ----");
  await ev("PK.fullscreen.toggle()");
  await traceFrames(ev, "进入", 40);

  console.log("\n---- 退出：document.exitFullscreen() ----");
  await ev("document.exitFullscreen()");
  await traceFrames(ev, "退出", 30);

  console.log("\n---- 黑匣子事件轴 ----");
  dump(JSON.parse(await ev("JSON.stringify(window.__fsLog)") || "[]"));

  console.log("\n---- 终态 ----");
  console.log("  " + await ev(SNAP));

  console.log("\n---- 页面未捕获异常 ----");
  console.log(jsErrors.length ? jsErrors.join("\n") : "（无）");

  cdp.close();
} catch (e) {
  console.error("探针失败：" + e.message);
} finally {
  if (proc && proc.pid) killTree(proc.pid);
}

/* 只打印"状态发生变化"的帧 + 前几帧，避免刷屏掩盖关键转折 */
/* Print only frames where "state changed" plus the first few frames, to avoid a flood of output hiding the key turning points */
async function traceFrames(ev, label, n) {
  let prev = null;
  let head = 0;
  for (let i = 0; i < n; i++) {
    await sleep(100);
    const s = JSON.parse(await ev(SNAP));
    const key = s.pageFs + "|" + s.mediaFs + "|" + s.btnOn + "|" + s.btnAria + "|" + s.log;
    if (key !== prev || head < 3) {
      console.log("  " + label + " " + String(i * 100).padStart(5) + "ms  pageFs=" + s.pageFs
        + "  mediaFs=" + s.mediaFs + "  btnOn=" + s.btnOn + "  aria=" + s.btnAria + "  事件数=" + s.log);
      prev = key; head++;
    }
  }
}

function dump(log) {
  if (!log.length) { console.log("  （空）"); return; }
  log.forEach((e) => console.log("  t=" + String(e.t).padStart(6) + "  " + e.kind + (e.detail ? "  " + JSON.stringify(e.detail) : "")));
}
