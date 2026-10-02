/* ============================================================
 * test.js — 引擎逻辑单元测试（Node 运行，不依赖浏览器）
 * test.js — engine logic unit tests (run under Node, no browser required)
 *   node test/test.js
 * ============================================================ */
'use strict';
const path = require('path');

['poker.js', 'equity.js', 'ai.js', 'engine.js'].forEach(f => {
  require(path.join(__dirname, '..', 'src', f));
});
const PK = globalThis.PK;

let pass = 0, fail = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, name) { ok(a === b, name, `期望 ${b}，实际 ${a}`); }
function group(title) { console.log('\n\x1b[36m── ' + title + '\x1b[0m'); }

function C() {
  return Array.prototype.slice.call(arguments).map(s => {
    const c = PK.parseCard(s);
    if (c < 0) throw new Error('无法解析的牌: ' + s);
    return c;
  });
}

/* ============ 1. 牌型评估 ============
 * ============ 1. Hand evaluation ============ */
group('1. 牌型评估器');

const ladder = [
  ['同花顺', C('As', 'Ks', 'Qs', 'Js', 'Ts')],
  ['四条',   C('9h', '9d', '9c', '9s', 'Kd')],
  ['葫芦',   C('8h', '8d', '8c', 'Kh', 'Kd')],
  ['同花',   C('Ah', 'Jh', '8h', '5h', '2h')],
  ['顺子',   C('9h', '8d', '7c', '6s', '5d')],
  ['三条',   C('7h', '7d', '7c', 'Ks', '3d')],
  ['两对',   C('Ah', 'Ad', 'Kh', 'Kd', '2c')],
  ['一对',   C('Ah', 'Ad', 'Kh', 'Qd', '2c')],
  ['高牌',   C('Ah', 'Kd', 'Qh', 'Jd', '9c')],
];
for (let i = 0; i < ladder.length - 1; i++) {
  const a = PK.evaluate(ladder[i][1]);
  const b = PK.evaluate(ladder[i + 1][1]);
  ok(a > b, `${ladder[i][0]} 应大于 ${ladder[i + 1][0]}`, `${a} vs ${b}`);
  eq(PK.unpack(a).cat, ladder.length - 1 - i, `${ladder[i][0]} 等级编号正确`);
}

/* 轮子（A2345）识别为顺子，且小于 6 高顺子
 * The wheel (A2345) is recognized as a straight and ranks below the 6-high straight */
const wheel = C('Ah', '2d', '3c', '4s', '5d');
const sixHigh = C('6h', '5d', '4c', '3s', '2d');
eq(PK.unpack(PK.evaluate(wheel)).cat, 4, 'A2345 识别为顺子');
eq(PK.unpack(PK.evaluate(wheel)).ks[0], 3, 'A2345 的最高牌是 5');
ok(PK.evaluate(sixHigh) > PK.evaluate(wheel), '6 高顺子大于轮子');

/* 7 张牌取最优 5 张
 * Best 5 of 7 cards */
const seven = C('As', 'Ks', 'Qs', 'Js', 'Ts', '2h', '3d');
eq(PK.unpack(PK.evaluate(seven)).cat, 8, '7 张中识别出同花顺');

const sevenFlush = C('Ah', 'Kh', 'Qh', 'Jh', '9h', '8h', '2h');
eq(PK.unpack(PK.evaluate(sevenFlush)).ks.join(','), '12,11,10,9,7', '同花取最大的 5 张');

/* 葫芦优先于同花：三条 + 一对 + 同花牌面
 * Full house outranks a flush: trips + a pair with a flushing board */
const fullOverFlush = C('Ah', 'Ad', 'Ac', 'Kh', 'Kd', '2h', '3h');
eq(PK.unpack(PK.evaluate(fullOverFlush)).cat, 6, '三条+对子 = 葫芦');

/* 两对取最大的两对（三条对子混合）
 * Two pair takes the two largest pairs (trips mixed with pairs) */
