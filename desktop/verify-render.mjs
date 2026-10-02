/**
 * 渲染验收：用「桌面快捷方式同一套命令」启动 Chrome 应用模式，
 * Render verification: launch Chrome in app mode with 「the same command set as the desktop shortcut」,
 * 通过 CDP（Chrome DevTools Protocol）连进页面做 DOM 级断言。
 * connect into the page via CDP (Chrome DevTools Protocol) and make DOM-level assertions.
 *
 * 为什么不用截图判定：
 * Why not judge by screenshot:
 *   窗口被遮挡或未取得前台时，CopyFromScreen 抓到的是压在下面的桌面壁纸，
 *   When the window is occluded or not foregrounded, CopyFromScreen captures the desktop wallpaper underneath,
 *   截图"保存成功"却什么都证明不了（本项目实测出现过这种假阳性）；
 *   so the screenshot "saves successfully" yet proves nothing (this project hit exactly that false positive in testing);
 *   PrintWindow 对 Chrome 的 GPU 合成窗口也会返回空白图。
 *   PrintWindow also returns a blank image for Chrome's GPU-composited windows.
 *   而 CDP 读的是页面真实 DOM —— 能明确证伪，不受焦点/遮挡影响。
 *   CDP instead reads the page's real DOM —— it can clearly falsify, unaffected by focus/occlusion.
 *
 * 为什么用独立 user-data-dir + 随机调试端口：
 * Why use a separate user-data-dir + a random debugging port:
 *   - 独立 profile 才会真正新起一个实例（否则会把手上的 Chrome 当成已运行实例而直接复用）；
 *   - only a separate profile truly starts a new instance (otherwise the running Chrome is treated as an existing instance and reused);
 *   - --remote-debugging-port=0 让系统分配空闲端口，避免与用户已开的调试端口冲突；
 *   - --remote-debugging-port=0 lets the system assign a free port, avoiding conflicts with the user's already-open debugging port;
 *   - 这两项仅用于测试，不会写进用户的桌面快捷方式。
 *   - these two are used only for testing and are never written into the user's desktop shortcut.
 *
 * 用法：
 * Usage:
 *   node verify-render.mjs            # 独立运行
 *   node verify-render.mjs            # run standalone
 *   import { verifyRender } from './verify-render.mjs'   # 供 verify-entry.mjs 编排
 *   import { verifyRender } from './verify-render.mjs'   # orchestrated by verify-entry.mjs
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
const EXPECT_TITLE = "德州扑克练习室 · NLHE Trainer";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 阶段标记：CDP 调用卡住时，异常里本来只带得出方法名（如 "Runtime.evaluate"），
   Phase marker: when a CDP call hangs, the exception would otherwise only carry the method name (e.g. "Runtime.evaluate"),
   而同一个方法在流程里被调用几十次，定位不到"卡在哪一步"。
   and the same method is called dozens of times in the flow, so "which step is stuck" cannot be located.
   所有会发 CDP 请求的地方都先更新这个变量，失败信息带上它，才不用靠猜。
   Every place that sends a CDP request updates this variable first, and failure messages include it, so no guessing is needed. */
let PHASE = "初始化";

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

/**
 * 极简 CDP 客户端（Node 22 自带 WebSocket，无需第三方依赖）
 * Minimal CDP client (Node 22 ships WebSocket, no third-party dependency needed)
 */
async function connectCDP(wsUrl) {
  if (typeof WebSocket !== "function") throw new Error("当前 Node 运行时不支持 WebSocket（需 Node >= 22）");
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
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  });

  return {
    send(method, params = {}) {
      const id = ++seq;
      /* 连接已关闭时 ws.send() **既不报错也不回包**，请求会静默消失，
         When the connection is closed, ws.send() **neither errors nor replies**, and the request silently vanishes,
         最后只能等到 20s 超时才失败 —— 实测被这样坑过一次（断言写在 cdp.close() 之后）。
         so it only fails after waiting the full 20s timeout —— this bit us once in testing (an assertion written after cdp.close()).
         这里直接拒绝，把"等 20 秒"换成"立刻说清原因"。
         Here we reject immediately, replacing "wait 20 seconds" with "state the reason at once". */
      if (ws.readyState !== 1) {
        return Promise.reject(new Error("CDP 连接已关闭，无法发送 " + method + "（阶段：" + PHASE + "）"));
      }
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); rej(new Error("CDP 超时：" + method + "（阶段：" + PHASE + "）")); }
        }, 20000);
      });
    },
    on(fn) { listeners.push(fn); },
    close() { try { ws.close(); } catch { /* 忽略 / Ignore */ } },
  };
}

