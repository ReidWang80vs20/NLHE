/**
 * 进程调用的公共封装 —— **一律异步**。
 * Shared wrapper for process invocation —— **always async**.
 *
 * ⚠️ 本环境里 `spawnSync` 创建子进程一律返回 EBUSY（2026-09-28 实测）：
 * ⚠️ In this environment `spawnSync` always returns EBUSY when creating a child process (tested 2026-09-28):
 *    node 自身、cmd、powershell、脚本宿主、chrome 全部如此；
 *    node itself, cmd, powershell, the script host, and chrome all behave this way;
 *    把同一目标换成异步 `spawn` 则全部正常。
 *    switching the same targets to async `spawn` makes them all work.
 *    这不是"某个可执行被拉黑"，是**同步创建子进程被挡**。
 *    This is not "a particular executable being blacklisted" but **synchronous child-process creation being blocked**.
 *
 * 这个失败特别有欺骗性：
 * This failure is especially deceptive:
 *   - 不抛异常；
 *   - it does not throw;
 *   - 不返回非零退出码（status 是 null）；
 *   - it does not return a non-zero exit code (status is null);
 *   - 只在返回值上挂一个 `.error.code = "EBUSY"`。
 *   - it only attaches `.error.code = "EBUSY"` to the return value.
 * 所以老代码里 `spawnSync(...)` 后面若只看 `r.status`，会把失败当成"没输出"，
 * So in old code, if `spawnSync(...)` is followed by a check of only `r.status`, the failure is treated as "no output",
 * 继续往下跑，最后表现为"脚本没生效"而不是"报错"。**新代码请一律用本模块。**
 * execution continues, and the final symptom is "the script did nothing" rather than an error. **New code should always use this module.**
 */
import { spawn } from "node:child_process";

/**
 * 跑一个进程并收集输出。
 * Run a process and collect its output.
 * @returns {Promise<{status:number|null, stdout:string, stderr:string, error:Error|null, timedOut:boolean}>}
 */
export function runCapture(exe, args = [], opts = {}) {
  const timeoutMs = opts.timeoutMs || 60000;
  return new Promise((resolve) => {
    let settled = false;
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true, cwd: opts.cwd });
    } catch (e) {
      return resolve({ status: null, stdout: "", stderr: "", error: e, timedOut: false });
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const done = (status, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr, error, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* 忽略 / Ignore */ }
      done(null, new Error("超时 " + timeoutMs + "ms 未结束：" + exe));
    }, timeoutMs);

    if (child.stdout) child.stdout.on("data", (d) => { stdout += d; });
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => done(null, e));
    child.on("close", (code) => done(code, null));
  });
}

/**
 * 只求"拉起来"，不等它退出（启动 GUI/壳层用）。返回是否成功创建。
 * Only needs to "launch it", without waiting for exit (used to start GUI/shell). Returns whether creation succeeded.
 */
export function spawnDetached(exe, args = [], opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true, cwd: opts.cwd, detached: !!opts.detached });
    } catch (e) {
      return resolve({ ok: false, error: e, pid: 0 });
    }
    let settled = false;
    const fin = (payload) => { if (!settled) { settled = true; resolve(payload); } };
    child.on("error", (e) => fin({ ok: false, error: e, pid: 0 }));
    child.on("spawn", () => {
      if (opts.detached && child.unref) child.unref();
      fin({ ok: true, error: null, pid: child.pid });
    });
    /* 有些壳层（如 explorer）不回报 spawn 事件时序，兜底判定 */
    /* Some shells (e.g. explorer) do not report the spawn event in time, so this is a fallback check */
    setTimeout(() => fin({ ok: true, error: null, pid: child.pid || 0 }), 3000);
  });
}

/** 结束整棵进程树。必须异步，理由见文件头。 / Kill the entire process tree. Must be async; see the file header for the reason. */
export function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(false);
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(true); } };
    try {
      const c = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      c.on("error", fin);
      c.on("close", fin);
      setTimeout(() => { try { c.kill(); } catch { /* 忽略 / Ignore */ } fin(); }, 8000);
    } catch { fin(); }
  });
}
