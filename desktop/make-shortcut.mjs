/**
 * 一键创建 / 重建「德州扑克练习室」桌面入口。
 * One-click creation / rebuild of the "Texas Hold'em Practice Room" desktop entry.
 *
 * 入口形态：用 Chrome（或 Edge）的「应用模式」打开单文件游戏，
 * Entry form: open the single-file game in Chrome's (or Edge's) "app mode",
 * 得到无地址栏、无标签栏的独立窗口，观感与原生应用一致。
 * yielding a standalone window with no address bar or tab strip, looking like a native app.
 *
 * 用法：
 * Usage:
 *   node make-shortcut.mjs            # 创建到桌面
 *   node make-shortcut.mjs            # create on the desktop
 *   node make-shortcut.mjs "名字"      # 自定义快捷方式名
 *   node make-shortcut.mjs "name"      # custom shortcut name
 *
 * 设计要点：
 * Design notes:
 * - 浏览器每次运行都重新探测（Chrome > Edge），换机/换浏览器后重新跑一遍即可；
 * - The browser is re-detected on every run (Chrome > Edge); after changing machine/browser just run it again;
 * - 图标优先引用"文件名带内容哈希"的版本化 .ico —— Windows 图标缓存以图标路径为键，
 * - The icon preferentially references the "content-hash-in-filename" versioned .ico —— the Windows icon cache is keyed by icon path,
 *   同名替换文件内容不会刷新桌面图标，换名必然命中新缓存。
 *   so replacing file contents under the same name does not refresh the desktop icon, while renaming is guaranteed to hit a new cache.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireBrowser } from "./browser.mjs";
import { runVbs, parseVbsOutput } from "./vbs.mjs";
import { inspectLnk } from "./lnk.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PAGE = path.join(ROOT, "poker-trainer.html");
const VBS = path.join(here, "create-shortcut.vbs");

const LNK_NAME = (process.argv[2] || "德州扑克练习室") + ".lnk";

/* ---------- 1. 前置检查 / 1. Pre-flight checks ---------- */
if (!fs.existsSync(PAGE)) {
  console.error("找不到 " + PAGE + "，请先运行：node build.js");
  process.exit(1);
}

const browser = requireBrowser();

