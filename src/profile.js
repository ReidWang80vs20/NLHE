/* ============================================================
 * profile.js — 玩家漏洞画像
 * profile.js — player leak profile
 *
 * 目的：让电脑不再"照着教科书打"，而是先观察你，再针对你。
 * Purpose: stop the computer from "playing by the textbook" and instead observe you first, then exploit you.
 *   你面对下注老弃牌 → 它开始多诈唬、尺度也放大
 *   You keep folding to bets → it starts bluffing more and enlarges its sizing
 *   你什么牌都跟     → 它把诈唬砍掉，改成薄价值下注
 *   You call with anything → it cuts its bluffs and switches to thin value bets
 *   你太紧           → 它用后位范围疯狂偷盲
 *   You are too tight → it steals blinds relentlessly with late-position ranges
 *   你怕 3-bet       → 它把 3-bet 诈唬频率提上去
 *   You fear 3-bets → it raises its 3-bet bluff frequency
 *
 * 两条设计红线（否则这个功能会变成"随机乱打"）：
 * Two design red lines (otherwise this feature becomes "playing at random"):
 *   1. **最小样本门控**：没有 20 次以上的对应机会，不产生任何调整。
 *   1. **Minimum sample gating**: with fewer than 20 relevant opportunities, no adjustment is produced at all.
 *   2. **置信度渐进**：调整幅度按样本量线性 ramp 上来，且用拉普拉斯平滑
 *   2. **Gradual confidence**: the adjustment magnitude ramps up linearly with sample size, and Laplace smoothing
 *      把观测率往基准值上收（3/3 弃牌不会被当成 100% 弃牌）。
 *      pulls the observed rate toward the baseline (3/3 folds is not treated as a 100% fold rate).
 *      —— 小样本噪声导致 AI 行为乱跳，比"不会剥削"糟糕得多。
 *      —— Small-sample noise making the AI's behavior jump around is far worse than "failing to exploit".
 *
 * 口径约定：
 * Convention:
 *   foldToBet 只统计**翻后**（翻牌/转牌/河牌）。翻前弃给加注是正常行为，
 *   foldToBet counts only **postflop** (flop/turn/river). Folding to a raise preflop is normal behavior,
 *   混进来会把这个指标稀释成噪声。
 *   and mixing it in would dilute this metric into noise.
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK || (global.PK = {});

  /* 基准值 = "标准紧凶对手"的参考区间；来自常见 HUD 统计口径
     Baseline = reference range for a "standard tight-aggressive opponent"; taken from common HUD conventions */
  const BASE = {
    vpip: 0.28, pfrRatio: 0.45, foldToBet: 0.45,
    foldTo3Bet: 0.52, riverCall: 0.40, wtsd: 0.30, betSize: 0.62,
    aggr: 1.0,
  };
  /* 每个指标先验的等效观测数：越大越"不轻易下结论"
     Equivalent observation count for each metric's prior: the larger, the more reluctant to draw conclusions */
  const PRIOR_N = 14;
  /* 产生调整所需的最小机会数
     Minimum number of opportunities required to produce an adjustment */
  const MIN_OPP = 20;
  /* 置信度饱和所需的机会数
     Number of opportunities required for confidence to saturate */
  const FULL_OPP = 140;

  /* 漏洞 → 心算题库主题的映射（D 组联动用）。
     Leak → mental-math drill topic mapping (used for group D linkage).
     主题 key 与题库 index.html 的 TOPICS 保持一致。
     The topic keys stay consistent with TOPICS in the drill app's index.html. */
  const TOPIC_FOR = {
    foldTooMuch: ['s3_req', 's3_decide'],
    callTooMuch: ['s3_decide', 's5_callev'],
    tooTight: ['s4_range', 's4_pct'],
    tooLoose: ['s4_single', 's4_range'],
    passive: ['s5_bluffev', 's1_frac'],
    overFold3Bet: ['s3_fe', 's5_semiev'],
    riverOverCall: ['s3_maxcall', 's5_callev'],
    bigBetSize: ['s3_size', 's1_reward'],
    sticky: ['s2_exact', 's3_decide'],
  };

  function emptyStats() {
    return {
      hands: 0,                 // 记过牌的手数（VPIP 分母） / number of hands recorded (VPIP denominator)
      vpip: 0, pfr: 0,
      threeBetOpp: 0, threeBet: 0,
      foldTo3BetOpp: 0, foldTo3Bet: 0,
      faced: { flop: { opp: 0, fold: 0 }, turn: { opp: 0, fold: 0 }, river: { opp: 0, fold: 0 } },
      bets: 0, raises: 0, calls: 0, checks: 0, folds: 0,
      sawFlop: 0, sawShowdown: 0, wonShowdown: 0,
      riverCallOpp: 0, riverCall: 0,
      bigCallOpp: 0, bigCall: 0,
      sizeSum: 0, sizeN: 0,
    };
  }

  /* 拉普拉斯平滑：把观测率往基准值收，小样本时结果接近基准
     Laplace smoothing: pull the observed rate toward the baseline; with small samples the result stays close to the baseline */
  function smoothed(hit, opp, prior) {
    if (opp <= 0) return prior;
    return (hit + prior * PRIOR_N) / (opp + PRIOR_N);
  }
  /** 样本置信度 0~1：达到 FULL_OPP 次机会才算完全可信（用于界面展示）
   * Sample confidence 0~1: fully trustworthy only once FULL_OPP opportunities are reached (used for display) */
  function confidence(opp) {
    if (opp < MIN_OPP) return 0;
    return Math.min(1, (opp - MIN_OPP) / (FULL_OPP - MIN_OPP));
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /**
   * 观测率相对基准的 z 值：偏离了几个标准误。
   * z-value of the observed rate relative to the baseline: how many standard errors it deviates.
   *
   * 为什么必须有这个：n≈300 时，"弃牌率"这个比例量的标准误约 2.9pp。
   * Why this is essential: at n≈300 the standard error of the "fold rate" proportion is about 2.9pp.
   * 如果只按"偏离 15 个百分点算一档"来判定，那么**纯噪声**（±2σ ≈ ±6pp）
   * If we judged purely by "a 15-percentage-point deviation counts as one step", then **pure noise** (±2σ ≈ ±6pp)
   * 就能推动近半档，AI 会在标准玩家身上莫名其妙地忽而狂诈唬、忽而完全不诈唬。
   * could move nearly half a step, making the AI inexplicably alternate between bluffing wildly and not bluffing at all against a standard player.
   * 只有把显著性算出来，才能做到"没有证据就不动"。
   * Only by computing significance can we achieve "no evidence, no move".
   */
  function zScore(hit, opp, baseline) {
    if (opp < MIN_OPP) return 0;
    const p = hit / opp;
    const se = Math.sqrt(Math.max(1e-9, p * (1 - p) / opp));
    return (p - baseline) / se;
  }
  /**
   * 证据强度：z² / (z² + k)，带符号，取值 -1~1。
   * Evidence strength: z² / (z² + k), signed, ranging from -1 to 1.
   * 直觉：z=1（偏离 1 个标准误）→ 只有 0.09 的分量（k=10），基本忽略；
   * Intuition: z=1 (a 1 standard error deviation) → only a 0.09 share (k=10), essentially ignored;
   *       z=3 → 0.47；z=6 → 0.78；z=13（真有大漏洞）→ 0.94。
   *       z=3 → 0.47; z=6 → 0.78; z=13 (a genuinely large leak) → 0.94.
   * 这是把"偏离多大"和"这个偏离有多可信"合成一个数的经验贝叶斯式收缩。
   * This is an empirical-Bayes-style shrinkage that combines "how large the deviation is" and "how credible it is" into one number.
   */
  function evidence(hit, opp, baseline, k) {
    const z = zScore(hit, opp, baseline);
    const zz = z * z;
    return (z >= 0 ? 1 : -1) * zz / (zz + (k === undefined ? 10 : k));
  }
  /* 漏洞卡片的最低显著性要求：|z| >= 2（约 95% 置信）。宁可不报，也不误报。
     Minimum significance required for a leak card: |z| >= 2 (about 95% confidence). Better to miss one than to report a false one. */
  const Z_REPORT = 2;

  /* ============================================================
   * 构造一个画像实例（工厂形式，测试可造隔离实例）
   * Build a profile instance (factory form; tests can create isolated instances)
   * ============================================================ */
  function create() {
    let S = emptyStats();
    let preflopMarked = false;    // 本手是否已计过 VPIP/PFR / whether VPIP/PFR has been counted for this hand

    /** 每手开始时调用：VPIP 的分母在这里 +1
     * Called at the start of each hand: the VPIP denominator is incremented here */
    function startHand() {
      S.hands++;
      preflopMarked = false;
    }

    /** 翻前首次主动投钱时调用一次（口径与 HUD 一致）
     * Called once when money is first put in voluntarily preflop (convention matches HUD) */
    function markPreflop(o) {
      if (preflopMarked || !o || !o.invested) return;
      preflopMarked = true;
      S.vpip++;
      if (o.aggressive) S.pfr++;
    }

    /**
     * 记录英雄的一次行动。
     * Record one action by the hero.
     * @param {object} o
     *   street      'preflop'|'flop'|'turn'|'river'
     *   action      'fold'|'check'|'call'|'raise'|'allin'
     *   toCall      需要跟注的金额（0 = 可以免费过牌）
     *   toCall      amount needed to call (0 = can check for free)
     *   pot         行动**之前**的底池（用于算下注尺度）
     *   pot         the pot **before** the action (used to compute bet sizing)
     *   invested    本次实际投入的筹码
     *   invested    chips actually put in this time
     *   raiseCount  行动前本街的加注次数
     *   raiseCount  number of raises on this street before the action
     */
    function observe(o) {
      if (!o) return;
      const street = o.street || 'preflop';
      const toCall = Math.max(0, o.toCall | 0);
      const raiseCount = Math.max(0, o.raiseCount | 0);
      const isPreflop = street === 'preflop';

      /* 面对下注的弃牌统计（只记翻后）
       * fold-to-bet stats (recorded postflop only) */
      if (toCall > 0 && S.faced[street]) {
        const f = S.faced[street];
        f.opp++;
        if (o.action === 'fold') f.fold++;
      }
      /* 翻前面对加注 → 3-bet 机会
       * facing a raise preflop → 3-bet opportunity */
      if (isPreflop && toCall > 0 && raiseCount >= 1) {
        S.threeBetOpp++;
        if (o.action === 'raise' || o.action === 'allin') S.threeBet++;
      }
      /* 面对 3-bet（本街已加注两次以上）
       * facing a 3-bet (two or more raises on this street) */
      if (isPreflop && toCall > 0 && raiseCount >= 2) {
        S.foldTo3BetOpp++;
        if (o.action === 'fold') S.foldTo3Bet++;
      }

      if (o.action === 'fold') S.folds++;
      else if (o.action === 'check') S.checks++;
      else if (o.action === 'call') S.calls++;
      else if (o.action === 'raise' || o.action === 'allin') {
        S.raises++;
        const invested = Math.max(0, o.invested | 0);
        const potBefore = Math.max(1, o.pot | 0);
        /* 下注尺度只统计**翻后**。翻前的"加注到 2.5BB"除以 1.5BB 的底池
           Bet sizing counts **postflop** only. Dividing a preflop "raise to 2.5BB" by a 1.5BB pot
           会得到 1.67 这种数，与翻后的"下注半个底池"完全不是一回事，
           yields numbers like 1.67, which is nothing like a postflop "bet half pot";
           混在一起会把尺度均值抬到 1 以上、误报"下注尺度偏大"。
           mixing them would push the average sizing above 1 and falsely report "bet sizing too large". */
        if (invested > 0 && !isPreflop) { S.sizeSum += invested / potBefore; S.sizeN++; }
      }

      /* 河牌跟注倾向
       * river calling tendency */
      if (street === 'river' && toCall > 0) {
        S.riverCallOpp++;
        if (o.action === 'call') S.riverCall++;
      }
      /* 大额跟注（跟注额 ≥ 底池的 60%）：最能暴露"跟注站"的地方
       * big calls (call amount ≥ 60% of pot): where a "calling station" is most exposed */
      if (toCall > 0 && o.pot > 0 && toCall >= 0.6 * o.pot) {
        S.bigCallOpp++;
        if (o.action === 'call') S.bigCall++;
      }
    }

    /** 一手结束
     * End of a hand */
    function endHand(r) {
      if (!r) return;
      if (r.sawFlop) S.sawFlop++;
      if (r.showdown) {
        S.sawShowdown++;
        if (r.won) S.wonShowdown++;
      }
    }

    function reset() { S = emptyStats(); preflopMarked = false; }

    /* ---------- 派生指标 ----------
     * ---------- derived metrics ---------- */
    function facedTotal() {
      const f = S.faced;
      return { opp: f.flop.opp + f.turn.opp + f.river.opp,
               fold: f.flop.fold + f.turn.fold + f.river.fold };
    }

    function metrics() {
      const fa = facedTotal();
      const vpip = smoothed(S.vpip, S.hands, BASE.vpip);
      /* PFR 的机会集是"已经进池的手"，拿 S.vpip 当分母更贴近 HUD 口径
       * the opportunity set for PFR is "hands that already entered the pot", so using S.vpip as the denominator is closer to the HUD convention */
      const pfrR = smoothed(S.pfr, S.vpip, BASE.pfrRatio);
      const aggr = (S.calls + PRIOR_N) > 0
        ? (S.raises + BASE.aggr * PRIOR_N) / (S.calls + PRIOR_N) : BASE.aggr;
      return {
        opp: {
          hands: S.hands,
          preflop: S.hands,
          facedBet: fa.opp,
          threeBet: S.threeBetOpp,
          foldTo3Bet: S.foldTo3BetOpp,
          river: S.riverCallOpp,
          bigCall: S.bigCallOpp,
          betSize: S.sizeN,
        },
        raw: {
          vpip: S.hands ? S.vpip / S.hands : 0,
          pfr: S.hands ? S.pfr / S.hands : 0,
          foldToBet: fa.opp ? fa.fold / fa.opp : 0,
          riverCall: S.riverCallOpp ? S.riverCall / S.riverCallOpp : 0,
          wtsd: S.sawFlop ? S.sawShowdown / S.sawFlop : 0,
          betSize: S.sizeN ? S.sizeSum / S.sizeN : 0,
        },
        vpip,
        pfrRatio: pfrR,
        foldToBet: smoothed(fa.fold, fa.opp, BASE.foldToBet),
        foldTo3Bet: smoothed(S.foldTo3Bet, S.foldTo3BetOpp, BASE.foldTo3Bet),
        riverCall: smoothed(S.riverCall, S.riverCallOpp, BASE.riverCall),
        bigCall: smoothed(S.bigCall, S.bigCallOpp, BASE.riverCall),
        wtsd: smoothed(S.sawShowdown, S.sawFlop, BASE.wtsd),
        betSize: S.sizeN ? S.sizeSum / S.sizeN : BASE.betSize,
        aggr,
      };
    }

    /* ---------- 漏洞清单 ----------
     * ---------- leak list ----------
     * 每张卡片都必须同时满足两件事才会出现：
     * Each card appears only if two conditions hold at once:
     *   a) 越过"实战上有意义"的阈值；
     *   a) it crosses a "practically meaningful" threshold;
     *   b) 偏离达到 |z| >= 2（约 95% 置信）。
     *   b) the deviation reaches |z| >= 2 (about 95% confidence).
     * 只有 a 不够 —— 比例量的标准误在 n≈300 时就有 3 个百分点，
     * a alone is not enough —— the standard error of a proportion is already 3 percentage points at n≈300,
     * 光看阈值会把纯粹的手气当成漏洞报出来。
     * judging by the threshold alone would report pure luck as a leak. */
    function leaks() {
      const m = metrics();
      const o = m.opp;
      const fa = facedTotal();
      const out = [];
      if (o.hands < MIN_OPP) return out;    // 样本不足 → 不输出任何结论
                                           // EN: insufficient sample → output no conclusion at all

      const push = (id, level, title, evText, fix, z) => out.push({
        id, level, title, evidence: evText, fix,
        topics: TOPIC_FOR[id] || [],
        z: z === undefined ? null : z,
        confidence: confidence(o.hands),
      });
      const sig = (hit, opp, base) =>
        opp >= MIN_OPP && Math.abs(zScore(hit, opp, base)) >= Z_REPORT;

      /* 1. 面对下注的弃牌率（翻后）
       * 1. fold-to-bet rate (postflop) */
      {
        const v = m.foldToBet, z = zScore(fa.fold, fa.opp, BASE.foldToBet);
        if (sig(fa.fold, fa.opp, BASE.foldToBet) && v > 0.58) {
          push('foldTooMuch', 'warn', '面对下注弃牌过多',
            '翻后面对下注的弃牌率 ' + (v * 100).toFixed(0) + '%（参考 ~45%，' + fa.opp + ' 次机会）',
            '对手会开始高频诈唬你，并把下注尺度放大到让你难受。', z);
        } else if (sig(fa.fold, fa.opp, BASE.foldToBet) && v < 0.32) {
          push('callTooMuch', 'warn', '跟注过多，弃不掉牌',
            '翻后面对下注的弃牌率仅 ' + (v * 100).toFixed(0) + '%（参考 ~45%，' + fa.opp + ' 次机会）',
            '对手会砍掉诈唬，改用中等牌力对你做薄价值下注。', z);
        }
      }
      /* 2. 翻前宽紧
       * 2. preflop looseness/tightness */
      {
        const v = m.raw.vpip, z = zScore(S.vpip, S.hands, BASE.vpip);
        if (sig(S.vpip, S.hands, BASE.vpip) && v < 0.17) {
          push('tooTight', 'warn', '翻前过紧',
            'VPIP ' + (v * 100).toFixed(0) + '%（参考 24~30%，' + S.hands + ' 手）',
            '对手会提高后位偷盲频率，你的盲注会被慢慢磨掉。', z);
        } else if (sig(S.vpip, S.hands, BASE.vpip) && v > 0.50) {
          push('tooLoose', 'warn', '翻前过松',
            'VPIP ' + (v * 100).toFixed(0) + '%（参考 24~30%，' + S.hands + ' 手）',
            '对手会收紧价值范围、减少诈唬，让你用弱牌付更多钱。', z);
        }
      }
      /* 3. 攻击性
       * 3. aggression */
      {
        const z = zScore(S.pfr, S.vpip, BASE.pfrRatio);
        if (sig(S.pfr, S.vpip, BASE.pfrRatio) && m.raw.pfr > 0 && m.pfrRatio < 0.30) {
          push('passive', 'info', '打得偏被动',
            'PFR/VPIP = ' + (m.pfrRatio * 100).toFixed(0) + '%（参考 ~45%）；累计加注 ' + S.raises + ' 次、跟注 ' + S.calls + ' 次',
            '对手会频繁持续下注抢走底池，你拿到好牌也赚不到该赚的钱。', z);
        }
      }
      /* 4. 面对 3-bet
       * 4. facing 3-bets */
      {
        const z = zScore(S.foldTo3Bet, S.foldTo3BetOpp, BASE.foldTo3Bet);
        if (sig(S.foldTo3Bet, S.foldTo3BetOpp, BASE.foldTo3Bet) && m.foldTo3Bet > 0.68) {
          push('overFold3Bet', 'warn', '面对 3-bet 弃牌过多',
            '面对 3-bet 弃牌率 ' + (m.foldTo3Bet * 100).toFixed(0) + '%（参考 ~52%，' + S.foldTo3BetOpp + ' 次）',
            '对手会用带阻断牌的弱牌（A5s / 76s 之类）频繁 3-bet 你，直接拿走底池。', z);
        }
      }
      /* 5. 河牌跟注
       * 5. river calling */
      {
        const z = zScore(S.riverCall, S.riverCallOpp, BASE.riverCall);
        if (sig(S.riverCall, S.riverCallOpp, BASE.riverCall) && m.riverCall > 0.56) {
          push('riverOverCall', 'warn', '河牌跟注过多',
            '河牌面对下注的跟注率 ' + (m.riverCall * 100).toFixed(0) + '%（参考 ~40%，' + S.riverCallOpp + ' 次）',
            '对手会在河牌用更薄的价值牌下注；你也要警惕自己的"好奇心跟注"。', z);
        }
      }
      /* 6. 摊牌倾向
       * 6. showdown tendency */
      {
        const z = zScore(S.sawShowdown, S.sawFlop, BASE.wtsd);
        if (sig(S.sawShowdown, S.sawFlop, BASE.wtsd) && m.wtsd > 0.44) {
          push('sticky', 'info', '翻后不容易放手',
            '看到翻牌后走到摊牌的比例 ' + (m.wtsd * 100).toFixed(0) + '%（参考 ~30%，' + S.sawFlop + ' 次看牌）',
            '对手会停止对你诈唬——因为骗不走你；改用更薄的价值下注剥削你。', z);
        }
      }
      /* 7. 下注尺度：分布本身很集中，噪声小，用次数门槛即可
       * 7. bet sizing: the distribution itself is tight and the noise small, so a count threshold suffices */
      if (S.sizeN >= 25 && m.betSize > 0.98) {
        push('bigBetSize', 'info', '下注尺度偏大',
          '平均下注约 ' + m.betSize.toFixed(2) + ' 倍底池（常见 0.5~0.75，' + S.sizeN + ' 次）',
          '大尺度容易被读：对手会用强牌跟注、弱牌弃牌，你的收益被压到最窄。', null);
      }
      /* 越可信的排前面
       * more credible ones first */
      out.sort((a, b) => (b.z === null ? -1 : Math.abs(b.z)) - (a.z === null ? -1 : Math.abs(a.z)));
      return out;
    }

    /* ---------- 给 AI 用的剥削权重 ----------
     * ---------- exploit weights for the AI ----------
     * 每个权重 = 1 + 方向 × 幅度 × 证据强度。
     * Each weight = 1 + direction × magnitude × evidence strength.
     *   · 方向/幅度：观测值偏离基准多少（按"档"计）
     *   · direction/magnitude: how far the observed value deviates from the baseline (in "steps")
     *   · 证据强度：z²/(z²+10)，统计上站不住的偏离贡献接近 0
     *   · evidence strength: z²/(z²+10); deviations that are not statistically defensible contribute near 0
     * 这样一个行为对应一项调整，且样本越少、调整越接近"什么也不做"。
     * This way one behavior maps to one adjustment, and the smaller the sample, the closer the adjustment is to "doing nothing". */
    function exploit() {
      const m = metrics();
      const o = m.opp;
      const fa = facedTotal();
      const ex = {
        bluffBoost: 1, sizeBoost: 1, thinValue: 0, stealBoost: 1,
        threeBetBluffBoost: 1, callDownBoost: 1,
        confidence: 0,
      };

      /* 1. 面对下注的弃牌率 → 诈唬频率 / 尺度 / 薄价值
       * 1. fold-to-bet rate → bluff frequency / sizing / thin value
       * 注意：方向只由 evidence 携带，mag 必须取绝对值。
       * Note: direction is carried only by evidence, so mag must use the absolute value.
       * 两者都带符号的话相乘会把方向抵消，结果永远为正 ——
       * If both carried a sign, the product would cancel the direction and always be positive ——
       * 表现为"跟注站反而让 AI 更爱诈唬"这种反向行为。
       * manifesting as the backwards behavior of "calling stations actually make the AI bluff more". */
      {
        const ev = evidence(fa.fold, fa.opp, BASE.foldToBet);                 // 带符号 / signed
        const mag = clamp(Math.abs(m.foldToBet - BASE.foldToBet) / 0.15, 0, 1.6);  // 幅度 / magnitude
        const s = ev * mag;                     // s > 0 = 对手爱弃牌 / s > 0 = opponent folds a lot
        if (s > 0) {                            // 爱弃牌 → 多诈唬、加大尺度 / folds a lot → bluff more, increase sizing
          ex.bluffBoost += s * 1.15;
          ex.sizeBoost += s * 0.30;
          ex.callDownBoost -= clamp(s, 0, 1) * 0.25;
        } else {                                // 爱跟注 → 砍诈唬、加薄价值 / calls a lot → cut bluffs, add thin value
          ex.bluffBoost += s * 0.75;
          ex.thinValue += -s * 0.16;
          ex.callDownBoost += clamp(-s, 0, 1) * 0.20;
        }
      }
      /* 2. 翻前宽紧 → 偷盲强度
       * 2. preflop looseness/tightness → steal intensity
       * evidence 的符号是 (你的 VPIP − 基准)，即"越松越正"；
       * The sign of evidence is (your VPIP − baseline), i.e. "the looser, the more positive";
       * 而偷盲要的是"你越紧越偷"，所以这里取反。
       * but stealing wants "the tighter you are, the more it steals", so the sign is inverted here. */
      {
        const ev = evidence(S.vpip, S.hands, BASE.vpip);
        const mag = clamp(Math.abs(m.raw.vpip - BASE.vpip) / 0.10, 0, 2);
        const tightSignal = -ev * mag;          // > 0 = 你偏紧 → 多偷盲 / > 0 = you are too tight → steal more
        if (tightSignal > 0) ex.stealBoost += tightSignal * 0.42;
        else ex.stealBoost += tightSignal * 0.22;
      }
      /* 3. 面对 3-bet 的弃牌率 → 3-bet 诈唬频率（方向同第 1 项，s>0 = 你爱弃）
       * 3. fold-to-3-bet rate → 3-bet bluff frequency (direction as in item 1, s>0 = you fold a lot) */
      {
        const ev = evidence(S.foldTo3Bet, S.foldTo3BetOpp, BASE.foldTo3Bet);
        const mag = clamp(Math.abs(m.foldTo3Bet - BASE.foldTo3Bet) / 0.15, 0, 1.6);
        const s = ev * mag;
        if (s > 0) ex.threeBetBluffBoost += s * 0.95;
        else ex.threeBetBluffBoost += s * 0.55;
      }

      /* 刻意**不**为 riverCall 单独加一项调整。
         Deliberately **no** separate adjustment for riverCall.
         河牌跟注率与"面对下注的弃牌率"说的是同一件事（两者互补），
         The river call rate and the "fold-to-bet rate" describe the same thing (they are complementary),
         同时生效等于把同一种行为计两遍，调整幅度会被放大到失控。
         applying both would count the same behavior twice and blow the adjustment magnitude out of control.
         河牌数据只用于漏洞卡片展示，不参与剥削权重。
         River data is used only for leak card display and does not feed into the exploit weights.
         一个行为 → 一项调整，这是这里必须守住的对应关系。
         One behavior → one adjustment: this correspondence must be maintained here. */

      /* 上下限保护
       * upper and lower bound protection */
      ex.bluffBoost = clamp(ex.bluffBoost, 0.15, 3.2);
      ex.sizeBoost = clamp(ex.sizeBoost, 0.82, 1.45);
      ex.thinValue = clamp(ex.thinValue, 0, 0.22);
      ex.stealBoost = clamp(ex.stealBoost, 0.65, 2.0);
      ex.threeBetBluffBoost = clamp(ex.threeBetBluffBoost, 0.35, 3.0);
      ex.callDownBoost = clamp(ex.callDownBoost, 0.75, 1.35);

      /* 综合置信度取各项里最高的"有样本"程度，供界面显示
       * overall confidence takes the highest "has-sample" degree across items, for UI display */
      let conf = 0;
      const bump = (opp) => { conf = Math.max(conf, confidence(opp)); };
      bump(o.facedBet); bump(o.preflop); bump(o.foldTo3Bet); bump(o.river);
      ex.confidence = o.hands < MIN_OPP ? 0 : conf;
      return ex;
    }

    /** 一句话人话总结，给界面用
     * One plain-language summary sentence, for the UI */
    function summary() {
      const m = metrics();
      const o = m.opp;
      const ex = exploit();
      if (ex.confidence <= 0) {
        return { stage: 'warming', confidence: 0,
          text: '还在观察你（已记录 ' + o.hands + ' / ' + MIN_OPP + ' 手），暂不做针对性调整。' };
      }
      const bits = [];
      if (ex.bluffBoost > 1.15) bits.push('它们会更多地诈唬你');
      else if (ex.bluffBoost < 0.85) bits.push('它们很少对你诈唬了');
      if (ex.stealBoost > 1.15) bits.push('后位偷盲更凶');
      if (ex.threeBetBluffBoost > 1.2) bits.push('用弱牌 3-bet 你变多');
      if (ex.thinValue > 0.05) bits.push('会用中等牌力做薄价值下注');
      if (ex.callDownBoost > 1.08) bits.push('你的持续下注更容易被跟到底');
      if (!bits.length) bits.push('暂时没发现明显可利用的漏洞');
      return {
        stage: ex.confidence > 0.6 ? 'active' : 'ramping',
        confidence: ex.confidence,
        text: '样本 ' + o.hands + ' 手（置信度 ' + Math.round(ex.confidence * 100) + '%）：' + bits.join('、') + '。',
        exploit: ex,
      };
    }

    return {
      startHand, markPreflop, observe, endHand, reset,
      metrics, leaks, exploit, summary,
      get stats() { return S; },
      /**
       * 恢复存档。**必须从 emptyStats() 出发逐字段拷贝**，不能直接
       * Restore a save. **Must start from emptyStats() and copy field by field**; do not directly
       * Object.assign(emptyStats(), v)：那是浅合并，v.faced 会把整个
       * Object.assign(emptyStats(), v): that is a shallow merge, and v.faced would replace the entire
       * faced 对象替换掉。存档若缺了某一街（旧版本存档、手工改坏、
       * faced object. If the save is missing some street (an old-version save, a hand-edited one,
       * 或"只存了部分字段"），facedTotal() 就会读 undefined.opp 抛异常，
       * or "only some fields saved"), facedTotal() will read undefined.opp and throw,
       * 表现为"我的漏洞"面板直接打不开。
       * showing up as the "my leaks" panel simply refusing to open.
       * 结构合法性只在这一处保证，storage.js 不再重复定义字段形状。
       * Structural validity is guaranteed only here; storage.js no longer redefines the field shapes.
       */
      set stats(v) {
        const s = emptyStats();
        if (v && typeof v === 'object') {
          for (const k of Object.keys(s)) {
            if (k === 'faced') continue;
            if (v[k] !== undefined) s[k] = v[k];
          }
          if (v.faced && typeof v.faced === 'object') {
            for (const st of ['flop', 'turn', 'river']) {
              const src = v.faced[st];
              if (src && typeof src === 'object') {
                s.faced[st] = Object.assign({ opp: 0, fold: 0 }, src);
              }
            }
          }
        }
        S = s;
        preflopMarked = false;
      },
    };
  }

  const singleton = create();

  PK.Profile = {
    create,
    BASE, MIN_OPP, FULL_OPP, PRIOR_N, TOPIC_FOR, Z_REPORT,
    emptyStats, smoothed, confidence, zScore, evidence,
    /* 单例：游戏内使用
     * singleton: used in-game */
    startHand: () => singleton.startHand(),
    markPreflop: (o) => singleton.markPreflop(o),
    observe: (o) => singleton.observe(o),
    endHand: (r) => singleton.endHand(r),
    reset: () => singleton.reset(),
    metrics: () => singleton.metrics(),
    leaks: () => singleton.leaks(),
    exploit: () => singleton.exploit(),
    summary: () => singleton.summary(),
    get stats() { return singleton.stats; },
    set stats(v) { singleton.stats = v; },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PK;
})(typeof globalThis !== 'undefined' ? globalThis : this);
