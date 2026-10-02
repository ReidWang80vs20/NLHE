/* ============================================================
 * diag-style.js — 人格行为指标校验（含决策分支直方图）
 * diag-style.js — personality behavior metric verification (with a decision-branch histogram)
 *   node test/diag-style.js [每种人格手数]
 *   node test/diag-style.js [hands per personality]
 *
 * ⚠️ WTSD 口径（曾经写错，务必看这段）
 * ⚠️ WTSD metric definition (once wrong — be sure to read this)
 *   标准定义：WTSD = 本人摊牌手数 / 看到翻牌的手数
 *   Standard definition: WTSD = hands the player themself showed down / hands that saw the flop
 *     · 分子必须是**本人**真的摊了牌。只判断 handResult.type === 'showdown'
 *     · The numerator must be hands **the player themself** actually showed down. Testing only handResult.type === 'showdown'
 *       会把"自己翻前弃牌、其余人打到摊牌"也算进来 —— 实测让疯子读到 258%，
 *       would also count "you folded preflop but the others went to showdown" — measured, it made the maniac read 258%,
 *       一个比值超过 100% 就是口径崩了。
 *       and a ratio above 100% means the metric is broken.
 *     · 分母必须是"看到了翻牌"，与之后在转牌/河牌是否弃牌无关。
 *     · The denominator must be "saw the flop", regardless of later folding on the turn/river.
 *       原实现在牌局结束时取 !p.folded，等于把"翻后弃牌"的手从分母里剔除，
 *       The original implementation took !p.folded at the end of the hand, i.e. it removed "folded postflop" hands from the denominator,
 *       分母被削小、比值被系统性抬高（实测岩石 42% vs 真实 22%）。
 *       shrinking the denominator and systematically inflating the ratio (measured: rock 42% vs a true 22%).
 *   两个错误叠加的结果就是"看似 WTSD 全面超标"，据此去收紧 AI 的跟注门槛
 *   The two errors combined make "WTSD look uniformly over the limit"; tightening the AI's calling threshold based on that
 *   是在追一个不存在的鬼。脚本末尾有 <=100% 的硬断言防止再次退化。
 *   is chasing a ghost that does not exist. A hard <=100% assertion at the end of the script prevents regression.
 *
 * 牌桌构成：'mix'（默认，1 个目标人格 + 5 个基准对手，贴近真实牌桌）
 * Table composition: 'mix' (default, 1 target personality + 5 baseline opponents, close to a real table)
 *          'same'（全员同人格，早期实现；6 个疯子互相全下会抬高摊牌率，
 *          'same' (all the same personality, an early implementation; 6 maniacs all-in against each other inflate the showdown rate,
 *                  属于测量假象，仅作对照保留）
 *                  a measurement artifact, kept only for comparison)
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'poker.js'));
require(path.join(__dirname, '..', 'src', 'equity.js'));
/* range.js 必须加载：AI 的"极化 3-bet 诈唬"依赖 PK.Range.BLUFF_3BET，
 * range.js must be loaded: the AI's "polarized 3-bet bluff" depends on PK.Range.BLUFF_3BET;
   不加载的话标定出来的 PFR/3-bet 会比实际玩的偏低。
 * without it, the calibrated PFR/3-bet would read lower than what is actually played.
   profile.js 在此处为中性（没有观测样本），加载它是为了口径一致。
 * profile.js is neutral here (no observation samples); loading it keeps the metric definition consistent. */
require(path.join(__dirname, '..', 'src', 'range.js'));
require(path.join(__dirname, '..', 'src', 'profile.js'));
require(path.join(__dirname, '..', 'src', 'ai.js'));
require(path.join(__dirname, '..', 'src', 'engine.js'));
const PK = globalThis.PK;

const N = parseInt(process.argv[2] || '1200', 10);
const STACK = 200, SEATS = 6, BB = 2, TARGET = 0;
const STREET_IDX = { preflop: 0, flop: 1, turn: 2, river: 3 };

/** 基准对手阵容：一个标准牌桌上你会遇到的混合构成
 * Baseline opponent lineup: the mixed composition you would meet at a standard table */
const FIELD_MIX = ['tag', 'lag', 'calling', 'tag', 'rock'];

const REF = {
  rock:    { vpip: [10, 17], pfr: [7, 14],  wtsd: [16, 26] },
  tag:     { vpip: [20, 28], pfr: [15, 23], wtsd: [18, 28] },
  lag:     { vpip: [28, 40], pfr: [22, 33], wtsd: [20, 32] },
  calling: { vpip: [30, 48], pfr: [3, 10],  wtsd: [28, 42] },
  maniac:  { vpip: [48, 75], pfr: [35, 60], wtsd: [26, 44] },
};

