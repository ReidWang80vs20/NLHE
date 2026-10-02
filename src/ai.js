/* ============================================================
 * ai.js — 电脑对手决策模型
 *         Computer-opponent decision model
 *
 * 与"用原始胜率对比底池赔率"的朴素做法不同，这里的做法贴近实战：
 * Unlike the naive "compare raw equity against pot odds" approach, this one stays close to real play:
 *   翻前：位置 + 起手牌百分位 → 开池/3bet/跟注 范围表
 *   Preflop: position + starting-hand percentile → open/3-bet/call range tables
 *   翻后：胜率（对手手牌限制在其可能范围内）× 底池赔率
 *   Postflop: equity (opponent hands restricted to a plausible range) × pot odds
 * 这样 AI 不会因为"任意两张牌对随机牌都有 1/6 胜率"而变成跟注站。
 * This keeps the AI from turning into a calling station because "any two cards have ~1/6 equity versus a random hand".
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK || (global.PK = {});

  /* ---------------- 人格档案 ----------------
   *                  Personality profiles
   * rangeMul   —— 开池范围的宽窄倍数（1.0 = 标准紧凶）
   *              Width multiplier for the open-raising range (1.0 = standard tight-aggressive)
   * threeBet   —— 再加注范围的百分位上限
   *              Percentile ceiling of the 3-bet range
   * callRange  —— 面对加注时的跟注范围基准
   *              Baseline calling range when facing a raise
   * cheapCall  —— 便宜看牌（补盲/小注）的百分位上限
   *              Percentile ceiling for cheap flops (completing the blind / small bets)
   * aggr       —— 有牌时选择"加注"而非"跟注"的概率
   *              Probability of raising rather than calling when holding a hand
   * bluff      —— 无牌时下注/加注的频率
   *              Frequency of betting/raising when holding nothing
   * callMargin —— 跟注要求胜率高出底池赔率的余量（纪律性）
   *              Equity margin required above pot odds in order to call (discipline)
   * stickiness —— 情绪化跟注的宽容度（0 = 完全按赔率）
   *              Tolerance for emotional (sticky) calls (0 = strictly by the odds)
   */
  const STYLES = {
    rock: {
      key: 'rock', name: '岩石', avatar: '🪨', tag: '极紧·很少诈唬',
      rangeMul: 0.52, threeBet: 0.030, callRange: 0.13, cheapCall: 0.20,
      aggr: 0.95, bluff: 0.02, callMargin: 0.07, raiseFrac: 0.60, stickiness: 0.00,
    },
    tag: {
      key: 'tag', name: '紧凶', avatar: '🎯', tag: '教科书式打法',
      rangeMul: 0.88, threeBet: 0.055, callRange: 0.18, cheapCall: 0.42,
      aggr: 1.00, bluff: 0.08, callMargin: 0.04, raiseFrac: 0.72, stickiness: 0.02,
    },
    lag: {
      key: 'lag', name: '松凶', avatar: '🔥', tag: '范围宽·进攻性强',
      rangeMul: 1.25, threeBet: 0.090, callRange: 0.26, cheapCall: 0.60,
      aggr: 1.20, bluff: 0.19, callMargin: 0.01, raiseFrac: 0.82, stickiness: 0.035,
    },
    calling: {
      key: 'calling', name: '跟注站', avatar: '🐟', tag: '爱跟注·极少加注',
      rangeMul: 0.62, threeBet: 0.025, callRange: 0.28, cheapCall: 0.70,
      aggr: 0.40, bluff: 0.02, callMargin: -0.04, raiseFrac: 0.55, stickiness: 0.09,
    },
    maniac: {
      key: 'maniac', name: '疯子', avatar: '🎲', tag: '高频加注·重度诈唬',
      rangeMul: 2.30, threeBet: 0.260, callRange: 0.30, cheapCall: 0.78,
      aggr: 1.45, bluff: 0.30, callMargin: -0.06, raiseFrac: 1.00, stickiness: 0.05,
    },
  };
  /* stickiness 是"情绪化跟注"的宽容度。历史上曾把跟注站调到 0.13、疯子 0.06，
     依据是"WTSD 冲到 88~93%"—— 那个 WTSD 是错的（见 test/diag-style.js 顶部说明：
     分子把"自己弃牌、别人摊牌"也算进来了）。修正口径后 WTSD 本来就落在合理区间，
     所以这里只需要保留少量性格区分度，不需要靠它压指标。
     rangeMul 同理：修正口径后 WTSD 不再超标，于是把之前为压制 WTSD 而调紧的
     开池范围回调（tag 1.00→0.88、lag 1.45→1.25、calling 0.75→0.62 是为了把
     VPIP 收进参考区间，与 WTSD 无关）。
     stickiness is the tolerance for "emotional calling". Historically it was set to 0.13 for the
     calling station and 0.06 for the maniac, based on "WTSD spiking to 88-93%" — but that WTSD was
     wrong (see the note at the top of test/diag-style.js: the numerator also counted "we folded, others
     showed down"). After fixing the accounting WTSD already fell into a reasonable range, so here we
     only keep a little personality differentiation rather than using it to push metrics down.
     rangeMul likewise: once WTSD is no longer out of bounds, the open ranges previously tightened to
     suppress WTSD are rolled back (tag 1.00→0.88, lag 1.45→1.25, calling 0.75→0.62 — these changes
     bring VPIP into the reference band and are unrelated to WTSD). */
  const STYLE_KEYS = ['rock', 'tag', 'lag', 'calling', 'maniac'];
  /* 名字池要够 9 人桌用（8 个电脑玩家），否则会出现两个同名对手 */
  /* The name pool must be large enough for a 9-handed table (8 computer players), otherwise two opponents end up with the same name */
  const AI_NAMES = ['老岩石', '李紧凶', '王松凶', '陈跟注', '赵疯子',
                    '孙学者', '周稳健', '吴半仙', '郑新人'];

  /* ---------------- 位置与范围 ---------------- */
  /* ---------------- Position & ranges ---------------- */

  /** 位置系数：0 = 最早行动，1 = 按钮位 */
  /** Position factor: 0 = earliest to act, 1 = button */
  function positionFrac(seat, button, n) {
    const order = (seat - button - 1 + n) % n;   // 0 = 小盲 / 0 = small blind
    return n > 2 ? order / (n - 1) : order;
  }

  /**
   * 翻前「身后还有几人未行动」——决定开池范围的宽窄。
   * How many players are still to act behind us preflop — this determines how wide the open range is.
   *
   * ⚠️ 这里必须按**行动顺序**数，不能按座位编号数。
   *   翻前的行动顺序是「大盲的下家 → … → 按钮 → 小盲 → 大盲」，与座位编号顺序
   *   并不一致。而且每手开始时所有人都还没弃牌，若只按座位往后数、不看位置，
   *   结果恒等于 (人数-1)，这个函数会退化成常数 —— 于是按钮位也拿着
   *   枪口位 12% 的范围开池（correct 值应为 37%），PFR 被压低、VPIP 被抬高。
   *   详见 test/probe-behind.js。
   * ⚠️ This must be counted in **action order**, never by seat number.
   *   The preflop action order is "the player after the big blind → … → button → small blind → big blind",
   *   which does not match seat-number order. Moreover, nobody has folded at the start of a hand, so
   *   counting only by seat and ignoring position always yields (players - 1), degenerating this function
   *   into a constant — the button would then open with the UTG 12% range (the correct value is 37%),
   *   PFR is suppressed and VPIP is inflated. See test/probe-behind.js for details.
   *
   * @param {number} seat
   * @param {Array} players
   * @param {number} button 按钮位座位号（2 人桌时为小盲）
   * @param {number} button Button seat number (the small blind in heads-up play)
   */
  function playersBehind(seat, players, button) {
    const n = players.length;
    if (n <= 1) return 0;
    const twoHanded = n === 2;
    const bb = twoHanded ? (button + 1) % n : (button + 2) % n;
    const first = twoHanded ? button : (bb + 1) % n;   // 与 engine._firstPreflopActor 一致 / consistent with engine._firstPreflopActor

    let myIdx = 0;
    for (let i = 0; i < n; i++) { if ((first + i) % n === seat) { myIdx = i; break; } }

    let cnt = 0;
    for (let i = myIdx + 1; i < n; i++) {
      const p = players[(first + i) % n];
      if (p && !p.folded && !p.allIn) cnt++;
    }
    return cnt;
  }

  /**
   * 开池范围基准（**手牌组合占比**，越小越紧）
   * Baseline open range (**share of hand combos**; smaller = tighter)
   * 下标 = 身后未行动人数（0 = 大盲，5 = 枪口）
   * Index = number of players still to act behind (0 = big blind, 5 = UTG)
   * 参考：6 人桌标准紧凶开池范围
   * Reference: standard tight-aggressive open range for a 6-handed table
   *   枪口 12% / 中位 16% / 关煞 22% / 按钮 42% / 小盲 44%
   *   UTG 12% / MP 16% / CO 22% / BTN 42% / SB 44%
   *
   * ⚠️ 这些数字是"前 X% 的**手牌**"，而下面比较用的 pct2() 是**类别百分位**
   *   （169 类各占 1/169）。必须经 classPctForCombos() 换算，否则范围会
   *   被收得比设计值紧一档 —— 实测会让 VPIP 偏低约 4~6 个百分点。
   * ⚠️ These numbers are "the top X% of **hand combos**", whereas pct2() used for comparison below
   *   is a **class percentile** (each of the 169 classes has weight 1/169). They must be converted via
   *   classPctForCombos(), otherwise the range ends up one notch tighter than intended — measured to
   *   lower VPIP by about 4-6 percentage points.
   */
  const OPEN_BY_BEHIND = [0.50, 0.44, 0.42, 0.22, 0.16, 0.12];

  /**
   * 把"手牌组合占比"换算成可与 pct2() 比较的类别百分位。
   * Convert a "share of hand combos" into a class percentile comparable with pct2().
   * range.js 未加载时退回恒等映射（只是范围偏紧，不会崩），
   * If range.js is not loaded, fall back to the identity mapping (the range is merely tighter, no crash),
   * 但正常加载顺序下（poker → equity → range → profile → ai）不会走到这里。
   * but under the normal load order (poker → equity → range → profile → ai) this branch is never reached.
   */
  function toClassPct(frac) {
    if (PK.Range && typeof PK.Range.classPctForCombos === 'function') {
      return PK.Range.classPctForCombos(frac);
    }
    return frac;
  }

  /**
   * 当前开池范围（已按人格放宽/收紧、并换算成类别百分位）
   * Current open range (widened/tightened by personality, then converted to a class percentile)
   * @param {number} behind 身后未行动人数
   * @param {number} behind number of players still to act behind
   * @param {object} style
   * @param {number} [boost] 额外倍数（偷盲等）
   * @param {number} [boost] extra multiplier (stealing blinds, etc.)
   */
  function openRangeFor(behind, style, boost) {
    const base = OPEN_BY_BEHIND[Math.min(behind, OPEN_BY_BEHIND.length - 1)];
    const frac = Math.min(0.90, base * style.rangeMul * (boost === undefined ? 1 : boost));
    return toClassPct(frac);
  }

  /**
   * 对手"下注"范围模型
   * Opponent "betting" range model
   *
   * 两个事实决定了 AI 不能把对手当随机牌：
   * Two facts mean the AI must not treat opponents as random hands:
   *   1. 能进入这一手的牌，本身就不在翻前范围的边缘之外（rangePct）
   *   1. Hands that reach this spot are already inside the preflop range, not beyond its edge (rangePct)
   *   2. 愿意下注的牌，多半在牌面上"有内容"（minCat = 最低牌型等级）
   *   2. Hands willing to bet usually "have something" on the board (minCat = minimum hand category)
   * 再留一部分纯诈唬（bluffFrac），否则 AI 会把所有对手都当成有牌，
   * 从而过紧；反过来只按随机牌算，就会无脑跟注到底（跟注站）。
   * A fraction of pure bluffs (bluffFrac) is kept as well; otherwise the AI treats every opponent as
   * having a hand and becomes too tight, while counting only random hands makes it call everything
   * down (a calling station).
   *
   * @returns {{rangePct:number, minCat:number, bluffFrac:number}}
   */
  function opponentModel(G, nOpp) {
    const raised = G.raiseCount > 1;
    let rangePct, minCat, bluffFrac;

    /* minCat 的选取要贴合各街的真实下注范围：
       The choice of minCat should match each street's real betting ranges:
       翻牌圈大量持续下注，一对甚至空气都算（minCat 1）；
       The flop has plenty of continuation bets, so a pair or even air counts (minCat 1);
       转牌圈一对仍会为保护牌力下注（minCat 1）；
       On the turn a pair still bets to protect its strength (minCat 1);
       **河牌圈**则基本是两极化的——两对以上的价值牌，或者纯诈唬，
       单凭一对在河牌主动下注价值的情况很少见。
       **The river** is mostly polarized — value hands of two pair or better, or pure bluffs; betting
       a single pair for value on the river is rarely seen.
       原先河牌也按 minCat 1 建模，会让 AI 系统性高估自己的胜率，
       Modeling the river with minCat 1 as well made the AI systematically overestimate its equity,
       进而跟注过多，WTSD 明显高于真实玩家。
       and therefore call too much, pushing WTSD clearly above that of real players. */
    if (G.street === 'flop')      { rangePct = 0.62; minCat = 1; bluffFrac = 0.48; }
    else if (G.street === 'turn') { rangePct = 0.48; minCat = 1; bluffFrac = 0.21; }
    else                          { rangePct = 0.38; minCat = 2; bluffFrac = 0.16; }

    if (raised) {
      rangePct *= 0.60;
      minCat = Math.min(3, minCat + 1);      // 被加注 → 对手八成是两对以上或纯诈唬 / raised → villain is very likely two pair or better, or a pure bluff
      bluffFrac *= 0.50;
    }
    rangePct *= Math.pow(0.88, Math.max(0, nOpp - 1));   // 多人下注，范围交集更强 / multiway betting → stronger range intersection

    return {
      rangePct: Math.max(0.05, Math.min(0.95, rangePct)),
      minCat: minCat,
      bluffFrac: bluffFrac,
    };
  }

  /** 对手尚未表态时的范围（用于"我要不要主动下注"） */
  /** Range when the opponent has not acted yet (used for "should I bet out?") */
  function passiveModel(nOpp) {
    return { rangePct: 0.80, minCat: 0, bluffFrac: 1.0 };
  }

  /* ---------------- 下注尺度 ---------------- */
  /* ---------------- Bet sizing ---------------- */

  /** 计算加注到的总额（翻后：按底池比例） */
  /** Compute the total amount to raise to (postflop: as a fraction of the pot) */
  function raiseTarget(G, me, frac) {
    const bb = G.cfg.bb;
    const toCall = Math.max(0, G.currentBet - me.bet);
    const minTarget = G.currentBet + Math.max(G.lastRaiseSize, bb);
    let target = G.currentBet + (G.pot + toCall) * frac;
    target = Math.round(target / bb) * bb;
    if (target < minTarget) target = minTarget;
    const maxTarget = me.bet + me.stack;
    /* "加注额接近剩余筹码就直接全下"只在短筹码成立（≤50bb）。
       深筹码下一刀切会把正常的 3/4 底池加注扭曲成超额全下，
       既不拟真，也污染复盘与 EV 损失统计的参照系。
       "Shove when the raise approaches the remaining stack" holds only for short stacks (≤50bb).
       With deep stacks a blanket rule distorts a normal 3/4-pot raise into an oversized shove, which is
       neither realistic nor good for the reference frame of hand reviews and EV-loss statistics. */
    if (maxTarget <= 50 * bb && target >= maxTarget * 0.72) target = maxTarget;
    if (target > maxTarget) target = maxTarget;
    return Math.min(target, maxTarget);
  }

  /** 翻前加注尺度：开池 2.5BB + 每个溜入者 1BB；再加注为当前注的 3 倍 */
  /** Preflop raise sizing: open 2.5BB + 1BB per limper; a 3-bet is 3x the current bet */
  function preflopRaiseTarget(G, me) {
    const bb = G.cfg.bb;
    const maxTarget = me.bet + me.stack;
    const minTarget = Math.min(G.currentBet + Math.max(G.lastRaiseSize, bb), maxTarget);
    let target;
    if (G.raiseCount === 0) {
      let limpers = 0;
      for (const p of G.players) {
        if (p.seat !== me.seat && !p.folded && p.bet > 0 && p.bet <= bb) limpers++;
      }
      target = bb * (2.5 + limpers);
    } else {
      target = G.currentBet * 3;
    }
    if (target < minTarget) target = minTarget;
    /* 同上：翻前的"接近全下就直接推"也只在短筹码生效 */
    /* Same as above: the preflop "shove when close to all-in" rule also applies only to short stacks */
    if (maxTarget <= 50 * bb && target >= maxTarget * 0.82) target = maxTarget;
    if (target > maxTarget) target = maxTarget;
    return target;
  }

  /** 统一返回加注/全下动作 */
  /** Uniformly return a raise / all-in action */
  function raiseAction(G, me, target, note) {
    const maxTarget = me.bet + me.stack;
    if (target >= maxTarget) return { action: 'allin', amount: maxTarget, note: note };
    return { action: 'raise', amount: target, note: note };
  }

  /* ---------------- 针对性剥削（读玩家漏洞画像） ---------------- */
  /* ---------------- Targeted exploitation (reads the player's leak profile) ---------------- */

  /** 中性权重：没有画像模块、或样本不足时，一切调整都等于"什么都没做" */
  /** Neutral weights: with no profile module or too few samples, every adjustment equals "do nothing" */
  const NEUTRAL_EX = {
    bluffBoost: 1, sizeBoost: 1, thinValue: 0, stealBoost: 1,
    threeBetBluffBoost: 1, callDownBoost: 1, confidence: 0,
  };

  function exploitEnv() {
    try {
      if (PK.Profile && typeof PK.Profile.exploit === 'function') {
        /* 兜底合并：画像若缺字段，一律按中性处理，
           避免画像改结构后 AI 静默失灵或读到 undefined 变成 NaN
           Fallback merge: if the profile is missing fields, treat everything as neutral, to avoid the AI
           silently breaking or reading undefined→NaN after a profile schema change. */
        return Object.assign({}, NEUTRAL_EX, PK.Profile.exploit());
      }
    } catch (e) { /* 画像算错绝不能拖垮 AI 决策，退回不剥削 */ }
    /* A profile computation error must never break AI decisions; fall back to no exploit */
    return NEUTRAL_EX;
  }

  /**
   * 下注尺度抖动（±15% 上下）。
   * Bet-sizing jitter (roughly ±15%).
   * 真人不会每次都用同一个比例下注；固定尺度既容易被读，也浪费了
   * "尺度本身是信息"这一训练点。尺度变化只加在翻后，
   * 翻前仍按 2.5BB / 3 倍的标准尺度，以免打乱开池范围的口径。
   * Real players do not bet the same fraction every time; a fixed size is both easy to read and wastes
   * the training point that "the size itself is information". Jitter is applied postflop only, while
   * preflop keeps the standard 2.5BB / 3x sizing so the open-range calibration is not disturbed.
   */
  const SIZE_JITTER = [0.86, 0.94, 1.0, 1.07, 1.16];
  function jitterFrac(base) {
    return base * SIZE_JITTER[(Math.random() * SIZE_JITTER.length) | 0];
  }

  /* ---------------- 决策核心 ---------------- */
  /* ---------------- Decision core ---------------- */
  /**
   * @param {object} ctx 决策上下文
   * @param {object} ctx decision context
   * @returns {{action:string, amount:number, eq:number, note:string}}
   */
  function coreDecide(ctx) {
    const st = ctx.style;
    const ex = ctx.ex || NEUTRAL_EX;
    const rnd = Math.random;
    const G = ctx.G, me = ctx.me;
    const toCall = ctx.toCall;
    const nOpp = Math.max(1, ctx.nOpp);
    const potOdds = toCall > 0 ? toCall / (ctx.pot + toCall) : 0;

    /* ================= 翻前 ================= */
    /* ================= Preflop ================= */
    if (ctx.street === 'preflop') {
      const pct = ctx.pct;                    // 0 = AA，1 = 32o / 0 = AA, 1 = 32o
      const posFrac = ctx.posFrac;
      const behind = ctx.behind;
      const isPair = ctx.isPair;
      const bb = G.cfg.bb;
      const effStack = me.stack + me.bet;
      /* 是否已经投过盲注。"补盲"这条路径在语义上只属于盲注位玩家；
         见下方说明。
         Whether we have already posted a blind. The "complete the blind" path semantically belongs only
         to blind-position players; see the note below. */
      const isBlind = me.seat === G.sbSeat || me.seat === G.bbSeat;

      /* --- 无人加注（含溜入局） --- */
      /* --- No raise (including limped pots) --- */
      if (ctx.raiseCount === 0) {
        /* 偷盲：身后只剩 1~2 人未行动时，才把"你偏紧"这条漏洞转成开池范围放宽。
           早位放宽毫无意义（后面一堆人等着反击）。
           Steal: only when just 1-2 players remain behind does "you are too tight" translate into a
           wider open range. Loosening from early position is pointless (a crowd behind waits to
           fight back). */
        const steal = behind <= 2 ? ex.stealBoost : 1;

        if (toCall === 0) {
          /* 大盲免费看牌：只用超强牌主动加注，否则看牌 */
          /* Big blind gets a free look: raise only with premium hands, otherwise check */
          const openR = openRangeFor(behind, st, steal);
          if (pct < openR * 0.55 && rnd() < st.aggr) {
            return raiseAction(G, me, preflopRaiseTarget(G, me), '大盲加注');
          }
          return { action: 'check', note: '免费看牌' };
        }

        /* 可开池：小盲补盲 / 加注隔离溜入者 */
        /* Openable: small blind completes / raise to isolate limpers */
        const openR = Math.min(0.92, openRangeFor(behind, st, steal));
        if (pct < openR) {
          /* aggr 越高越倾向加注；否则溜入跟注（跟注站的典型行为） */
          /* The higher aggr, the more it raises; otherwise it limps and calls (typical calling-station behavior) */
          if (rnd() < Math.min(1, st.aggr)) {
            return raiseAction(G, me, preflopRaiseTarget(G, me),
              steal > 1.2 ? '偷盲加注' : '开池加注');
          }
          return { action: 'call', note: '溜入' };
        }
        /* 便宜补盲：小盲只花半个盲注就能看翻牌，按人格放宽。
           ⚠️ 必须限定在**盲注位**。原先只判断 toCall <= bb，而"无人加注"时
           所有人都满足 toCall <= bb（按钮位面对大盲也是 toCall = bb），
           于是每个人都在用 cheapCall 溜入 —— 跟注站 0.70、疯子 0.78，
           也就是拿七八成手牌溜入。这是 VPIP 虚高、PFR 塌陷的第二个原因。
           Cheap completion: the small blind can see a flop for half a blind, widened by personality.
           ⚠️ It must be restricted to the **blind seats**. The original code only checked toCall <= bb,
           and when nobody raised everyone satisfies toCall <= bb (the button facing the big blind also
           has toCall = bb), so everyone limped using cheapCall — 0.70 for the calling station, 0.78
           for the maniac — i.e. limping with 70-80% of hands. This is the second cause of inflated
           VPIP and collapsed PFR. */
        if (isBlind && toCall <= bb && pct < st.cheapCall) {
          return { action: 'call', note: '补盲看牌' };
        }
        return { action: 'fold', note: '牌力不足' };
      }

      /* --- 面对加注 --- */
      /* --- Facing a raise --- */
      const posTerm = 0.60 + posFrac * 1.00;
      const price = toCall / bb;
      const priceFactor = Math.max(0.45, Math.min(1.30, 2.5 / Math.max(0.6, price)));
      const threeBetR = st.threeBet * (0.70 + posFrac * 0.70);

      if (pct < threeBetR && rnd() < Math.min(1, st.aggr) && me.stack > toCall) {
        return raiseAction(G, me, preflopRaiseTarget(G, me), '再加注');
      }

      /* 极化 3-bet 诈唬：用"有阻断、有可玩性、但强度一般"的牌去 3-bet。
         这是剥削"怕 3-bet 的玩家"的主力手段 —— 光靠放宽百分位阈值做不到，
         因为那些真正的 3-bet 诈唬牌（A5s / 76s）在百分位排名里并不靠前。
         Polarized 3-bet bluff: 3-bet with hands that "block, have playability, but only average strength".
         This is the main tool for exploiting "players who fear 3-bets" — loosening the percentile
         threshold alone cannot do it, because the true 3-bet bluff hands (A5s / 76s) do not rank high in
         the percentile list. */
      if (ctx.raiseCount === 1 && ctx.key && PK.Range && PK.Range.BLUFF_3BET.has(ctx.key) &&
          me.stack > toCall * 2) {
        const p3 = Math.min(0.62, 0.09 * ex.threeBetBluffBoost * (0.5 + st.bluff * 2.5));
        if (rnd() < p3) return raiseAction(G, me, preflopRaiseTarget(G, me), '3-bet 诈唬');
      }

      let callR = st.callRange * posTerm * priceFactor;
      /* behind 现在按行动顺序正确计算，<=1 就真的只落在小盲/大盲身上，
         盲注位防守更宽是合理的，恢复 1.35。
         behind is now computed correctly in action order; <=1 truly applies only to the small/big blind,
         and defending wider from the blinds is reasonable, so 1.35 is restored. */
      if (behind <= 1) callR *= 1.35;
      if (ctx.raiseCount >= 2) callR *= 0.72;                // 面对多次加注需收紧 / tighten when facing multiple raises
      /* 上限保护：posTerm(≤1.6) × priceFactor(≤1.30) × 盲注加成 能把基准放大到
         0.5 以上，等于"什么牌都防守"。真实玩家即便在盲注位也不会用半副牌跟加注。
         Cap protection: posTerm(≤1.6) × priceFactor(≤1.30) × blind bonus can inflate the baseline above
         0.5, meaning "defend with anything". Even real players in the blinds will not call a raise with
         half the deck. */
      callR = Math.min(callR, 0.55);
      /* 对手爱弃牌 → 我们的边缘跟注交替换成"以后更多的偷鸡"不划算；
         这里只在对方极爱跟注（callDownBoost 高）时放宽跟注范围
         Opponents who fold a lot → trading our marginal calls for "more steals later" is not worth it;
         we only widen the calling range when the opponent loves to call (high callDownBoost). */
      if (ex.callDownBoost > 1.05) callR = Math.min(0.60, callR * Math.min(1.25, ex.callDownBoost));

      if (pct < callR) return { action: 'call', note: '范围合适' };

      /* 小对子便宜凑三条：20:1 的隐含赔率支撑 */
      /* Cheap set-mining with small pairs: supported by 20:1 implied odds */
      if (isPair && toCall <= effStack * 0.05) return { action: 'call', note: '小对子凑三条' };
      /* 极小代价收尾：同"补盲"，只对盲注位成立（盲注已经投过钱，补足到当前注最便宜） */
      /* Closing for a tiny price: same as "completing the blind", valid only for blind seats (they have already posted, so matching the current bet is cheapest) */
      if (isBlind && toCall <= bb && pct < st.cheapCall * 0.75) {
        return { action: 'call', note: '便宜跟注' };
      }
      return { action: 'fold', note: '范围外弃牌' };
    }

    /* ================= 翻后 ================= */
    /* ================= Postflop ================= */
    const eq = ctx.equity;
    const posAdj = (ctx.posFrac - 0.5) * 0.03;
    const bluff = st.bluff * ex.bluffBoost;          // 剥削后的诈唬频率 / bluff frequency after exploitation
    const size = (f) => raiseTarget(G, me, jitterFrac(f * ex.sizeBoost));

    /* --- 无人下注：我来决定是否下注 --- */
    /* --- No bet yet: I decide whether to bet --- */
    if (toCall === 0) {
      if (eq > 0.75) return raiseAction(G, me, size(st.raiseFrac * 0.95), '价值下注（强牌）');
      /* 薄价值：对手爱跟注（thinValue > 0）时，把下注门槛往下放，
         用中等牌力榨取跟注站的钱
         Thin value: when the opponent loves to call (thinValue > 0), lower the betting threshold to
         extract money from calling stations with medium-strength hands. */
      if (eq > 0.58 - ex.thinValue && rnd() < st.aggr) {
        return raiseAction(G, me, size(st.raiseFrac * 0.72),
          ex.thinValue > 0.04 ? '薄价值下注' : '价值下注');
      }
      /* 有牌力或强听牌时持续下注 */
      /* Continuation-bet with a made hand or a strong draw */
      if (ctx.tier >= 2 && rnd() < st.aggr * 0.72) return raiseAction(G, me, size(0.55), '持续下注');
      /* 中等成牌（一对）也要主动下注，否则会把底池主动权让出去 */
      /* Bet with medium made hands (one pair) too, or otherwise we give up control of the pot */
      if (ctx.tier >= 1 && eq > 0.48 && rnd() < st.aggr * 0.62) {
        return raiseAction(G, me, size(0.50), '持续下注');
      }
      /* 半诈唬：听牌型下注 */
      /* Semi-bluff: bet with drawing hands */
      if (ctx.tier >= 1 && rnd() < bluff * 1.3 * st.aggr) {
        return raiseAction(G, me, size(0.55), '半诈唬');
      }
      if (rnd() < bluff * (nOpp === 1 ? 0.9 : 0.45)) {
        return raiseAction(G, me, size(0.62 * (ex.sizeBoost > 1.15 ? 1.15 : 1)), '诈唬');
      }
      return { action: 'check', note: '过牌' };
    }

    /* --- 面对下注 ---
     * --- Facing a bet ---
     * 跟注门槛 = 底池赔率 + 人格纪律余量 + 手牌分层的附加要求
     * Call threshold = pot odds + personality discipline margin + hand-tier surcharge
     * 实战常识：手上什么都没有（空气牌）时，即便底池赔率划算也要谨慎，
     * Practical wisdom: with nothing (air), be cautious even when pot odds look attractive,
     * 因为对手下注的范围强于随机，而空气牌往往"赢了赢小、输了输大"。
     * because a betting range is stronger than random, and air often "wins small, loses big".
     * 成牌与听牌（同花听牌/两头顺）不受这条附加要求约束。
     * Made hands and draws (flush draw / open-ended straight draw) are exempt from this surcharge. */
    const tierBonus = ctx.tier >= 2 ? 0 : (ctx.tier === 1 ? 0.07 : 0.16);
    /* 越到后面越贵：转牌/河牌的下注可信度远高于翻牌。
       注意：这里一度被调到 0.02/0.07/0.12，理由是"WTSD 冲到 40~50%"——
       那个 WTSD 是口径错误算出来的（见 test/diag-style.js 顶部）。修正口径后
       WTSD 本来就正常，过高的门槛只会让 AI 在转牌/河牌弃得比真人还多，
       玩家反而学不到"便宜的边缘跟注"。故回调到中间值。
       The later the street, the more it costs: turn/river bets are far more credible than flop bets.
       Note: this was once tuned to 0.02/0.07/0.12 because "WTSD spiked to 40-50%" — but that WTSD came
       from a wrong accounting (see the top of test/diag-style.js). After the fix WTSD is normal, and an
       overly high threshold only makes the AI fold more than real players on the turn/river, so the
       player never learns "cheap marginal calls". Hence reverted to the middle values. */
    const streetPressure = G.street === 'flop' ? 0.02 : G.street === 'turn' ? 0.05 : 0.08;
    /* 河牌纪律：对手在河牌下大注（≥60% 底池）几乎是两极化——要么是价值、要么是诈唬，
       而一对及以下的牌只赢诈唬那一半。这里保留一道额外门槛（比原设计略强）。
       River discipline: a large river bet (≥60% pot) is almost always polarized — value or bluff — and
       one pair or worse only beats the bluff half. An extra threshold is kept here (slightly stronger
       than the original design). */
    const riverBig = (G.street === 'river' && ctx.tier <= 1 && toCall >= 0.6 * G.pot) ? 0.05 : 0;
    /* callDownBoost：对手（真人）爱弃牌 → 他的下注更有可能是真货 → 我们要更谨慎；
       对手爱跟注/爱诈唬 → 我们的跟注更有利。用乘法表达，避免除零。
       callDownBoost: if the opponent (a human) folds a lot → their bets are more likely real → we must
       be more careful; if they love to call/bluff → our calls are more profitable. Expressed
       multiplicatively to avoid division by zero. */
    const margin = st.callMargin * (2 - ex.callDownBoost);
    const need = potOdds + margin + tierBonus + streetPressure + riverBig - posAdj;
    /* 把门槛随结果一起带出。教练面板上"跟注所需"这个数字，指的必须是这个 need
       （底池赔率 + 纪律余量 + 牌力分层 + 街头压力 − 位置修正），而不是裸的底池赔率 ——
       否则文案会写出"胜率 48% 低于跟注所需的 35%"这种字面自相矛盾的句子：
       margin + streetPressure − posAdj 恒为正、tierBonus ≥ 0，所以 need 必然大于 potOdds。
       这里只携带数据，不参与任何判断。
       Carry the threshold out together with the result. The "needed to call" number on the coach panel
       must mean this need (pot odds + discipline margin + hand tier + street pressure − position
       adjustment), not the bare pot odds — otherwise the wording produces self-contradictory sentences
       like "48% equity is below the 35% needed to call": margin + streetPressure − posAdj are always
       positive and tierBonus ≥ 0, so need is necessarily greater than potOdds. This only carries data;
       it takes no part in any decision. */
    const cont = (o) => Object.assign(o, { need, potOdds });
    if (eq > need + 0.26 && rnd() < st.aggr * 0.85) {
      return cont(raiseAction(G, me, size(st.raiseFrac), '加注施压'));
    }
    if (eq > need) return cont({ action: 'call', note: '胜率高于赔率' });
    if (eq + st.stickiness > need) return cont({ action: 'call', note: '勉强跟注' });
    /* 极小代价的关闭行动 */
    /* Closing action at a tiny price */
    if (potOdds < 0.12 && eq > need - 0.05 && rnd() < 0.6) return cont({ action: 'call', note: '赔率合适' });
    return cont({ action: 'fold', note: '不值得跟注' });
  }

  /* ---------------- 组装决策上下文 ----------------
   *                  Build the decision context
   * @param {boolean} [useExploit] 是否载入针对该玩家的剥削权重。
   * @param {boolean} [useExploit] whether to load the exploitation weights targeting this player.
   *   AI 对手用 true；给真人的教练建议必须用 false ——
   *   AI opponents use true; coaching advice for the human must use false —
   *   拿"针对你自己的漏洞"去建议你自己打牌，逻辑上是荒诞的。
   *   advising you how to play based on "exploits against your own leaks" is logically absurd.
   */
  function buildContext(G, seat, style, iters, useExploit) {
    const me = G.players[seat];
    const n = G.players.length;
    const nOpp = Math.max(1, G.players.filter(p => !p.folded && p.seat !== seat).length);
    const toCall = Math.max(0, G.currentBet - me.bet);
    const isPreflop = G.board.length === 0;

    let eq;
    if (isPreflop) {
      eq = PK.preflopEquity(PK.holeKey(me.hole[0], me.hole[1]), nOpp);
    } else {
      /* 面对下注 → 用"对手下注范围模型"；无人下注 → 对手尚未表态，范围较宽 */
      /* Facing a bet → use the "opponent betting range model"; no bet → opponent has not acted, wider range */
      const model = toCall > 0 ? opponentModel(G, nOpp) : passiveModel(nOpp);
      eq = PK.estimateEquity(me.hole, G.board, nOpp, iters, model);
    }

    const r1 = me.hole[0] >> 2, r2 = me.hole[1] >> 2;
    /* 手牌分层（0=空气 1=弱牌/卡顺 2=成牌或强听牌）
       成牌等级 cat：0=高牌 1=一对 2=两对 …
       听牌等级 draw：0=无 1=卡顺/双高张 2=同花听牌/两头顺
       Hand tier (0 = air, 1 = weak hand/gutshot, 2 = made hand or strong draw)
       Made-hand category cat: 0 = high card, 1 = one pair, 2 = two pair, …
       Draw tier draw: 0 = none, 1 = gutshot/two overcards, 2 = flush draw/open-ended straight draw */
    let tier = 0;
    if (isPreflop) {
      tier = (r1 === r2) ? 2 : 1;
    } else {
      const cat = PK.evaluate(me.hole.concat(G.board)) >> 20;
      const draw = PK.drawTier(me.hole, G.board);
      tier = cat >= 2 ? 2 : (cat === 1 ? Math.max(1, draw) : draw);
    }

    return {
      G, me, style, street: G.street, nOpp, toCall,
      pot: G.pot, equity: eq,
      pct: isPreflop ? PK.pct2(me.hole[0], me.hole[1]) : eq,
      key: PK.holeKey(me.hole[0], me.hole[1]),
      posFrac: positionFrac(seat, G.button, n),
      raiseCount: G.raiseCount,
      behind: playersBehind(seat, G.players, G.button),
      isPair: r1 === r2,
      isSuited: (me.hole[0] & 3) === (me.hole[1] & 3),
      tier: tier,
      ex: useExploit ? exploitEnv() : NEUTRAL_EX,
    };
  }

  /* ---------------- 对外：AI 行动 ---------------- */
  /* ---------------- Public: AI action ---------------- */
  function aiDecide(G, seat) {
    const me = G.players[seat];
    const st = me.style || STYLES.tag;
    const iters = G.board.length === 0 ? 0 : (G.players.filter(p => !p.folded).length >= 4 ? 420 : 700);
    const ctx = buildContext(G, seat, st, iters, true);
    const d = coreDecide(ctx);
    d.eq = ctx.equity;
    d.pct = ctx.pct;
    d.styleKey = st.key;
    d.exploit = ctx.ex.confidence > 0 ? ctx.ex : null;

    /* 兜底：任何非法动作降级为 check / fold */
    /* Fallback: downgrade any illegal action to check / fold */
    if (d.action === 'check' && ctx.toCall > 0) d.action = 'call';
    if (d.action === 'call' && ctx.toCall === 0) d.action = 'check';
    if (d.action === 'raise' && (!d.amount || d.amount <= G.currentBet)) {
      d.action = ctx.toCall > 0 ? 'call' : 'check';
    }
    if (d.action === 'fold' && ctx.toCall === 0) d.action = 'check';
    /* 短全下未重开下注轮：已行动过的玩家不得再加注（与 engine.heroAct 同规） */
    /* A short all-in does not reopen the betting round: players who have already acted may not raise again (same rule as engine.heroAct) */
    if ((d.action === 'raise' || d.action === 'allin') &&
        G.noReopen && me.acted && ctx.toCall > 0) {
      d.action = 'call';
      d.amount = undefined;
    }
    return d;
  }

  /* ---------------- 对外：教练建议（给真人用） ---------------- */
  /* ---------------- Public: coaching advice (for the human) ---------------- */
  function adviseHero(G, seat) {
    const me = G.players[seat];
    const st = STYLES.tag;                       // 建议以"紧凶标准打法"为基准 / advice is based on "standard tight-aggressive play"
    const iters = G.board.length === 0 ? 0 : 1400;
    const ctx = buildContext(G, seat, st, iters, false);   // 对真人不用剥削权重 / no exploit weights for the human
    const d = coreDecide(ctx);

    /* 展示口径：对随机手牌的胜率（与常见胜率计算器一致），便于理解 */
    /* Display convention: equity against random hands (consistent with common equity calculators), for easy understanding */
    const rawEq = G.board.length === 0
      ? PK.preflopEquity(PK.holeKey(me.hole[0], me.hole[1]), ctx.nOpp)
      : PK.estimateEquity(me.hole, G.board, ctx.nOpp, 1600);

    d.equity = rawEq;
    d.equityVsRange = ctx.equity;
    d.potOdds = ctx.toCall > 0 ? ctx.toCall / (G.pot + ctx.toCall) : 0;
    /* 面板要知道这条建议的依据是"赔率门槛"（翻后）还是"范围表"（翻前），
       两者的文案完全不同：翻前拿底池赔率解释跟注/弃牌是错的。
       The panel needs to know whether this advice rests on the "odds threshold" (postflop) or the
       "range table" (preflop); the wording differs completely: explaining a preflop call/fold with pot
       odds is wrong. */
    d.street = ctx.street;
    return d;
  }

  PK.STYLES = STYLES;
  PK.STYLE_KEYS = STYLE_KEYS;
  PK.AI_NAMES = AI_NAMES;
  PK.OPEN_BY_BEHIND = OPEN_BY_BEHIND;
  PK.NEUTRAL_EX = NEUTRAL_EX;
  PK.positionFrac = positionFrac;
  PK.playersBehind = playersBehind;
  PK.openRangeFor = openRangeFor;
  PK.opponentModel = opponentModel;
  PK.passiveModel = passiveModel;
  PK.coreDecide = coreDecide;
  PK.buildContext = buildContext;
  PK.exploitEnv = exploitEnv;
  PK.jitterFrac = jitterFrac;
  PK.aiDecide = aiDecide;
  PK.adviseHero = adviseHero;

  if (typeof module !== 'undefined' && module.exports) module.exports = PK;
})(typeof globalThis !== 'undefined' ? globalThis : this);
