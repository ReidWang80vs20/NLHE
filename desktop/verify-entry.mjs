/**
 * 入口验收：确认"双击桌面图标 → 打开的游戏窗口是好的"。
 * Entry verification: confirm that "double-clicking the desktop icon → the game window that opens is good".
 *
 * 分三段，逐段独立成立，避免任何一段的假阳性盖过整体结论：
 * Split into three stages, each independently valid, so no stage's false positive can override the overall conclusion:
 *   A. 快捷方式内容 —— 二进制解析 .lnk，确认目标/参数/图标真的指对了（不依赖启动窗口）
 *   A. Shortcut contents —— parse the .lnk binary and confirm the target/arguments/icon really point correctly (independent of launching a window)
 *   B. 真实渲染     —— 用同一套命令行启动 Chrome 应用模式，CDP 直连页面做 DOM 断言
 *   B. Real rendering   —— launch Chrome app mode with the same command line and connect via CDP for DOM assertions
 *   C. 双击联动     —— 实际打开 .lnk，确认出现标题匹配的窗口
 *   C. Double-click linkage —— actually open the .lnk and confirm a window with a matching title appears
 *
 * 为什么不再用截图当判定依据：
 * Why screenshots are no longer used as the basis:
 *   窗口被遮挡/未取得前台时，屏幕抓图拍的是压在下面的桌面壁纸，文件照样"保存成功"。
 *   When the window is occluded/not foregrounded, the screen grab captures the desktop wallpaper underneath, yet the file still "saves successfully".
 *   本项目实测已出现过一次纯壁纸的"通过"截图。故截图降级为留档证据，判定交给 B 段。
 *   This project already produced a "pass" screenshot that was pure wallpaper. So screenshots are demoted to archival evidence; the verdict goes to stage B.
 *
 * 用法：
 * Usage:
 *   node verify-entry.mjs            # 完整验收（会短暂弹出窗口后自动关闭）
 *   node verify-entry.mjs            # full verification (a window briefly pops up then closes)
 *   node verify-entry.mjs --keep     # 保留窗口不关闭
 *   node verify-entry.mjs --keep     # keep the window open
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnDetached, runCapture } from "./proc.mjs";
import { fileURLToPath } from "node:url";
import { inspectLnk } from "./lnk.mjs";
import { parseRect, judgeWindow, describeWindowVerdict, WINDOW_OK_LABEL } from "./wingeom.mjs";
import { requireBrowser } from "./browser.mjs";
import { verifyRender } from "./verify-render.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PS1 = path.join(here, "shot-window.ps1");
/* ★ 快捷方式定位 —— **绝不能写死文件名**。
 * ★ Shortcut discovery —— **never hard-code the file name**.
 *
 * 原来这里写死 "德州扑克练习室.lnk"。用户把桌面图标改名为 "NLHE练习室.lnk" 之后，
 * It used to hard-code "德州扑克练习室.lnk". After the user renamed the desktop icon to "NLHE练习室.lnk",
 * 文件明明就在桌面上，验收却报"快捷方式不存在，请先运行 make-shortcut.mjs" ——
 * the file was clearly still on the desktop, yet verification reported "shortcut does not exist, run make-shortcut.mjs first" ——
 * 也就是说这段验收**一直在验一个不存在的入口**，却没人发现：它的失败信息
 * that is, this check **had been verifying a non-existent entry** without anyone noticing: its failure message
 * 指向"你没建快捷方式"，看起来像环境问题，不像断言缺陷。
 * pointed at "you didn't create the shortcut", which looks like an environment problem, not an assertion defect.
 *
 * 正解是"按内容找，不按名字找"：扫桌面所有 .lnk，取目标里含 poker-trainer.html
 * The right answer is "find by content, not by name": scan all .lnk files on the desktop and take the one whose target contains poker-trainer.html
 * 的那个。名字只作为兜底，也可以从命令行显式指定。
 * The name serves only as a fallback, and it can also be specified explicitly on the command line.
 */
