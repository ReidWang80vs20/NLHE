/* ============================================================
 * check-ev.js — EV 损失复盘自检（Node，不依赖浏览器）
 * check-ev.js — EV loss review self-check (Node, no browser required)
 *   node test/check-ev.js
 *
 * 断言分两类，刻意区别对待：
 * Assertions fall into two deliberately differentiated categories:
 *   ✔ 不变量（必须成立的结构性质）：单调性、口径自洽、公式恒等、
 *   ✔ Invariants (structural properties that must hold): monotonicity, metric self-consistency, formula identities,
 *     前置状态还原。这些一旦破坏就是真 bug，必须让测试红。
 *     restoration of the prior state. If these break it is a real bug, and the test must go red.
 *   ○ 标定值（经验参数的绝对大小）：只打印供人眼复核，不做断言。
 *   ○ Calibration values (absolute magnitudes of empirical parameters): printed only for human review, not asserted.
 *     把"当前恰好算出来的数"写成断言，等于把可能错误的标定固化成
 *     Writing "the number currently computed" as an assertion freezes a possibly wrong calibration into
 *     "通过"，日后调参时测试只会碍事，不会报警。
 *     a "pass", so later tuning only gets in the way instead of raising an alarm.
 * ============================================================ */
'use strict';
const path = require('path');
['poker.js', 'equity.js', 'range.js', 'evloss.js', 'storage.js']
  .forEach(f => require(path.join(__dirname, '..', 'src', f)));
const PK = globalThis.PK;
const R = PK.Range;
const E = PK.EVLoss;

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
const BB = 2;

/* ============================================================
 * 记录构造器 —— 独立实现一遍引擎的记账，作为 walk() 的对照真值
 * Record builder — an independent reimplementation of the engine's bookkeeping, used as ground truth for walk()
 * ============================================================ */
const BL = { preflop: 0, flop: 3, turn: 4, river: 5 };

/**
 * @param spec.acts [{street, seat, action:'fold'|'check'|'call'|'raise', to?}]  to = 加注到的下注额
 * @param spec.acts [{street, seat, action:'fold'|'check'|'call'|'raise', to?}]  to = the bet amount raised to
 * @returns {{rec: object, truth: Array}}  truth[i] = 第 i 次行动**之前**的场面
 * @returns {{rec: object, truth: Array}}  truth[i] = the state **before** the i-th action
 */
function mkRec(spec) {
  const n = spec.seats || 6;
  const bb = spec.bb || BB, sb = spec.sb || 1;
  const button = spec.button === undefined ? 3 : spec.button;
  const stack0 = spec.stack || 200;
  const holes = spec.holes || {};

  const bet = new Array(n).fill(0);
  const stack = new Array(n).fill(stack0);
  const folded = new Array(n).fill(false);
  const sbSeat = (button + 1) % n, bbSeat = (button + 2) % n;
  bet[sbSeat] = sb; bet[bbSeat] = bb;
  stack[sbSeat] -= sb; stack[bbSeat] -= bb;

  let pot = sb + bb, cur = bb, street = 'preflop';
  const actions = [], truth = [];

  for (const a of spec.acts) {
    if (a.street !== street) { street = a.street; bet.fill(0); cur = 0; }
    const toCall = Math.max(0, cur - bet[a.seat]);
    const potBefore = pot, stackBefore = stack[a.seat];

    let pay = 0;
    if (a.action === 'call') pay = Math.min(toCall, stack[a.seat]);
    else if (a.action === 'raise') pay = a.to - bet[a.seat];
    else if (a.action === 'allin') pay = stack[a.seat];
    pay = Math.max(0, Math.min(pay, stack[a.seat]));

    stack[a.seat] -= pay;
    bet[a.seat] += pay;
    pot += pay;

    let act = a.action;
    if (a.action === 'fold') { folded[a.seat] = true; act = 'fold'; }
    else if (bet[a.seat] > cur) { if (act !== 'raise') act = 'raise'; cur = bet[a.seat]; }

    actions.push({
      street: street, seat: a.seat, action: act, note: a.note || null,
      toCall: toCall, betAfter: bet[a.seat], pot: pot, stack: stack[a.seat],
      allIn: stack[a.seat] === 0, boardLen: BL[street],
    });
    truth.push({ potBefore: potBefore, invested: pay, toCall: toCall, stackBefore: stackBefore });
  }

  const rec = {
    no: spec.no || 1, button: button, sb: sb, bb: bb, seats: n,
    players: Array.from({ length: n }, (_, s) => ({
      seat: s, name: s === 0 ? '你' : ('AI' + s),
      hole: holes[s] || [], isHero: s === 0, folded: folded[s],
    })),
    board: (spec.board || []).slice(),
    actions: actions,
    result: spec.result || { type: 'fold', pot: pot, winners: [{ seat: 0, amount: pot }] },
    heroHole: holes[0] || [],
    heroNet: spec.heroNet || 0,
  };
  return { rec: rec, truth: truth };
}

