/* probe-heat.js — 量一下热力图那一步（合并多个对手的范围）的真实开销 */
/* probe-heat.js — measure the real cost of the heatmap step (merging multiple opponents' ranges) */
'use strict';
const path = require('path');
['poker.js', 'equity.js', 'range.js', 'evloss.js']
  .forEach(f => require(path.join(__dirname, '..', 'src', f)));
const PK = globalThis.PK, E = PK.EVLoss, R = PK.Range;
const C = (...a) => a.map(s => PK.parseCard(s));

const board = C('As', 'Kd', '7c', '2h', '9s');
const rec = {
  no: 1, button: 3, sb: 1, bb: 2, seats: 6,
  players: Array.from({ length: 6 }, (_, s) => ({
    seat: s, name: 'p' + s, hole: [], isHero: s === 0, folded: s >= 4,
  })),
  board: board,
  heroHole: C('Ah', 'Ad'),
  actions: [
    { street: 'preflop', seat: 0, action: 'raise', toCall: 2, betAfter: 6, pot: 9, stack: 194, allIn: false, boardLen: 0 },
    { street: 'preflop', seat: 1, action: 'call', toCall: 6, betAfter: 6, pot: 15, stack: 194, allIn: false, boardLen: 0 },
    { street: 'preflop', seat: 2, action: 'call', toCall: 6, betAfter: 6, pot: 21, stack: 194, allIn: false, boardLen: 0 },
    { street: 'preflop', seat: 3, action: 'call', toCall: 6, betAfter: 6, pot: 27, stack: 194, allIn: false, boardLen: 0 },
    { street: 'flop', seat: 0, action: 'check', toCall: 0, betAfter: 0, pot: 27, stack: 194, allIn: false, boardLen: 3 },
    { street: 'flop', seat: 1, action: 'raise', toCall: 0, betAfter: 14, pot: 41, stack: 180, allIn: false, boardLen: 3 },
    { street: 'flop', seat: 2, action: 'call', toCall: 14, betAfter: 14, pot: 55, stack: 180, allIn: false, boardLen: 3 },
    { street: 'flop', seat: 3, action: 'fold', toCall: 14, betAfter: 0, pot: 55, stack: 194, allIn: false, boardLen: 3 },
    { street: 'flop', seat: 0, action: 'call', toCall: 14, betAfter: 14, pot: 69, stack: 180, allIn: false, boardLen: 3 },
    { street: 'turn', seat: 0, action: 'check', toCall: 0, betAfter: 0, pot: 69, stack: 180, allIn: false, boardLen: 4 },
    { street: 'turn', seat: 1, action: 'raise', toCall: 0, betAfter: 34, pot: 103, stack: 146, allIn: false, boardLen: 4 },
    { street: 'turn', seat: 2, action: 'fold', toCall: 34, betAfter: 0, pot: 103, stack: 180, allIn: false, boardLen: 4 },
    { street: 'turn', seat: 0, action: 'call', toCall: 34, betAfter: 34, pot: 137, stack: 146, allIn: false, boardLen: 4 },
    { street: 'river', seat: 0, action: 'check', toCall: 0, betAfter: 0, pot: 137, stack: 146, allIn: false, boardLen: 5 },
    { street: 'river', seat: 1, action: 'raise', toCall: 0, betAfter: 80, pot: 217, stack: 66, allIn: false, boardLen: 5 },
    { street: 'river', seat: 0, action: 'call', toCall: 80, betAfter: 80, pot: 297, stack: 66, allIn: false, boardLen: 5 },
  ],
};

/* 冷缓存下的首次合并（这是热力图每次换街才会重算的那种） */
/* First merge under a cold cache (the kind the heatmap recomputes only when the street changes) */
let t0 = Date.now();
const w1 = E.mergeRanges(rec, [1, 2], 3, 8);
const cold = Date.now() - t0;

/* 热缓存 */
/* Warm cache */
t0 = Date.now();
for (let k = 0; k < 200; k++) E.mergeRanges(rec, [1, 2], 3, 8);
const warm = Date.now() - t0;

/* 5 个对手（最坏情况） */
/* 5 opponents (worst case) */
const seats = [1, 2, 3, 4, 5];
t0 = Date.now();
E.mergeRanges(rec, seats, 5, 16);
const five = Date.now() - t0;

const d = R.describe(w1, rec.heroHole.concat(rec.board.slice(0, 3)));
console.log('冷缓存 2 对手  : ' + cold + 'ms');
console.log('热缓存 2 对手  : ' + (warm / 200).toFixed(3) + 'ms/次');
console.log('5 对手（首次） : ' + five + 'ms');
console.log('范围描述       : ' + (d.pct * 100).toFixed(1) + '% / ' + d.combos.toFixed(0) + ' 组合 / ' +
  d.classes + ' 类');
console.log('范围前 5 类    : ' + d.top.slice(0, 5).map(x => x.key + '=' + x.w.toFixed(2)).join(' '));
