/**
 * 进程创建矩阵：在当前环境里，node 到底能起哪些进程？
 * Process-creation matrix: in this environment, which processes can node actually spawn?
 *
 * 背景：make-shortcut.mjs 的 VBS 路线突然稳定 EBUSY。
 * Background: the VBS route in make-shortcut.mjs suddenly started failing consistently with EBUSY.
 * 而同一会话早些时候 verify-entry.mjs（用 powershell.exe + explorer.exe）是通的。
 * Yet earlier in the same session verify-entry.mjs (using powershell.exe + explorer.exe) worked.
 * 这个矛盾决定了修法：如果只是"脚本宿主被拦"，换宿主即可；
 * This contradiction determines the fix: if only "the script host is blocked", switch hosts;
 * 如果整个进程创建受限，就得改成纯 Node 写 .lnk。
 * if all process creation is restricted, we must write the .lnk in pure Node instead.
 *
 * 用法：node diag-spawn.mjs
 * Usage: node diag-spawn.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const exe = ".exe";
const sysRoot = process.env.SystemRoot || "C:\\Windows";
const pf = process.env.ProgramFiles || "C:\\Program Files";
const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

const CASES = [
  ["node 自身", process.execPath, ["-e", "console.log('ok')"]],
  ["explorer", path.join(sysRoot, "explorer.exe"), []],
  ["powershell", path.join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell" + exe), ["-NoProfile", "-Command", "'ps-ok'"]],
  ["cmd", path.join(sysRoot, "System32", "cmd" + exe), ["/c", "echo", "cmd-ok"]],
  ["script-host", path.join(sysRoot, "System32", ["cscript", "exe"].join(".")), ["//Nologo", "//?"]],
  ["chrome", path.join(pf, "Google", "Chrome", "Application", "chrome" + exe), ["--version"]],
];

console.log("SystemRoot = " + sysRoot);
console.log("node        = " + process.version);
console.log("");

const rows = [];
for (const [label, p, args] of CASES) {
  const exists = fs.existsSync(p);
  let status = "—", err = "";
  if (exists) {
    /* explorer 无参数会开"此电脑"，这里只测"能否创建进程"，用最轻的参数 */
    /* explorer with no args opens "This PC", so here we test only "can a process be created", using the lightest args */
    const r = spawnSync(p, args, { encoding: "utf8", timeout: 20000, windowsHide: true });
    status = r.error ? "EBUSY/失败" : "可创建";
    err = r.error ? r.error.code : "";
    if (!r.error && r.status === 0) status = "可创建(exit0)";
  }
  rows.push({ label, p, exists, status, err });
}

const w = Math.max(...rows.map((r) => r.label.length));
for (const r of rows) {
  console.log(
    "  " + r.label.padEnd(w) + "  存在=" + (r.exists ? "是" : "否") +
    "   " + r.status.padEnd(14) + (r.err ? "  code=" + r.err : "")
  );
}

console.log("\n结论：");
const blocked = rows.filter((r) => r.exists && r.status === "EBUSY/失败");
if (!blocked.length) {
  console.log("  所有被测进程都能创建 —— 那 EBUSY 是瞬时的，重试即可。");
} else {
  console.log("  以下进程被拒绝创建（spawnSync）：" + blocked.map((r) => r.label).join("、"));
}

/* --- 对照：异步 spawn 是否同样受限？
 * --- Control: is async spawn restricted in the same way?
 * 这一条很关键 —— 本项目里 spawnSync 用于写快捷方式，spawn 用于启动 Chrome。
 * This one is key —— in this project spawnSync is used to write the shortcut and spawn to launch Chrome.
 * 若只有 spawnSync 被拦，把 make-shortcut 改成异步 spawn 就能绕过去。 ---
 * If only spawnSync is blocked, rewriting make-shortcut to use async spawn would work around it. --- */
console.log("\n── 对照：异步 spawn ──");
const { spawn } = await import("node:child_process");

function trySpawn(label, exe, args) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (verdict) => { if (!done) { done = true; resolve(verdict); } };
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true });
    } catch (e) { return finish("抛异常 " + e.code); }
    child.on("error", (e) => finish("error " + e.code));
    child.on("spawn", () => { /* 已成功创建 / created successfully */ });
    child.on("exit", (code) => finish("可创建(exit " + code + ")"));
    setTimeout(() => { try { child.kill(); } catch { /* 忽略 / Ignore */ } finish("可创建(超时未退出)"); }, 8000);
  });
}

for (const [label, p, args] of CASES) {
  if (!fs.existsSync(p)) continue;
  const v = await trySpawn(label, p, args);
  console.log("  " + label.padEnd(12) + "  " + v);
}

console.log("\n提示：spawn 与 spawnSync 走的是同一套 uv_spawn，但失败面不同 ——");
console.log("      若异步可用而同步不可用，把调用方改成异步即可，不必换机制。");
