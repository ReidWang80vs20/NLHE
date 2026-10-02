/* ============================================================
 * synth-player.js — 合成玩家生成器（测试专用共享模块）
 * synth-player.js — synthetic player generator (shared test-only module)
 *
 *   为什么单独抽出来：check-profile.js 的断言是**统计性**的，
 *   Why it is factored out: check-profile.js's assertions are **statistical**,
 *   要判断某条断言是否"余量太小、会偶发假失败"，必须能反复运行
 *   so judging whether an assertion has "too little margin and may fail spuriously" requires running
 *   同一个生成器并统计指标分布。若探针里再抄一份 synth，两份代码
 *   the same generator repeatedly and collecting metric distributions. If the probe copied another synth, the two
 *   一旦分叉，测出来的就不是被测对象 —— 结论无效。
 *   copies would diverge and measure something other than the object under test — invalidating the conclusion.
 *   所以由 check-profile.js 与 probe-profile-stats.js 共用这一份。
 *   So check-profile.js and probe-profile-stats.js share this single copy.
 *
 *   ⚠ 本模块使用 Math.random()，结果不可复现，属有意为之：
 *   ⚠ This module uses Math.random(); results are not reproducible, and that is intentional:
 *     目的是"用随机样本压测画像判定的稳健性"。
 *     the goal is to stress-test the robustness of profile judgments using random samples.
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'profile.js'));
const PK = globalThis.PK;
const P = PK.Profile;

/**
 * 合成一个玩家：按给定倾向跑 N 手
 * Synthesize a player: play N hands according to the given tendencies
 * @param {object} t 倾向
 * @param {object} t tendencies
 *   { hands, vpipRate, pfrRate?, foldToBetRate, foldTo3BetRate, riverCallRate?, betSize?, wtsdRate }
 * @returns 画像实例（可直接 .metrics() / .exploit() / .leaks()）
 * @returns a profile instance (directly usable with .metrics() / .exploit() / .leaks())
 */
function synth(t) {
  const p = P.create();
  const rnd = () => Math.random();
  /* 河牌口径必须与其余两条街自洽，否则"标准玩家"会被误判。
   * The river metric definition must be self-consistent with the other two streets, or the "standard player" gets misjudged.
     面对河牌下注不是只有 call/fold —— 还有约 13% 的加注。
   * Facing a river bet is not merely call/fold — about 13% of the time it is a raise.
     于是：跟注率默认 = 1 − 弃牌率 − 加注率。
   * Hence: the call rate defaults to 1 − fold rate − raise rate.
     若把跟注率硬写成 0.40，隐含的弃牌率就变成 0.60，
   * If the call rate were hard-coded to 0.40, the implied fold rate would become 0.60,
     与"每条街都弃 45%"自相矛盾，画像会把它读成"弃牌过多"。
   * contradicting "fold 45% on every street", and the profile would read it as "folds too much". */
  const RIVER_RAISE = 0.13;
  const riverCall = t.riverCallRate === undefined
    ? Math.max(0, 1 - t.foldToBetRate - RIVER_RAISE)
    : t.riverCallRate;
  const riverFold = Math.max(0, 1 - riverCall - RIVER_RAISE);
  for (let h = 0; h < t.hands; h++) {
    p.startHand();
    /* --- 翻前 ---
     * --- Preflop --- */
    const plays = rnd() < t.vpipRate;
    if (plays) {
      const aggressive = rnd() < (t.pfrRate === undefined ? 0.45 : t.pfrRate);
      p.markPreflop({ invested: true, aggressive });
      p.observe({ street: 'preflop', action: aggressive ? 'raise' : 'call', toCall: 2, pot: 3, invested: 6, raiseCount: 1 });
      /* 面对 3-bet
       * Facing a 3-bet */
      if (rnd() < 0.45) {
        const folds = rnd() < t.foldTo3BetRate;
        p.observe({ street: 'preflop', action: folds ? 'fold' : 'call', toCall: 16, pot: 30, invested: folds ? 0 : 16, raiseCount: 2 });
        if (folds) { p.endHand({ sawFlop: false }); continue; }
      }
    } else {
      /* 没进池：要么直接弃牌，要么是没人加注时免费看牌
       * Out of the pot: either fold outright, or see a free flop when nobody raised */
      const seesFlop = rnd() < 0.25;
      if (!seesFlop) { p.endHand({ sawFlop: false }); continue; }
    }

    /* --- 翻后：面对下注 ---
     * --- Postflop: facing a bet --- */
    let alive = true;
    const streets = ['flop', 'turn', 'river'];
    for (let si = 0; si < streets.length; si++) {
      const street = streets[si];
      const faced = rnd() < 0.72;
      if (faced) {
        const folds = rnd() < t.foldToBetRate;
        const pot = 20 + si * 15;
        const toCall = Math.round(pot * (t.betSize === undefined ? 0.65 : t.betSize));
        if (street === 'river') {
          const r = rnd();
          const act = r < RIVER_RAISE ? 'raise' : (r < RIVER_RAISE + riverFold ? 'fold' : 'call');
          p.observe({ street, action: act, toCall, pot, invested: act === 'fold' ? 0 : toCall, raiseCount: 0 });
          if (act === 'fold') { alive = false; break; }
        } else {
          p.observe({ street, action: folds ? 'fold' : 'call', toCall, pot, invested: folds ? 0 : toCall, raiseCount: 0 });
          if (folds) { alive = false; break; }
        }
      } else {
        /* 我主动下注
         * I bet out proactively */
        const bet = Math.round(20 * (t.betSize === undefined ? 0.62 : t.betSize));
        p.observe({ street, action: 'raise', toCall: 0, pot: 20, invested: bet, raiseCount: 0 });
      }
    }
    if (!alive) { p.endHand({ sawFlop: true }); continue; }
    const sd = rnd() < t.wtsdRate;
    p.endHand({ sawFlop: true, showdown: sd, won: sd && rnd() < 0.5 });
  }
  return p;
}