function findLnk() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (arg) return path.resolve(arg);
  const home = process.env.USERPROFILE || os.homedir();
  const dirs = [
    path.join(home, "Desktop"),
    path.join(home, "OneDrive", "Desktop"),
    process.env.OneDrive ? path.join(process.env.OneDrive, "Desktop") : null,
  ].filter(Boolean);
  const hits = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/\.lnk$/i.test(f)) continue;
      const p = path.join(d, f);
      try {
        if (/poker-trainer\.html/i.test(fs.readFileSync(p).toString("utf16le"))) hits.push(p);
      } catch { /* 读不了就跳过，别让一个坏文件挡住其余候选 / if unreadable, skip it; don't let one bad file block the other candidates */ }
    }
  }
  if (hits.length) return hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return path.join(home, "Desktop", "\u5fb7\u5dde\u6251\u514b\u7ec3\u4e60\u5ba4.lnk");
}
const LNK = findLnk();
const SHOT_DIR = path.join(ROOT, "test", "shots");
const SHOT = path.join(SHOT_DIR, "20-\u684c\u9762\u5165\u53e3\u6253\u5f00.png");

/**
 * 窗口标题里的 ASCII 特征串：页面 <title> 为「德州扑克练习室 · NLHE Trainer」
 * The ASCII marker in the window title: the page <title> is 「德州扑克练习室 · NLHE Trainer」
 */
const MATCH = "NLHE Trainer";
const KEEP = process.argv.includes("--keep");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
let invalid = 0;
const report = [];
function line(ok, name, val) {
  /* ok === null 表示"本轮测不了"（前置不满足），既不算通过也不算失败 ——
     ok === null means "cannot be tested this round" (precondition unmet); it counts neither as pass nor fail ——
     算通过等于把没测的伪装成测过的，算失败等于把环境问题报成产品缺陷。
     counting it as pass disguises not-tested as tested; counting it as fail reports an environment problem as a product defect. */
  const mark = ok === null ? "  \u2298 " : (ok ? "  \u2713 " : "  \u2717 ");
  report.push(mark + name + (val ? "  \u2192 " + val : ""));
  if (ok === false) failed++;
  if (ok === null) invalid++;
  console.log(report[report.length - 1]);
}

fs.mkdirSync(SHOT_DIR, { recursive: true });

/* ══════════════════════════ A. 快捷方式内容 / A. Shortcut contents ══════════════════════════ */
console.log("【A】快捷方式内容");
if (!fs.existsSync(LNK)) {
  console.error("  \u2717 快捷方式不存在：" + LNK + "\n    \u8bf7\u5148\u8fd0\u884c\uff1anode make-shortcut.mjs");
  process.exit(1);
}

const browser = requireBrowser();
const info = inspectLnk(LNK);

line(true, "快捷方式文件存在", path.basename(LNK) + "（" + info.size + " 字节）");
line(info.hasAny(browser.exe), "目标为所选浏览器", path.basename(browser.exe));
line(fs.existsSync(browser.exe), "目标可执行文件存在", browser.exe);
line(info.has("--app=") && info.has("poker-trainer.html"),
  "命令行含应用模式与页面地址", "--app=file:///.../poker-trainer.html");
line(info.has("\u5fb7\u5dde\u6251\u514b\u7ec3\u4e60\u5ba4") || info.has("NLHE") || info.has("Trainer"),
  "带应用名描述", "Texas Hold'em No-Limit Trainer");

/* ★ 开窗方式：必须"有 --start-maximized 且没有写死 --window-size"。
 * ★ Window-opening mode: it must "have --start-maximized and not hard-code --window-size".
 * 曾经写死 --window-size=1560,980，在 1440×960 的屏幕上窗口实际是 1455×975 @ (10,10)，
 * It once hard-coded --window-size=1560,980; on a 1440×960 screen the window was actually 1455×975 @ (10,10),
 * 右缘超出 25px、下缘超出 73px —— 表现为"右边和底部被遮住"。
 * with the right edge 25px over and the bottom edge 73px over —— showing as "right and bottom covered".
 * 两者同时存在时 --window-size 会胜出，所以必须成对断言，只查"有最大化参数"会漏。
 * When both exist --window-size wins, so they must be asserted as a pair; checking only "has a maximize flag" would miss it. */
line(info.has("--start-maximized"), "带 --start-maximized（按屏幕自适应）", "--start-maximized");
line(!info.windowSize, "未写死 --window-size（否则会在小屏上盖过最大化、被裁）",
  info.windowSize ? "检测到 " + info.windowSize.raw + " —— 必须删除" : "无");