/**
 * 在页面里采集一份"体检报告"；字符串表达式，避免依赖外部源码注入
 * Collect a "health report" in the page; a string expression, to avoid depending on external source injection
 */
const PROBE = `(() => {
  const felt = document.getElementById('felt');
  const seats = Array.from(document.querySelectorAll('.seat'));
  const labels = seats.map(s => { const e = s.querySelector('.seat-pos'); return e ? e.textContent.trim() : ''; });
  let storage = 'n/a';
  try {
    const k = '__nlhe_probe__';
    localStorage.setItem(k, '1');
    storage = localStorage.getItem(k) === '1' ? 'ok' : 'mismatch';
    localStorage.removeItem(k);
  } catch (e) { storage = 'unavailable:' + e.name; }
  const g = window.__game || null;
  const P = window.PK || {};
  return JSON.stringify({
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    felt: felt ? { w: felt.clientWidth, h: felt.clientHeight } : null,
    scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
    seats: seats.length,
    labels,
    uniqueLabels: new Set(labels).size,
    cards: document.querySelectorAll('.card').length,
    cardBacks: document.querySelectorAll('.card.back').length,
    storage,
    hasGame: !!g,
    players: g && g.players ? g.players.length : 0,
    street: g ? g.street : null,
    pot: g ? g.pot : null,
    mods: {
      Game: !!P.Game, UI: !!P.UI, Store: !!P.Store,
      Replay: !!P.Replay, Drill: !!P.Drill,
      Scenarios: !!P.SCENARIOS,
      equity: typeof P.estimateEquity === 'function',
      /* B/C/D 组的模块。range.js 与 profile.js 曾经既不在 index.html 的
         <script> 列表里、也不在 build.js 的 JS_ORDER 里 —— 功能"写好了"
         却整条链路是断的，而且完全不报错。这几个字段就是防它重演。 */
      Range: !!P.Range, Profile: !!P.Profile,
      EVLoss: !!P.EVLoss, Bridge: !!P.Bridge, Leaks: !!P.Leaks
    }
  });
})()`;

/**
 * @param {{ quiet?: boolean }} opts
 * @returns {Promise<{ok:boolean, checks:Array, facts:object|null, errors:string[]}>}
 */