/* 标准局面：6 人桌，按钮位 3，英雄 UTG 加注，1 号位跟注，单挑到河牌。
 * Standard situation: 6-handed, button at seat 3, hero UTG raises, seat 1 calls, heads-up to the river.
   翻牌 A♠K♦7♣ → 转牌 2♥ → 河牌 9♠（无同花、无顺子可能，便于定性判断）。
 * Flop A♠K♦7♣ → turn 2♥ → river 9♠ (no flush or straight possible, easing qualitative judgment). */
const BOARD = C('As', 'Kd', '7c', '2h', '9s');
const ACTS = [
  { street: 'preflop', seat: 0, action: 'raise', to: 6 },
  { street: 'preflop', seat: 1, action: 'call' },
  { street: 'preflop', seat: 2, action: 'fold' },
  { street: 'preflop', seat: 3, action: 'fold' },
  { street: 'preflop', seat: 4, action: 'fold' },
  { street: 'preflop', seat: 5, action: 'fold' },
  { street: 'flop', seat: 0, action: 'check' },
  { street: 'flop', seat: 1, action: 'raise', to: 8 },
  { street: 'flop', seat: 0, action: 'call' },
  { street: 'turn', seat: 0, action: 'check' },
  { street: 'turn', seat: 1, action: 'raise', to: 20 },
  { street: 'turn', seat: 0, action: 'call' },
  { street: 'river', seat: 0, action: 'check' },
  { street: 'river', seat: 1, action: 'raise', to: 40 },
  { street: 'river', seat: 0, action: 'call' },
];

function hand(heroHole, acts) {
  return mkRec({
    board: BOARD, heroNet: 77,
    holes: { 0: heroHole, 1: C('Ks', 'Qs') },
    acts: acts || ACTS,
  });
}

/* ============================================================
 * 1. walk()：行动前场面还原
 * 1. walk(): restoring the pre-action state
 * ============================================================ */
group('1. 前置状态还原（walk 对比引擎记账的独立实现）');
{
  const { rec, truth } = hand(C('Ah', 'Ad'));
  const w = E.walk(rec);
  ok(w.length === rec.actions.length, '每个行动都有对应状态',
    w.length + ' vs ' + rec.actions.length);

  let potBad = 0, invBad = 0, tcBad = 0, stkBad = 0;
  for (let i = 0; i < w.length; i++) {
    if (w[i].potBefore !== truth[i].potBefore) potBad++;
    if (w[i].invested !== truth[i].invested) invBad++;
    if (w[i].a.toCall !== truth[i].toCall) tcBad++;
    if (w[i].stackBefore !== truth[i].stackBefore) stkBad++;
  }
  ok(potBad === 0, '行动前底池全部一致', potBad + ' 处不符');
  ok(invBad === 0, '本次投入全部一致', invBad + ' 处不符');
  ok(tcBad === 0, 'toCall 全部一致', tcBad + ' 处不符');
  ok(stkBad === 0, '行动前筹码全部一致', stkBad + ' 处不符');

  /* 具体数值抽查：河牌那次跟注面对的底池应含对手的下注
   * Specific numeric spot-check: the pot the river call faces should include the opponent's bet */
  const river = w[w.length - 1];
  ok(river.street === 'river' && river.a.seat === 0, '末条行动是英雄的河牌跟注');
  ok(river.potBefore === 111, '河牌跟注面对底池 111（含对手 40 的下注）', String(river.potBefore));
  ok(river.invested === 40, '河牌跟注投入 40', String(river.invested));
}

