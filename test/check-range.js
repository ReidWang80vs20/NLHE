/* ============================================================
 * check-range.js — 169 类范围模型自检（Node，不依赖浏览器）
 * check-range.js — self-check of the 169-class range model (Node, no browser required)
 *   node test/check-range.js
 * ============================================================ */
'use strict';
const path = require('path');
['poker.js', 'equity.js', 'range.js'].forEach(f => require(path.join(__dirname, '..', 'src', f)));
const PK = globalThis.PK;
const R = PK.Range;

let pass = 0, fail = 0;
const bad = [];
let gName = '', gPass = 0, gFail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; gPass++; }
  else { fail++; gFail++; bad.push('[' + gName + '] ' + name + (extra ? '  → ' + extra : '')); }
}
function group(t) {
  if (gName) console.log('   ' + (gFail ? '✗ ' + gFail + ' 项失败' : '✓ ' + gPass + ' 项通过'));
  gName = t; gPass = 0; gFail = 0;
  console.log('\n── ' + t);
}
const C = (...a) => a.map(s => PK.parseCard(s));

/* ---------- 1. 组合数与结构 ----------
 * ---------- 1. Combo counts and structure ---------- */
group('1. 结构完整性');
ok(R.N === 169, '类别数为 169', String(R.N));
ok(R.totalCombos === 1326, '组合总数为 1326', String(R.totalCombos));

let pairC = 0, suitC = 0, offC = 0;
for (let i = 0; i < R.N; i++) {
  const k = R.ORDER[i], n = R.COMBOS[i].length;
  if (/^([2-9TJQKA])\1$/.test(k)) pairC += n;
  else if (k.endsWith('s')) suitC += n;
  else offC += n;
}
ok(pairC === 78, '对子合计 78 个组合', String(pairC));
ok(suitC === 312, '同花合计 312 个组合', String(suitC));
ok(offC === 936, '不同花合计 936 个组合', String(offC));

/* 13x13 热力图必须恰好覆盖全部 169 类且不重复
 * The 13x13 heatmap must cover all 169 classes exactly once, with no duplicates */
const seen = new Set();
let dup = 0, missing = 0;
for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
  const i = R.HEATMAP[r][c];
  if (i < 0) { missing++; continue; }
  if (seen.has(i)) dup++; else seen.add(i);
}
ok(seen.size === 169, '热力图覆盖全部 169 类', '实得 ' + seen.size);
ok(dup === 0 && missing === 0, '热力图无重复、无空缺', 'dup=' + dup + ' missing=' + missing);
/* 角点必须是最强与最弱
 * The corners must be the strongest and the weakest */
ok(R.ORDER[R.HEATMAP[0][0]] === 'AA', '左上角 = AA', R.ORDER[R.HEATMAP[0][0]]);
ok(R.ORDER[R.HEATMAP[12][12]] === '22', '右下角 = 22', R.ORDER[R.HEATMAP[12][12]]);
ok(R.ORDER[R.HEATMAP[0][1]] === 'AKs', 'AA 右侧 = AKs', R.ORDER[R.HEATMAP[0][1]]);
ok(R.ORDER[R.HEATMAP[1][0]] === 'AKo', 'AA 下方 = AKo', R.ORDER[R.HEATMAP[1][0]]);

/* ---------- 2. 索引与阻断 ----------
 * ---------- 2. Indexing and blocking ---------- */
group('2. 索引 / 阻断牌');
ok(R.idxOfKey('AA') === 0, 'AA 排名第 0', String(R.idxOfKey('AA')));
ok(R.idxOfKey('32o') === 168, '32o 排名第 168', String(R.idxOfKey('32o')));
ok(R.idxOf(...C('As', 'Ah')) === R.idxOfKey('AA'), '同色 AA 归入 AA');
ok(R.idxOf(...C('As', 'Ks')) === R.idxOfKey('AKs'), 'AK 同花归入 AKs');
ok(R.idxOf(...C('As', 'Kh')) === R.idxOfKey('AKo'), 'AK 不同花归入 AKo');
/* idxOf 同时接受数组形式（代码库里牌组到处都是数组）
 * idxOf also accepts the array form (card sets are arrays all over the codebase) */
ok(R.idxOf(C('As', 'Ah')) === R.idxOfKey('AA'), 'idxOf 也接受 [c1,c2] 数组形式');

