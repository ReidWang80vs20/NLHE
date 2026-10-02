/* ============================================================
 * probe-wtsd.js — 一次性诊断：两种 WTSD 口径的对比
 * probe-wtsd.js — one-off diagnostic: comparison of two WTSD definitions
 *
 * 背景：项目的 diag-style.js 把"进翻牌"定义成
 * Background: the project's diag-style.js defines "saw the flop" as
 *         sawFlop = !p.folded && maxStreet >= 1     ← 在**牌局结束时**取 p.folded
 *         sawFlop = !p.folded && maxStreet >= 1     ← takes p.folded **at the end of the hand**
 *       这会把"在转牌/河牌弃牌"的牌局从分母里剔掉，于是
 *       This removes hands that "folded on the turn/river" from the denominator, so
 *         WTSD = 摊牌 / (进过翻牌 且 全程没弃过牌)
 *         WTSD = showdown / (saw the flop and never folded the whole hand)
 *       这不是 WTSD。WTSD 的标准分母是"看到了翻牌"，与之后是否弃牌无关。
 *       This is not WTSD. The standard denominator for WTSD is "saw the flop", unrelated to whether one folds afterwards.
 *
 * 本脚本对同一批牌局同时按两种口径计算，直接看差距：
 * This script computes the same set of hands under both definitions at once, directly showing the gap:
 *   旧口径 = 项目现在用的（错误）
 *   Old definition = what the project currently uses (wrong)
 *   新口径 = 在发牌到翻牌那一刻记录 hero 是否还在牌局里（正确）
 *   New definition = record whether hero is still in the hand at the moment the flop is dealt (correct)
 *
 *   node test/probe-wtsd.js [每种人格手数]
 *   node test/probe-wtsd.js [hand count per persona]
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'poker.js'));
require(path.join(__dirname, '..', 'src', 'equity.js'));
require(path.join(__dirname, '..', 'src', 'range.js'));
require(path.join(__dirname, '..', 'src', 'profile.js'));
require(path.join(__dirname, '..', 'src', 'ai.js'));
require(path.join(__dirname, '..', 'src', 'engine.js'));
const PK = globalThis.PK;

const N = parseInt(process.argv[2] || '500', 10);
const SEATS = 6, BB = 2, STACK = 200, TARGET = 0;
const STREET_IDX = { preflop: 0, flop: 1, turn: 2, river: 3 };

/** field: 'same' = 全员同人格（diag-style.js 的现状）；'mix' = 真实混合牌桌 */
/** field: 'same' = everyone the same persona (diag-style.js's current state); 'mix' = a realistic mixed table */
const FIELD_MIX = ['tag', 'lag', 'calling', 'tag', 'rock'];

function run(styleKey, fieldKey) {
  return new Promise(resolve => {
    const sim = new PK.Game({ seats: SEATS, bb: BB, sb: 1, startStack: STACK, aiSpeed: 0, dealDelay: 0 });
    sim._delay = () => Promise.resolve();
    sim.players.forEach((p, i) => {
      p.isHero = false;
      if (i === TARGET) { p.style = PK.STYLES[styleKey]; return; }
      p.style = PK.STYLES[fieldKey === 'same' ? styleKey
        : FIELD_MIX[(i - 1) % FIELD_MIX.length]];
    });

    const acc = {
      hands: 0, sawFlop: 0, flopSeenOld: 0, showdown: 0, showdownAny: 0,
      foldAt: { preflop: 0, flop: 0, turn: 0, river: 0 },
      wonNoShowdown: 0,
    };
    let maxStreet = -1;
    let heroSawFlop = false;

    sim.on('hand-start', () => { maxStreet = -1; heroSawFlop = false; });
    sim.on('street', s => {
      maxStreet = Math.max(maxStreet, STREET_IDX[s]);
      /* ★ 正确口径：翻牌发出的那一刻，hero 还在牌局里 = "看到了翻牌" */
      /* ★ Correct definition: at the moment the flop is dealt, hero is still in the hand = "saw the flop" */
      if (s === 'flop' && !sim.players[TARGET].folded) heroSawFlop = true;
    });
    sim.on('hand-end', () => {
      acc.hands++;
      const p = sim.players[TARGET];
      if (heroSawFlop) acc.sawFlop++;                       // 正确分母 / correct denominator
      if (!p.folded && maxStreet >= 1) acc.flopSeenOld++;    // 项目现用分母 / current project denominator
      const sd = sim.handResult && sim.handResult.type === 'showdown';
      /* ★ 分子也必须限定"hero 本人摊牌了"。原来只判断 handResult.type，
         ★ The numerator must also require "hero personally reached showdown". It used to check only handResult.type,
         于是 hero 翻前弃牌、其余 5 人继续打到摊牌，这笔也被算进 hero 的摊牌数，
         so when hero folds pre-flop and the other 5 keep playing to showdown, that hand was still counted into hero's showdown count,
         导致 WTSD 可以 >100%（实测疯子 258%）。
         allowing WTSD to exceed 100% (measured 258% for the maniac). */
      if (sd) { acc.showdownAny++; if (!p.folded) acc.showdown++; }
      if (p.folded) {
        const st = ['preflop', 'flop', 'turn', 'river'][maxStreet < 0 ? 0 : maxStreet];
        acc.foldAt[st]++;
      } else if (!sd) acc.wonNoShowdown++;
      if (acc.hands < N) sim.newHand(); else resolve(acc);
    });
    sim.newHand();
  });
}

(async function () {
  console.log('每种人格 ' + N + ' 手  |  6 人桌  |  筹码 ' + STACK + '  |  统计座位 ' + TARGET + '\n');
  for (const fieldKey of ['same', 'mix']) {
    console.log('══ ' + (fieldKey === 'same' ? '全员同人格（diag-style.js 现状）' : '混合牌桌（1 目标 + 5 基准对手）') + ' ══');
    console.log('人格        本人摊牌  含他人摊牌  旧分母   新分母   旧WTSD   新WTSD');
    console.log('─'.repeat(74));
    for (const k of PK.STYLE_KEYS) {
      const r = await run(k, fieldKey);
      const oldW = r.flopSeenOld ? r.showdown / r.flopSeenOld * 100 : 0;
      const newW = r.sawFlop ? r.showdown / r.sawFlop * 100 : 0;
      console.log(
        (PK.STYLES[k].name + ' ' + k).padEnd(12, ' ') +
        String(r.showdown).padStart(8) +
        String(r.showdownAny).padStart(11) +
        String(r.flopSeenOld).padStart(9) +
        String(r.sawFlop).padStart(9) +
        oldW.toFixed(1).padStart(9) + '%' +
        newW.toFixed(1).padStart(8) + '%'
      );
    }
    console.log('');
  }
  console.log('参考：真实玩家 WTSD 大致区间 —— 岩石 16~26% / 紧凶 18~28% / 松凶 20~32% /');
  console.log('      跟注站 28~42% / 疯子 26~44%（即 diag-style.js 里的 REF.wtsd）');
  process.exit(0);
})();
