/* ============================================================
 * find-browser.cjs — Chromium 系浏览器发现的**唯一来源**
 * find-browser.cjs — the **single source of truth** for locating a Chromium-family browser
 *
 * 为什么单独抽一份：原先 test/ 下 12 个脚本各自复制了一份候选路径表，
 * Why a shared module: previously 12 scripts under test/ each carried their own copy of the candidate
 * 里面写死了作者机器的用户名与 playwright 版本号（C:/Users/<name>/AppData/Local/ms-playwright/chromium-1234/...）。
 * path list, hard-coding the author's user name and playwright build number
 * 换一台机器、换一个 playwright 版本，测试就整体瘫掉，而且这些路径会把用户名带进公开仓库。
 * (C:/Users/<name>/AppData/Local/ms-playwright/chromium-1234/...). On another machine or after a playwright
 * upgrade the whole suite dies, and those paths leak the user name into a public repository.
 * 现在只在这里解析一次，探测顺序如下（先命中先用）：
 * Now it is resolved once, in this file, in the following order (first hit wins):
 *
 *   1. 显式环境变量 NLHE_CHROME / CHROME_PATH / PUPPETEER_EXECUTABLE_PATH
 *   1. Explicit environment variables NLHE_CHROME / CHROME_PATH / PUPPETEER_EXECUTABLE_PATH
 *   2. playwright 自报的浏览器路径（装了 playwright-core 时最准）
 *   2. The path playwright itself reports (most accurate when playwright-core is installed)
 *   3. playwright 缓存目录扫描（PLAYWRIGHT_BROWSERS_PATH 或 %LOCALAPPDATA%\ms-playwright）
 *   3. Scan the playwright cache directory (PLAYWRIGHT_BROWSERS_PATH or %LOCALAPPDATA%\ms-playwright)
 *   4. 标准安装位置（%ProgramFiles% / %ProgramFiles(x86)% / %LOCALAPPDATA%，Chrome 优先于 Edge）
 *   4. Standard install locations (%ProgramFiles% / %ProgramFiles(x86)% / %LOCALAPPDATA%, Chrome before Edge)
 *   5. PATH 上直接可执行的 chrome.exe / msedge.exe
 *   5. chrome.exe / msedge.exe directly executable on PATH
 *
 * 全流程不写死任何用户名与版本号：目录一律按环境变量推导，版本目录按数字倒序排。
 * Nothing here hard-codes a user name or a version number: directories derive from environment variables,
 * and version directories are sorted numerically descending.
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

/** 存在性判断，吞掉权限/路径异常 / Existence check that swallows permission and path errors */
function exists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

/** 从目录名尾部取出数字，用于版本倒序 / Pull the trailing number out of a directory name, for descending sort */
function trailingNum(name) {
  const m = /(\d+)\s*$/.exec(name);
  return m ? parseInt(m[1], 10) : 0;
}

/** playwright 缓存目录里的候选（chromium-1234 / chromium_headless_shell-1234 等布局）
 * Candidates inside the playwright cache directory (layouts such as chromium-1234 / chromium_headless_shell-1234) */
function playwrightCacheCandidates() {
  const roots = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'));

  const out = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue; // 目录不存在 / Directory does not exist
    }
    /* 新版本排在前面，避免一旦装了多个版本就永远命中旧的
       Newest first, so that having several versions installed never pins us to an old one */
    const dirs = entries.filter((n) => /^chromium[-_]/.test(n)).sort((a, b) => trailingNum(b) - trailingNum(a));
    for (const d of dirs) {
      out.push(path.join(root, d, 'chrome-win64', 'chrome.exe'));
      out.push(path.join(root, d, 'chrome-win', 'chrome.exe')); // 较早版本的目录名 / Directory name used by older releases
      out.push(path.join(root, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
    }
    /* 也支持 PLAYWRIGHT_BROWSERS_PATH 直接指向可执行文件所在目录的情形
       Also support PLAYWRIGHT_BROWSERS_PATH pointing straight at the folder holding the executable */
    out.push(path.join(root, 'chrome-win64', 'chrome.exe'));
    out.push(path.join(root, 'chrome.exe'));
  }
  return out;
}

/** playwright 自己报告的浏览器路径（未安装时会抛异常，故必须 try/catch）
 * The browser path playwright reports (it throws when the browser is not installed, hence the try/catch) */
function playwrightReportedCandidates() {
  try {
    const { chromium } = require('playwright-core');
    const p = typeof chromium.executablePath === 'function' ? chromium.executablePath() : '';
    return p ? [p] : [];
  } catch {
    return [];
  }
}

/** 标准安装位置：Chrome 优先于 Edge；同一浏览器按 系统级 → 用户级 排列
 * Standard install locations: Chrome before Edge; for the same browser, machine-wide before per-user */
function standardCandidates() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA];
  const rels = [
    path.join('Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join('Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  const out = [];
  for (const rel of rels) {
    for (const root of roots) {
      if (root) out.push(path.join(root, rel));
    }
  }
  return out;
}

/** PATH 上直接可执行的浏览器 / Browsers directly executable on PATH */
function pathCandidates() {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const names = ['chrome.exe', 'msedge.exe'];
  const out = [];
  for (const d of dirs) {
    for (const n of names) out.push(path.join(d, n));
  }
  return out;
}

/** 按优先级拼出候选列表（可能含不存在的路径）
 * Build the candidate list in priority order (may contain paths that do not exist) */
function browserCandidates() {
  const explicit = [process.env.NLHE_CHROME, process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH]
    .filter(Boolean);
  return [
    ...explicit,
    ...playwrightReportedCandidates(),
    ...playwrightCacheCandidates(),
    ...standardCandidates(),
    ...pathCandidates(),
  ];
}

/** @returns {string|null} 第一个真实存在的浏览器可执行文件 / The first browser executable that actually exists */
function findBrowserExe() {
  return browserCandidates().find(exists) || null;
}

/** 由路径判断浏览器种类 / Decide the browser kind from its path */
function browserKind(exe) {
  return /msedge/i.test(String(exe)) ? 'edge' : 'chrome';
}

/** @returns {{exe:string, kind:'chrome'|'edge'}|null} */
function findBrowser() {
  const exe = findBrowserExe();
  return exe ? { exe, kind: browserKind(exe) } : null;
}

module.exports = { findBrowser, findBrowserExe, browserKind, browserCandidates, exists };