/* 换街后本街下注额必须清零
 * On a street change the current-street bet amount must reset to zero */
{
  const { rec } = hand(C('Ah', 'Ad'));
  const w = E.walk(rec);
  const firstFlop = w.find(x => x.street === 'flop');
  const firstTurn = w.find(x => x.street === 'turn');
  const firstRiver = w.find(x => x.street === 'river');
  ok(firstFlop.prev === 0, '翻牌第一条行动的本街投入为 0', String(firstFlop.prev));
  ok(firstTurn.prev === 0, '转牌第一条行动的本街投入为 0', String(firstTurn.prev));
  ok(firstRiver.prev === 0, '河牌第一条行动的本街投入为 0', String(firstRiver.prev));
}

/* ★ 盲注播种：大盲过牌时不得被算成"投入了一个大盲"
 * ★ Blind seeding: when the big blind checks it must not be counted as "invested one big blind" */
group('2. 盲注播种（容易漏，漏了行动前底池就错）');
{
  const limp = mkRec({
    board: BOARD, holes: { 0: C('Ah', 'Ad'), 1: C('Ks', 'Qs') },
    acts: [
      { street: 'preflop', seat: 0, action: 'call' },
      { street: 'preflop', seat: 1, action: 'call' },
      { street: 'preflop', seat: 2, action: 'call' },
      { street: 'preflop', seat: 3, action: 'call' },
      { street: 'preflop', seat: 4, action: 'call' },
      { street: 'preflop', seat: 5, action: 'check' },
    ],
  });
  const w = E.walk(limp.rec);
  const bbAct = w[w.length - 1];
  ok(bbAct.a.seat === 5, '末条是大盲位（座位 5）的行动');
  ok(bbAct.prev === BB, '大盲行动前本街已投入 = 大盲注 ' + BB, String(bbAct.prev));
  ok(bbAct.invested === 0, '大盲过牌算零投入（不是又投入一个大盲）', String(bbAct.invested));
  ok(bbAct.potBefore === 12, '大盲过牌前底池 12（3 盲注 + 四个跟注 2 + 小盲补 1）',
    String(bbAct.potBefore));
  ok(bbAct.stackBefore === 198, '大盲行动前筹码已扣掉盲注', String(bbAct.stackBefore));

  /* 小盲补盲：只补 1
   * Small blind completing: only 1 more */
  const sbAct = w.find(x => x.a.seat === 4);
  ok(sbAct.invested === 1, '小盲补盲只投入 1', String(sbAct.invested));
}

/* ============================================================
 * 3. 对手继续模型
 * 3. Opponent continuing model
 * ============================================================ */