export async function verifyRender(opts = {}) {
  const say = opts.quiet ? () => {} : (...a) => console.log(...a);
  const result = { ok: false, checks: [], facts: null, errors: [], invalid: [] };
  /* add()     → 真判定，通过/不通过
   * add()     → a real verdict, pass/fail
   * invalidate() → 这一项**本轮测不了**（前置不满足）。它既不算通过也不算失败：
   * invalidate() → this item **cannot be tested this round** (precondition unmet). It counts neither as pass nor fail:
   *   算通过 = 把"没测"伪装成"测过了"（恒真断言，等于没写）；
   *   counting it as pass = disguising "not tested" as "tested" (a tautological assertion, equivalent to none);
   *   算失败 = 把环境问题报成产品缺陷（已经误导过一次）。
   *   counting it as fail = reporting an environment problem as a product defect (it has already misled once).
   *   所以单列，并让整轮标记为"作废"。
   *   So it is listed separately and the whole round is marked "invalid". */
  const add = (name, ok, val) => result.checks.push([name, !!ok, val || ""]);
  const invalidate = (name, val) => {
    result.checks.push([name, null, val || ""]);
    result.invalid.push(name);
  };

  if (!fs.existsSync(PAGE)) {
    result.errors.push("找不到 " + PAGE + "，请先运行：node build.js");
    return result;
  }

  const browser = requireBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nlhe-verify-"));
  const portFile = path.join(profile, "DevToolsActivePort");

  let proc;
  try {
    say("启动浏览器 : " + path.basename(browser.exe) + "（应用模式 + 随机调试端口）");
    say("页面       : " + PAGE);

    proc = spawn(browser.exe, [
      "--app=" + PAGE_URL,
      "--window-size=1200,760",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      "--no-first-run",
      "--no-default-browser-check",
      /* 关闭 Windows 的"原生窗口遮挡判定"。
         Disable Windows' "native window occlusion calculation".
         开着的时候，只要窗口被系统判为不可见（被别的窗口完全遮住、会话断开等），
         While it is on, whenever the window is judged invisible by the system (fully covered by another window, session disconnected, etc.),
         页面 document.visibilityState 就是 'hidden'，Chrome 会**挂起全屏状态机**：
         the page's document.visibilityState is 'hidden' and Chrome **suspends the fullscreen state machine**:
         fullscreenElement 置真但 fullscreenchange 永不触发、exitFullscreen 也无效。
         fullscreenElement is set true but fullscreenchange never fires and exitFullscreen has no effect either.
         实测（desktop/probe-fullscreen.mjs）：不加此参数时全屏的 5 项断言里有 2 项
         Measured (desktop/probe-fullscreen.mjs): without this argument 2 of the 5 fullscreen assertions
         恒红，加了这个参数后同一份源码 5 项全过 —— 也就是说那 2 项红是**环境**造成的，
         were permanently red; with this argument the same source passed all 5 —— that is, those 2 reds were caused by the **environment**,
         与 poker 代码无关。
         not by the poker code. */
      "--disable-features=CalculateNativeWinOcclusion",
    ], { detached: false, stdio: "ignore" });

    /* ---- 1. 等 DevToolsActivePort 落盘，拿到真实调试端口 / 1. Wait for DevToolsActivePort to be written, then get the real debugging port ---- */
    PHASE = "等待 DevToolsActivePort";
    let port = 0;
    for (let i = 0; i < 60; i++) {
      await sleep(400);
      if (fs.existsSync(portFile)) {
        const first = fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0].trim();
        port = Number(first);
        if (port > 0) break;
      }
      if (proc.exitCode !== null) { result.errors.push("浏览器进程提前退出，exit=" + proc.exitCode); return result; }
    }
    if (!port) { result.errors.push("未能获取调试端口（DevToolsActivePort 未生成）"); return result; }
    say("调试端口   : " + port);

    /* ---- 2. 找到页面 target / 2. Find the page target ---- */
    PHASE = "查找页面 target";
    let target = null;
    for (let i = 0; i < 40; i++) {
      try {
        const list = await getJson(port, "/json/list");
        target = list.find((t) => t.type === "page" && /poker-trainer\.html/.test(t.url || ""))
              || list.find((t) => t.type === "page");
        if (target && target.webSocketDebuggerUrl) break;
      } catch { /* 端口刚起好，重试 / the port just came up, retry */ }
      await sleep(400);
    }
    if (!target) { result.errors.push("未发现页面 target"); return result; }

    /* ---- 3. 连上页面，收集控制台错误 / 3. Connect to the page and collect console errors ---- */
    PHASE = "连接 CDP";
    const cdp = await connectCDP(target.webSocketDebuggerUrl);
    const jsErrors = [];
    const consoleErrors = [];
    cdp.on((msg) => {
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        jsErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text || "未知异常");
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        consoleErrors.push(msg.params.entry.text);
      }
    });
    PHASE = "启用 CDP 域";
    await cdp.send("Runtime.enable");
    try { await cdp.send("Log.enable"); } catch { /* 可选域 / optional domain */ }
    PHASE = "采集 DOM 状态（等首手牌发出）";

    /* ---- 4. 等首手牌发出（应用在 load 后约 200ms 自动开局） ----
     * ---- 4. Wait for the first hand to be dealt (the app auto-starts about 200ms after load) ----
     * 退出条件不能只看 hasGame：Game 实例在构造阶段就已存在（players 已就位），
     * The exit condition cannot rely on hasGame alone: the Game instance already exists at construction (players are in place),
     * 但此时还没发牌（street 未设置、cards 为 0）。若在此刻取快照，"牌面已发出"
     * but cards have not been dealt yet (street unset, cards 0). Taking a snapshot now makes "cards were dealt"
     * 会假失败。因此必须等到真的进入某条街且有牌。
     fail spuriously. So we must wait until it has really entered a street and has cards. */
    const probeOnce = async () => {
      const r = await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
      const v = r && r.result && r.result.value;
      if (!v) return null;
      try { return JSON.parse(v); } catch { return null; }
    };

    let facts = null;
    for (let i = 0; i < 40; i++) {
      const f = await probeOnce();
      if (f) {
        facts = f;
        if (f.readyState === "complete" && f.seats > 0 && f.hasGame && f.street && f.cards >= 2) break;
      }
      await sleep(350);
    }
    await sleep(600);          // 让异常事件先到齐 / let exception events arrive first
    const final = await probeOnce();   // 再采一次，确保快照反映的是"牌已发出"的状态 / sample again to ensure the snapshot reflects the "cards dealt" state
    if (final) facts = final;
    if (!facts) { cdp.close(); result.errors.push("页面未在预期时间内就绪，无法采集 DOM 状态"); return result; }
    result.facts = facts;

    /* ---- 4b. 全屏开关：断言真实相位，不看按钮文案 ----
     * ---- 4b. Fullscreen toggle: assert the real phase, not the button text ----
     * requestFullscreen 需要"用户手势"，否则会被拒绝。CDP 的 Runtime.evaluate
     * requestFullscreen requires a "user gesture" or it is rejected. CDP's Runtime.evaluate
     * 支持 userGesture:true 来模拟手势 —— 这样测的是真实行为，不是把函数名念一遍。
     * supports userGesture:true to simulate a gesture —— so what is tested is the real behavior, not reciting a function name.
     * 按钮文案会随状态改（全屏 ↔ 退出全屏），拿文案当判据会把"状态变了但全屏没生效"
     * The button text changes with state (fullscreen ↔ exit fullscreen); using the text as the predicate would mark "state changed but fullscreen did not take effect"
     * 也判成通过，所以判据落在 document.fullscreenElement 上。
     * as passing too, so the predicate is based on document.fullscreenElement.
     *
     * ⚠️ 必须**轮询到状态到达**，不能用固定 sleep：全屏切换是有动画的异步过程，
     * ⚠️ You must **poll until the state arrives**, not use a fixed sleep: fullscreen switching is an animated async process,
     * 新 profile 首启时可能超过 0.8s。固定等待会让断言随机变红（实测同一份代码
     * and on a new profile's first start it can exceed 0.8s. A fixed wait makes the assertion randomly fail (the same code passed all 5 items
     * 单独跑 5 项全过、在 verify-entry 里嵌套跑时挂了 2 项）。
     * when run alone, but hung 2 items when nested inside verify-entry).
     *
     * ⚠️⚠️ 前置条件（这一条踩过一次，务必读）：
     * ⚠️⚠️ Precondition (we got burned by this once; be sure to read it):
     *   Chrome 在 Windows 上默认开启"原生窗口遮挡判定"（CalculateNativeWinOcclusion）。
     *   On Windows, Chrome enables "native window occlusion calculation" (CalculateNativeWinOcclusion) by default.
     *   窗口被系统判定为不可见时，页面 document.visibilityState 会变成 'hidden'，
     *   When the system judges the window invisible, the page's document.visibilityState becomes 'hidden',
     *   **整个全屏状态机随之被挂起**，表现为：
     *   and **the entire fullscreen state machine is suspended as a result**, showing up as:
     *     · document.fullscreenElement 乐观置真、display-mode: fullscreen 也匹配
     *     · document.fullscreenElement is optimistically set true and display-mode: fullscreen also matches
     *     · 但 fullscreenchange 事件**永不触发** → 按钮状态不更新
     *     · but the fullscreenchange event **never fires** → the button state does not update
     *     · exitFullscreen() 同样不生效，一直卡在全屏
     *     · exitFullscreen() also has no effect, staying stuck in fullscreen
     *   实测证据（desktop/probe-fullscreen.mjs，同一份代码）：
     *   Measured evidence (desktop/probe-fullscreen.mjs, same code):
     *     不加参数            → visibilityState=hidden，事件轴只有
     *     Without the argument    → visibilityState=hidden, the event timeline has only
     *                           requestFullscreen → resolve，**无 change**；
     *                              requestFullscreen → resolve, **no change**;
     *                           按钮 aria-pressed 始终 false；退出无效
     *                              button aria-pressed always false; exit has no effect
     *     加 --disable-features=CalculateNativeWinOcclusion
     *     With --disable-features=CalculateNativeWinOcclusion
     *                        → visibilityState=visible，change 正常触发，
     *                        → visibilityState=visible, change fires normally,
     *                           按钮 aria-pressed=true，退出后回到 false
     *                              button aria-pressed=true, back to false after exit
     *   这是**测试环境问题，不是产品缺陷**（真实用户看着窗口时窗口必然可见）。
     *   This is a **test-environment problem, not a product defect** (when a real user looks at the window, it is necessarily visible).
     *   所以处理是两件事：
     *   So the handling is two things:
     *     ① 启动参数禁用该特性（见下面 spawn 处）；
     *     ① disable the feature via a launch argument (see the spawn below);
     *     ② 这里仍显式断言前置 —— 前置不满足就把这几项标成"作废"，
     *     ② still explicitly assert the precondition here —— if unmet, mark these items "invalid",
     *        而不是判红：判红会让人误以为产品坏了（实测已经误导过一次）。
     *        rather than failing: failing would make people think the product is broken (it already misled once).
     */
    const evalIn = async (expr) => {
      const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, userGesture: true });
      return r && r.result ? r.result.value : null;
    };
    const waitFor = async (expr, want, ms = 5000) => {
      const t0 = Date.now();
      let last = null;
      while (Date.now() - t0 < ms) {
        last = await evalIn(expr);
        if (last === want) return last;
        await sleep(150);
      }
      return last;   // 超时返回最后一次读数，交给断言报错 / on timeout return the last reading and let the assertion report the error
    };

    const FS_CHECKS = [
      "全屏开关初始状态为「未全屏」",
      "点击全屏后真的进入全屏（document.fullscreenElement 非空）",
      "全屏时按钮状态同步为「已全屏」",
      "全屏后牌桌比例仍为 16:9.4（未被拉伸）",
      "退出全屏后回到未全屏状态",
    ];

    PHASE = "全屏状态机（visibilityState / fullscreenchange）";
    const visibility = await evalIn("document.visibilityState");
    if (visibility !== "visible") {
      const why = "前置不满足：document.visibilityState=" + visibility
        + "（窗口被系统判为不可见，Chrome 会挂起全屏状态机）";
      FS_CHECKS.forEach((n) => invalidate(n, why));
    } else {
      const fsBefore = await evalIn("!!document.fullscreenElement");
      await evalIn("window.PK && PK.fullscreen ? (PK.fullscreen.toggle(), 0) : -1");
      const fsDuring = await waitFor("!!document.fullscreenElement", true);
      const fsBtnOn = await waitFor("document.getElementById('btn-fullscreen').classList.contains('on')", true);
      const fsFelt = await evalIn("(() => { const f = document.getElementById('felt'); if (!f) return 0; const r = f.getBoundingClientRect(); return Math.round(r.width / r.height * 1000) / 1000; })()");
      await evalIn("document.fullscreenElement ? (document.exitFullscreen(), 0) : 0");
      const fsAfter = await waitFor("!!document.fullscreenElement", false);

      add(FS_CHECKS[0], fsBefore === false, String(fsBefore));
      add(FS_CHECKS[1], fsDuring === true, String(fsDuring));
      add(FS_CHECKS[2], fsBtnOn === true, String(fsBtnOn));
      add(FS_CHECKS[3], Math.abs(fsFelt - 1.702) < 0.06, "比例 " + fsFelt);
      add(FS_CHECKS[4], fsAfter === false, String(fsAfter));
    }

    /* 内嵌 favicon —— Chrome 应用模式窗口图标（= 任务栏按钮图标）的唯一来源。
     * Embedded favicon —— the sole source of the Chrome app-mode window icon (= taskbar button icon).
     *
     * 为什么必须单独断言：.lnk 里的 .ico 只决定**桌面图标和固定项**，决定不了
     * Why it must be asserted separately: the .ico in the .lnk only decides the **desktop icon and pinned items**, not
     * 运行中窗口的任务栏按钮。Chrome 用 `--app=` 开窗时，窗口图标取自页面 favicon；
     * the taskbar button of a running window. When Chrome opens a window with `--app=`, the window icon comes from the page favicon;
     * 页面没声明 favicon 就回退到 Chrome 自带的**灰色**默认应用图标。
     * if the page declares no favicon it falls back to Chrome's bundled **grey** default app icon.
     * 实测（desktop/probe-window-icon.py 读 WM_GETICON）：无 favicon 时窗口图标
     * Measured (desktop/probe-window-icon.py reading WM_GETICON): without a favicon the window icon's
     * 主色是灰 #666666；把 favicon 换成纯品红后，窗口图标整块变品红 ——
     * dominant color is grey #666666; after switching the favicon to pure magenta, the window icon turns entirely magenta ——
     * 也就是"图标做得再漂亮，少这一行照样是灰的"。
     * that is, "however pretty the icon file is, without this one line it is still grey".
     *
     * 判据取 DOM 里真实的 link[rel=icon]，并**真的解码** data URI 校验 PNG 头与尺寸，
     * The predicate takes the real link[rel=icon] in the DOM and **really decodes** the data URI to check the PNG header and size,
     * 不只看"有没有这行"—— 否则写个空 href 也能蒙过。
     * not merely "is the line there" —— otherwise an empty href would pass.
     *
     * ⚠️ 位置有讲究：必须排在 `cdp.close()` **之前**。放在那之后的话，evalIn 发出的
     * ⚠️ Placement matters: it must come **before** `cdp.close()`. If placed after, the requests sent by evalIn
     *    请求会因为连接已关闭而**没有任何回音**（ws.send 不报错、也不回包），
     *    would get **no response at all** because the connection is closed (ws.send neither errors nor replies),
     *    表现是干等满 20s 才抛超时——本文件里踩过一次，排查成本很高。
     *    showing up as waiting the full 20s before throwing a timeout —— we hit this once here and it was costly to diagnose. */
    PHASE = "内嵌 favicon 断言";
    const fav = await evalIn(`(() => {
      const l = document.querySelector('link[rel="icon"]');
      if (!l) return { ok: false, why: "页面没有 link[rel=icon]" };
      const h = l.getAttribute("href") || "";
      const pre = "data:image/png;base64,";
      if (h.indexOf(pre) !== 0) return { ok: false, why: "不是内嵌 PNG：先 " + JSON.stringify(h.slice(0, 32)) };
      const bin = atob(h.slice(pre.length));
      if (bin.length < 200) return { ok: false, why: "数据过小 " + bin.length + "B" };
      const b = (i) => bin.charCodeAt(i);
      if (b(0) !== 0x89 || b(1) !== 0x50 || b(2) !== 0x4e || b(3) !== 0x47)
        return { ok: false, why: "PNG 魔数不对" };
      const w = (b(16) << 24) | (b(17) << 16) | (b(18) << 8) | b(19);
      const hh = (b(20) << 24) | (b(21) << 16) | (b(22) << 8) | b(23);
      return { ok: w >= 64 && hh >= 64, why: w + "×" + hh + "  " + bin.length + "B" };
    })()`);
    add("内嵌 favicon（缺则应用模式任务栏退回 Chrome 灰色图标）",
      fav && fav.ok, fav ? fav.why : "取不到（evalIn 无返回）");

    cdp.close();

    /* ---- 5. 断言 / 5. Assertions ---- */
    const m = facts.mods || {};
    add("页面地址指向已打包单文件", /poker-trainer\.html$/.test(facts.href), facts.href);
    add("窗口标题正确（取自 document.title）", facts.title === EXPECT_TITLE, facts.title);
    add("文档加载完成", facts.readyState === "complete", facts.readyState);
    add("牌桌元素已渲染且有尺寸", !!facts.felt && facts.felt.w > 200 && facts.felt.h > 100,
      facts.felt ? facts.felt.w + "×" + facts.felt.h : "缺失");
    add("界面缩放变量已生效", Number(facts.scale) > 0, "--ui-scale=" + facts.scale);
    add("座位已渲染", facts.seats >= 2, facts.seats + " 个座位");
    add("位置标签齐全且不重复", facts.labels.length === facts.seats
      && facts.uniqueLabels === facts.seats && facts.labels.every(Boolean),
      facts.labels.join(" / "));
    add("牌面已发出", facts.cards >= facts.players * 2,
      facts.cards + " 张（背面 " + facts.cardBacks + " 张 / " + facts.players + " 人）");
    add("游戏实例已创建", facts.hasGame && facts.players === facts.seats,
      "players=" + facts.players + " street=" + facts.street + " pot=" + facts.pot);
    add("核心模块齐备（引擎/界面/持久化）", m.Game && m.UI && m.Store,
      ["Game", "UI", "Store"].map((k) => k + "=" + !!m[k]).join(" "));
    add("本次新增三项功能已加载", m.Replay && m.Drill && m.Scenarios && m.equity,
      ["Replay", "Drill", "Scenarios", "equity"].map((k) => k + "=" + !!m[k]).join(" "));
    const bcd = ["Range", "Profile", "EVLoss", "Bridge", "Leaks"];
    add("B/C/D 组模块已加载（范围/画像/EV复盘/题库联动/漏洞面板）",
      bcd.every((k) => !!m[k]),
      bcd.map((k) => k + "=" + !!m[k]).join(" "));
    add("localStorage 可用（持久化前提）", facts.storage === "ok", facts.storage);

    add("双端加载无未捕获异常", jsErrors.length === 0, jsErrors.length ? jsErrors[0] : "0 个");
    add("无控制台错误", consoleErrors.length === 0, consoleErrors.length ? consoleErrors[0] : "0 条");

    if (jsErrors.length) result.errors.push(...jsErrors);
    /* 作废的一轮不给"通过"结论：ok 要求**每项都真通过**（ok === true） */
    /* An invalid round does not get a "pass" verdict: ok requires **every item to truly pass** (ok === true) */
    result.ok = result.checks.length > 0 && result.checks.every(([, ok]) => ok === true);
    return result;
  } finally {
    /* ---- 6. 收尾：整棵进程树关掉，删除临时 profile / 6. Wrap up: kill the whole process tree and delete the temp profile ---- */
    try { await killTree(proc && proc.pid); } catch { /* 忽略 / Ignore */ }
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 / Ignore */ }
  }
}