const uni = R.uniformWeights(1);
ok(R.combosInRange(uni) === 1326, '无阻断时随机范围 = 1326 组合', String(R.combosInRange(uni)));
/* 手持 A♠A♥ 时，AA 只剩 1 个组合，所有含 A 的类别都受影响
 * Holding A♠A♥ leaves only 1 combo for AA, and every class containing an A is affected */
const aaLeft = R.combosInRange(R.topWeights(0), C('As', 'Ah'));
ok(aaLeft === 1, '手持 A♠A♥ 时 AA 仅剩 1 组合', String(aaLeft));
/* combosInRange 返回的就是"扣除阻断牌后的剩余组合数"，不要再拿 1326 去减它
 * combosInRange already returns "remaining combos after removing blocked cards"; do not subtract it from 1326 */
const totalLeft = R.combosInRange(uni, C('As', 'Ah'));
ok(totalLeft === 1225, '两张已知牌后剩余 1225 组合', String(totalLeft));
/* 口径陷阱：topWeights 按**类别数**切，不是按组合数切。
 * Metric-definition trap: topWeights cuts by **class count**, not by combo count.
   强牌区里对子(6 组合)与同花(4 组合)占多数，组合数天生少，
 * In the strong-hand region, pairs (6 combos) and suited hands (4 combos) dominate, so the combo count is naturally small,
   所以"前 10% 的类别"实际只覆盖约 6~9% 的组合。
 * hence "the top 10% of classes" actually covers only about 6~9% of combos. */
const p10class = R.pctOfRange(R.topWeights(0.10), C('As', 'Ah'));
ok(p10class > 0.05 && p10class < 0.12, 'topWeights(10%) 实际覆盖约 6%~12% 的组合（类别口径）',
  (p10class * 100).toFixed(1) + '%');
const p10combos = R.pctOfRange(R.topCombos(0.10));
ok(Math.abs(p10combos - 0.10) < 0.01, 'topCombos(10%) 无阻断时恰好覆盖 10% 的组合',
  (p10combos * 100).toFixed(1) + '%');
/* 阻断效应：手持 A♠A♥ 会同时抽掉对手范围顶部的 AA/AK 组合，
 * Blocking effect: holding A♠A♥ removes the top-of-range AA/AK combos from the opponent's range,
   而顶部恰好被抽得最狠，于是"实际能落在范围里的牌"变少了。
 * and the top is exactly where the removal hits hardest, so fewer hands can actually land in the range.
   这不是 bug，是真实存在的阻断效应。
 * This is not a bug — it is a real blocking effect. */
const p10blocked = R.pctOfRange(R.topCombos(0.10), C('As', 'Ah'));
ok(p10blocked < p10combos - 0.01, '手持 A♠A♥ 显著缩小对手的实际可用范围（阻断效应）',
  (p10combos * 100).toFixed(1) + '% → ' + (p10blocked * 100).toFixed(1) + '%');
ok(R.pctOfRange(R.topWeights(1)) > 0.999, 'topWeights(1) = 全部牌');
ok(R.pctOfRange(R.topCombos(0.25)) > R.pctOfRange(R.topWeights(0.25)),
  '同样写 25%：组合口径的范围比类别口径更宽');

/* ---------- 3. 翻前范围形状 ----------
 * ---------- 3. Preflop range shape ---------- */
group('3. 翻前范围（极化是否正确）');
const openBtn = R.fromLine({ preflop: 'open', posPct: 1 });
const openUtg = R.fromLine({ preflop: 'open', posPct: 0 });
ok(R.pctOfRange(openBtn) > R.pctOfRange(openUtg), '按钮开池范围宽于枪口',
  (R.pctOfRange(openBtn) * 100).toFixed(1) + '% vs ' + (R.pctOfRange(openUtg) * 100).toFixed(1) + '%');

const three = R.fromLine({ preflop: 'threebet', posPct: 0.5 });
ok(three[R.idxOfKey('AA')] > 0.9, '3-bet 范围含 AA', String(three[R.idxOfKey('AA')].toFixed(2)));
ok(three[R.idxOfKey('76s')] > 0.3, '3-bet 范围含 76s（极化尾巴）', String(three[R.idxOfKey('76s')].toFixed(2)));
ok(three[R.idxOfKey('A9o')] < 0.05, '3-bet 范围**不含** A9o（中游牌，这才是关键）',
  String(three[R.idxOfKey('A9o')].toFixed(2)));
