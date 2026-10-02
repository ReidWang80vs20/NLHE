/**
 * CLI 包装：node run-vbs.mjs <script.vbs> [args...]
 * CLI wrapper: node run-vbs.mjs <script.vbs> [args...]
 */
import { runVbs } from "./vbs.mjs";

const vbs = process.argv[2];
const vbsArgs = process.argv.slice(3);
if (!vbs) {
  console.error("用法: node run-vbs.mjs <script.vbs> [args...]");
  process.exit(2);
}

const r = await runVbs(vbs, vbsArgs);
if (r.error) console.error("调用失败：" + r.error.message);
if (r.stdout && r.stdout.trim()) console.log(r.stdout.trim());
if (r.stderr && r.stderr.trim()) console.error(r.stderr.trim());
console.log("exit=" + r.status);
process.exit(r.error || r.status === null ? 1 : r.status);