group('3. 继续门槛 needCat 与 continueRange');
{
  ok(E.needCat(0.15) === 0, '价格 15% → 门槛：任何牌', String(E.needCat(0.15)));
  ok(E.needCat(0.16) === 1, '价格 16% → 门槛：一对', String(E.needCat(0.16)));
  ok(E.needCat(0.27) === 1, '价格 27% → 门槛：一对', String(E.needCat(0.27)));
  ok(E.needCat(0.28) === 2, '价格 28% → 门槛：两对', String(E.needCat(0.28)));
  ok(E.needCat(0.41) === 2, '价格 41% → 门槛：两对', String(E.needCat(0.41)));
  ok(E.needCat(0.42) === 3, '价格 42% → 门槛：三条', String(E.needCat(0.42)));

  let mono = true, prev = -1;
  for (let p = 0; p <= 0.9; p += 0.02) {
    const c = E.needCat(p);
    if (c < prev) mono = false;
    prev = c;
  }
  ok(mono, 'needCat 随价格单调不减');

  const hole = C('Ah', 'Ad');
  const board = C('As', 'Kd', '7c');
  const known = hole.concat(board);
  const range = R.topCombos(0.45);

  const prices = [0.05, 0.20, 0.28, 0.45, 0.80];
  const shares = prices.map(p => E.continueRange(range, board, known, p).share);

  let inRange = true;
  for (const s of shares) if (!(s >= 0 && s <= 1)) inRange = false;
  ok(inRange, '继续占比全部落在 [0,1]', shares.map(x => x.toFixed(3)).join(', '));

  let nonInc = true;
  for (let i = 1; i < shares.length; i++) if (shares[i] > shares[i - 1] + 1e-9) nonInc = false;
  ok(nonInc, '价格越高、继续占比越低（单调不增）', shares.map(x => x.toFixed(3)).join(' ≥ '));

  ok(shares[0] > shares[1] - 1e-9 && shares[1] > shares[2] - 1e-9,
    '前段严格下降（门槛确实在起作用）',
    shares.slice(0, 3).map(x => x.toFixed(3)).join(' > '));

  /* 范围越强 → 继续占比越高
   * The stronger the range → the higher the continuing share */
  const strong = R.topCombos(0.03), loose = R.topCombos(1.0);
  const ss = E.continueRange(strong, board, known, 0.28).share;
  const ls = E.continueRange(loose, board, known, 0.28).share;
  ok(ss > ls, '强范围继续占比 > 随机手牌范围', '强 ' + ss.toFixed(3) + ' vs 全 ' + ls.toFixed(3));

  /* 退化输入不得抛异常：空范围、被阻断牌吃光的范围
   * Degenerate inputs must not throw: empty ranges, ranges consumed by blocking cards */
  let crashed = false;
  try {
    const z = R.emptyWeights();
    ok(E.continueRange(z, board, known, 0.28).share === 0, '空范围的继续占比为 0');
  } catch (e) { crashed = true; }
  ok(!crashed, '空范围不抛异常');

  /* ★ 翻前不得退化。
   * ★ Preflop must not degenerate.
     翻前没有公共牌，PK.evaluate 对任何两张牌都只给"高牌"（cat 0），
   * Preflop has no board, and PK.evaluate returns only "high card" (cat 0) for any two hole cards,
     若沿用翻后的成牌门槛，continueRange 会算出继续占比 0、弃牌率 100%，
   * so reusing the postflop made-hand threshold makes continueRange compute a 0 continuing share and a 100% fold rate,
     于是"翻前加注"永远最优、任何翻前弃牌都被误判成重大失误。
   * which makes "raise preflop" always optimal and every preflop fold a grave blunder.
     这条断言就是钉住这个退化。
   * This assertion pins down that degeneration. */
  const uni = R.uniformWeights(1);
  const preShares = [0.10, 0.22, 0.34, 0.60].map(p => E.continueRange(uni, [], [], p).share);
  ok(preShares.every(s => s > 0.03 && s < 0.97),
    '翻前继续占比不得退化到 0 或 1',
    preShares.map(s => s.toFixed(3)).join(', '));
  let preNonInc = true;
  for (let i = 1; i < preShares.length; i++) {
    if (preShares[i] > preShares[i - 1] + 1e-9) preNonInc = false;
  }
  ok(preNonInc, '翻前：价格越高、继续占比越低',
    preShares.map(s => s.toFixed(3)).join(' ≥ '));
  ok(E.preflopTop(0.10) > E.preflopTop(0.60),
    '翻前门槛：便宜时范围更宽', E.preflopTop(0.10) + ' vs ' + E.preflopTop(0.60));

  console.log('\n   ○ 标定参考（非断言，供人工复核）');
  console.log('     价格     ' + prices.map(p => ((p * 100).toFixed(0) + '%').padStart(6)).join(''));
  console.log('     继续占比 ' + shares.map(s => s.toFixed(3).padStart(6)).join(''));
}

/* ============================================================
 * 4. EV 公式恒等（最容易写错，逐项锁定）
 * 4. EV formula identities (the easiest to get wrong; locked down term by term)
 * ============================================================ */
