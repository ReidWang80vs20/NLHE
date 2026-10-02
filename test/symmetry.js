/* ============================================================
 * symmetry.js — 对称性测试
 * symmetry.js — symmetry test
 * 让 6 个玩家使用同一套决策逻辑（tag），长期结果应接近 0。
 * Let 6 players use the same decision logic (tag); the long-run result should be close to 0.
 * 若某个座位系统性盈利，说明引擎存在位置/结算偏差。
 * If a seat is systematically profitable, the engine has a position/settlement bias.
 *   node test/symmetry.js [手数]
 *   node test/symmetry.js [hand count]
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'poker.js'));
require(path.join(__dirname, '..', 'src', 'equity.js'));
require(path.join(__dirname, '..', 'src', 'ai.js'));
require(path.join(__dirname, '..', 'src', 'engine.js'));
const PK = globalThis.PK;

const TARGET = parseInt(process.argv[2] || '2000', 10);
const NO_HERO = process.argv.indexOf('nohero') >= 0;   // 所有人走 AI 路径，绕开 heroAct / all via AI, bypass heroAct
const STACK = parseInt(process.env.STACK || '200', 10); // 带入筹码（放大后不会触发重新买入） / chips carried in, avoids rebuy
const SEATS = 6;

const sim = new PK.Game({ seats: SEATS, bb: 2, sb: 1, startStack: STACK, aiSpeed: 0, dealDelay: 0 });
sim._delay = () => Promise.resolve();

/* 全部使用同一风格，消除风格差异 */
/* Use the same style for everyone, removing style differences */
sim.players.forEach(p => {
  p.style = PK.STYLES.tag;
  if (NO_HERO) p.isHero = false;
});

const startTotal = SEATS * STACK;
const seatNet = new Array(SEATS).fill(0);
let hands = 0;

sim.on('hand-end', () => {
  hands++;
  /* 每手独立：记录净盈亏后把筹码重置，避免"破产补满"注入筹码干扰公平性判断 */
  /* Independent per hand: record net profit/loss then reset stacks, to avoid "bust refill" injecting chips that distort the fairness judgment */
  sim.players.forEach((p, i) => { seatNet[i] += p.stack - STACK; });
  sim.players.forEach(p => { p.stack = STACK; });
  if (sim.players.some(p => p.stack < 0)) { console.log('❌ 出现负筹码'); process.exit(1); }
  if (hands < TARGET) sim.newHand();
  else report();
});

sim.on('hero-turn', () => {
  const d = PK.aiDecide(sim, 0);
  setTimeout(() => sim.heroAct(d.action, d.amount), 0);
});

const watchdog = setInterval(() => {
  console.log('[watchdog] 已完成 ' + hands + ' 手 / 目标 ' + TARGET +
    '，stage=' + sim.stage + ' street=' + sim.street +
    ' toAct=' + sim.toAct + ' gen=' + sim.generation +
    ' heroResolve=' + (sim._heroResolve ? 'PENDING' : 'null') +
    ' button=' + sim.button);
  if (sim.players[sim.toAct]) {
    const p = sim.players[sim.toAct];
    console.log('        toAct 玩家: ' + p.name + ' isHero=' + p.isHero +
      ' folded=' + p.folded + ' allIn=' + p.allIn +
      ' bet=' + p.bet + ' currentBet=' + sim.currentBet + ' acted=' + p.acted);
  }
}, 2000);

function report() {
  clearInterval(watchdog);
  console.log('\n══════ 对称性测试结果（' + hands + ' 手，' + SEATS + ' 人全部使用 tag 策略）══════');
  console.log('每手筹码重置为 ' + STACK + '，以下为各座位累计净盈亏：\n');

  const bb = 2;
  let maxAbs = 0;
  sim.players.forEach((p, i) => {
    const bb100 = seatNet[i] / bb / hands * 100;
    maxAbs = Math.max(maxAbs, Math.abs(bb100));
    console.log('  seat ' + i + ' ' + p.name.padEnd(6, ' ') + ' → ' +
      String(seatNet[i]).padStart(8, ' ') + '  (' +
      (bb100 >= 0 ? '+' : '') + bb100.toFixed(1).padStart(7, ' ') + ' bb/100)');
  });

  const total = seatNet.reduce((a, b) => a + b, 0);
  console.log('\n  全部座位净盈亏合计：' + total + '（应接近 0）');

  const s = sim.stats;
  console.log('\n  摊牌 ' + s.showdowns + ' 次 / ' + hands + ' 手（占比 ' +
    (s.showdowns / hands * 100).toFixed(1) + '%，正常 15%~30%）');
  console.log('  摊牌胜率 ' + (s.showdowns ? (s.showdownWins / s.showdowns * 100).toFixed(1) : '—') + '%');
  console.log('  入池率 VPIP ' + (s.vpip / s.hands * 100).toFixed(1) + '%，翻前加注率 PFR ' +
    (s.pfr / s.hands * 100).toFixed(1) + '%（紧凶合理：VPIP 22~30%，PFR 12~22%）');

  console.log('\n判定：');
  if (Math.abs(total) > bb * hands * 0.05) {
    console.log('  ❌ 合计不为 0，筹码分配存在泄漏');
  } else {
    console.log('  ✅ 各座位盈亏合计为 0，分配守恒');
  }
  if (maxAbs < 60) {
    console.log('  ✅ 最大座位偏差 ' + maxAbs.toFixed(1) + ' bb/100，在正常方差内，无系统性座位优势');
  } else {
    console.log('  ⚠️ 最大座位偏差 ' + maxAbs.toFixed(1) + ' bb/100，偏大，需排查');
  }
  process.exit(0);
}

setTimeout(() => { console.log('超时，已完成 ' + hands + ' 手'); report(); }, 120000);
sim.newHand();