/* ★ 图标：光有"图标位置记录"不够，还必须指向**当前最新的**那份版本化 .ico。
 * ★ Icon: having "an icon-location record" is not enough; it must point at the **current latest** versioned .ico.
 * 只查"有没有 nlhe-xxxx.ico"的话，重新生成图标后忘了重建快捷方式，老断言照样绿，
 * If it only checked "is there an nlhe-xxxx.ico", then after regenerating the icon and forgetting to rebuild the shortcut, the old assertion would stay green,
 * 而桌面图标其实还是旧设计 —— 这种"更新了一半"正是最难发现的失败模式。
 * even though the desktop icon is still the old design —— this "half-updated" state is exactly the hardest failure mode to spot. */
const lnkText = fs.readFileSync(LNK).toString("utf16le");
const iconMatch = /nlhe-[0-9a-f]{8}\.ico/.exec(lnkText);
line(info.hasIconLocation, "带图标位置记录", iconMatch ? iconMatch[0] : "");

const newestIco = fs.readdirSync(here)
  .filter((f) => /^nlhe-[0-9a-f]{8}\.ico$/.test(f))
  .map((f) => path.join(here, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (newestIco) {
  const want = path.basename(newestIco);
  const got = iconMatch ? iconMatch[0] : "(无)";
  const ok = got === want;
  line(ok, "桌面图标指向最新版本化 .ico",
    ok ? want
       : "指向 " + got + "，最新是 " + want
         + " —— 桌面已存在同名 .lnk 时无法覆盖，需先由用户删除它再运行 node make-shortcut.mjs");
} else {
  line(null, "桌面图标指向最新版本化 .ico", "本机没有 nlhe-<hash>.ico（先运行 python make-icon.py）");
}

/* ══════════════════════════ B. 真实渲染 / B. Real rendering ══════════════════════════ */
console.log("\n【B】真实渲染（Chrome 应用模式 + CDP 直连页面）");
const rv = await verifyRender({ quiet: true });
if (!rv.facts) {
  line(false, "页面可被 CDP 接管", rv.errors[0] || "未知原因");
} else {
  for (const [name, ok, val] of rv.checks) line(ok, name, val);
}

/* ══════════════════════════ C. 双击联动 / C. Double-click linkage ══════════════════════════ */

/**
 * 调用 PowerShell 脚本：close=1 时截屏后关闭窗口（异步，理由见 proc.mjs）
 * Call the PowerShell script: when close=1, screenshot then close the window (async; see proc.mjs for the reason)
 */
async function probe(outPng, close) {
  const r = await runCapture("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", PS1, "-Match", MATCH, "-Out", outPng, "-Close", close ? "1" : "0",
  ], { timeoutMs: 90000 });
  const lines = (r.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  const info = {};
  for (const l of lines) {
    const i = l.indexOf("=");
    if (i > 0) info[l.slice(0, i)] = l.slice(i + 1);
  }
  if (r.stderr && r.stderr.trim()) info._err = r.stderr.trim();
  return info;
}

console.log("\n【C】双击联动（实际打开 .lnk）");

/* C0. 清理残留窗口，保证可重复运行 / C0. Clean up leftover windows so the run is repeatable */
const pre = await probe(path.join(here, "_tmp.png"), true);
if (pre.found === "1") {
  console.log("  \u00b7 发现残留窗口（pid " + pre.pid + "\uff09\uff0c\u5df2\u8bf7\u6c42\u5173\u95ed");
  for (let i = 0; i < 10; i++) {
    await sleep(800);
    const again = await probe(path.join(here, "_tmp.png"), false);
    if (again.found !== "1") break;
  }
}
try { fs.rmSync(path.join(here, "_tmp.png"), { force: true }); } catch { /* 忽略 / Ignore */ }

/* C1. 打开（等价双击）。explorer 是被允许用来"代理双击"的壳层。 */
/* C1. Open it (equivalent to a double-click). explorer is the shell allowed to "double-click on our behalf". */
const shell = path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe");
const launched = await spawnDetached(shell, [LNK]);
if (!launched.ok) console.log("  \u00b7 拉起 explorer 失败：" + (launched.error && launched.error.message));

let found = null;
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  await sleep(1500);
  const info2 = await probe(SHOT, false);
  if (info2.found === "1") { found = info2; break; }
}

if (!found) {
  line(false, "双击后出现标题含 \"" + MATCH + "\" 的窗口", "30 秒内未出现");
} else {
  line(true, "双击后出现标题含 \"" + MATCH + "\" 的窗口", "pid " + found.pid + " / " + found.rect);
  line(found.title === "\u5fb7\u5dde\u6251\u514b\u7ec3\u4e60\u5ba4 \u00b7 NLHE Trainer",
    "窗口标题与页面 document.title 一致", found.title);

  /* ★ 窗口必须完整可见 —— 这正是用户报的"右边和底部被遮住、像错位"。
   * ★ The window must be fully visible —— this is exactly the user's report of "the right and bottom being covered, looking misaligned".
   * 只验"快捷方式里有 --start-maximized"是不够的（参数对但被别的东西盖过也可能发生），
   * Verifying only "the shortcut has --start-maximized" is not enough (the argument may be right yet be overridden by something else),
   * 这里直接拿窗口外框四边与工作区比大小，数字说话。
   * so here we directly compare the window frame's four edges with the work area; the numbers speak.
   * 判据本身抽在 `wingeom.mjs`（含容差推导与边界情形），由 `test-wingeom.mjs` 用
   * The predicate itself is extracted into `wingeom.mjs` (including tolerance derivation and boundary cases), pinned by `test-wingeom.mjs`
   * 实测记录里的坏/好窗口数据钉住 —— 规则踩过两次坑，不再靠"现在通过"来证明它对。
   * using bad/good window data from real test records —— the rule was burned twice, so we no longer rely on "it passes now" to prove it right. */
  const rect = parseRect(found.rect);
  const verdict = judgeWindow({
    rect, workarea: found.workarea,
    zoomed: found.zoomed === "1",
    frameborder: Number(found.frameborder || 0),
  });
  line(verdict.ok, WINDOW_OK_LABEL,
    verdict.mode === "unparsed"
      ? "rect=" + (found.rect || "(无)") + " workarea=" + (found.workarea || "(无)") +
        (found.screeninfo_failed ? " screeninfo_failed=" + found.screeninfo_failed : "")
      : describeWindowVerdict(verdict, {
          rect, workarea: found.workarea,
          zoomed: found.zoomed === "1", frameborder: Number(found.frameborder || 0),
        }));

  const trustworthy = found.shotmode === "printwindow" || found.foreground === "1";
  console.log("  \u00b7 截图 " + (fs.existsSync(SHOT) ? path.relative(ROOT, SHOT) : "(\u672a\u751f\u6210)") +
    (trustworthy ? "（内容可信）" : "（本次拍到的是桌面，仅留档，不作判定依据）"));
}

/* C2. 关闭 / C2. Close */
if (KEEP) {
  console.log("  \u00b7 --keep：窗口保留，未关闭");
} else {
  const closed = await probe(SHOT, true);
  console.log("  \u00b7 " + (closed.closed === "1" ? "已关闭该窗口" : "关闭请求已发送"));
}

/* ══════════════════════════ 结论 / Conclusion ══════════════════════════ */
console.log("\n\u2550\u2550\u2550\u2550\u2550\u2550 结论 \u2550\u2550\u2550\u2550\u2550\u2550");
if (invalid) {
  console.error("\u2298 入口验收作废：" + invalid + " 项因前置条件不满足而无法判定"
    + "（详见上面的 \u2298 项），结论不成立 —— 这不是产品缺陷，请改善运行环境后重跑。");
  process.exit(1);
}
if (failed) {
  console.error("\u274c 入口验收未通过：" + failed + " 项不满足，请检查上面的 \u2717 项。");
  process.exit(1);
}
console.log("\u2705 入口验收通过：" + report.length + " 项断言全部满足");
console.log("   双击桌面「\u5fb7\u5dde\u6251\u514b\u7ec3\u4e60\u5ba4」\u2192 Chrome 应用模式打开单文件游戏，牌桌/座位/牌面正常渲染。");
