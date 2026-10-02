/* ============================================================
 * find-python.cjs — Python 解释器发现的**唯一来源**
 * find-python.cjs — the **single source of truth** for locating a Python interpreter
 *
 * 用途：desktop/ 下的探针需要一个能调 Win32 API 的 Python（见 probe-window-icon.py）。
 * Purpose: the probes under desktop/ need a Python able to call Win32 APIs (see probe-window-icon.py).
 * 原先把作者机器上某个固定路径写死在常量里，换机器就必然失败，也会把用户名带进公开仓库。
 * The original code hard-coded one fixed path from the author's machine, which necessarily breaks elsewhere
 * and leaks the user name into a public repository.
 *
 * 探测顺序（先命中先用）：
 * Search order (first hit wins):
 *   1. 显式环境变量 NLHE_PYTHON / PYTHON
 *   1. Explicit environment variables NLHE_PYTHON / PYTHON
 *   2. PATH 上的 python.exe / python3.exe / py.exe
 *   2. python.exe / python3.exe / py.exe on PATH
 *   3. 用户级安装 %LOCALAPPDATA%\Programs\Python\Python3*\python.exe
 *   3. Per-user install %LOCALAPPDATA%\Programs\Python\Python3*\python.exe
 *   4. 系统级安装 %ProgramFiles%\Python3*\python.exe 与 C:\Python3*\python.exe
 *   4. Machine-wide install %ProgramFiles%\Python3*\python.exe and C:\Python3*\python.exe
 *   5. 本工具链自带的托管解释器 <home>\.workbuddy\binaries\python\versions\*\python.exe
 *   5. The managed interpreter bundled with this toolchain <home>\.workbuddy\binaries\python\versions\*\python.exe
 *
 * 全程用 os.homedir() 与环境变量推导，不出现任何具体用户名。
 * Everything derives from os.homedir() and environment variables; no concrete user name appears.
 * ============================================================ */
'use strict';
const fs = require('fs');
const os = require('os');
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

/** 扫描一个父目录下的 Python3* 子目录，版本新的排前面
 * Scan Python3* subdirectories under a parent directory, newest version first */
function scanVersionedDir(parent, rel) {
  let entries;
  try {
    entries = fs.readdirSync(parent);
  } catch {
    return [];
  }
  return entries
    .filter((n) => /^python3/i.test(n))
    .sort((a, b) => trailingNum(b) - trailingNum(a))
    .map((n) => path.join(parent, n, rel));
}

/** 托管解释器目录下的候选 / Candidates under the managed-interpreter directory */
function managedCandidates() {
  const base = path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'versions');
  let entries;
  try {
    entries = fs.readdirSync(base);
  } catch {
    return [];
  }
  return entries
    .sort((a, b) => {
      const [a1, a2, a3] = String(a).split('.').map((x) => parseInt(x, 10) || 0);
      const [b1, b2, b3] = String(b).split('.').map((x) => parseInt(x, 10) || 0);
      return b1 - a1 || b2 - a2 || b3 - a3;
    })
    .map((v) => path.join(base, v, 'python.exe'));
}

/** 按优先级拼出候选列表（可能含不存在的路径）
 * Build the candidate list in priority order (may contain paths that do not exist) */
function pythonCandidates() {
  const out = [];

  /* 1. 显式指定 / Explicitly specified */
  if (process.env.NLHE_PYTHON) out.push(process.env.NLHE_PYTHON);
  if (process.env.PYTHON) out.push(process.env.PYTHON);

  /* 2. PATH / PATH lookup */
  const names = ['python.exe', 'python3.exe', 'py.exe'];
  for (const d of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const n of names) out.push(path.join(d, n));
  }

  /* 3. 用户级安装 / Per-user install */
  if (process.env.LOCALAPPDATA) {
    out.push(...scanVersionedDir(path.join(process.env.LOCALAPPDATA, 'Programs', 'Python'), 'python.exe'));
  }

  /* 4. 系统级安装 / Machine-wide install */
  if (process.env.ProgramFiles) {
    out.push(...scanVersionedDir(process.env.ProgramFiles, 'python.exe'));
  }
  const sysRoot = process.env.SystemDrive || 'C:';
  out.push(...scanVersionedDir(path.join(sysRoot, path.sep), 'python.exe'));

  /* 5. 本工具链的托管解释器 / The toolchain's managed interpreter */
  out.push(...managedCandidates());

  return out;
}

/** @returns {string|null} 第一个真实存在的 Python 解释器 / The first Python interpreter that actually exists */
function findPythonExe() {
  return pythonCandidates().find(exists) || null;
}

module.exports = { findPythonExe, pythonCandidates, exists };