group('4. EV 公式恒等');
{
  const pot = 100, call = 50;

  /* 跟注：胜率恰好等于底池赔率时，EV 必须为 0
   * Call: when equity exactly equals the pot odds, EV must be 0 */
  const odds = call / (pot + call);
  ok(Math.abs(E.evCall(odds, pot, call)) < 1e-9, '胜率=底池赔率时跟注 EV 恰为 0',
    E.evCall(odds, pot, call).toFixed(6));
  ok(Math.abs(E.evCall(1, pot, call) - pot) < 1e-9, '胜率 100% 时跟注 EV = 底池',
    E.evCall(1, pot, call).toFixed(3));
  ok(Math.abs(E.evCall(0, pot, call) + call) < 1e-9, '胜率 0% 时跟注 EV = −跟注额',
    E.evCall(0, pot, call).toFixed(3));

  let mono = true;
  for (let e = 0.05; e <= 1; e += 0.05) {
    if (E.evCall(e, pot, call) <= E.evCall(e - 0.05, pot, call)) mono = false;
  }
  ok(mono, '跟注 EV 随胜率严格递增');

  /* 加注：对手必定弃牌 → 直接收池
   * Raise: the opponent always folds → win the pot outright */
  ok(Math.abs(E.evRaise(0, 1, pot, 80, call) - pot) < 1e-9,
    '对手 100% 弃牌时加注 EV = 底池', E.evRaise(0, 1, pot, 80, call).toFixed(3));

  /* 对手必定跟注：胜率 100% → 净得 pot + toAmt − callAmt
   * Opponent always calls: 100% equity → net gain of pot + toAmt − callAmt */
  ok(Math.abs(E.evRaise(1, 0, pot, 80, call) - (pot + 80 - call)) < 1e-9,
    '对手必定跟注且我们必胜时，EV = 底池 + 加注增量', E.evRaise(1, 0, pot, 80, call).toFixed(3));

  /* 对手必定跟注：胜率 0% → 亏掉全部投入
   * Opponent always calls: 0% equity → lose the entire investment */
  ok(Math.abs(E.evRaise(0, 0, pot, 80, call) + 80) < 1e-9,
    '对手必定跟注且我们必败时，EV = −投入', E.evRaise(0, 0, pot, 80, call).toFixed(3));

  /* 弃牌恒为基准 0：由候选表体现，这里确认 table 里 fold 就是 0
   * Fold is always the zero baseline: shown by the candidate table; here we confirm fold is 0 in the table */
  const { rec } = hand(C('Ah', 'Ad'));
  const r = E.review(rec, { iters: 300 });
  ok(r.decisions.every(d => d.evs.fold === 0), '每个决策的弃牌 EV 都是 0');
}

/* ============================================================
 * 5. 分级与可信度
 * 5. Grading and reliability
 * ============================================================ */
group('5. 分级与可信度');
{
  ok(E.verdictOf(0).key === 'ok', '0BB → 可以接受');
  ok(E.verdictOf(0.30).key === 'inaccuracy', '0.30BB → 轻微偏差');
  ok(E.verdictOf(1.00).key === 'mistake', '1.0BB → 失误');
  ok(E.verdictOf(3.00).key === 'blunder', '3.0BB → 严重失误');

  ok(E.reliabilityOf('river', 1) === 'high', '河牌单挑 → 可信');
  ok(E.reliabilityOf('turn', 1) === 'medium', '转牌单挑 → 中等');
  ok(E.reliabilityOf('flop', 1) === 'low', '翻牌单挑 → 仅方向');
  ok(E.reliabilityOf('preflop', 1) === 'low', '翻前 → 仅方向');
  ok(E.reliabilityOf('river', 3) === 'low', '三人以上底池一律降级');
  ok(E.reliabilityOf('river', 2) === 'medium', '两人对手的河牌 → 中等');
  ok(E.reliabilityOf('turn', 2) === 'low', '两人对手的转牌 → 仅方向');
}

/* ============================================================
 * 6. 端到端：给定牌面，结论方向必须正确
 * 6. End to end: given a board, the direction of the conclusion must be correct
 * ============================================================ */