ok(three[R.idxOfKey('32o')] < 0.05, '3-bet 范围不含 32o', String(three[R.idxOfKey('32o')].toFixed(2)));
ok(R.pctOfRange(three) < 0.12, '3-bet 总范围不超过 12%', (R.pctOfRange(three) * 100).toFixed(1) + '%');

const four = R.fromLine({ preflop: 'fourbet' });
ok(R.pctOfRange(four) < 0.04, '4-bet 范围极窄（<4%）', (R.pctOfRange(four) * 100).toFixed(1) + '%');
ok(four[R.idxOfKey('72o')] === 0, '4-bet 不含 72o');

const callOpen = R.fromLine({ preflop: 'callOpen', posPct: 0.5 });
ok(callOpen[R.idxOfKey('AA')] < 0.05, '跟注开池范围剔除 AA（该 3-bet）', String(callOpen[R.idxOfKey('AA')].toFixed(2)));
ok(callOpen[R.idxOfKey('99')] > 0.5, '跟注开池范围含 99', String(callOpen[R.idxOfKey('99')].toFixed(2)));

/* ---------- 4. 翻后因子 ----------
 * ---------- 4. Postflop factors ---------- */
group('4. 翻后因子（牌面相关）');
const boardA = C('Ah', '7d', '2c');
const flop = R.fromLine({ preflop: 'open', postflop: ['bet'], posPct: 0.5, board: boardA });
const flopCheck = R.fromLine({ preflop: 'open', postflop: ['check'], posPct: 0.5, board: boardA });
const setW = flop[R.idxOfKey('77')], airW = flop[R.idxOfKey('KQo')];
ok(setW > airW, 'A72 面上，77（三条）比 KQo（空气）更可能下注',
  setW.toFixed(2) + ' vs ' + airW.toFixed(2));
ok(flop[R.idxOfKey('AKs')] > flop[R.idxOfKey('KQo')], 'A72 面上 AKs（顶对）比 KQo 更可能下注',
  flop[R.idxOfKey('AKs')].toFixed(2) + ' vs ' + flop[R.idxOfKey('KQo')].toFixed(2));
ok(flopCheck[R.idxOfKey('KQo')] > flop[R.idxOfKey('KQo')], '空气牌更可能过牌而不是下注',
  flopCheck[R.idxOfKey('KQo')].toFixed(2) + ' vs ' + flop[R.idxOfKey('KQo')].toFixed(2));

const strongB = R.strongShare(flop, boardA, []);
const strongC = R.strongShare(flopCheck, boardA, []);
ok(strongB > strongC, '下注范围里的强牌占比高于过牌范围',
  (strongB * 100).toFixed(1) + '% vs ' + (strongC * 100).toFixed(1) + '%');

/* ---------- 5. 按权重的胜率 ----------
 * ---------- 5. Weighted range equity ---------- */
group('5. 加权范围胜率');
/* 迭代数从 4000 提到 40000，理由是**统计功效**，不是为了让断言变松：
 * The iteration count was raised from 4000 to 40000 for **statistical power**, not to loosen the assertion:
 * 本区要做的是"两个估计值比大小"，而 AA 对随机牌(85.25%) 与对 3-bet 范围(83.82%)
 * This section compares two estimates, and AA vs random (85.25%) versus AA vs the 3-bet range (83.82%)
 * 只差 1.43pp。4000 次时单侧标准误约 0.56pp，差值仅 ~1.8σ —— 实测 5 次挂 1 次。
 * differ by only 1.43pp. At 4000 iterations the one-sided standard error is about 0.56pp, a gap of only ~1.8σ — 1 failure in 5 runs in practice.
 * 40000 次时标准误约 0.18pp，同样的差值≈8σ，才谈得上"稳定成立"。
 * At 40000 iterations the standard error is about 0.18pp and the same gap is ≈8σ, which is what makes it "reliably hold".
 * 下面的收敛值由 test/probe-3bet.mjs 以 200000 次迭代跑 3 轮取得（极差 <0.31pp）。
 * The converged values below come from test/probe-3bet.mjs running 3 rounds at 200000 iterations (range <0.31pp). */
const iters = 40000;
const aaPre = R.equityVsWeights(C('As', 'Ah'), [], R.uniformWeights(1), iters, { nOpp: 1 });
ok(Math.abs(aaPre - 0.852) < 0.035, 'AA 对随机牌单挑胜率约 85%', (aaPre * 100).toFixed(1) + '%');