/**
 * 场景预设 —— **只此一份**，check-profile.js 与 probe-profile-stats.js 共用。
 * Scenario presets — **one single copy**, shared by check-profile.js and probe-profile-stats.js.
 *
 * 为什么必须共用：探针要给每条断言算 σ 余量，就必须跑与验收脚本**逐字相同**的
 * Why sharing is mandatory: to compute the σ margin of each assertion, the probe must run scenarios **byte-for-byte identical**
 * 场景。曾把配置在探针里另抄一份，改验收脚本的 hands 后忘了同步探针，
 * to the acceptance script. A copy was once made inside the probe, and after hands changed in the acceptance script the probe was not synced,
 * 于是探针拿旧配置算出"g8 仍脆弱"的**错误结论**，差点据此去改错地方。
 * so the probe produced a **wrong conclusion** that "g8 is still fragile" from the stale config, nearly causing a fix in the wrong place.
 * 配置即被测对象的一部分，不能有第二份。
 * The config is part of the object under test; there must not be a second copy.
 *
 * ⚠ 各档 hands 的取值理由见 check-profile.js 第 8 组的注释（统计功效实测）。
 * ⚠ The rationale for each hands value is in the group-8 comment of check-profile.js (measured statistical power).
 */
const SCENARIOS = {
  /* 面对下注弃牌过多（组 2 / 组 10）
   * Folds too much facing a bet (groups 2 / 10) */
  overFolder: { hands: 400, vpipRate: 0.34, foldToBetRate: 0.78, foldTo3BetRate: 0.5, riverCallRate: 0.15, wtsdRate: 0.12 },
  /* 跟注站（组 3）
   * Calling station (group 3) */
  station: { hands: 400, vpipRate: 0.6, foldToBetRate: 0.10, foldTo3BetRate: 0.15, riverCallRate: 0.8, wtsdRate: 0.5 },
  /* 翻前过紧（组 4）
   * Too tight preflop (group 4) */
  nit: { hands: 400, vpipRate: 0.10, foldToBetRate: 0.45, foldTo3BetRate: 0.5, riverCallRate: 0.4, wtsdRate: 0.3 },
  /* 翻前过松（组 5）
   * Too loose preflop (group 5) */
  loose: { hands: 400, vpipRate: 0.75, foldToBetRate: 0.45, foldTo3BetRate: 0.5, riverCallRate: 0.4, wtsdRate: 0.3 },
  /* 怕 3-bet（组 6）
   * Afraid of 3-bets (group 6) */
  scared3Bet: { hands: 400, vpipRate: 0.3, foldToBetRate: 0.45, foldTo3BetRate: 0.92, riverCallRate: 0.4, wtsdRate: 0.3 },
  /* 河牌跟太多 + 尺度偏大（组 7）
   * Calls too much on the river + oversized bets (group 7) */
  riverCaller: { hands: 400, vpipRate: 0.35, foldToBetRate: 0.45, foldTo3BetRate: 0.5, riverCallRate: 0.9, betSize: 1.4, wtsdRate: 0.3 },
  /* 单调性扫描用的基准档（组 9）：只改 foldToBetRate，其余固定
   * Baseline preset for the monotonicity sweep (group 9): vary only foldToBetRate, everything else fixed */
  monotonic: { hands: 400, vpipRate: 0.3, foldToBetRate: 0.45, foldTo3BetRate: 0.5, riverCallRate: 0.4, wtsdRate: 0.3 },
  /* 标准紧凶（组 8）：零容差断言，样本量必须给足 —— 实测 1500 手档余量才到 4σ
   * Standard tight-aggressive (group 8): a zero-tolerance assertion, so the sample size must be sufficient — only the 1500-hand setting reaches a 4σ margin in practice */
  standard: { hands: 1600, vpipRate: 0.27, pfrRate: 0.45, foldToBetRate: 0.45, foldTo3BetRate: 0.52, betSize: 0.62, wtsdRate: 0.30 },
};

/* 组 9 单调性扫描的三个弃牌率档（低 / 标准 / 高）
 * The three fold-rate settings for the group-9 monotonicity sweep (low / standard / high) */
const MONO_FOLDS = [0.20, 0.45, 0.70];

module.exports = { synth, P, SCENARIOS, MONO_FOLDS };