group('6. 端到端结论方向');
{
  const { rec: recNuts } = hand(C('Ah', 'Ad'));       // 三条 A，河牌坚果附近 / Trip aces, near the nuts on the river
  const rN = E.review(recNuts, { iters: 400 });

  ok(rN.decisions.length === 7, '英雄有 7 个决策点', String(rN.decisions.length));
  ok(rN.decisions.every(d => d.street && d.verdict && d.reliability),
    '每个决策都带街/分级/可信度');
  ok(rN.decisions.every(d => d.loss >= 0), '损失非负');

  const riverN = rN.decisions[rN.decisions.length - 1];
  ok(riverN.street === 'river', '末个决策在河牌');
  ok(riverN.eq > 0.9, '三条 A 在河牌的胜率 > 90%', (riverN.eq * 100).toFixed(1) + '%');
  ok(riverN.best === 'raise', '三条 A 面对下注，最优是加注而不是跟注', riverN.best);
  ok(riverN.loss > 0, '只是跟注会损失价值', riverN.loss.toFixed(1));
  ok(riverN.reliability === 'high', '河牌单挑可信度为 high', riverN.reliability);

  /* 空气牌：跟注必然是错的，且要能说出"为什么"（底池赔率）
   * Air: calling is necessarily wrong, and the "why" (pot odds) must be stated */
  const { rec: recAir } = hand(C('3c', '4d'));
  const rA = E.review(recAir, { iters: 400 });
  const riverA = rA.decisions[rA.decisions.length - 1];
  ok(riverA.eq < 0.15, '4 高牌在河牌胜率 < 15%', (riverA.eq * 100).toFixed(1) + '%');
  ok(riverA.best === 'fold', '空气牌面对下注最优是弃牌', riverA.best);
  ok(riverA.verdict === 'blunder', '空气牌跟注判为严重失误', riverA.verdict);
  ok(/底池赔率/.test(riverA.advice), '解说里给出了底池赔率这一判据',
    riverA.advice.slice(0, 40));
  ok(rA.totalLossBB > 0 && rN.totalLossBB > 0,
    '两手都能识别出可改进之处',
    rA.totalLossBB.toFixed(1) + 'BB / ' + rN.totalLossBB.toFixed(1) + 'BB');

  /* ★ 端到端确认翻前没有退化：翻前决策的弃牌率不能是 100%
   * ★ End-to-end confirmation that preflop has not degenerated: the preflop decision's fold rate must not be 100% */
  const preN = rN.decisions[0];
  ok(preN.street === 'preflop', '首个决策在翻前');
  ok(preN.foldP !== null && preN.foldP < 1,
    '翻前弃牌率不是 100%（否则"加注"会永远显示最优）',
    preN.foldP === null ? 'null' : preN.foldP.toFixed(3));
  ok(preN.caveat && /静态估算/.test(preN.caveat), '翻前决策带上了静态估算的提示');

  /* 好线路 vs 坏线路：三条 A 一路主动下注，损失应当小于一路过牌跟注
   * Good line vs bad line: betting out all the way with trip aces should lose less than check-calling all the way */
  const aggroActs = [
    { street: 'preflop', seat: 0, action: 'raise', to: 6 },
    { street: 'preflop', seat: 1, action: 'call' },
    { street: 'preflop', seat: 2, action: 'fold' },
    { street: 'preflop', seat: 3, action: 'fold' },
    { street: 'preflop', seat: 4, action: 'fold' },
    { street: 'preflop', seat: 5, action: 'fold' },
    { street: 'flop', seat: 0, action: 'raise', to: 10 },
    { street: 'flop', seat: 1, action: 'call' },
    { street: 'turn', seat: 0, action: 'raise', to: 22 },
    { street: 'turn', seat: 1, action: 'call' },
    { street: 'river', seat: 0, action: 'raise', to: 52 },
    { street: 'river', seat: 1, action: 'call' },
  ];
  const { rec: recAggro } = hand(C('Ah', 'Ad'), aggroActs);
  const rG = E.review(recAggro, { iters: 400 });
  ok(rG.totalLossBB < rN.totalLossBB,
    '三条 A 主动下注的累计损失 < 一路过牌跟注',
    rG.totalLossBB.toFixed(1) + 'BB vs ' + rN.totalLossBB.toFixed(1) + 'BB');

  /* 弃掉坚果：损失应当很大，且最优解不是弃牌
   * Folding the nuts: the loss should be large, and the optimal answer is not fold */
  const foldActs = ACTS.map(a =>
    (a.street === 'river' && a.seat === 0) ? { street: 'river', seat: 0, action: 'fold' } : a);
  const { rec: recFold } = hand(C('Ah', 'Ad'), foldActs);
  const rF = E.review(recFold, { iters: 400 });
  const riverF = rF.decisions[rF.decisions.length - 1];
  ok(riverF.taken === 'fold', '实际记录为弃牌', riverF.taken);
  ok(riverF.best !== 'fold', '弃掉三条 A 不是最优', riverF.best);
  ok(riverF.verdict === 'blunder', '弃掉坚果判为严重失误', riverF.verdict);
  ok(riverF.loss > riverN.loss, '弃牌的损失大于只是跟注的损失',
    riverF.loss.toFixed(1) + ' > ' + riverN.loss.toFixed(1));
  ok(riverF.takenEV === 0, '弃牌的 EV 为 0', String(riverF.takenEV));

  /* options() 排序与标注
   * options() ordering and labeling */
  const opts = E.options(riverN);
  ok(opts.length === 3, '河牌面对下注有 3 个候选（弃/跟/加）', String(opts.length));
  ok(opts[0].isBest, '候选表第一条就是最优动作', opts[0].key);
  let sorted = true;
  for (let i = 1; i < opts.length; i++) if (opts[i].ev > opts[i - 1].ev + 1e-9) sorted = false;
  ok(sorted, '候选表按 EV 降序');
  ok(opts.some(o => o.isTaken), '候选表标出了实际选择');

  /* 加注的"标准尺度"必须大于跟注额，且不超过全下
   * The "standard size" raise must exceed the call amount and must not exceed the all-in */
  ok(riverN.raiseBenchAmt === null || riverN.raiseBenchAmt >= riverN.callAmt,
    '标准加注额不小于跟注额');
  ok(riverN.raiseBenchAmt === null || riverN.raiseBenchAmt <= riverN.stackBefore,
    '标准加注额不超过全下');

  /* 对手范围的结构自洽
   * Structural self-consistency of the opponent range */
  ok(riverN.range.combos > 0 && riverN.range.classes > 0, '对手范围非空',
    riverN.range.combos.toFixed(0) + ' 组合 / ' + riverN.range.classes + ' 类');
  ok(riverN.range.pct > 0 && riverN.range.pct <= 1, '范围占比落在 (0,1]',
    riverN.range.pct.toFixed(3));

  /* ★ 交叉校验：决策里报出的弃牌率，必须能用它自己那份范围权重独立复算出来。
   * ★ Cross-check: the fold rate reported in a decision must be independently recomputable from that decision's own range weights.
     这条直接把"报出来的数"和"用的模型"钉在一起，防止两者悄悄脱钩。
   * This pins the "reported number" directly to the "model used", preventing a silent decoupling. */
  const bench = riverN.raiseBenchAmt;
  const villainAdd = bench - riverN.callAmt;
  const price = villainAdd / (riverN.potBefore + bench + villainAdd);
  const known6 = recNuts.heroHole.concat(riverN.board);
  const cr2 = E.continueRange(riverN.weights, riverN.board, known6, price);
  ok(Math.abs(riverN.foldP - (1 - cr2.share)) < 1e-9,
    '报出的弃牌率 = 1 − 独立复算的继续占比',
    riverN.foldP.toFixed(4) + ' vs ' + (1 - cr2.share).toFixed(4));
  ok(Math.abs(price - (villainAdd / (riverN.potBefore + bench + villainAdd))) < 1e-12,
    '对手底池赔率口径：投入 / 投入后的底池');
  ok(riverN.foldP >= 0 && riverN.foldP <= 1, '弃牌率落在 [0,1]', riverN.foldP.toFixed(3));
  ok(riverN.eqCalled === null || (riverN.eqCalled >= 0 && riverN.eqCalled <= 1),
    '被跟注时的胜率落在 [0,1]');
}