const trips3 = C('Ah', 'Ad', 'Ac', 'Kh', 'Kd', 'Qs', 'Qd');
eq(PK.unpack(PK.evaluate(trips3)).cat, 6, '三条+两对 = 葫芦');

/* 踢脚比较
 * Kicker comparison */
ok(PK.evaluate(C('Ah', 'Ad', 'Kh', 'Qd', '2c')) > PK.evaluate(C('Ah', 'Ad', 'Kh', 'Jd', '2c')),
  '同为一对 A，踢脚 K 大于 J');

/* 平手判定
 * Tie determination */
eq(PK.evaluate(C('Ah', 'Kd', 'Qh', 'Jd', '9c')),
   PK.evaluate(C('Ac', 'Kh', 'Qd', 'Js', '9h')), '同点数同花色结构应平手');

/* 描述文本
 * Description text */
ok(PK.describe(C('Ah', 'Ad', 'Kh', 'Qd', '2c')).text.indexOf('一对') === 0, '描述含"一对"');
ok(PK.describe(C('As', 'Ks', 'Qs', 'Js', 'Ts')).text.indexOf('同花顺') === 0, '描述含"同花顺"');

/* bestFive */
const bf = PK.bestFive(C('As', 'Ks', 'Qs', 'Js', 'Ts', '2h', '3d'));
eq(bf.cards.length, 5, 'bestFive 返回 5 张');

/* ============ 2. 起手牌抽象 ============
 * ============ 2. Starting-hand abstraction ============ */
group('2. 起手牌抽象');
eq(PK.holeKey(PK.parseCard('As'), PK.parseCard('Ks')), 'AKs', 'AKs 识别');
eq(PK.holeKey(PK.parseCard('Kd'), PK.parseCard('As')), 'AKo', 'AKo 识别（顺序无关）');
eq(PK.holeKey(PK.parseCard('Ad'), PK.parseCard('As')), 'AA', 'AA 识别');
eq(PK.holeKey(PK.parseCard('2h'), PK.parseCard('7c')), '72o', '72o 识别');

/* ============ 3. 胜率估算 ============
 * ============ 3. Equity estimation ============ */
group('3. 胜率估算');
const AA = C('Ah', 'Ad');
const eqAA1 = PK.estimateEquity(AA, [], 1, 6000);
const eqAA5 = PK.estimateEquity(AA, [], 5, 6000);
const eq72 = PK.estimateEquity(C('7h', '2d'), [], 1, 6000);
ok(Math.abs(eqAA1 - 0.85) < 0.05, 'AA vs 1 人胜率约 85%', (eqAA1 * 100).toFixed(1) + '%');
ok(Math.abs(eqAA5 - 0.49) < 0.06, 'AA vs 5 人胜率约 49%', (eqAA5 * 100).toFixed(1) + '%');
ok(Math.abs(eq72 - 0.35) < 0.06, '72o vs 1 人胜率约 35%', (eq72 * 100).toFixed(1) + '%');
ok(eqAA1 > eq72, 'AA 强于 72o');
ok(eqAA1 > eqAA5, '对手越多胜率越低');

/* 已成型牌型的胜率
 * Equity of already-made hands */
const flushDrawEq = PK.estimateEquity(C('Ah', 'Kh'), C('Qh', '7h', '2c'), 1, 4000);
ok(flushDrawEq > 0.5, '同花听牌（4 张同花 + 两高张）胜率过半', (flushDrawEq * 100).toFixed(1) + '%');

const nuts = PK.estimateEquity(C('As', 'Ks'), C('Qs', 'Js', 'Ts'), 1, 3000);
ok(nuts > 0.99, '皇家同花顺几乎必胜', (nuts * 100).toFixed(1) + '%');

/* 缓存一致性
 * Cache consistency */
const c1 = PK.preflopEquity('AA', 3);
const c2 = PK.preflopEquity('AA', 3);
eq(c1, c2, '翻前胜率缓存命中结果一致');

/* 性能：翻前首次计算的耗时
 * Performance: time of the first preflop computation */