/* ---------------- 作为脚本直接运行时 / When run directly as a script ---------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let r;
  try {
    r = await verifyRender();
  } catch (e) {
    /* 走到这里说明有 CDP 调用卡到超时（异常信息里带阶段名）。
       Reaching here means a CDP call hung until timeout (the exception message carries the phase name).
       以前这种情况会以"未处理的 Promise 拒绝"直接崩栈：既没有部分结果，
       Previously this crashed the stack with an "unhandled Promise rejection": no partial results,
       也看不出卡在哪一步。现在明确报出阶段并以非零码退出 —— 仍然是硬失败，
       and no indication of which step hung. Now the phase is clearly reported and it exits with a non-zero code —— still a hard failure,
       只是可定位。
       just a locatable one. */
    console.error("\n❌ 渲染验收中断：" + e.message);
    console.error("   卡在阶段：" + PHASE);
    console.error("   提示：Chrome 无响应/窗口被系统挂起时会出现这种情况；" +
      "重跑一次仍卡在同一阶段，再按该阶段往下查。");
    process.exit(1);
  }
  console.log("\n── 渲染验收 ──");
  for (const [name, ok, val] of r.checks) {
    console.log((ok === null ? "  ⊘ " : (ok ? "  ✓ " : "  ✗ ")) + name + (val ? "  → " + val : ""));
  }
  if (r.errors.length && !r.ok) console.log("\n错误：" + r.errors.join("\n      "));
  if (r.invalid.length) {
    console.log("\n⊘ 本轮作废：" + r.invalid.length + " 项因前置条件不满足而无法判定，"
      + "结论不成立 —— 这不是产品缺陷，请改善运行环境后重跑。");
    console.log("  受影响：" + r.invalid.join(" / "));
    process.exit(1);
  }
  console.log(r.ok ? "\n✅ 渲染验收通过：" + r.checks.length + " 项断言全部满足"
                   : "\n❌ 渲染验收未通过");
  process.exit(r.ok ? 0 : 1);
}
