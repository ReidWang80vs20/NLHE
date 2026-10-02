/**
 * 浏览器探测 —— 供图标渲染、快捷方式创建、桌面截图复用。
 * Browser detection —— shared by icon rendering, shortcut creation, and desktop screenshots.
 * 优先级：Chrome > Edge。返回可执行文件绝对路径。
 * Priority: Chrome > Edge. Returns the absolute path of the executable.
 */
import fs from "node:fs";
import path from "node:path";

const CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

/** @returns {{exe:string, kind:'chrome'|'edge'}|null} */
export function findBrowser() {
  for (const exe of CANDIDATES) {
    if (!exe) continue;
    try {
      if (fs.existsSync(exe)) {
        return { exe, kind: /msedge/i.test(exe) ? "edge" : "chrome" };
      }
    } catch { /* 忽略无权限的候选路径 / Ignore candidate paths without access permission */ }
  }
  return null;
}

export function requireBrowser() {
  const b = findBrowser();
  if (!b) {
    console.error("未找到 Chrome 或 Edge，无法继续。");
    process.exit(1);
  }
  return b;
}
