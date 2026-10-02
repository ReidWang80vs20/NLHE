/**
 * 浏览器探测 —— 供图标渲染、快捷方式创建、桌面截图复用。
 * Browser detection —— shared by icon rendering, shortcut creation, and desktop screenshots.
 * 优先级：Chrome > Edge。返回可执行文件绝对路径。
 * Priority: Chrome > Edge. Returns the absolute path of the executable.
 *
 * 真正的探测逻辑在 ../tools/find-browser.cjs（与 test/ 共用同一份，避免两处漂移）；
 * The actual detection logic lives in ../tools/find-browser.cjs (shared with test/, so the two cannot drift):
 * 那里按 NLHE_CHROME → playwright 自报 → playwright 缓存 → 标准安装位置 → PATH 的顺序找，
 * it searches NLHE_CHROME → path reported by playwright → playwright cache → standard install → PATH,
 * 不写死任何用户名与版本号。
 * without hard-coding any user name or version number.
 */
import shared from "../tools/find-browser.cjs";

const { findBrowser: detectBrowser } = shared;

/** @returns {{exe:string, kind:'chrome'|'edge'}|null} */
export function findBrowser() {
  return detectBrowser();
}

export function requireBrowser() {
  const b = findBrowser();
  if (!b) {
    console.error("未找到 Chrome 或 Edge，无法继续。");
    console.error("可设置 NLHE_CHROME 环境变量显式指定，例如：");
    console.error('  set NLHE_CHROME=C:\\path\\to\\chrome.exe');
    process.exit(1);
  }
  return b;
}
