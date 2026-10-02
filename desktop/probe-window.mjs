/**
 * 窗口尺寸探针：用与桌面快捷方式**完全相同**的启动参数开窗，
 * Window-size probe: opens a window with launch arguments **exactly the same** as the desktop shortcut,
 * 读出屏幕分辨率 / 工作区 / 窗口外框 / 视口 / 是否溢出屏幕。
 * reading out the screen resolution / work area / window frame / viewport / whether it overflows the screen.
 *
 * 为什么需要它：
 * Why it is needed:
 *   快捷方式写死了 `--window-size=1560,980`。如果目标机器的屏幕比这小，
 *   The shortcut hard-codes `--window-size=1560,980`. If the target machine's screen is smaller,
 *   Chrome 仍会按这个尺寸开窗 —— 窗口右缘与下缘伸出屏幕之外，
 *   Chrome still opens the window at that size —— the right and bottom edges extend past the screen,
 *   表现出来就是"有些地方被遮住/错位"，而不是报错。
 *   showing up as "some parts covered/misaligned" rather than an error.
 *   这件事必须用真实浏览器读数判定，不能靠看截图猜。
 *   This must be judged by real browser readings, not guessed from screenshots.
 *
 * 用法：
 * Usage:
 *   node probe-window.mjs                 # 用快捷方式当前的参数
 *   node probe-window.mjs                 # use the shortcut's current arguments
 *   node probe-window.mjs 1560x980         # 指定尺寸复现
 *   node probe-window.mjs 1560x980         # reproduce with a given size
 *   node probe-window.mjs --start-maximized  # 附加任意 Chrome 参数
 *   node probe-window.mjs --start-maximized  # append arbitrary Chrome arguments
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { requireBrowser } from "./browser.mjs";
import { inspectLnk } from "./lnk.mjs";
import { killTree } from "./proc.mjs";

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
  if (typeof WebSocket !== "function") throw new Error("需要 Node >= 22（自带 WebSocket）");
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let seq = 0;
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP 连接失败")), { once: true });
    setTimeout(() => reject(new Error("CDP 连接超时")), 8000);
  });
  ws.addEventListener("message", (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
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
    close() { try { ws.close(); } catch { /* 忽略 / Ignore */ } },
  };
}

/** 只读探针：屏幕 / 窗口 / 视口 / 溢出 / Read-only probe: screen / window / viewport / overflow */
const PROBE = `(() => {
  const de = document.documentElement;
  const b = document.body;
  const overflowX = Math.max(de.scrollWidth, b ? b.scrollWidth : 0) - de.clientWidth;
  const overflowY = Math.max(de.scrollHeight, b ? b.scrollHeight : 0) - de.clientHeight;
  /* 找出比视口还宽的元素（"被遮住"最可能的原因） */
  /* Find elements wider than the viewport (the most likely cause of "being covered") */
  const vw = de.clientWidth, vh = de.clientHeight;
  const wide = [];
  document.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > vw + 1 || r.height > vh + 1) {
      const id = el.id ? '#' + el.id : (el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\\s+/).join('.') : el.tagName.toLowerCase());
      wide.push(id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  });
  const f = document.getElementById('felt');
  const fr = f ? f.getBoundingClientRect() : null;
  return JSON.stringify({
    screen:  { w: screen.width, h: screen.height, availW: screen.availWidth, availH: screen.availHeight },
    window:  { outerW: window.outerWidth, outerH: window.outerHeight,
               innerW: window.innerWidth, innerH: window.innerHeight,
               screenX: window.screenX, screenY: window.screenY,
               outerRight: window.screenX + window.outerWidth,
               outerBottom: window.screenY + window.outerHeight },
    dpr: window.devicePixelRatio || 1,
    viewport: { w: vw, h: vh },
    overflowX, overflowY,
    fullscreen: matchMedia('(display-mode: fullscreen)').matches,
    wideEls: wide.slice(0, 8),
    wideCount: wide.length,
    felt: fr ? { w: Math.round(fr.width), h: Math.round(fr.height),
                 ratio: +(fr.width / fr.height).toFixed(3),
                 scale: getComputedStyle(de).getPropertyValue('--ui-scale').trim() } : null,
    street: window.__game ? window.__game.street : null,
    cards: document.querySelectorAll('.card').length
  });
})()`;