let t0 = Date.now();
PK.preflopEquity('T9s', 5);
const cost = Date.now() - t0;
ok(cost < 400, '翻前胜率首次计算耗时可接受', cost + 'ms');
t0 = Date.now();
PK.estimateEquity(C('Ah', 'Kd'), C('Qs', '7h', '2c'), 5, 800);
const cost2 = Date.now() - t0;
ok(cost2 < 400, '翻后蒙特卡洛(800 次×5 人)耗时可接受', cost2 + 'ms');
console.log('   翻前首次 ' + cost + 'ms / 翻后 800iters×5人 ' + cost2 + 'ms');

/* ============ 4. 边池构建 ============
 * ============ 4. Side-pot construction ============ */
group('4. 边池构建');
const g2 = new PK.Game({ seats: 4, bb: 2, sb: 1, startStack: 200, aiSpeed: 0, dealDelay: 0 });
g2.players.forEach(p => { p.contrib = 0; p.folded = false; });
g2.players[0].contrib = 100;                        // 未弃牌 / Not folded
g2.players[1].contrib = 50; g2.players[1].folded = true;  // 弃牌 / Folded
g2.players[2].contrib = 50;                         // 未弃牌 / Not folded
g2.players[3].contrib = 200;                        // 未弃牌 / Not folded
const pots1 = g2._buildPots();
eq(pots1.length, 3, '构建出 3 层边池');
eq(pots1.reduce((a, p) => a + p.amount, 0), 400, '边池总额等于总投入 400');
eq(pots1[1].eligible.indexOf(1), -1, '弃牌玩家不能赢任何边池');
eq(pots1[2].eligible.length, 1, '最高层池只有最大投入者有资格');

/* 保守性：所有投入都被分配
 * Conservativeness: every contribution is distributed */
eq(pots1.reduce((a, p) => a + p.amount, 0),
   g2.players.reduce((a, p) => a + p.contrib, 0), '边池总额 = 玩家投入总额（守恒）');

/* ============ 5. 整局模拟 ============
 * ============ 5. Full-game simulation ============ */
group('5. 整局模拟（300 手）');

const Game = PK.Game;
const sim = new Game({ seats: 6, bb: 2, sb: 1, startStack: 200, aiSpeed: 0, dealDelay: 0 });
sim._delay = () => Promise.resolve();

let handsPlayed = 0;
let totalBefore = 0;
let chipOk = true;
let potOk = true;
let actionOk = true;
const HAND_TARGET = 300;

const VALID = ['fold', 'check', 'call', 'raise', 'allin'];

sim.on('hand-start', () => {
  /* 此刻盲注已投入 bet，一并计入总筹码
   * At this point the blinds have gone into bet, so count them toward total chips */
  totalBefore = sim.players.reduce((a, p) => a + p.stack + p.bet, 0);
});

sim.on('hand-end', r => {
  handsPlayed++;
  /* 筹码守恒
   * Chip conservation */
  const after = sim.players.reduce((a, p) => a + p.stack, 0);
  if (after !== totalBefore) {
    chipOk = false;
    if (failures.length < 30) failures.push(`第 ${sim.handNo} 手筹码不守恒：${totalBefore} → ${after}`);
  }
  /* 派奖金额守恒
   * Payout amount conservation */
  const paid = r.winners.reduce((a, w) => a + w.amount, 0);
  if (paid !== r.pot) {
    potOk = false;
    if (failures.length < 30) failures.push(`第 ${sim.handNo} 手派奖不符：派 ${paid} vs 池 ${r.pot}`);
  }
  /* 无负筹码
   * No negative chips */
  if (sim.players.some(p => p.stack < 0)) { chipOk = false; failures.push('出现负筹码'); }

  if (handsPlayed < HAND_TARGET) {
    sim.newHand();
  } else {
    finishSim();
  }
});

sim.on('hero-turn', () => {
  const d = PK.aiDecide(sim, 0);
  if (VALID.indexOf(d.action) < 0) { actionOk = false; failures.push('非法动作：' + d.action); }
  setTimeout(() => { sim.heroAct(d.action, d.amount); }, 0);
});