const vsTop3 = R.equityVsWeights(C('As', 'Ah'), [], R.topWeights(0.03), iters, { nOpp: 1 });
ok(vsTop3 < aaPre, 'AA 对 top3% 的胜率低于对随机牌', (vsTop3 * 100).toFixed(1) + '%');
/* top3%（按百分位切）实际只含 AA~99 六种对子，AA 对它们约 78%；
 * top3% (cut by percentile) actually contains only the six pairs AA~99, and AA wins about 78% against them;
   这里用区间而不是点值，是因为它本来就是个粗口径
 * a band is used instead of a point value because this is inherently a coarse metric */
ok(vsTop3 > 0.74 && vsTop3 < 0.86, 'AA 对 top3%（99+ 对子）胜率在 74%~86%', (vsTop3 * 100).toFixed(1) + '%');

const vsThree = R.equityVsWeights(C('As', 'Ah'), [], R.fromLine({ preflop: 'threebet', posPct: 0.5 }), iters, { nOpp: 1 });
ok(vsThree < aaPre, 'AA 对 3-bet 范围低于对随机牌', (vsThree * 100).toFixed(1) + '%');
const vsFour = R.equityVsWeights(C('As', 'Ah'), [], R.fromLine({ preflop: 'fourbet' }), iters, { nOpp: 1 });
ok(vsFour < aaPre, 'AA 对 4-bet 范围低于对随机牌', (vsFour * 100).toFixed(1) + '%');
/* ⚠️ 不要加 `vsFour < vsThree`（4-bet 更窄 ⇒ AA 胜率更低）——那是错的。
 * ⚠️ Do not add `vsFour < vsThree` (a narrower 4-bet ⇒ lower AA equity) — that is wrong.
 * 收敛值实测：对 3-bet 83.82%、对 4-bet 84.10%，**4-bet 反而更高**。
 * Measured converged values: vs 3-bet 83.82%, vs 4-bet 84.10% — the **4-bet is actually higher**.
 * 两个范围都含 AK，而 AA 对 AK 高达 93%，主导项是"对子密度"而不是范围宽度。
 * Both ranges contain AK, and AA is 93% against AK, so the dominant factor is "pair density", not range width.
 * 这里改用公开口径的合理区间：既能证伪异常值（采样顺序写错会掉到 69%），
 * A reasonable band under a public metric is used instead: it can still falsify outliers (a wrong sampling order drops to 69%)
 * 又不依赖"越窄越低"这个不成立的方向假设。
 * without relying on the invalid directional assumption that "narrower means lower". */
ok(vsThree > 0.78 && vsThree < 0.89, 'AA 对 3-bet 范围胜率在 78%~89%（收敛值 83.8%）', (vsThree * 100).toFixed(1) + '%');
ok(vsFour > 0.78 && vsFour < 0.89, 'AA 对 4-bet 范围胜率在 78%~89%（收敛值 84.1%）', (vsFour * 100).toFixed(1) + '%');

/* 范围越宽 → 对手平均越弱 → AA 胜率越高。
 * Wider range → weaker opponent on average → higher AA equity.
   ⚠️ 注意这条**不是**扑克定律，只是 topCombos 这种"按强度前缀"切法下的结果。
 * ⚠️ Note this is **not** a poker law, only a result of the "strength-prefix" cut used by topCombos.
   反例：AA 对 AKo 高到 93%（AA 完全压制），对 76s 只有 77%（活顺子活花），
 * Counterexample: AA vs AKo is as high as 93% (AA dominates), vs 76s only 77% (live straight and flush draws),
   所以"对手范围更强"不等于"AA 胜率更低"。真正的地基是下面那条单类对照。
 * so "a stronger opponent range" does not mean "lower AA equity". The real foundation is the single-class comparison below. */
const w50 = R.equityVsWeights(C('As', 'Ah'), [], R.topCombos(0.50), iters, { nOpp: 1 });
const w10 = R.equityVsWeights(C('As', 'Ah'), [], R.topCombos(0.10), iters, { nOpp: 1 });
const w03 = R.equityVsWeights(C('As', 'Ah'), [], R.topCombos(0.03), iters, { nOpp: 1 });
ok(w50 > w10 && w10 > w03, 'AA 胜率随 topCombos 收窄而下降',
  (w50 * 100).toFixed(1) + '% > ' + (w10 * 100).toFixed(1) + '% > ' + (w03 * 100).toFixed(1) + '%');