/* 牌桌严格 16:9.4 → 比例 1.702。偏离说明 measureFelt() 还没写入尺寸，
   The table is strictly 16:9.4 → ratio 1.702. A deviation means measureFelt() has not yet written the size,
   此时取值会得到"未定型"的容器高度（实测读到过 1.102），必须等它稳定。
   in which case reading gives an "unsettled" container height (1.102 was observed in testing); we must wait for it to stabilize. */
const TARGET_RATIO = 1.702;
const ratioOk = (f) => f && f.felt && Math.abs(f.felt.ratio - TARGET_RATIO) < 0.06;

/* ---------------- 参数解析 / Parameter parsing ---------------- */
/** Chrome 的 --window-size 是**逗号**分隔（`W,H`）。写成 `WxH` 会被静默忽略，
 *  Chrome's --window-size is **comma** separated (`W,H`). Writing it as `WxH` is silently ignored,
 *  窗口退回默认尺寸 —— 实测请求 1560x980/1920x1040/1366x728 三次都得到 1050x892，
 *  and the window falls back to the default size —— in testing, requesting 1560x980/1920x1040/1366x728 all three yielded 1050x892,
 *  若不核对实际外框就会以为"参数生效了"。这里统一转成逗号形式。
 *  so without checking the actual frame you would think "the argument took effect". Here we normalize to comma form. */
function toChromeSize(s) {
  const m = /^(\d+)[x,](\d+)$/.exec(String(s).trim());
  return m ? m[1] + "," + m[2] : null;
}

function parseArgs(argv) {
  const sizes = [];
  const extras = [];
  for (const a of argv.slice(2)) {
    if (a.startsWith("--")) { extras.push(a); continue; }
    if (a === "-" || a === "none") { sizes.push(null); continue; }   // 显式不传 --window-size / explicitly do not pass --window-size
    const norm = toChromeSize(a);
    if (norm) sizes.push(norm);
    else extras.push(a);
  }
  return { sizes: [...new Set(sizes)], extras };
}

/**
 * 从桌面快捷方式里读出它实际用的参数，作为默认复现目标
 * Read the arguments actually used from the desktop shortcut, as the default reproduction target
 */
function shortcutArgs() {
  const home = process.env.USERPROFILE || os.homedir();
  const cands = [
    path.join(home, "Desktop", "德州扑克练习室.lnk"),
    path.join(home, "OneDrive", "Desktop", "德州扑克练习室.lnk"),
  ];
  const lnk = cands.find((c) => fs.existsSync(c));
  if (!lnk) return { lnk: null, size: null };
  try {
    const info = inspectLnk(lnk);
    return { lnk, size: (info.windowSize || null), found: true };
  } catch {
    return { lnk, size: null, found: true };
  }
}

