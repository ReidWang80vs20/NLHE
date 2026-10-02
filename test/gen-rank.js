/* ============================================================
 * gen-rank.js — 生成 169 类起手牌的标准强度排名表
 * gen-rank.js — generate the standard strength ranking of the 169 starting-hand classes
 * 排序依据：对 1 名随机对手的胜率（高精度蒙特卡洛，保证排名稳定）
 * Ranked by win rate against one random opponent (high-precision Monte Carlo for a stable ranking)
 * 输出：按强度从高到低的 key 列表，可直接内嵌到 equity.js
 * Output: a list of keys from strongest to weakest, ready to embed directly into equity.js
 *   node test/gen-rank.js
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'poker.js'));
require(path.join(__dirname, '..', 'src', 'equity.js'));
const PK = globalThis.PK;

const RC = PK.RANK_CHARS;
const keys = [];
for (let i = 12; i >= 0; i--) {
  for (let j = i; j >= 0; j--) {
    if (i === j) keys.push(RC[i] + RC[j]);
    else keys.push(RC[i] + RC[j] + 's', RC[i] + RC[j] + 'o');
  }
}
console.log('// 共 ' + keys.length + ' 类');
if (keys.length !== 169) throw new Error('键数量应为 169');

const rows = keys.map(k => {
  const eq = PK.estimateEquity(PK.holeFromKey(k), [], 1, 24000);
  return { k: k, eq: eq };
});
rows.sort((a, b) => b.eq - a.eq);

/* 输出：每行 12 个，便于阅读
 * Output: 12 entries per line for readability */
const out = rows.map(r => "'" + r.k + "'");
console.log('\nconst HAND_RANK_ORDER = [');
for (let i = 0; i < out.length; i += 12) {
  console.log('  ' + out.slice(i, i + 12).join(', ') + ',');
}
console.log('];');

/* 抽样核对几个关键位置
 * Spot-check a few key positions */
console.log('\n// 排名抽样（序号从 0 开始，0 = 最强）');
[0, 1, 2, 3, 4, 9, 16, 25, 33, 41, 50, 67, 84, 101, 118, 135, 152, 168].forEach(i => {
  console.log('// ' + String(i).padStart(3) + '  ' + rows[i].k.padEnd(4) +
    '  eq=' + rows[i].eq.toFixed(4) + '  百分位=' + (i / 168).toFixed(3));
});