/* ============================================================
 * 单类对照 —— 这块是 equityVsWeights 的地基，用公开值锚定。
 * Single-class comparison — this is the foundation of equityVsWeights, anchored to published values.
 *
 * 为什么必须有：曾经的发牌顺序是"先把公共牌从 50 张里发完，再让对手在范围里
 * Why it is mandatory: the dealing order used to be "deal the board fully from the 50 remaining cards, then let the opponent pick
 * 挑两张避开公共牌"。那样公共牌是从一副**还含着对手底牌**的牌堆里发出来的，
 * two cards from the range that avoid the board". That dealt the board from a deck that **still contained the opponent's hole cards**,
 * 挡住对手范围的牌面被系统性放大（AA 对纯 KK 时"公共牌出现 K"的概率从 20.0%
 * systematically inflating boards that block the opponent's range (for AA vs pure KK the chance of "a K on the board" rose from 20.0%
 * 涨到 35.3%）。范围越窄偏差越大：AA 对纯 KK 只有 69.55%，而真值是 81.95%。
 * to 35.3%). The narrower the range the larger the bias: AA vs pure KK was only 69.55% against a true value of 81.95%.
 *
 * 只测"对随机牌"是发现不了的（随机范围里阻断被摊平，85.2% 一直是对的），
 * Testing only "vs random" cannot reveal this (blocking averages out against a random range, and 85.2% was always right),
 * 必须用**窄范围**才照得出来 —— 这就是下面这几条存在的理由。
 * it takes a **narrow range** to expose it — which is why the checks below exist.
 * ============================================================ */
const single = (key) => {
  const w = R.emptyWeights();
  w[R.idxOfKey(key)] = 1;
  return R.equityVsWeights(C('As', 'Ah'), [], w, 60000, { nOpp: 1 });
};
const PUBLISHED = [['KK', 0.819], ['QQ', 0.812], ['22', 0.826], ['AKo', 0.927], ['76s', 0.775]];
let singleBad = [];
for (const [key, want] of PUBLISHED) {
  const got = single(key);
  if (Math.abs(got - want) > 0.012) singleBad.push(key + ' ' + (got * 100).toFixed(2) + '%≠' + (want * 100).toFixed(1) + '%');
}
ok(singleBad.length === 0, 'AA 对 5 个单类起手牌的胜率与公开值一致（±1.2pp）',
  singleBad.join(', ') || PUBLISHED.map(([k, v]) => k + ' ' + (v * 100).toFixed(1)).join(' / '));
ok(single('KK') > 0.80, 'AA 对纯 KK 不得掉到 80% 以下（旧发牌顺序 bug 时会掉到 69.5%）',
  (single('KK') * 100).toFixed(2) + '%');

/* 混合恒等式：一个范围与其补集，按组合数加权后必须等于全体。
 * Mixing identity: a range and its complement, weighted by combo count, must equal the whole.
   这条能一次抓住"抽样权重错"和"阻断处理错"两类毛病。
 * This catches both "wrong sampling weights" and "wrong blocking handling" in one shot. */
{
  const t = R.topCombos(0.50);
  const b = R.emptyWeights();
  for (let i = 0; i < R.N; i++) if (!(t[i] > 0)) b[i] = 1;
  const nT = R.combosInRange(t), nB = R.combosInRange(b);
  const eAll = R.equityVsWeights(C('As', 'Ah'), [], R.uniformWeights(1), 60000, { nOpp: 1 });
  const eT = R.equityVsWeights(C('As', 'Ah'), [], t, 60000, { nOpp: 1 });
  const eB = R.equityVsWeights(C('As', 'Ah'), [], b, 60000, { nOpp: 1 });
  const mix = (nT * eT + nB * eB) / (nT + nB);
  ok(Math.abs(mix - eAll) < 0.008, '范围与其补集按组合数加权后还原为全体',
    '混合 ' + (mix * 100).toFixed(2) + '% vs 全体 ' + (eAll * 100).toFixed(2) + '%');
}

const t72 = R.equityVsWeights(C('7h', '2d'), [], R.uniformWeights(1), iters, { nOpp: 1 });
ok(t72 < 0.40, '72o 对随机牌胜率低于 40%', (t72 * 100).toFixed(1) + '%');

/* 与旧版 rangePct 口径应大体一致（同为"前 10% 的牌"）
 * Should be broadly consistent with the old rangePct metric (both being "the top 10% of hands") */
