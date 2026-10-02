/**
 * CDP 通道诊断：连上页面后按顺序发若干条 Runtime.evaluate，逐条计时打印。
 * CDP channel diagnosis: after connecting to the page, send several Runtime.evaluate calls in order and time each one.
 *
 * 用途：验收脚本报 "CDP 超时：Runtime.evaluate" 时，光看方法名分不清是
 * Purpose: when a verification script reports "CDP timeout: Runtime.evaluate", the method name alone cannot tell whether
 *   (a) 整条 CDP 通道/页面主线程坏了，还是
 *   (a) the whole CDP channel/page main thread is broken, or
 *   (b) 某一条表达式自身有问题。
 *   (b) one particular expression is the problem.
 * 本脚本把两者分开：先发一条 `1+1`，再逐步加上更长/更复杂的表达式，
 * This script separates the two: send `1+1` first, then add progressively longer/more complex expressions;
 * 哪一条开始超时，问题就出在那一条。
 * whichever one starts timing out is where the problem lies.
 *
 * 用法：node diag-cdp.mjs
 * Usage: node diag-cdp.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { requireBrowser } from "./browser.mjs";
import { killTree } from "./proc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PAGE = path.join(ROOT, "poker-trainer.html");
const PAGE_URL = "file:///" + PAGE.split(path.sep).join("/");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CALL_TIMEOUT = 8000;

/* 把 verify-render.mjs 里那条 favicon 表达式**原样**抽出来一起测，
   Extract the favicon expression from verify-render.mjs **verbatim** and test it together,
   保证诊断对象就是要定位的那一条，而不是我另写的一条相似表达式。
   ensuring the diagnostic target is exactly the one to be located, not a similar expression I rewrote. */
const vr = fs.readFileSync(path.join(here, "verify-render.mjs"), "utf8");
const favExpr = (vr.match(/const fav = await evalIn\(`([\s\S]*?)`\);/) || [])[1] || "";

const CASES = [
  ["1+1", "1+1"],
  ["document.title", "document.title"],
  ["window.PK 是否存在", "!!window.PK"],
  ["querySelector 图标链接", 'document.querySelector(\'link[rel="icon"]\') ? "yes" : "no"'],
  ["favicon 表达式的 href 片段", '(() => { const l = document.querySelector(\'link[rel="icon"]\'); if (!l) return "none"; return l.getAttribute("href").slice(0, 24); })()'],
  ["verify-render 原样 favicon 表达式（" + favExpr.length + " 字符）", favExpr],
];

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath, timeout: 4000 }, (res) => {
      let s = "";
      res.on("data", (d) => { s += d; });
      res.on("end", () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("http 超时")); });
  });
}

function connectCDP(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let seq = 0;
    ws.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = ++seq;
        return new Promise((res, rej) => {
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
          setTimeout(() => {
            if (pending.has(id)) { pending.delete(id); rej(new Error("超时 " + method)); }
          }, CALL_TIMEOUT);
        });
      },
      close() { try { ws.close(); } catch { /* 忽略 / Ignore */ } },
    }));
    ws.addEventListener("error", (e) => reject(new Error("WebSocket 错误：" + (e.message || "?"))));
    ws.addEventListener("message", (ev) => {
      const kind = typeof ev.data;
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch {
        console.log("  ⚠ 收到无法解析的帧，data 类型=" + kind);
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });
  });
}

const browser = requireBrowser();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "diag-cdp-"));
const portFile = path.join(profile, "DevToolsActivePort");
console.log("浏览器 : " + browser.exe);

const proc = spawn(browser.exe, [
  "--app=" + PAGE_URL,
  "--window-size=1200,760",
  "--remote-debugging-port=0",
  "--user-data-dir=" + profile,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=CalculateNativeWinOcclusion",
], { detached: false, stdio: "ignore" });

let port = 0;
for (let i = 0; i < 60 && !port; i++) {
  await sleep(400);
  if (fs.existsSync(portFile)) port = Number(fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0].trim());
}
console.log("调试端口 : " + (port || "(无)"));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const list = await getJson(port, "/json/list");
    target = list.find((t) => t.type === "page" && /poker-trainer\.html/.test(t.url || ""))
          || list.find((t) => t.type === "page");
  } catch { /* 端口刚起好 / the port just came up */ }
  if (!target) await sleep(400);
}
console.log("页面     : " + (target ? target.url : "(未找到)"));
if (!target) { await killTree(proc.pid); process.exit(1); }

const cdp = await connectCDP(target.webSocketDebuggerUrl);
const t0 = Date.now();
try { await cdp.send("Runtime.enable"); console.log("Runtime.enable  " + (Date.now() - t0) + "ms"); }
catch (e) { console.log("Runtime.enable  ✗ " + e.message); }

console.log("\n── 逐条表达式计时（超时阈值 " + CALL_TIMEOUT + "ms）──");
for (const [name, expr] of CASES) {
  const s = Date.now();
  try {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, userGesture: true });
    const v = r && r.result ? r.result.value : undefined;
    console.log("  ✓ " + (Date.now() - s) + "ms  " + name + "  → " + JSON.stringify(v).slice(0, 80));
  } catch (e) {
    console.log("  ✗ " + (Date.now() - s) + "ms  " + name + "  → " + e.message);
  }
}

/* 复现验收脚本里的真实顺序：favicon 那条不是孤立跑的，它排在**一次全屏往返之后**。
   Reproduce the real order in the verification script: the favicon check does not run in isolation; it runs **after a fullscreen round trip**.
   如果这一组开始超时，就说明卡点不在表达式，而在前面的全屏往返留下的状态。
   If this group starts timing out, the blocker is not the expression but the state left behind by the earlier fullscreen round trip. */
console.log("\n── 复现验收顺序：全屏往返 → favicon 表达式 ──");
const step = async (name, fn) => {
  const s = Date.now();
  try {
    const v = await fn();
    console.log("  ✓ " + (Date.now() - s) + "ms  " + name + "  → " + String(v).slice(0, 60));
  } catch (e) {
    console.log("  ✗ " + (Date.now() - s) + "ms  " + name + "  → " + e.message);
  }
};
const ev = async (expr) => {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, userGesture: true });
  return r && r.result ? r.result.value : undefined;
};

await step("读 visibilityState", () => ev("document.visibilityState"));
await step("全屏前进 fullscreenElement", () => ev("!!document.fullscreenElement"));
await step("调用 PK.fullscreen.toggle()", () => ev("window.PK && PK.fullscreen ? (PK.fullscreen.toggle(), 0) : -1"));
await sleep(1200);
await step("全屏后 fullscreenElement", () => ev("!!document.fullscreenElement"));
await step("再切回（退出全屏）", () => ev("window.PK && PK.fullscreen ? (PK.fullscreen.toggle(), 0) : -1"));
await sleep(1200);
await step("退出后 fullscreenElement", () => ev("!!document.fullscreenElement"));
await step("全屏往返之后跑 favicon 表达式", () => ev(favExpr));

cdp.close();
await killTree(proc.pid);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 / Ignore */ }


