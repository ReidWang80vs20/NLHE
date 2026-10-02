/**
 * 用无头浏览器把图标 HTML 源渲染为 1024×1024 透明底 PNG。
 * Render the icon HTML source to a 1024×1024 PNG with a transparent background using a headless browser.
 * 用法：node render-icon.mjs <源HTML> <输出PNG>
 * Usage: node render-icon.mjs <source HTML> <output PNG>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireBrowser } from "./browser.mjs";
import { runCapture } from "./proc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const srcArg = process.argv[2];
const outArg = process.argv[3];
if (!srcArg || !outArg) {
  console.error("用法: node render-icon.mjs <icon-source.html> <out.png>");
  process.exit(2);
}

const src = path.resolve(srcArg);
const out = path.resolve(outArg);
if (!fs.existsSync(src)) { console.error("源文件不存在: " + src); process.exit(2); }

const browser = requireBrowser();
const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), "icon-render-"));
const SIZE = "1024,1024";

const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--user-data-dir=" + tmpProfile,
  "--force-device-scale-factor=1",
  // 透明底的关键：缺了这行会渲染出白底
  // Key to the transparent background: without this line the render comes out with a white background
  "--default-background-color=00000000",
  "--window-size=" + SIZE,
  "--virtual-time-budget=2500",
  "--screenshot=" + out.split(path.sep).join("/"),
  "file:///" + src.split(path.sep).join("/"),
];

let r = await runCapture(browser.exe, args, { timeoutMs: 120000 });
if (!fs.existsSync(out) && r.status !== 0) {
  // 旧版 Chrome 回退到 --headless
  // Fall back to --headless for older Chrome versions
  console.log("  (headless=new 未产出，回退 --headless)");
  const legacy = args.map(a => (a === "--headless=new" ? "--headless" : a));
  r = await runCapture(browser.exe, legacy, { timeoutMs: 120000 });
}

try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch { /* 临时目录残留无碍 / A leftover temp dir is harmless */ }

if (!fs.existsSync(out)) {
  console.error("渲染失败，未生成 PNG。" + (r.stderr || ""));
  process.exit(1);
}

// 校验 PNG 头：宽高 + 颜色类型（25 处应为 6 = RGBA，否则丢了透明通道）
// Validate the PNG header: width/height + color type (byte 25 should be 6 = RGBA, otherwise the alpha channel was lost)
const b = fs.readFileSync(out);
const w = b.readUInt32BE(16), h = b.readUInt32BE(20), colorType = b[25];
console.log("生成 " + path.basename(out) + "  " + w + "x" + h +
  "  colorType=" + colorType + (colorType === 6 ? " (RGBA ✓)" : " (⚠ 非 RGBA)") +
  "  " + (b.length / 1024).toFixed(1) + " KB");
