/**
 * 应用图标探针 —— 用**和快捷方式完全相同的命令行**把应用窗口拉起来，
 * App icon probe —— launches the app window with **exactly the same command line as the shortcut**,
 * 读出 Windows 实际会给任务栏画的那个图标（`WM_GETICON`），并导出 PNG。
 * reads the icon Windows actually paints on the taskbar (`WM_GETICON`), and exports a PNG.
 *
 * 为什么不能用截屏判：任务栏可能被遮挡、DPI 缩放会二次插值，
 * Why a screenshot cannot decide it: the taskbar may be occluded, DPI scaling re-interpolates,
 * 而截屏拿到的是"像素长什么样"，不是"图标是什么"。
 * and a screenshot captures "what the pixels look like", not "what the icon is".
 *
 * 默认用一次性临时档案，跑完自动关窗清理 —— 不打扰正在用的 Chrome。
 * By default it uses a throwaway temp profile and closes/cleans up afterwards —— without disturbing your running Chrome.
 * 要验证"用户的真实档案下也是这样"时加 `--real`（这会复用/新建用户的
 * To verify "the same holds under the user's real profile", add `--real` (this reuses/creates the user's
 * 默认档案，窗口会真的出现在你的任务栏上，跑完会派 WM_CLOSE 关掉）。
 * default profile; the window really shows up on your taskbar and is closed via WM_CLOSE afterwards).
 *
 * 用法：
 * Usage:
 *   node probe-app-icon.mjs                    # 临时档案，输出到 app-icon.png
 *   node probe-app-icon.mjs                    # temp profile, output to app-icon.png
 *   node probe-app-icon.mjs --real out.png     # 真实档案
 *   node probe-app-icon.mjs --real out.png     # real profile
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireBrowser } from "./browser.mjs";
import { runCapture, spawnDetached, killTree } from "./proc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PAGE = path.join(ROOT, "poker-trainer.html");
const PROBE = path.join(here, "probe-window-icon.py");
const PY = "C:\\Users\\80vs2\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe";
const TITLE = "德州扑克练习室";

const args = process.argv.slice(2);
const useReal = args.includes("--real");
const out = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(here, "app-icon.png"));

if (!fs.existsSync(PAGE)) {
  console.error("找不到 " + PAGE + "，请先运行：node build.js");
  process.exit(1);
}

/* 与 make-shortcut.mjs 的 cmdArgs 保持一致，别在这里另起一套参数 —— 
   Keep these consistent with make-shortcut.mjs's cmdArgs; do not start a second set of arguments here —— 
   探针要证明的是"双击快捷方式会看到什么"，参数一旦分叉就失去证明力。
   the probe is meant to prove "what you see when double-clicking the shortcut"; once the arguments diverge, it loses that power. */
const chromeArgs = [
  "--app=file:///" + PAGE.split(path.sep).join("/"),
  "--start-maximized",
  "--no-first-run",
  "--no-default-browser-check",
  // 与 verify-render 同样的理由：窗口被判定遮挡会让 Chrome 挂起部分状态机
  // Same reason as verify-render: a window judged occluded makes Chrome suspend part of its state machine
  "--disable-features=CalculateNativeWinOcclusion",
];

let profile = "";
if (!useReal) {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "app-icon-"));
  chromeArgs.push("--user-data-dir=" + profile);
}

const browser = requireBrowser();
console.log("浏览器   : " + browser.exe);
console.log("窗口命令行: " + chromeArgs.filter((a) => a.startsWith("--app=")).join(" "));
console.log("档案     : " + (useReal ? "用户默认档案（--real）" : profile));
console.log("");

const sp = await spawnDetached(browser.exe, chromeArgs);
let probeOut = "";
let ok = false;
const t0 = Date.now();
while (Date.now() - t0 < 45000) {
  const r = await runCapture(PY, [PROBE, TITLE, out], { timeoutMs: 30000 });
  probeOut = (r.stdout || "") + (r.stderr || "");
  if (/^found=1/m.test(probeOut)) { ok = true; break; }
  await new Promise((r2) => setTimeout(r2, 1500));
}

for (const line of probeOut.split(/\r?\n/)) if (line.trim()) console.log("  " + line);

if (ok) {
  const top = (probeOut.match(/^top=(\S+)$/gm) || []).map((s) => s.slice(4));
  console.log("\n图标主色：" + (top.length ? top.join("  ") : "(整块单色)"));
  console.log("判读：出现 66/55 系灰阶 = 仍是 Chrome 默认灰图标；" +
    "出现绿(1a/2a/0a/06) + 白 + 红(e4/ff) = 我们的图标已生效。");
}

await killTree(sp.pid);
if (ok) {
  /* 用户档案模式下列进程可能不属于我们（Chrome 已有实例），taskkill 关不掉那个窗口，
     In real-profile mode the listed process may not be ours (an existing Chrome instance), and taskkill cannot close that window,
     所以额外派一次 WM_CLOSE，避免留下一个孤儿窗口。
     so we send an extra WM_CLOSE to avoid leaving an orphan window. */
  const cls = path.join(os.tmpdir(), "probe-close.py");
  fs.writeFileSync(cls, [
    "import ctypes,sys",
    "u=ctypes.WinDLL('user32')",
    "h=int(sys.argv[1],16)",
    "u.PostMessageW(h,0x0010,0,0)",
  ].join("\n"), "utf8");
  const hwnd = (probeOut.match(/^hwnd=(\S+)$/m) || [])[1];
  if (hwnd) await runCapture(PY, [cls, hwnd], { timeoutMs: 15000 });
}
if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 / Ignore */ } }

console.log(ok ? "\n完成，图标 PNG：" + out : "\n✗ 45s 内没取到窗口图标");
process.exit(ok ? 0 : 1);