function runStyle(styleKey, fieldKey) {
  return new Promise(resolve => {
    const sim = new PK.Game({ seats: SEATS, bb: BB, sb: 1, startStack: STACK, aiSpeed: 0, dealDelay: 0 });
    sim._delay = () => Promise.resolve();
    sim.players.forEach((p, i) => {
      p.isHero = false;
      if (i === TARGET) { p.style = PK.STYLES[styleKey]; return; }
      p.style = PK.STYLES[fieldKey === 'same'
        ? styleKey : FIELD_MIX[(i - 1) % FIELD_MIX.length]];
    });

    const acc = {
      hands: 0, vpip: 0, pfr: 0, foldPre: 0, flopSeen: 0, showdown: 0, sdWin: 0,
      net: 0, branches: Object.create(null), foldPost: 0,
      reached: { flop: 0, turn: 0, river: 0 },
      /* 旧口径的计数器，保留只为对照，不参与判定
       * Legacy-metric counters, kept only for comparison and not used in the verdict */
      legacyFlopSeen: 0, legacyShowdownAny: 0,
    };

    let maxStreet = -1;
    /* ★ 正确口径的关键：在翻牌发出的**那一刻**记录 hero 是否还在牌局里。
     * ★ The key to the correct metric: record whether the hero is still in the hand **at the moment** the flop is dealt.
       之后 hero 在转牌/河牌弃牌，不影响"看过翻牌"这个事实。
     * Later folding on the turn/river does not change the fact that the hero "saw the flop". */
    let heroSawFlop = false;

    sim.on('street', s => {
      maxStreet = Math.max(maxStreet, STREET_IDX[s]);
      if (s === 'flop' && !sim.players[TARGET].folded) heroSawFlop = true;
    });
    sim.on('hand-start', () => {
      maxStreet = -1;
      heroSawFlop = false;
      sim.players.forEach(p => { p._v = false; p._pf = false; });
      sim.players[TARGET]._snap = sim.players[TARGET].stack;
    });

    const origApply = sim._apply.bind(sim);
    sim._apply = function (p, d) {
      if (p.seat === TARGET) {
        const tag = sim.street + ':' + (d.note || d.action);
        acc.branches[tag] = (acc.branches[tag] || 0) + 1;
        if (sim.street === 'preflop') {
          const toCall = Math.max(0, sim.currentBet - p.bet);
          const vol = (d.action === 'call' && toCall > 0) || d.action === 'raise' || d.action === 'allin';
          if (vol && !p._v) { acc.vpip++; p._v = true; }
          if ((d.action === 'raise' || d.action === 'allin') && !p._pf) { acc.pfr++; p._pf = true; }
          if (d.action === 'fold') acc.foldPre++;
        } else if (d.action === 'fold') {
          acc.foldPost++;
        }
      }
      return origApply(p, d);
    };

    sim.on('hand-end', () => {
      acc.hands++;
      const p = sim.players[TARGET];
      acc.net += p.stack - p._snap;

      const sd = sim.handResult && sim.handResult.type === 'showdown';
      const heroShowdown = sd && !p.folded;        // ★ 本人摊牌 / ★ this player showed down
      if (heroSawFlop) acc.flopSeen++;              // ★ 正确分母 / ★ correct denominator
      if (heroShowdown) {
        acc.showdown++;
        if (sim.handResult.winners.some(w => w.seat === TARGET)) acc.sdWin++;
      }

      /* 旧口径（仅在 'same' 模式下留作差值对照）
       * Legacy metric (kept only as a differential reference in 'same' mode) */
      if (!p.folded && maxStreet >= 1) acc.legacyFlopSeen++;
      if (sd) acc.legacyShowdownAny++;

      /* 街道到达率：以"进过翻牌"为基准，共用一个分母
       * Street reach rate: based on "entered the flop", sharing one denominator */
      if (heroSawFlop) {
        acc.reached.flop++;
        if (maxStreet >= 2) acc.reached.turn++;
        if (maxStreet >= 3) acc.reached.river++;
      }
      if (acc.hands < N) sim.newHand(); else resolve(acc);
    });
    sim.newHand();
  });
}