/* ---------- 2. 挑图标：优先版本化副本 / 2. Pick icon: prefer the versioned copy ---------- */
function pickIcon() {
  const versioned = fs.readdirSync(here)
    .filter(f => /^nlhe-[0-9a-f]{8}\.ico$/.test(f))
    .map(f => path.join(here, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (versioned.length) return versioned[0];
  const stable = path.join(here, "nlhe.ico");
  return fs.existsSync(stable) ? stable : "";
}
const icon = pickIcon();
if (!icon) {
  console.error("找不到图标，请先运行：node render-icon.mjs + python make-icon.py");
  process.exit(1);
}

/* ---------- 3. 桌面路径（兼容 OneDrive 重定向） / 3. Desktop path (handles OneDrive redirection) ---------- */
function findDesktop() {
  const home = process.env.USERPROFILE || os.homedir();
  const cands = [
    path.join(home, "Desktop"),
    path.join(home, "OneDrive", "Desktop"),
    process.env.OneDrive ? path.join(process.env.OneDrive, "Desktop") : null,
  ].filter(Boolean);
  return cands.find(c => fs.existsSync(c)) || cands[0];
}
const desktop = findDesktop();
const lnkPath = path.join(desktop, LNK_NAME);

/* ---------- 4. 组装命令行 / 4. Assemble the command line ---------- */
// 应用模式：--app=<URL> 去掉地址栏与标签栏。
// App mode: --app=<URL> removes the address bar and tab strip.
//
// ⚠️ 不要写死 --window-size：
// ⚠️ Do not hard-code --window-size:
//   曾经用 --window-size=1560,980，在 1440×960（工作区 1440×912）的机器上，
//   We once used --window-size=1560,980; on a 1440×960 machine (work area 1440×912),
//   窗口被开成 1455×975 @ (10,10) —— 右缘超出屏幕 25px、下缘超出 73px，
//   the window opened at 1455×975 @ (10,10) —— 25px past the right edge and 73px past the bottom edge,
//   表现为"右边和底部被遮住、看着像错位"。而且即使把尺寸改成恰好等于工作区，
//   showing as "right and bottom covered, looking misaligned". And even setting the size exactly to the work area,
//   因为 Chrome 从 (10,10) 起画，仍会各溢出 10px。**靠调数字治不好**。
//   since Chrome draws from (10,10) it still overflows by 10px on each side. **Tuning the numbers cannot fix it.**
//   改用 --start-maximized：浏览器按当前工作区自适应，任何分辨率都不会被裁。
//   Use --start-maximized instead: the browser adapts to the current work area, so no resolution gets clipped.
//   两者同时传时 --window-size 会胜出（实测 --start-maximized 被忽略），所以只能留一个。
//   When both are passed, --window-size wins (--start-maximized was ignored in testing), so only one may be kept.
//   想要"真全屏"（盖住任务栏）用应用内 F11 / 顶栏 ⛶ 按钮。
//   For "true fullscreen" (covering the taskbar) use the in-app F11 / the top-bar ⛶ button.
const url = "file:///" + PAGE.split(path.sep).join("/");
const quotedUrl = /\s/.test(url) ? '"' + url + '"' : url;
const cmdArgs = [
  "--app=" + quotedUrl,
  "--start-maximized",
].join(" ");

/* ---------- 5. 创建 / 5. Create ---------- */
console.log("浏览器   : " + browser.exe + "  [" + browser.kind + "]");
console.log("页面     : " + PAGE);
console.log("图标     : " + path.basename(icon));
console.log("快捷方式 : " + lnkPath);

const mtimeBefore = fs.existsSync(lnkPath) ? fs.statSync(lnkPath).mtimeMs : 0;

const r = await runVbs(VBS, [lnkPath, browser.exe, cmdArgs, icon, ROOT, "Texas Hold'em No-Limit Trainer"]);
const out = parseVbsOutput(r.stdout);

if (r.error) {
  console.error("调用脚本宿主失败：" + r.error.message);
  process.exit(1);
}

const mtimeAfter = fs.existsSync(lnkPath) ? fs.statSync(lnkPath).mtimeMs : 0;

console.log("脚本宿主     : exit=" + r.status +
  "  result=" + (out.result || "(无回传)") +
  (out.reason ? "  reason=" + out.reason : ""));
if (r.stderr && r.stderr.trim()) console.log("宿主 stderr  : " + r.stderr.trim());

/* ★ 判定成败必须看"文件是否真的被更新"，不能只看"文件存在"。
 * ★ Success/failure must be judged by "whether the file was really updated", not just by "the file exists".
 * 旧版只看存在性：只要磁盘上残留着一个旧 .lnk（比如上次成功创建的），
 * The old version checked only existence: as long as an old .lnk remained on disk (e.g. from a previous successful creation),
 * 哪怕这次 VBS 完全失败，校验也照样过 —— 参数是旧的却显示"成功"。
 * even if this run's VBS failed completely, the check still passed —— showing "success" while the arguments were old.
 * 实测就是这么被瞒过去的：--start-maximized 没写进去，检查项却是 ✓。
 * That is exactly how it was fooled in testing: --start-maximized was not written, yet the check showed ✓. */
if (!mtimeAfter || mtimeAfter <= mtimeBefore) {
  console.error("创建失败：快捷方式未被更新（mtime 未变化）。" +
    "exit=" + r.status + "  result=" + (out.result || "(无)") +
    (out.reason ? "  reason=" + out.reason : "") +
    (r.stdout ? "\nstdout: " + r.stdout : ""));
  process.exit(1);
}

/* ---------- 6. 校验：直接解析 .lnk 二进制回读真实属性 ---------- */
/* ---------- 6. Verification: parse the .lnk binary directly to read back the real properties ---------- */
const info = inspectLnk(lnkPath);

console.log("\n—— 校验 ——");

const checks = [
  ["快捷方式文件已生成", fs.existsSync(lnkPath), path.basename(lnkPath)],
  ["目标为所选浏览器（完整路径命中）", info.hasAny(browser.exe), path.basename(browser.exe)],
  ["目标可执行文件真实存在", fs.existsSync(browser.exe), browser.exe],
  ["命令行含应用模式与页面地址", info.has("--app=") && info.has("poker-trainer.html"), "--app=file:///.../poker-trainer.html"],
  /* 下面这两条是配套的，一起才能防住"窗口比屏幕大"的复发：
     The following two checks go together; only both can prevent a recurrence of "window bigger than screen":
     只要有 --start-maximized、且没有写死的 --window-size，任何分辨率都不会被裁。
     as long as --start-maximized is present and no --window-size is hard-coded, no resolution gets clipped.
     实测两者同时存在时 --window-size 胜出 —— 所以"有最大化参数"并不够，必须同时没有尺寸参数。
     In testing, when both exist --window-size wins —— so "has a maximize flag" is not enough; there must also be no size flag. */
  ["带 --start-maximized（按屏幕自适应开窗）", info.has("--start-maximized"), "--start-maximized"],
  ["未写死 --window-size（否则会盖过最大化、在小屏上被裁）", !info.windowSize,
    info.windowSize ? "检测到 " + info.windowSize.raw + " —— 必须删除" : "无（正确）"],
  ["带图标位置记录", info.hasIconLocation, ""],
  ["图标指向版本化 .ico 文件", info.has(path.basename(icon)) && fs.existsSync(icon), path.basename(icon)],
  ["带描述信息", info.has("Texas Hold'em") || info.has("Trainer"), "Texas Hold'em No-Limit Trainer"],
];

let allOk = true;
for (const [name, ok, val] of checks) {
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (val ? "  → " + val : ""));
  if (!ok) allOk = false;
}
console.log("  · 文件 " + info.size + " 字节，" +
  "flags=0x" + info.flags.toString(16).padStart(4, "0") +
  " (IDList=" + info.hasTargetIdList +
  " LinkInfo=" + info.hasLinkInfo +
  " Icon=" + info.hasIconLocation +
  " Unicode=" + info.isUnicode + ")");
if (info.localBasePath) console.log("  · LinkInfo 目标 " + info.localBasePath);

if (!allOk) {
  console.error("\n校验未全部通过，请检查上面的 ✗ 项。");
  process.exit(1);
}
console.log("\n完成：双击桌面的「" + LNK_NAME.replace(/\.lnk$/, "") + "」即可进入。");