/* ============================================================
 * 7. 缓存与汇总
 * 7. Caching and aggregation
 * ============================================================ */
group('7. 缓存与汇总');
{
  const { rec } = hand(C('Ah', 'Ad'));
  const a = E.review(rec, { iters: 300 });
  const b = E.review(rec, { iters: 300 });
  ok(a === b, '同样参数下复用缓存对象');
  const c = E.review(rec, { iters: 301 });
  ok(c !== a, '迭代次数变化则重新计算');
  const d = E.review(rec, { iters: 300, fresh: true });
  ok(d !== a, 'fresh 强制重算');

  const { rec: r1 } = hand(C('3c', '4d'));
  const agg = E.audit([r1, rec], { iters: 300 });
  ok(agg.hands === 2, '汇总覆盖 2 手牌', String(agg.hands));
  ok(agg.decisions === 14, '汇总覆盖 14 个决策', String(agg.decisions));

  const stSum = ['preflop', 'flop', 'turn', 'river']
    .reduce((s, k) => s + agg.byStreet[k].n, 0);
  ok(stSum === agg.decisions, '按街计数之和 = 决策总数', stSum + ' vs ' + agg.decisions);
  const acSum = ['fold', 'check', 'call', 'raise']
    .reduce((s, k) => s + agg.byAction[k].n, 0);
  ok(acSum === agg.decisions, '按动作计数之和 = 决策总数', acSum + ' vs ' + agg.decisions);

  const dSum = E.review(r1, { iters: 300 }).decisions
    .reduce((s, x) => s + x.loss, 0) + E.review(rec, { iters: 300 }).decisions
    .reduce((s, x) => s + x.loss, 0);
  ok(Math.abs(dSum - agg.totalLoss) < 1e-6, '总损失 = 各决策损失之和',
    dSum.toFixed(3) + ' vs ' + agg.totalLoss.toFixed(3));

  ok(agg.leaks.length >= 1, '至少识别出一条损失模式', String(agg.leaks.length));
  let leakWeightDesc = true;
  for (let i = 1; i < agg.leaks.length; i++) {
    if (agg.leaks[i].weight > agg.leaks[i - 1].weight + 1e-9) leakWeightDesc = false;
  }
  ok(leakWeightDesc, '损失模式按权重降序');
  let worstDesc = true;
  for (let i = 1; i < agg.worst.length; i++) {
    if (agg.worst[i].d.loss > agg.worst[i - 1].d.loss + 1e-9) worstDesc = false;
  }
  ok(worstDesc, '最差决策按损失降序');
  ok(agg.perHandBB === (agg.hands ? agg.totalLossBB / agg.hands : 0),
    '每手平均损失口径一致');
}

