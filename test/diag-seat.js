/* ============================================================
 * diag-seat.js — 座位偏差诊断
 * diag-seat.js — seat-bias diagnostic
 * 统计每个座位 / 每个位置的行为指标，定位系统性优势来源
 * Aggregates behavioral metrics per seat / per position to locate the source of systematic advantage
 *   node test/diag-seat.js [手数]
 *   node test/diag-seat.js [hand count]
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'poker.js'));
require(path.join(__dirname, '..', 'src', 'equity.js'));
require(path.join(__dirname, '..', 'src', 'ai.js'));
require(path.join(__dirname, '..', 'src', 'engine.js'));
const PK = globalThis.PK;

const TARGET = parseInt(process.argv[2] || '3000', 10);
const STACK = 200, SEATS = 6, BB = 2;
const POS_NAME = ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'];

const sim = new PK.Game({ seats: SEATS, bb: BB, sb: 1, startStack: STACK, aiSpeed: 0, dealDelay: 0 });
sim._delay = () => Promise.resolve();
sim.players.forEach(p => { p.style = PK.STYLES.tag; p.isHero = false; });

/* 统计容器 */
/* Statistics container */
const bySeat = Array.from({ length: SEATS }, () => ({
  net: 0, hands: 0, vpip: 0, pfr: 0, foldPre: 0, sawFlop: 0, won: 0, invest: 0,
}));
const byPos = Array.from({ length: SEATS }, () => ({
  net: 0, hands: 0, vpip: 0, pfr: 0, foldPre: 0,
}));

let hands = 0;
/* 每手开始前记录位置映射 */
/* Record the position mapping before each hand starts */
let handSeatPos = new Array(SEATS).fill(-1);
sim.on('hand-start', () => {
  const n = SEATS;
  for (let s = 0; s < n; s++) {
    handSeatPos[s] = (s - sim.button - 1 + n) % n;   // 0=SB
  }
});

/* 监听每次行动，判定自愿入池 */
/* Listen to every action and determine voluntary entry into the pot */
const origApply = sim._apply.bind(sim);
sim._apply = function (p, d) {
  if (sim.street === 'preflop') {
    const toCall = Math.max(0, sim.currentBet - p.bet);
    const vol = (d.action === 'call' && toCall > 0) || d.action === 'raise' || d.action === 'allin';
    if (vol && !p._vpipCounted) {
      bySeat[p.seat].vpip++; byPos[handSeatPos[p.seat]].vpip++;
      p._vpipCounted = true;
    }
    if ((d.action === 'raise' || d.action === 'allin') && !p._pfrCounted) {
      bySeat[p.seat].pfr++; byPos[handSeatPos[p.seat]].pfr++;
      p._pfrCounted = true;
    }
    if (d.action === 'fold') {
      bySeat[p.seat].foldPre++; byPos[handSeatPos[p.seat]].foldPre++;
    }
  }
  return origApply(p, d);
};

sim.on('hand-start', () => {
  sim.players.forEach(p => { p._vpipCounted = false; p._pfrCounted = false; });
});

sim.on('hand-end', () => {
  hands++;
  sim.players.forEach((p, i) => {
    const net = p.stack - STACK;
    bySeat[i].net += net;
    bySeat[i].hands++;
    bySeat[i].invest += p.contrib;
    byPos[handSeatPos[i]].net += net;
    byPos[handSeatPos[i]].hands++;
  });
  sim.players.forEach(p => { p.stack = STACK; });
  if (hands < TARGET) sim.newHand(); else report();
});

function report() {
  console.log('\n══════ 座位维度（' + hands + ' 手，全部 tag 策略）══════');
  console.log('seat  hands   net(bb/100)   VPIP%   PFR%   foldPre%   avgPut/hand');
  for (let i = 0; i < SEATS; i++) {
    const s = bySeat[i];
    console.log(
      '  ' + i + '   ' + String(s.hands).padStart(5) +
      '   ' + (s.net / BB / s.hands * 100).toFixed(1).padStart(8) +
      '   ' + (s.vpip / s.hands * 100).toFixed(1).padStart(6) +
      '  ' + (s.pfr / s.hands * 100).toFixed(1).padStart(6) +
      '   ' + (s.foldPre / s.hands * 100).toFixed(1).padStart(7) +
      '   ' + (s.invest / s.hands).toFixed(2).padStart(8)
    );
  }

  console.log('\n══════ 位置维度 ══════');
  console.log('pos    hands   net(bb/100)   VPIP%   PFR%   foldPre%');
  for (let p = 0; p < SEATS; p++) {
    const s = byPos[p];
    console.log(
      '  ' + POS_NAME[p].padEnd(4) + String(s.hands).padStart(5) +
      '   ' + (s.net / BB / s.hands * 100).toFixed(1).padStart(8) +
      '   ' + (s.vpip / s.hands * 100).toFixed(1).padStart(6) +
      '  ' + (s.pfr / s.hands * 100).toFixed(1).padStart(6) +
      '   ' + (s.foldPre / s.hands * 100).toFixed(1).padStart(7)
    );
  }
  const tot = bySeat.reduce((a, s) => a + s.net, 0);
  console.log('\n合计净盈亏：' + tot + '（应为 0）');
  process.exit(0);
}

setTimeout(() => { console.log('超时，完成 ' + hands + ' 手'); report(); }, 120000);
sim.newHand();