const wOld = PK.estimateEquity(C('As', 'Ah'), [], 1, iters, 0.10);
const wNew = R.equityVsWeights(C('As', 'Ah'), [], R.topWeights(0.10), iters, { nOpp: 1 });
ok(Math.abs(wOld - wNew) < 0.05, '新口径与旧 rangePct 口径结果接近（交叉校验）',
  (wOld * 100).toFixed(1) + '% vs ' + (wNew * 100).toFixed(1) + '%');

/* 多人局：对手越多胜率越低
 * Multiway: the more opponents, the lower the equity */
const eq1 = R.equityVsWeights(C('As', 'Ah'), [], R.uniformWeights(1), 2500, { nOpp: 1 });
const eq3 = R.equityVsWeights(C('As', 'Ah'), [], R.uniformWeights(1), 2500, { nOpp: 3 });
ok(eq3 < eq1, '对手越多 AA 胜率越低', (eq1 * 100).toFixed(1) + '% → ' + (eq3 * 100).toFixed(1) + '%');

/* 翻后：已知牌面下不应该出现重复牌
 * Postflop: with a known board there must be no duplicate cards */
const eqFlip = R.equityVsWeights(C('As', 'Ah'), C('Ad', '7h', '2s'), R.uniformWeights(1), 1500, { nOpp: 1 });
ok(eqFlip > 0.9, 'A72 面持 AA（三条 A）胜率极高', (eqFlip * 100).toFixed(1) + '%');

/* ---------- 6. 由复盘记录还原范围 ----------
 * ---------- 6. Reconstructing a range from a hand record ---------- */
group('6. fromRecord 还原');
const fakeRec = {
  button: 5, seats: 6, board: C('Ah', '7d', '2c', '9s'),
  heroHole: C('Ks', 'Qd'),
  actions: [
    { seat: 3, street: 'preflop', action: 'raise', boardLen: 0 },
    { seat: 0, street: 'preflop', action: 'call', boardLen: 0 },
    { seat: 3, street: 'flop', action: 'raise', boardLen: 3 },
  ],
};
const rw = R.fromRecord(fakeRec, 3, 3, 3);
ok(rw[R.idxOfKey('AA')] > rw[R.idxOfKey('32o')], '加注过的对手：AA 权重高于 32o',
  rw[R.idxOfKey('AA')].toFixed(2) + ' vs ' + rw[R.idxOfKey('32o')].toFixed(2));
ok(R.pctOfRange(rw) < 0.35, '翻前加注 + 翻牌再加注 → 范围已明显收窄',
  (R.pctOfRange(rw) * 100).toFixed(1) + '%');

const rwPassive = R.fromRecord(fakeRec, 0, 0, 1);
ok(R.pctOfRange(rwPassive) > R.pctOfRange(rw), '只跟注的范围宽于加注两次的范围',
  (R.pctOfRange(rwPassive) * 100).toFixed(1) + '% vs ' + (R.pctOfRange(rw) * 100).toFixed(1) + '%');

/* ---------- 7. 性能 ----------
 * ---------- 7. Performance ---------- */
group('7. 性能');
let t0 = Date.now();
for (let i = 0; i < 20; i++) R.equityVsWeights(C('As', 'Ah'), C('Ah', '7d', '2c').slice(0, 3), R.uniformWeights(1), 700, { nOpp: 1 });
const per = (Date.now() - t0) / 20;
ok(per < 60, '单次 700 迭代加权胜率 < 60ms', per.toFixed(1) + 'ms');

t0 = Date.now();
for (let i = 0; i < 20; i++) R.fromLine({ preflop: 'threebet', postflop: ['bet'], board: C('Ah', '7d', '2c'), posPct: 0.5 });
const perLine = (Date.now() - t0) / 20;
ok(perLine < 40, '单次构造范围向量 < 40ms', perLine.toFixed(1) + 'ms');

/* ---------- 汇总 ----------
 * ---------- Summary ---------- */
if (gName) console.log('   ' + (gFail ? '✗ ' + gFail + ' 项失败' : '✓ ' + gPass + ' 项通过'));
console.log('\n' + '─'.repeat(56));
if (fail) {
  console.log('❌ 失败 ' + fail + ' 项：');
  bad.forEach(b => console.log('   · ' + b));
} else {
  console.log('✅ 全部通过：' + pass + ' 项断言');
}
console.log('─'.repeat(56));
process.exit(fail ? 1 : 0);