/* ============================================================
 * 8. 持久化安全（缓存绝不能进 localStorage）
 * 8. Persistence safety (cache must never enter localStorage)
 * ============================================================ */
group('8. 持久化安全');
{
  const { rec } = hand(C('Ah', 'Ad'));
  E.review(rec, { iters: 300 });

  const text = JSON.stringify(rec);
  ok(text.indexOf('_evloss') < 0, '缓存的键不可枚举，不会被序列化',
    '长度 ' + text.length);
  ok(text.indexOf('weights') < 0, '169 类权重向量没有被写进 JSON');
  ok(text.length < 4000, '单条记录序列化后仍然很小', text.length + ' 字节');

  const state = PK.Store.collect({
    stats: PK.Store.emptyStats(), handNo: 1, recents: [rec],
    players: [{ stack: 200 }],
  });
  const keys = Object.keys(state.recents[0]);
  ok(keys.every(k => k.charCodeAt(0) !== 95), 'collect() 剥掉了全部下划线缓存字段',
    keys.filter(k => k.charCodeAt(0) === 95).join(','));

  /* 手工塞一个可枚举的缓存（模拟 replay.js 的 _eq 写法），也必须被剥掉
   * Manually insert an enumerable cache (mimicking replay.js's _eq style); it must still be stripped */
  const legacy = JSON.parse(JSON.stringify(rec));
  legacy._eq = { 3: 0.42 };
  const cleaned = PK.Store.stripRec(legacy);
  ok(!('_eq' in cleaned), 'stripRec 能清掉可枚举的缓存字段');
  ok(cleaned.actions.length === rec.actions.length, 'stripRec 保留业务字段');
}

/* ============================================================
 * 9. 性能
 * 9. Performance
 * ============================================================ */
group('9. 性能');
{
  const { rec } = hand(C('Ah', 'Ad'));
  const t0 = Date.now();
  E.review(rec, { iters: 600, fresh: true });
  const dt = Date.now() - t0;
  ok(dt < 1500, '单手套复盘耗时 < 1.5s', dt + 'ms');
  console.log('   ○ 单手套复盘（600 次模拟 × 7 个决策）：' + dt + 'ms');
}

/* ---------- 汇总 ----------
 * ---------- Summary ---------- */
if (gName) console.log('   ' + (gFail ? '✗ ' + gFail + ' 项失败' : '✓ ' + gPass + ' 项通过'));
console.log('\n' + '═'.repeat(52));
console.log('EV 复盘自检：' + pass + ' 项通过，' + fail + ' 项失败');
if (fail) {
  console.log('\n失败明细：');
  for (const b of bad) console.log('  ✗ ' + b);
  process.exit(1);
}
console.log('✅ 全部通过');