function finishSim() {
  ok(chipOk, '【关键】300 手筹码完全守恒');
  ok(potOk, '【关键】派奖金额与底池一致');
  ok(actionOk, 'AI 产生的动作全部合法');
  eq(handsPlayed, HAND_TARGET, '完成 300 手模拟');
  eq(sim.stage, 'over', '模拟结束时状态为 over');
  console.log('   模拟结果：hero 筹码 ' + sim.players[0].stack +
    '，累计盈亏 ' + sim.stats.netProfit +
    '，摊牌 ' + sim.stats.showdowns + ' 次');

  /* ============ 6. 边界场景 ============
   * ============ 6. Edge cases ============ */
  group('6. 边界场景');

  /* 6.1 只有 1 人未弃牌 → 直接获胜
   * 6.1 Only one player has not folded → win outright */
  const g3 = new Game({ seats: 3, bb: 2, sb: 1, startStack: 100, aiSpeed: 0, dealDelay: 0 });
  g3._delay = () => Promise.resolve();
  g3.players[1].folded = true;
  g3.players[2].folded = true;
  g3.pot = 30;
  g3.players[0].contrib = 10;
  g3.players[1].contrib = 10;
  g3.players[2].contrib = 10;
  g3._endByFold(g3.generation).then(() => {
    eq(g3.players[0].stack, 130, '唯一未弃牌者收下整个底池');
    eq(g3.pot, 0, '结算后底池清零');

    /* 6.2 两人同额全下摊牌，平分底池
     * 6.2 Two players all-in for equal amounts to showdown, split the pot */
    const g4 = new Game({ seats: 2, bb: 2, sb: 1, startStack: 100, aiSpeed: 0, dealDelay: 0 });
    g4.board = C('Ah', 'Kd', '7c', '2s', '3h');
    g4.players[0].hole = C('Qs', 'Jd');
    g4.players[1].hole = C('Qh', 'Jc');
    g4.players[0].contrib = 50; g4.players[1].contrib = 50;
    g4.players[0].stack = 50; g4.players[1].stack = 50;
    g4.pot = 100;
    g4.players[0].folded = false; g4.players[1].folded = false;
    g4._heroStackAtStart = 50;
    g4._showdown(g4.generation).then(() => {
      eq(g4.players[0].stack, 100, '平手时底池平分给 A');
      eq(g4.players[1].stack, 100, '平手时底池平分给 B');

      /* 6.3 最小加注约束
       * 6.3 Minimum-raise constraint */
      const g5 = new Game({ seats: 3, bb: 2, sb: 1, startStack: 100, aiSpeed: 0, dealDelay: 0 });
      g5.currentBet = 6;
      g5.lastRaiseSize = 4;
      g5.players[0].bet = 0;
      g5.players[0].stack = 100;
      g5.toAct = 0;
      g5.stage = 'betting';
      let handled = false;
      g5._heroResolve = () => { handled = true; };
      /* 小于最小加注额时应被自动提升到最小合法值
       * A raise below the minimum must be automatically raised to the minimum legal value */
      g5.heroAct('raise', 7);
      eq(g5.currentBet, 10, '加注额不足时自动提升到最小合法值（6+4=10）');
      ok(handled, 'heroAct 后释放等待');

      summary();
    });
  });
}

function summary() {
  console.log('\n' + '─'.repeat(52));
  if (fail === 0) {
    console.log('\x1b[32m%s\x1b[0m', `✅ 全部通过：${pass} 项断言`);
  } else {
    console.log('\x1b[31m%s\x1b[0m', `❌ 失败 ${fail} 项 / 通过 ${pass} 项`);
    failures.slice(0, 25).forEach(f => console.log('   · ' + f));
  }
  console.log('─'.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
}

setTimeout(() => {
  console.log('\n\x1b[31m模拟超时（30 秒）\x1b[0m');
  console.log('   已完成 ' + handsPlayed + ' 手');
  summary();
}, 30000);

sim.newHand();
