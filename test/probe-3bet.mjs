/**
 * 测准 AA 对各类范围的收敛胜率，用于给 check-range.js 的断言定标。
 * Precisely measure AA's converged equity against various ranges, to calibrate the assertions in check-range.js.
 *
 * 背景：原断言 `AA 对 3-bet 范围 < AA 对随机牌` 会偶发失败（实测 5 次挂 1 次）。
 * Background: the original assertion `AA vs 3-bet range < AA vs random hand` fails intermittently (observed 1 failure in 5 runs).
 * 根因不是蒙特卡洛噪声那么简单 —— 3-bet 范围里含 AK，而 AA 对 AK 高达 93%，
 * The root cause is not as simple as Monte Carlo noise — the 3-bet range contains AK, and AA vs AK is as high as 93%,
 * 于是"对 3-bet 范围"与"对随机牌"的胜率本来就几乎相等（都在 84~86%），
 * so the equities "vs 3-bet range" and "vs random hand" are almost equal to begin with (both around 84~86%),
 * 拿两个 4000 次迭代的估计去比一个接近零的差，必然时通时不通。
 * comparing two estimates from 4000 iterations to detect a near-zero difference is bound to pass and fail intermittently.
 *
 * 这里用高迭代把真值收敛出来，再据此改写断言。
 * Here we converge on the true value with high iteration counts, then rewrite the assertion accordingly.
 *
 * 用法：node test/probe-3bet.mjs [迭代数，默认 200000]
 * Usage: node test/probe-3bet.mjs [iteration count, default 200000]
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "src");

require(path.join(SRC, "poker.js"));
require(path.join(SRC, "equity.js"));
require(path.join(SRC, "range.js"));

const PK = globalThis.PK;
const R = PK.Range;

const iters = Number(process.argv[2] || 200000);
const C = (...cs) => cs.map(PK.parseCard);
const HAND = C("As", "Ah");

/* 同一副牌、每个口径跑 3 轮，看收敛后是否稳定 */
/* Same deck, run 3 rounds per metric to see whether it is stable after convergence */
const CASES = [
  ["对随机牌（uniform）", () => R.uniformWeights(1)],
  ["top3% 按类别（topWeights 0.03）", () => R.topWeights(0.03)],
  ["top3% 按组合（topCombos 0.03）", () => R.topCombos(0.03)],
  ["top10% 按组合", () => R.topCombos(0.10)],
  ["top50% 按组合", () => R.topCombos(0.50)],
  ["行动线 3-bet", () => R.fromLine({ preflop: "threebet", posPct: 0.5 })],
  ["行动线 4-bet", () => R.fromLine({ preflop: "fourbet" })],
  ["单类 KK", () => { const w = R.emptyWeights(); w[R.idxOfKey("KK")] = 1; return w; }],
  ["单类 AKo", () => { const w = R.emptyWeights(); w[R.idxOfKey("AKo")] = 1; return w; }],
];

console.log("迭代 " + iters + " 次/轮，共 3 轮（AA 单挑）\n");
console.log("口径".padEnd(34, " ") + "第1轮    第2轮    第3轮    极差");

const results = {};
for (const [name, mk] of CASES) {
  const vals = [];
  for (let r = 0; r < 3; r++) {
    vals.push(R.equityVsWeights(HAND, [], mk(), iters, { nOpp: 1 }));
  }
  const pct = vals.map((v) => v * 100);
  const spread = Math.max(...pct) - Math.min(...pct);
  results[name] = pct;
  console.log(
    name.padEnd(34, " ") +
    pct.map((v) => v.toFixed(2).padStart(7) + "%").join(" ") +
    "   " + spread.toFixed(2) + "pp"
  );
}

/* 顺带看看 3-bet / 4-bet 范围里到底有哪些牌 —— 这决定了 AA 的胜率为什么高 */
/* Also take a look at exactly which hands are in the 3-bet / 4-bet ranges — that is what makes AA's equity high */
console.log("\n3-bet 范围的构成（前 8 类，按权重）:");
const w3 = R.fromLine({ preflop: "threebet", posPct: 0.5 });
const desc = R.describe(w3);
console.log("  组合数 " + desc.combos + "，占比 " + (desc.pct * 100).toFixed(1) + "%");
const entries = [];
for (let i = 0; i < 169; i++) if (w3[i] > 0) entries.push([R.ORDER[i], w3[i]]);
entries.sort((a, b) => b[1] - a[1]);
for (const [key, w] of entries.slice(0, 8)) {
  console.log("   " + key.padEnd(5) + " 权重 " + w.toFixed(2) + "  " + R.COMBOS[R.idxOfKey(key)].length + " 组合");
}
console.log("  （共 " + entries.length + " 类；AA 对 AK 约 93%，所以含 AK 的范围不会显著拉低 AA 胜率）");
