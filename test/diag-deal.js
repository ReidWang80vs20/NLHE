/* ============================================================
 * diag-deal.js — 发牌公平性隔离测试
 * diag-deal.js — isolated fairness test for dealing
 * 检验项：
 * Checks:
 *   A. 各座位「平均牌值」——最灵敏的洗牌均匀性检验
 *   A. Per-seat "average card value" — the most sensitive test of shuffle uniformity
 *   B. 各座位「平均牌力排名」——用随机对手基准衡量起手牌质量
 *   B. Per-seat "average hand-strength rank" — measures starting-hand quality against a random-opponent baseline
 *   C. 完赛胜率（含并列折算份额）
 *   C. Full-run win rate (with split shares for ties)
 *   node test/diag-deal.js [样本数] [rng: native|lcg]
 *   node test/diag-deal.js [sample count] [rng: native|lcg]
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'poker.js'));
require(path.join(__dirname, '..', 'src', 'equity.js'));
const PK = globalThis.PK;

const N = parseInt(process.argv[2] || '200000', 10);
const RNG = process.argv[3] || 'native';
const SEATS = 6;

let rnd;
if (RNG === 'lcg') {
  let seed = 12345;
  rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
} else {
  rnd = Math.random;
}

const cardSum = new Array(SEATS).fill(0);      // 牌值总和 / sum of card values
const shareSum = new Array(SEATS).fill(0);     // 胜率份额（并列按 1/k） / win-rate share (ties split as 1/k)
const rankPos = new Array(SEATS).fill(0);      // 起手牌在 6 人中的排名位次之和 / sum of starting-hand ranks among 6 players

for (let it = 0; it < N; it++) {
  const deck = PK.shuffle(PK.freshDeck(), rnd);
  const holes = [];
  let k = 0;
  for (let r = 0; r < 2; r++) for (let s = 0; s < SEATS; s++) {
    (holes[s] || (holes[s] = [])).push(deck[k++]);
  }
  const board = [deck[k++], deck[k++], deck[k++], deck[k++], deck[k++]];

  for (let s = 0; s < SEATS; s++) cardSum[s] += holes[s][0] + holes[s][1];

  /* 起手牌质量排名：按对 1 名随机对手的胜率排序 */
  /* Starting-hand quality ranking: sort by win rate against 1 random opponent */
  const pf = holes.map(h => PK.preflopEquity(PK.holeKey(h[0], h[1]), 1));
  const order = pf.map((v, s) => ({ v: v, s: s })).sort((a, b) => b.v - a.v);
  order.forEach((o, i) => { rankPos[o.s] += i; });

  const scores = holes.map(h => PK.evaluate(h.concat(board)));
  const best = Math.max.apply(null, scores);
  const winners = [];
  scores.forEach((sc, s) => { if (sc === best) winners.push(s); });
  const sh = 1 / winners.length;
  winners.forEach(s => { shareSum[s] += sh; });
}

function report() {
  console.log('样本：' + N + ' 手  |  随机源：' + RNG + '\n');
  const expCard = 2 * (51 / 2);   // 每座位 2 张牌，期望牌值 = 2 × 25.5 = 51 / 2 cards per seat, expected card value = 2 × 25.5 = 51
  console.log('【A】平均牌值（期望 ' + expCard + '，越低说明拿到的牌越差）');
  let maxCardDev = 0;
  for (let s = 0; s < SEATS; s++) {
    const v = cardSum[s] / N;
    maxCardDev = Math.max(maxCardDev, Math.abs(v - expCard));
    console.log('  seat ' + s + ' : ' + v.toFixed(4) + '   (偏差 ' + (v - expCard >= 0 ? '+' : '') + (v - expCard).toFixed(4) + ')');
  }

  console.log('\n【B】起手牌平均排名（0 = 该手最好，期望 2.5）');
  let maxRankDev = 0;
  for (let s = 0; s < SEATS; s++) {
    const v = rankPos[s] / N;
    maxRankDev = Math.max(maxRankDev, Math.abs(v - 2.5));
    console.log('  seat ' + s + ' : ' + v.toFixed(4) + '   (偏差 ' + (v - 2.5 >= 0 ? '+' : '') + (v - 2.5).toFixed(4) + ')');
  }

  console.log('\n【C】胜率份额（期望 1/6 = 0.166667）');
  let maxShareDev = 0, sum = 0;
  for (let s = 0; s < SEATS; s++) {
    const v = shareSum[s] / N;
    sum += v;
    maxShareDev = Math.max(maxShareDev, Math.abs(v - 1 / 6));
    console.log('  seat ' + s + ' : ' + (v * 100).toFixed(4) + '%   (偏差 ' + ((v - 1 / 6) * 100).toFixed(4) + 'pp)');
  }
  console.log('  份额合计：' + (sum * 100).toFixed(4) + '%（应 = 100%）');

  console.log('\n判定：');
  const cardSE = Math.sqrt(2 * (52 * 52 - 1) / 12) / Math.sqrt(N);   // 牌值方差 / card-value variance
  console.log('  牌值均值标准误 ≈ ' + cardSE.toFixed(4) + '，最大偏差 ' + maxCardDev.toFixed(4) +
    ' → ' + (maxCardDev / cardSE).toFixed(2) + 'σ');
  if (maxCardDev / cardSE < 4) console.log('  ✅ 洗牌与发牌公平（偏差在 4σ 内）');
  else console.log('  ⚠️ 发牌可疑，需排查 shuffle / freshDeck');
  process.exit(0);
}
report();