(async function main() {
  console.log('每种人格 ' + N + ' 手  |  6 人桌  |  统计座位 ' + TARGET + '\n');
  console.log('人格            VPIP%    PFR%   弃牌%   进翻牌%   WTSD%   SD胜率%   bb/100  判定');
  const rows = [];
  for (const key of PK.STYLE_KEYS) {
    const r = await runStyle(key, 'mix');
    const h = r.hands;
    const vpip = r.vpip / h * 100;
    const pfr = r.pfr / h * 100;
    const foldPre = r.foldPre / h * 100;
    const flopSeen = r.flopSeen / h * 100;
    const wtsd = r.flopSeen ? r.showdown / r.flopSeen * 100 : 0;
    const wsd = r.showdown ? r.sdWin / r.showdown * 100 : 0;
    const bb100 = r.net / BB / h * 100;
    const ref = REF[key];
    const inR = (v, rng) => v >= rng[0] && v <= rng[1];
    const ok = inR(vpip, ref.vpip) && inR(pfr, ref.pfr) && inR(wtsd, ref.wtsd);
    console.log(
      (PK.STYLES[key].name + ' ' + key).padEnd(14, ' ') +
      vpip.toFixed(1).padStart(6) + '  ' + pfr.toFixed(1).padStart(6) + '  ' +
      foldPre.toFixed(1).padStart(6) + '  ' + flopSeen.toFixed(1).padStart(7) + '  ' +
      wtsd.toFixed(1).padStart(7) + '  ' + wsd.toFixed(1).padStart(7) + '  ' +
      bb100.toFixed(1).padStart(7) + '   ' + (ok ? '✅' : '⚠️')
    );
    rows.push({ key, r, vpip, pfr, wtsd, ref, ok });
  }

  console.log('\n参考区间：');
  for (const k of PK.STYLE_KEYS) {
    const r = REF[k];
    console.log('  ' + (PK.STYLES[k].name + ' ' + k).padEnd(14, ' ') +
      'VPIP ' + r.vpip[0] + '~' + r.vpip[1] + '%  PFR ' + r.pfr[0] + '~' + r.pfr[1] +
      '%  WTSD ' + r.wtsd[0] + '~' + r.wtsd[1] + '%');
  }

  console.log('\n街道到达率（以"看过翻牌"为 100%）与翻后弃牌率：');
  console.log('  人格            看翻牌/手   到转牌%   到河牌%   摊牌%   翻后弃牌/手');
  for (const row of rows) {
    const r = row.r;
    const f = r.reached.flop || 1;
    console.log('  ' + (PK.STYLES[row.key].name + ' ' + row.key).padEnd(16, ' ') +
      (r.reached.flop / r.hands * 100).toFixed(1).padStart(8) + '%' +
      (r.reached.turn / f * 100).toFixed(1).padStart(9) + '%' +
      (r.reached.river / f * 100).toFixed(1).padStart(9) + '%' +
      (r.showdown / f * 100).toFixed(1).padStart(8) + '%' +
      (r.foldPost / r.hands * 100).toFixed(1).padStart(12) + '%');
  }

  console.log('\n翻后决策分支分布：');
  for (const row of rows) {
    const post = Object.keys(row.r.branches)
      .filter(k => k.indexOf('preflop:') !== 0)
      .map(k => [k, row.r.branches[k]])
      .sort((a, b) => b[1] - a[1]).slice(0, 10);
    const tot = Object.keys(row.r.branches)
      .filter(k => k.indexOf('preflop:') !== 0)
      .reduce((a, k) => a + row.r.branches[k], 0);
    console.log('  [' + PK.STYLES[row.key].name + '] 翻后决策共 ' + tot + ' 次');
    post.forEach(([n, c]) => console.log('      ' + n.padEnd(22, ' ') + String(c).padStart(6) +
      '  ' + (c / tot * 100).toFixed(1) + '%'));
  }

  /* ---- 口径自检：比值不可能超过 100% ----
   * ---- Metric self-check: a ratio cannot exceed 100% ---- */
  const overflow = rows.filter(r => r.wtsd > 100.0001);
  if (overflow.length) {
    console.log('\n❌ 口径自检失败：WTSD > 100% —— ' +
      overflow.map(r => r.key + ' ' + r.wtsd.toFixed(1) + '%').join('，'));
    console.log('   分子/分母必有一处算错，请先修口径再谈标定。');
    process.exit(1);
  }

  /* ---- 对照：全员同人格牌桌（旧实验设置），用来看牌桌构成的影响 ----
   * ---- Comparison: all-same-personality table (old experiment setup), to see the effect of table composition ---- */
  console.log('\n对照（全员同人格牌桌，测量假象较大，仅作参考）：');
  console.log('  人格            WTSD%(同人格桌)   WTSD%(混合桌)   差值');
  for (const row of rows) {
    const s = await runStyle(row.key, 'same');
    const sw = s.flopSeen ? s.showdown / s.flopSeen * 100 : 0;
    console.log('  ' + (PK.STYLES[row.key].name + ' ' + row.key).padEnd(16, ' ') +
      sw.toFixed(1).padStart(12) + '%' + row.wtsd.toFixed(1).padStart(14) + '%' +
      (row.wtsd - sw).toFixed(1).padStart(8));
  }

  const bad = rows.filter(r => !r.ok);
  console.log('\n结论：' + (bad.length === 0 ? '✅ 全部人格行为合理' :
    '⚠️ 需微调：' + bad.map(b => b.key + '(VPIP ' + b.vpip.toFixed(0) + ' PFR ' + b.pfr.toFixed(0) + ' WTSD ' + b.wtsd.toFixed(0) + ')').join('，')));
  process.exit(0);
})();