async function probe(label, sizeArg, extras) {
  const browser = requireBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nlhe-probe-"));
  const portFile = path.join(profile, "DevToolsActivePort");
  const args = ["--app=" + PAGE_URL, "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check"];
  if (sizeArg) args.push("--window-size=" + sizeArg);
  args.push(...extras);

  let proc;
  const out = { label, sizeArg, ok: false, facts: null, error: null };
  try {
    proc = spawn(browser.exe, args, { detached: false, stdio: "ignore" });

    let port = 0;
    for (let i = 0; i < 60; i++) {
      await sleep(400);
      if (fs.existsSync(portFile)) {
        port = Number(fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0].trim()) || 0;
        if (port > 0) break;
      }
      if (proc.exitCode !== null) { out.error = "浏览器提前退出 exit=" + proc.exitCode; return out; }
    }
    if (!port) { out.error = "未取得调试端口"; return out; }

    let target = null;
    for (let i = 0; i < 40; i++) {
      try {
        const list = await getJson(port, "/json/list");
        target = list.find((t) => t.type === "page" && /poker-trainer\.html/.test(t.url || ""))
              || list.find((t) => t.type === "page");
        if (target && target.webSocketDebuggerUrl) break;
      } catch { /* 重试 / Retry */ }
      await sleep(400);
    }
    if (!target) { out.error = "未发现页面 target"; return out; }

    const cdp = await connectCDP(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    const sample = async () => {
      const r = await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
      const v = r && r.result && r.result.value;
      if (!v) return null;
      try { return JSON.parse(v); } catch { return null; }
    };
    /* 等首手牌发出 + 布局定型（牌桌比例收敛到 1.702），再取值。
       Wait for the first hand to be dealt and the layout to settle (table ratio converging to 1.702) before sampling.
       否则会把"测量那一刻"的中间状态当成结论 —— 实测读到过比例 1.102。
       Otherwise the intermediate state "at the moment of measurement" would be taken as the conclusion —— a ratio of 1.102 was observed in testing. */
    let facts = null;
    for (let i = 0; i < 50; i++) {
      const f = await sample();
      if (f && f.street && f.cards >= 2 && ratioOk(f)) { facts = f; break; }
      await sleep(300);
    }
    if (!facts) facts = await sample();   // 兜底：附上最后一次读数 / fallback: attach the last reading

    /* ★ 权威通道：Browser.getWindowForTarget 直接给出 windowState
     * ★ Authoritative channel: Browser.getWindowForTarget directly gives windowState
     *   （normal / maximized / fullscreen）与 Chrome 自己的 bounds。
     *   (normal / maximized / fullscreen) and Chrome's own bounds.
     *   有了它就不必从 outerWidth 反推"到底是不是最大化了"——
     *   With it we no longer need to infer "is it really maximized" from outerWidth ——
     *   实测对照（同一台机器、同一份代码、全新 profile）：
     *   measured comparison (same machine, same code, brand-new profile):
     *     --window-size=1560,980 → state=normal,    bounds 10,10 1455×975
     *     --start-maximized      → state=maximized, bounds -7,-7 1454×926
     *   注意 bounds 是**物理像素**（含那圈不可见调整边框），页面侧 outerWidth 是
     *   Note bounds is in **physical pixels** (including that invisible resize border), while page-side outerWidth is
     *   CSS px（不含），所以同一扇最大化窗口在两处差一个边框宽 —— 两边都对，
     *   in CSS px (excluding it), so the same maximized window differs by one border width in the two places —— both are correct,
     *   只是坐标系不同。本探针的判据用页面侧（CSS）口径，故最大化窗口恰好贴合工作区，
     *   just in different coordinate systems. This probe's predicate uses the page-side (CSS) convention, so a maximized window exactly matches the work area,
     *   无需任何容差；Win32 口径（verify-entry）才需要按边框放宽。
     *   needing no tolerance at all; only the Win32 convention (verify-entry) needs to relax by the border width. */
    try {
      const ver = await getJson(port, "/json/version");
      if (ver && ver.webSocketDebuggerUrl) {
        const bw = await connectCDP(ver.webSocketDebuggerUrl);
        try {
          const t = await bw.send("Target.getTargets", {});
          const pg = (t.targetInfos || []).find((x) => /poker-trainer\.html/.test(x.url || ""));
          if (pg) {
            const w = await bw.send("Browser.getWindowForTarget", { targetId: pg.targetId });
            if (facts && w && w.bounds) {
              facts.windowState = w.bounds.windowState;
              facts.rawBounds = [w.bounds.left, w.bounds.top, w.bounds.width, w.bounds.height];
            }
          }
        } finally { bw.close(); }
      }
    } catch { /* 取不到就算了，不影响主判据 / Ignore if unavailable; it does not affect the main predicate */ }

    cdp.close();
    out.facts = facts;
    out.ok = !!facts;
    return out;
  } catch (e) {
    out.error = e.message;
    return out;
  } finally {
    try { await killTree(proc && proc.pid); } catch { /* 忽略 / Ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 / Ignore */ }
  }
}

/* ---------------- 主流程 / Main flow ---------------- */
const { sizes, extras } = parseArgs(process.argv);
const sc = shortcutArgs();

console.log("页面        : " + PAGE);
if (sc.lnk) {
  console.log("桌面快捷方式: " + sc.lnk);
  console.log("  其中窗口尺寸: " + (sc.size ? sc.size.raw + "（" + sc.size.w + " × " + sc.size.h + "）" : "未解析到 --window-size"));
} else {
  console.log("桌面快捷方式: 未找到");
}

/* 默认复现三档：快捷方式真实尺寸 → 当前屏幕工作区 → 常见的 1080p 工作区 */
/* Three default reproduction tiers: the shortcut's real size → the current screen's work area → a common 1080p work area */
const jobs = sizes.length
  ? sizes
  : [...new Set([
      sc.size ? sc.size.raw : "1560,980",
      "1440,912",
      "1920,1040",
    ])];

