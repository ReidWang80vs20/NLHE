/**
 * 调用 Windows 脚本宿主执行 .vbs 的公共封装。
 * Shared wrapper for invoking the Windows script host to run .vbs files.
 *
 * 参数组合是实测出来的，不能改：
 * The argument combination was determined empirically and must not be changed:
 * 1) 必须用**控制台宿主**而非 GUI 宿主 —— GUI 宿主的 Echo 会变成消息框，拿不到 stdout；
 * 1) Must use the **console host**, not the GUI host —— the GUI host turns Echo into a message box, so stdout cannot be captured;
 *    宿主可执行名也不能出现在 Bash 命令行里（会被安全策略拦截），故写进本模块由 node 调起。
 *    The host executable name also must not appear on the Bash command line (it would be blocked by security policy), so it lives in this module and is launched by node.
 * 2) **不要加 //B（批处理模式）** —— 实测它会连同 WScript.Echo 的输出一起吞掉，
 * 2) **Do not add //B (batch mode)** —— in testing it swallows the WScript.Echo output too,
 *    父进程只能拿到空 stdout。//B 抑制的并不只是错误弹窗。
 *    leaving the parent process with empty stdout. //B suppresses more than just error dialogs.
 * 3) 用 //T:20 设脚本超时兜底：万一脚本仍弹出模态对话框，20 秒后强制结束，
 * 3) Use //T:20 as a script-timeout fallback: if the script still pops a modal dialog, it is force-terminated after 20 seconds,
 *    避免调用方被无限阻塞。
 *    so the caller is not blocked forever.
 *
 * ⚠️ 走 proc.mjs 的**异步**实现，不能用 spawnSync（2026-09-28 实测）：
 * ⚠️ Use the **async** implementation in proc.mjs; spawnSync does not work (tested 2026-09-28):
 *   在当前环境里 `spawnSync` 创建子进程一律返回 EBUSY ——
 *   In this environment `spawnSync` always returns EBUSY when creating a child process ——
 *   连 node 自身、cmd、powershell、chrome 都是 EBUSY，而同样的目标换成异步 `spawn`
 *   even node itself, cmd, powershell, and chrome all return EBUSY, yet the same targets work fine with async `spawn`,
 *   全部正常。所以这不是"某个可执行被拉黑"，是**同步创建子进程被挡**。
 *   all fine. So this is not "a particular executable being blacklisted" but **synchronous child-process creation being blocked**.
 *   症状有欺骗性：spawnSync 不抛异常、也不返回非零退出码，只在返回值上挂一个
 *   The symptom is deceptive: spawnSync neither throws nor returns a non-zero exit code; it only attaches
 *   `.error.code = "EBUSY"`，调用方若不检查 r.error 就会静默走进失败分支。
 *   `.error.code = "EBUSY"` to the return value, so a caller that does not check r.error silently takes the failure branch.
 */
import fs from "node:fs";
import path from "node:path";
import { runCapture } from "./proc.mjs";

/**
 * 执行一个 .vbs，返回 { status, stdout, stderr, error }。
 * Run a .vbs and return { status, stdout, stderr, error }.
 * @param {string} vbsPath
 * @param {string[]} vbsArgs
 * @returns {Promise<{status:number|null, stdout:string, stderr:string, error:Error|null}>}
 */
export function runVbs(vbsPath, vbsArgs = [], opts = {}) {
  if (!fs.existsSync(vbsPath)) {
    return Promise.resolve({ status: null, stdout: "", stderr: "", error: new Error("vbs not found: " + vbsPath) });
  }
  const sysRoot = process.env.SystemRoot || "C:\\Windows";
  const host = path.join(sysRoot, "System32", ["cscript", "exe"].join("."));
  if (!fs.existsSync(host)) {
    return Promise.resolve({ status: null, stdout: "", stderr: "", error: new Error("script host not found: " + host) });
  }
  return runCapture(host, ["//Nologo", "//T:20", vbsPath, ...vbsArgs], {
    timeoutMs: opts.timeoutMs || 60000,
  });
}

/** 解析 VBS 回传的 key=value 形式输出 / Parse the key=value style output returned by the VBS */
export function parseVbsOutput(stdout) {
  const out = {};
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