const results = [];
for (const s of jobs) {
  process.stdout.write("\n── 开窗 " + (s ? "--window-size=" + s : "（不传 --window-size，由 Chrome 自行决定）") +
    (extras.length ? "  + " + extras.join(" ") : "") + " ──\n");
  const r = await probe(s, s, extras);
  results.push(r);
  if (!r.ok) { console.log("  ✗ " + (r.error || "采集失败")); continue; }
  const f = r.facts;
  const overflowW = f.window.outerRight - f.screen.availW;
  const overflowH = f.window.outerBottom - f.screen.availH;
  const req = s ? /(\d+),(\d+)/.exec(s) : null;
  console.log("  屏幕 CSS 尺寸 : " + f.screen.w + " × " + f.screen.h +
              "   （工作区 " + f.screen.availW + " × " + f.screen.availH + "，DPR " + f.dpr + "）");
  if (req) {
    console.log("  请求尺寸      : " + s.replace(",", " × ") +
              (Number(req[1]) !== f.window.outerW || Number(req[2]) !== f.window.outerH
                ? "   ← 实际外框不同，参数未完全生效" : ""));
  }
  console.log("  窗口外框      : " + f.window.outerW + " × " + f.window.outerH +
              "   @ " + f.window.screenX + "," + f.window.screenY);
  console.log("  视口(内尺寸)  : " + f.window.innerW + " × " + f.window.innerH);
  console.log("  页面溢出      : 横向 " + f.overflowX + "px，纵向 " + f.overflowY + "px");
  console.log("  超宽元素      : " + (f.wideCount ? f.wideCount + " 个 → " + f.wideEls.join(" | ") : "无"));
  console.log("  牌桌          : " + (f.felt
    ? f.felt.w + " × " + f.felt.h + "（比例 " + f.felt.ratio + "，目标 " + TARGET_RATIO +
      (Math.abs(f.felt.ratio - TARGET_RATIO) < 0.06 ? " ✓" : " ⚠️ 未定型/被拉伸") + "）"
    : "缺失"));
  console.log("  全屏显示模式  : " + f.fullscreen);
  console.log("  窗口状态      : " + (f.windowState || "(取不到)") +
    (f.rawBounds ? "   物理外框 " + f.rawBounds[2] + " × " + f.rawBounds[3] +
      " @ " + f.rawBounds[0] + "," + f.rawBounds[1] + "（含不可见边框）" : ""));
  if (f.fullscreen) {
    /* 全屏时窗口本就该盖住任务栏（工作区高度不含任务栏），拿工作区判越界是误报。 */
    /* In fullscreen the window is supposed to cover the taskbar (work-area height excludes it), so judging out-of-bounds by the work area is a false positive. */
    console.log("  ✓ 全屏模式：铺满整屏 " + f.screen.w + " × " + f.screen.h + "（含任务栏，符合预期）");
  } else if (overflowW > 0 || overflowH > 0) {
    console.log("  ⚠️ 窗口超出屏幕：横向 " + (overflowW > 0 ? overflowW + "px" : "0") +
                "，纵向 " + (overflowH > 0 ? overflowH + "px" : "0") + "  → 右/下缘会被屏幕裁掉");
  } else {
    console.log("  ✓ 窗口完全落在工作区内");
  }
}

/* ---------------- 汇总判据 / Summary predicate ---------------- */
console.log("\n══════ 判据 ══════");
const bad = results.filter((r) => {
  if (!r.ok) return true;
  const f = r.facts;
  if (f.fullscreen) return Math.abs((f.felt ? f.felt.ratio : 0) - TARGET_RATIO) > 0.06;
  return f.window.outerRight > f.screen.availW || f.window.outerBottom > f.screen.availH
      || Math.abs((f.felt ? f.felt.ratio : 0) - TARGET_RATIO) > 0.06;
});
if (!bad.length) {
  console.log("✅ 全部窗口尺寸都能完整落在屏幕内、牌桌比例正常");
} else {
  console.log("❌ 有 " + bad.length + " 档不合格：");
  for (const r of bad) {
    const why = !r.ok ? "采集失败"
      : [
          (!r.facts.fullscreen && r.facts.window.outerRight > r.facts.screen.availW)
            ? "右缘超出 " + (r.facts.window.outerRight - r.facts.screen.availW) + "px" : "",
          (!r.facts.fullscreen && r.facts.window.outerBottom > r.facts.screen.availH)
            ? "下缘超出 " + (r.facts.window.outerBottom - r.facts.screen.availH) + "px" : "",
          Math.abs((r.facts.felt ? r.facts.felt.ratio : 0) - TARGET_RATIO) > 0.06
            ? "牌桌比例 " + (r.facts.felt ? r.facts.felt.ratio : "?") : "",
        ].filter(Boolean).join("；");
    console.log("   · " + (r.sizeArg || "（未传尺寸）") + "  → " + why);
  }
}
