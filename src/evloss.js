/* ============================================================
 * evloss.js — EV 损失复盘
 * evloss.js — EV loss review
 *
 * 回答复盘里最要紧的那个问题："这一手/这条街，我到底打错了没有，错掉多少？"
 * Answers the single most important replay question: "Did I misplay this hand / this street, and by how much?"
 *
 * 为什么不能只看胜率：
 * Why win rate alone is not enough:
 *   胜率 42% 这个数字本身不构成任何建议。同一个 42%，面对半池下注是明确跟注
 *   （需要 25% 胜率），面对两倍池下注是明确弃牌（需要 40%）。可比的统一尺度
 *   是**期望值**（EV）：把"每种动作值多少筹码"算出来，差额就是损失。
 *   A 42% win rate is not actionable by itself. The same 42% is a clear call against
 *   a half-pot bet (needs 25% equity) and a clear fold against a 2x-pot bet (needs 40%).
 *   The comparable common yardstick is **expected value** (EV): work out what each action
 *   is worth in chips, and the difference is the loss.
 *
 * ⚠️ 这是一个**单街静态估算**，不是 GTO 求解器。务必清楚它的边界：
 * ⚠️ This is a **single-street static estimate**, not a GTO solver. Be clear about its limits:
 *   1. 只算当前这条街，不含后续街的继续下注 —— 即忽略隐含赔率、被反超风险，
 *      以及"过牌之后还能再下注"这条期权。因此**河牌的估算基本是准的**
 *      （后面没牌了，静态即完整），翻牌/翻前丢掉的后续街最多，只能看方向。
 *      每个决策都带 reliability 字段标注可信度，界面必须区分展示。
 *   1. It only covers the current street, excluding further betting on later streets —
 *      i.e. it ignores implied odds, the risk of being outdrawn, and the option to bet
 *      again after checking. So **river estimates are essentially accurate** (no cards
 *      left, static is complete), while flop/preflop lose the most future streets and can
 *      only indicate direction. Each decision carries a reliability field; the UI must
 *      show this distinction.
 *   2. 对手范围由 range.js 按行动线启发式重建，不是贝叶斯推断。
 *   2. Opponent ranges are heuristically rebuilt from the action line by range.js, not by Bayesian inference.
 *   3. 对手面对我们加注时的反应（弃牌率、跟注范围）用显式的牌力门槛模型近似，
 *      见 continueRange()。参数是经验值，但单调性是真的：
 *      下注越大 → 弃牌越多；对手范围越强 → 弃牌越少。
 *   3. How opponents respond to our raise (fold frequency, calling range) is approximated
 *      by an explicit hand-strength threshold model, see continueRange(). The parameters are
 *      empirical, but the monotonicity is real: bigger bets → more folds; stronger opponent
 *      ranges → fewer folds.
 *   4. 多人底池把各家范围**合并**成一个"等效对手"，并用 nOpp 抽样近似，
 *      会低估我们的胜率，故 reliabily 直接降级。
 *   4. Multiway pots **merge** all ranges into one "equivalent opponent" and approximate with
 *      nOpp sampling, which underestimates our equity, so reliabily is downgraded outright.
 *
 * 依赖：PK.Range（range.js）、PK.evaluate / PK.drawTier（poker.js）
 * Dependencies: PK.Range (range.js), PK.evaluate / PK.drawTier (poker.js)
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK || (global.PK = {});
  const R = PK.Range;

  const ITERS = 600;            // 每次胜率模拟的次数 / iterations per equity simulation
  const RAISE_FRAC = 0.62;      // "标准加注尺度"：相对底池的比例 / "standard raise sizing": fraction of the pot
  const CACHE_KEY = '_evloss';  // 挂在记录上的缓存名（storage.js 会剥掉下划线字段）
  // EN: cache name attached to the record (storage.js strips underscore fields)

  /* ============================================================
   * 1. 对手"继续"模型
   * 1. Opponent "continue" model
   * ============================================================ */

  /**
   * 继续所需的**成牌等级**门槛，按对手的底池赔率分档。
   * The **made-hand tier** threshold required to continue, bucketed by the opponent's pot odds.
   *
   * 语义：cat 是 PK.evaluate 的牌型等级 0=高牌 1=一对 2=两对 3=三条 4=顺 5=花 6=葫芦 7=四条 8=同花顺。
   * 阈值是经验设定：赔率便宜到什么牌都看，贵到只有三条以上才值得跟。
   * 这不是求解结果，但它保证了正确的单调性（价格越贵、门槛越高）。
   * Semantics: cat is the hand class from PK.evaluate, 0=high card 1=pair 2=two pair 3=trips
   * 4=straight 5=flush 6=full house 7=quads 8=straight flush. The thresholds are empirical:
   * cheap odds let any hand continue, expensive odds mean only trips or better is worth a call.
   * This is not a solver result, but it guarantees the correct monotonicity (the more expensive,
   * the higher the threshold).
   */
  const CAT_STEPS = [
    { price: 0.16, cat: 0 },
    { price: 0.28, cat: 1 },
    { price: 0.42, cat: 2 },
    { price: Infinity, cat: 3 },
  ];

  /**
   * 翻前的继续门槛 —— 必须与翻后分开！
   * Preflop continue threshold — it MUST be kept separate from postflop!
   *
   * ★ 这是本模块最容易踩、后果最严重的坑：
   *   翻前没有公共牌，PK.evaluate 对任何两张牌都只能给出"高牌"（cat 0）：
   *   classStrength() 对全部 169 类的返回值都是 cat 0、draw 0。
   *   若沿用上面的成牌门槛，s.cat >= need 永不成立 → continueRange 算出
   *   **继续占比 0，即弃牌率 100%** → "翻前加注"永远显示为最优，
   *   任何翻前弃牌都会被判成重大失误，整个漏洞报告被污染。
   * ★ This is the easiest trap to fall into in this module, with the most serious
   *   consequences: preflop has no community cards, so PK.evaluate can only report
   *   "high card" (cat 0) for any two cards: classStrength() returns cat 0, draw 0 for all
   *   169 classes. If the made-hand threshold above were reused, s.cat >= need would never
   *   hold → continueRange would yield **0% continue share, i.e. a 100% fold rate** →
   *   "raise preflop" would always show as optimal, every preflop fold would be judged a
   *   blunder, and the whole leak report would be corrupted.
   *
   *   翻前改用**起手牌百分位**门槛。口径与 Range.topWeights 一致：按类别数切，
   *   0 = AA，0.28 约等于前 48 类（对子 + 强同花 + 强不同花）。
   *   Preflop therefore uses a **starting-hand percentile** threshold instead. The basis
   *   matches Range.topWeights: cut by class count, 0 = AA, 0.28 is roughly the top 48
   *   classes (pairs + strong suited + strong offsuit).
   */
  const PREFLOP_STEPS = [
    { price: 0.16, top: 0.70 },   // 极便宜（补盲/小注）：半副牌都看 / very cheap (complete/small bet): half the deck plays
    { price: 0.26, top: 0.45 },   // 便宜：大量同花连张与对子 / cheap: lots of suited connectors and pairs
    { price: 0.40, top: 0.28 },   // 标准开池尺度：对子 + 强高张 / standard open sizing: pairs + strong broadways
    { price: Infinity, top: 0.14 }, // 面对 3-bet/4-bet：只剩强牌 / facing a 3-bet/4-bet: only strong hands left
  ];

  /* 翻后的继续概率分级。分档越细，范围收缩得越接近真实：
     成牌够门槛 → 必继续；强听牌 → 常继续；差一档 → 常继续；
     差两档（浮牌/后门）→ 偶尔继续；弱听牌 → 偶尔继续。 */
  /* Postflop continue-probability tiers. The finer the buckets, the closer the range
     contraction is to reality: made hand meets threshold → always continue; strong draw →
     often continue; one tier short → often continue; two tiers short (float/backdoor) →
     occasionally continue; weak draw → occasionally continue. */
  const DRAW_STRONG_W = 0.70, DRAW_STRONG_PRICE = 0.38;  // 同花听牌 / 两头顺 / flush draw / open-ended straight draw
  const EDGE_W = 0.45, EDGE_PRICE = 0.45;                // 差一档的成牌 / one tier below the threshold
  const FLOAT_W = 0.15, FLOAT_PRICE = 0.28;              // 浮牌 / 后门 / float / backdoor
  const DRAW_WEAK_W = 0.35, DRAW_WEAK_PRICE = 0.28;      // 卡顺 / 双高张 / gutshot / two overcards

  function needCat(price) {
    for (let i = 0; i < CAT_STEPS.length; i++) {
      if (price < CAT_STEPS[i].price) return CAT_STEPS[i].cat;
    }
    return CAT_STEPS[CAT_STEPS.length - 1].cat;
  }

  function preflopTop(price) {
    for (let i = 0; i < PREFLOP_STEPS.length; i++) {
      if (price < PREFLOP_STEPS[i].price) return PREFLOP_STEPS[i].top;
    }
    return PREFLOP_STEPS[PREFLOP_STEPS.length - 1].top;
  }

  /**
   * 给定价格，算出对手**继续**（跟注或加注）的那部分范围，以及它在整个范围里的占比。
   * Given a price, compute the portion of the opponent's range that **continues** (calls or
   * raises), and its share of the whole range.
   *
   * @returns {{w: Float64Array, share: number}}
   *   w     —— 继续范围（按最大值归一化的权重向量，供 equityVsWeights 抽样）
   *   share —— 继续的组合占原范围的比例，故 1 - share 就是**弃牌率**
   *   w     — continue range (weight vector normalized to max, for equityVsWeights sampling)
   *   share — share of combos continuing out of the original range, so 1 - share is the **fold rate**
   *
   * 注意 "share" 必须按**组合数**加权（对子 6 / 同花 4 / 不同花 12），
   * 否则与 range.js 的 combosInRange / pctOfRange 口径不一致。
   * Note "share" must be weighted by **combo count** (pair 6 / suited 4 / offsuit 12),
   * otherwise it is inconsistent with range.js's combosInRange / pctOfRange basis.
   */
  function continueRange(weights, board, known, price) {
    const preflop = !(board && board.length);          // 没有公共牌 → 走起手牌百分位口径
    // EN: no community cards → use the preflop percentile basis
    const need = preflop ? 0 : needCat(price);
    const top = preflop ? preflopTop(price) : 0;

    const out = new Float64Array(R.N);
    let tot = 0, cont = 0;

    for (let i = 0; i < R.N; i++) {
      const wi = weights[i];
      if (wi <= 0) continue;
      const s = R.classStrength(i, board, known);
      if (s.empty) continue;                    // 被阻断牌吃光的一类，不计入分母 / wholly blocked class; not counted
      const cnt = wi * R.COMBOS[i].length;
      tot += cnt;

      let p;
      if (preflop) {
        /* 类别百分位（0 = AA）。刻意用与 Range.topWeights 相同的口径。 */
        /* Class percentile (0 = AA). Deliberately the same basis as Range.topWeights. */
        p = (i / (R.N - 1)) <= top ? 1 : 0;
      } else if (s.cat >= need) p = 1;
      else if (s.draw >= 2 && price < DRAW_STRONG_PRICE) p = DRAW_STRONG_W;
      else if (s.cat === need - 1 && price < EDGE_PRICE) p = need >= 2 ? EDGE_W : FLOAT_W;
      else if (s.cat === need - 2 && price < FLOAT_PRICE) p = FLOAT_W;
      else if (s.draw >= 1 && price < DRAW_WEAK_PRICE) p = DRAW_WEAK_W;
      else p = 0;

      if (p > 0) { out[i] = wi * p; cont += cnt * p; }
    }

    return { w: cont > 0 ? R.normalize(out) : out, share: tot > 0 ? cont / tot : 0 };
  }

  /* ============================================================
   * 2. 期望值公式（以「弃牌 = 0」为基准点，单位：筹码）
   * 2. Expected value formulas (baseline: fold = 0, unit: chips)
   * ============================================================ */

  /** 跟注：赢下行动前的底池，输掉本次跟注额 */
  /** Call: win the pot before the action, lose the amount called */
  function evCall(eq, pot, callAmt) {
    return eq * pot - (1 - eq) * callAmt;
  }

  /**
   * 加注。toAmt = 本次行动**总共投入**这一条街的筹码（不是下注额）。
   * Raise. toAmt = the chips this action **invests in total** on this street (not the bet amount).
   *  - 对手弃牌（概率 foldP）→ 直接收下行动前的底池
   *  - Opponent folds (probability foldP) → win the pot before the action outright
   *  - 被跟注（概率 1-foldP）→ 摊牌，赢时净得 pot + toAmt - callAmt，输时亏掉 toAmt
   *  - Called (probability 1-foldP) → showdown: on a win net pot + toAmt - callAmt, on a loss lose toAmt
   */
  function evRaise(eqCalled, foldP, pot, toAmt, callAmt) {
    const calledWin = pot + toAmt - callAmt;
    const called = eqCalled * calledWin - (1 - eqCalled) * toAmt;
    return foldP * pot + (1 - foldP) * called;
  }

  /* ============================================================
   * 3. 从前置状态还原（行动前的底池 / 筹码 / 已投入）
   * 3. Reconstruct prior state (pot / stack / invested before the action)
   * ============================================================ */

  /**
   * 把行动序列走一遍，为每次行动还原出**行动之前**的场面。
   * Walk the action sequence once and reconstruct the situation **before** each action.
   *
   * 为什么不能直接读 a.pot：engine.js 的 _recordAction 记的是**行动之后**的底池，
   * 而 EV 计算需要行动前的底池（下注尺度的分母、跟注赔率的分母都靠它）。
   * Why we cannot just read a.pot: engine.js's _recordAction records the pot **after** the
   * action, whereas the EV calculation needs the pot before the action (both the bet-sizing
   * denominator and the call-odds denominator rely on it).
   *
   * 为什么盲注要单独播种：p.bet 包含盲注（盲注也是 _commit 进去的），
   * 而行动序列里没有"交盲注"这一条。若从 0 起算，大盲位玩家的一次过牌会被
   * 算成"投入了一个大盲"，行动前底池随之算错。
   * Why the blinds must be seeded separately: p.bet includes the blinds (blinds are also put in
   * via _commit), but the action sequence has no "post blind" entry. If you start from 0, a check
   * by the big blind would be counted as "invested one big blind", and the pre-action pot would
   * be wrong as a result.
   */
  function walk(rec) {
    const n = rec.seats;
    const sbSeat = (rec.button + 1) % n;
    const bbSeat = (rec.button + 2) % n;

    let street = 'preflop';
    const bet = new Array(n).fill(0);
    bet[sbSeat] = rec.sb;
    bet[bbSeat] = rec.bb;

    const out = [];
    const acts = rec.actions || [];
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      if (a.street !== street) { street = a.street; bet.fill(0); }   // 换街，本街下注额清零 / new street; reset bets
      const prev = bet[a.seat] || 0;
      const invested = Math.max(0, a.betAfter - prev);
      out.push({
        i: i,
        a: a,
        street: street,
        prev: prev,                                  // 本次行动前，该玩家本街已投入 / amount already invested this street
        invested: invested,                          // 本次行动实际投入 / actual amount invested by this action
        potBefore: Math.max(0, a.pot - invested),
        stackBefore: a.stack + invested,
      });
      bet[a.seat] = a.betAfter;
    }
    return out;
  }

  /** 第 upto 次行动之前，仍未弃牌的对手座位 */
  /** Opponent seats that have not yet folded before the upto-th action */
  function liveSeatsAt(rec, upto) {
    const folded = {};
    for (let k = 0; k < upto; k++) {
      const a = rec.actions[k];
      if (a.action === 'fold') folded[a.seat] = true;
    }
    const out = [];
    for (const p of rec.players) {
      if (p.isHero) continue;
      if (!folded[p.seat]) out.push(p.seat);
    }
    return out;
  }

  /** 把多个对手的范围合并成一个"等效对手"范围 */
  /** Merge several opponents' ranges into a single "equivalent opponent" range */
  function mergeRanges(rec, seats, boardLen, upto) {
    const acc = new Float64Array(R.N);
    for (const s of seats) {
      const w = R.fromRecord(rec, s, boardLen, upto);
      for (let i = 0; i < R.N; i++) acc[i] += w[i];
    }
    return R.normalize(acc);
  }

  /* ============================================================
   * 4. 结论分级
   * 4. Verdict grading
   * ============================================================ */

  const VERDICTS = [
    { bb: 2.0, key: 'blunder', cn: '严重失误' },
    { bb: 0.8, key: 'mistake', cn: '失误' },
    { bb: 0.25, key: 'inaccuracy', cn: '轻微偏差' },
    { bb: 0, key: 'ok', cn: '可以接受' },
  ];

  function verdictOf(lossBB) {
    for (const v of VERDICTS) if (lossBB >= v.bb) return v;
    return VERDICTS[VERDICTS.length - 1];
  }

  /**
   * 估算可信度。翻牌/翻前丢掉最多后续街，河牌静态即完整，故最高。
   * 多人底池一律降级 —— 合并成一个"等效对手"会低估我们的胜率。
   * Estimate confidence. Flop/preflop lose the most future streets; the river is complete
   * statically, hence highest. Multiway pots are always downgraded — merging into one
   * "equivalent opponent" underestimates our equity.
   */
  function reliabilityOf(street, nOpp) {
    if (nOpp >= 3) return 'low';
    if (nOpp === 2) return street === 'river' ? 'medium' : 'low';
    if (street === 'river') return 'high';
    if (street === 'turn') return 'medium';
    return 'low';
  }

  const REL_CN = { high: '可信', medium: '中等', low: '仅方向' };

  /* ============================================================
   * 5. 单次决策的复盘
   * 5. Reviewing a single decision
   * ============================================================ */

  function reviewDecision(rec, st, opts) {
    const a = st.a;
    const iters = opts.iters || ITERS;
    const rnd = opts.rnd;

    const callAmt = Math.min(a.toCall, st.stackBefore);
    /* 区分「加注」与「跟注式全下」：全下若投入不超过跟注额，那只是一次跟注 */
    /* Distinguish "raise" from "call-style all-in": if an all-in invests no more than the call amount, it is just a call */
    const isRaise = a.action === 'raise' ||
      (a.action === 'allin' && st.invested > callAmt + 1e-6);

    const seats = liveSeatsAt(rec, st.i);
    if (!seats.length) return null;                 // 没有对手，无从比较 / no opponents, nothing to compare
    const nOpp = seats.length;

    const board = rec.board.slice(0, a.boardLen);
    const known = rec.heroHole.concat(board);
    const w = mergeRanges(rec, seats, a.boardLen, st.i);
    const eqNow = R.equityVsWeights(rec.heroHole, board, w, iters, { nOpp: nOpp, rnd: rnd });

    /* ---- 候选动作的 EV ---- */
    /* ---- EV of candidate actions ---- */
    const evs = { fold: 0 };
    if (a.toCall > 0) evs.call = evCall(eqNow, st.potBefore, callAmt);
    else evs.check = eqNow * st.potBefore;

    /* 加注统一按"标准尺度"评估，这样不同牌局之间的 EV 才可比。
       若照玩家当时的实际尺度去评，一次超小加注会因为"投入少"而显得 EV 不差，
       掩盖掉"尺度本身错了"这个更重要的问题 —— 所以实际尺度单独再算一次。 */
    /* Raises are always evaluated at the "standard sizing" so that EVs are comparable across
       different hands. If the player's actual sizing were used, a tiny raise would look fine in
       EV simply because it "invests little", masking the more important problem that "the sizing
       itself is wrong" — so the actual sizing is evaluated again separately. */
    const callLevel = st.prev + a.toCall;
    const maxLevel = st.prev + st.stackBefore;
    let benchToAmt = null;
    if (maxLevel > callLevel + 1e-6) {
      const inc = Math.max(a.toCall, RAISE_FRAC * (st.potBefore + a.toCall));
      benchToAmt = Math.min(callLevel + inc, maxLevel) - st.prev;
    }

    const raiseCtx = (toAmt) => {
      const villainAdd = toAmt - callAmt;
      const potAfter = st.potBefore + toAmt + villainAdd;
      /* 对手的底池赔率 = 他要投入的 / 他投入之后的底池 */
      /* Opponent's pot odds = his amount to add / the pot after his investment */
      const price = potAfter > 0 ? villainAdd / potAfter : 1;
      const cr = continueRange(w, board, known, price);
      const eqCalled = R.equityVsWeights(rec.heroHole, board, cr.w, iters, { nOpp: nOpp, rnd: rnd });
      return { foldP: 1 - cr.share, share: cr.share, price: price, eqCalled: eqCalled };
    };

    let raiseInfo = null;
    if (benchToAmt !== null) {
      raiseInfo = raiseCtx(benchToAmt);
      evs.raise = evRaise(raiseInfo.eqCalled, raiseInfo.foldP, st.potBefore, benchToAmt, callAmt);
    }

    /* ---- 实际选择 ---- */
    /* ---- Actual choice ---- */
    let takenKey, takenEV;
    if (a.action === 'fold') { takenKey = 'fold'; takenEV = 0; }
    else if (a.action === 'check') { takenKey = 'check'; takenEV = evs.check; }
    else if (isRaise) {
      takenKey = 'raise';
      if (benchToAmt !== null && Math.abs(st.invested - benchToAmt) < 1e-6) {
        takenEV = evs.raise;
      } else {
        /* 实际尺度与标准尺度不同 → 单独求值（蒙特卡洛，只算一次） */
        /* Actual sizing differs from standard sizing → evaluate separately (Monte Carlo, once) */
        const ri = raiseCtx(st.invested);
        takenEV = evRaise(ri.eqCalled, ri.foldP, st.potBefore, st.invested, callAmt);
      }
    } else { takenKey = 'call'; takenEV = evs.call; }

    /* ---- 找最优 ---- */
    /* ---- Find the best ---- */
    let bestKey = takenKey, bestEV = takenEV;
    for (const k of Object.keys(evs)) {
      if (evs[k] > bestEV + 1e-9) { bestEV = evs[k]; bestKey = k; }
    }
    const loss = Math.max(0, bestEV - takenEV);
    const lossBB = rec.bb > 0 ? loss / rec.bb : loss;
    const v = loss < 1e-9 && bestKey === takenKey
      ? { key: 'best', cn: '最佳' }
      : verdictOf(lossBB);

    /* ---- 解说 ---- */
    /* ---- Explanation ---- */
    const needEq = a.toCall > 0 && st.potBefore + callAmt > 0
      ? callAmt / (st.potBefore + callAmt) : 0;

    const d = {
      i: st.i,
      street: st.street,
      boardLen: a.boardLen,
      board: board,
      potBefore: st.potBefore,
      toCall: a.toCall,
      callAmt: callAmt,
      stackBefore: st.stackBefore,
      prev: st.prev,
      taken: takenKey,
      takenLevel: a.betAfter,
      takenAmt: st.invested,
      noteText: a.note || null,

      eq: eqNow,
      needEq: needEq,
      evs: evs,
      best: bestKey,
      bestEV: bestEV,
      takenEV: takenEV,
      loss: loss,
      lossBB: lossBB,
      verdict: v.key,
      verdictCN: v.cn,

      nOpp: nOpp,
      reliability: reliabilityOf(st.street, nOpp),
      caveat: st.street === 'preflop'
        ? '翻前是静态估算：不含后续街的隐含赔率与可玩性，只看方向'
        : (reliabilityOf(st.street, nOpp) === 'high'
            ? null : '后面还有下注轮，静态估算会偏离真实期望'),
      raiseBenchAmt: benchToAmt,
      foldP: raiseInfo ? raiseInfo.foldP : null,
      eqCalled: raiseInfo ? raiseInfo.eqCalled : null,

      range: R.describe(w, known),
      weights: w,                       // 供热力图使用（持久化时会被 storage 剥掉） / used by heatmap (stripped on save)
      oppSeats: seats,
    };
    d.advice = advise(d, rec);
    return d;
  }

  /**
   * 生成一句人话建议。刻意不复述 EV 数字（界面上已经显示了），
   * 而是给出**可迁移的判据**——下次遇到同类局面该拿什么当依据。
   * Produce a single plain-language piece of advice. It deliberately does not restate the EV
   * numbers (already shown in the UI), but gives a **transferable criterion** — what to rely on
   * the next time a similar situation arises.
   */
  function advise(d, rec) {
    const pct = (x) => Math.round(x * 100) + '%';
    const bbc = (x) => (x >= 0 ? '+' : '') + x.toFixed(1) + 'BB';
    const odds = pct(d.needEq) + ' 底池赔率';

    if (d.verdict === 'best') {
      if (d.taken === 'fold') return '面对这个下注，弃牌是对的。';
      if (d.taken === 'check') return '过牌是好选择——这个牌面下注很难被更差的牌跟。';
      if (d.taken === 'call') return '跟注合理：' + odds + '，你有 ' + pct(d.eq) + ' 胜率，够了。';
      return '加注合理：' + pct(d.eq) + ' 胜率加上 ' + pct(d.foldP || 0) + ' 的弃牌率，两头都赚。';
    }

    /* 该跟却弃了 */
    /* Should have called but folded */
    if (d.taken === 'fold' && d.evs.call !== undefined && d.evs.call > 0) {
      return '这手弃错了：只需要 ' + odds + ' 的胜率，你有 ' + pct(d.eq) +
        '，跟注的期望是 ' + bbc(d.evs.call / rec.bb) + '。' +
        (d.eq < 0.30 ? '（注意：胜率不高不代表该弃，底池赔率才是判据）' : '');
    }
    /* 该弃却跟了 */
    /* Should have folded but called */
    if (d.taken === 'call' && d.evs.fold !== undefined && d.best === 'fold') {
      return '这个跟注是亏的：' + odds + ' 要求 ' + pct(d.needEq) +
        ' 胜率，你只有 ' + pct(d.eq) + '。对手在这里的范围（约占他全部起手牌的 ' +
        pct(d.range.pct) + '）已经强过你的牌。';
    }
    /* 该下注/加注却没打 */
    /* Should have bet/raised but did not */
    if ((d.taken === 'check' || d.taken === 'call') && d.best === 'raise') {
      const extra = bbc((d.bestEV - d.takenEV) / rec.bb);
      return '这里应该主动进攻：加注能同时赢两条路 —— 对手弃牌直接收下底池' +
        (d.foldP !== null ? '（估计弃牌率 ' + pct(d.foldP) + '）' : '') +
        '，被跟注时你仍有 ' + pct(d.eqCalled || d.eq) + ' 胜率。少赚了 ' + extra + '。';
    }
    /* 该跟却加注（过度激进） */
    /* Should have called but raised (over-aggressive) */
    if (d.taken === 'raise' && d.best === 'call') {
      return '加注过头了：你的胜率 ' + pct(d.eq) + ' 只够跟注，加注会赶走所有你本来就赢的牌、' +
        '只留下能打败你的牌（被反超损失 ' + bbc((d.takenEV - d.bestEV) / rec.bb) + '）。';
    }
    /* 尺度问题：动作选对了，但下注量不对 */
    /* Sizing problem: right action, wrong bet size */
    if (d.taken === 'raise' && d.best === 'raise' && d.raiseBenchAmt !== null) {
      const bench = Math.round(d.raiseBenchAmt + d.prev);
      return '方向对，但尺度偏了：当时加到 ' + Math.round(d.takenLevel) +
        '，按 ' + Math.round(RAISE_FRAC * 100) + '% 底池应该是 ' + bench + '。' +
        '尺度错了会让对手的跟注范围失真——太小留一堆听牌进来，太大只剩强牌跟。';
    }
    if (d.verdict === 'inaccuracy') return '大方向没错，' + d.verdictCN + '。';
    return '最优选择是「' + ACT_CN[d.best] + '」，实际选了「' + ACT_CN[d.taken] + '」。';
  }

  const ACT_CN = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注' };

  /* ============================================================
   * 6. 整手牌 / 全程复盘
   * 6. Whole hand / full-session review
   * ============================================================ */

  /** 复盘一手牌，返回全部决策点（带缓存） */
  /** Review one hand and return all decision points (with caching) */
  function review(rec, opts) {
    opts = opts || {};
    if (!R) return { decisions: [], totalLoss: 0, totalLossBB: 0 };
    if (!rec || !rec.heroHole || !rec.actions || !rec.actions.length) {
      return { decisions: [], totalLoss: 0, totalLossBB: 0 };
    }
    const iters = opts.iters || ITERS;
    const cached = rec[CACHE_KEY];
    if (cached && cached.iters === iters && !opts.fresh) return cached.data;

    const states = walk(rec);
    const decisions = [];
    for (const st of states) {
      if (st.a.seat !== 0) continue;          // 只看真人的决策 / only the human player's decisions
      const d = reviewDecision(rec, st, { iters: iters, rnd: opts.rnd });
      if (d) decisions.push(d);
    }

    let totalLoss = 0, worst = null;
    for (const d of decisions) {
      totalLoss += d.loss;
      if (!worst || d.loss > worst.loss) worst = d;
    }
    const data = {
      no: rec.no,
      decisions: decisions,
      totalLoss: totalLoss,
      totalLossBB: rec.bb > 0 ? totalLoss / rec.bb : totalLoss,
      worst: worst,
      hands: decisions.length,
    };
    Object.defineProperty(rec, CACHE_KEY, {
      value: { iters: iters, data: data },
      writable: true, configurable: true, enumerable: false,
    });
    return data;
  }

  /**
   * 跨多手牌的汇总：找出损失集中在哪条街、哪类动作。
   * 这比"某一手亏了多少"有用得多——个人漏洞几乎总是模式化的。
   * Aggregate across many hands: find which street and which type of action the losses
   * concentrate in. This is far more useful than "how much was lost on one hand" — personal
   * leaks are almost always patterned.
   */
  function audit(recents, opts) {
    opts = opts || {};
    const streets = ['preflop', 'flop', 'turn', 'river'];
    const byStreet = {}, byAction = {};
    for (const s of streets) byStreet[s] = { n: 0, loss: 0, bb: 0 };
    for (const k of ['fold', 'check', 'call', 'raise']) byAction[k] = { n: 0, loss: 0, bb: 0 };

    let hands = 0, decisions = 0, totalLoss = 0, totalLossBB = 0, bigMistakes = 0;
    const worst = [];
    const list = recents || [];

    for (let ri = 0; ri < list.length; ri++) {
      const rec = list[ri];
      const r = review(rec, opts);
      if (!r.decisions.length) continue;
      hands++;
      decisions += r.decisions.length;
      totalLoss += r.totalLoss;
      totalLossBB += r.totalLossBB;
      for (const d of r.decisions) {
        const bs = byStreet[d.street];
        const ba = byAction[d.taken];
        if (bs) { bs.n++; bs.loss += d.loss; bs.bb += d.lossBB; }
        if (ba) { ba.n++; ba.loss += d.loss; ba.bb += d.lossBB; }
        if (d.verdict === 'blunder' || d.verdict === 'mistake') {
          bigMistakes++;
          /* 带上 recents 下标，界面才能直接跳回那一手的那个决策点 */
          /* Carry the recents index so the UI can jump straight back to that decision point of that hand */
          worst.push({ no: rec.no, d: d, idx: ri });
        }
      }
    }

    worst.sort((x, y) => y.d.loss - x.d.loss);
    const top = worst.slice(0, 8);

    return {
      hands: hands,
      decisions: decisions,
      totalLoss: totalLoss,
      totalLossBB: totalLossBB,
      perHandBB: hands > 0 ? totalLossBB / hands : 0,
      bigMistakes: bigMistakes,
      byStreet: byStreet,
      byAction: byAction,
      worst: top,
      leaks: buildLeaks(byStreet, byAction, decisions),
    };
  }

  /** 把汇总结果翻译成"你该练什么" */
  /** Translate the aggregate results into "what you should practise" */
  function buildLeaks(byStreet, byAction, totalDecisions) {
    const out = [];
    const ST_CN = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };
    const AC_CN = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注' };

    const stRank = Object.keys(byStreet)
      .filter(k => byStreet[k].loss > 0)
      .sort((a, b) => byStreet[b].loss - byStreet[a].loss);
    if (stRank.length && byStreet[stRank[0]].loss > 0) {
      const k = stRank[0];
      out.push({
        id: 'street:' + k,
        text: '**' + ST_CN[k] + '**是你损失最集中的一条街（累计 ' +
          byStreet[k].bb.toFixed(1) + 'BB，占 ' + byStreet[k].n + ' 次决策中的一部分）。',
        weight: byStreet[k].loss,
      });
    }

    const acRank = Object.keys(byAction)
      .filter(k => byAction[k].loss > 0)
      .sort((a, b) => byAction[b].loss - byAction[a].loss);
    if (acRank.length) {
      const k = acRank[0];
      out.push({
        id: 'action:' + k,
        text: '选择「' + AC_CN[k] + '」时的损失最大（累计 ' + byAction[k].bb.toFixed(1) + 'BB）。',
        weight: byAction[k].loss,
      });
    }

    /* 跟注站倾向：跟注失误显著多于弃牌失误 */
    /* Calling-station tendency: calling mistakes markedly outnumber folding mistakes */
    const callLoss = byAction.call.loss, foldLoss = byAction.fold.loss;
    if (callLoss > foldLoss * 1.8 && callLoss > 0) {
      out.push({
        id: 'tooSticky',
        text: '跟注造成的损失明显高于弃牌（' + byAction.call.bb.toFixed(1) + 'BB vs ' +
          byAction.fold.bb.toFixed(1) + 'BB）——偏"粘"，边缘牌放弃得太少。',
        weight: callLoss - foldLoss,
      });
    }
    /* 被动倾向：该主动时没打，损失集中在过牌/跟注 */
    /* Passive tendency: did not bet when aggression was called for; losses concentrate in check/call */
    const passive = byAction.check.loss + byAction.call.loss;
    const aggr = byAction.raise.loss;
    if (passive > aggr * 2.2 && passive > 0) {
      out.push({
        id: 'tooPassive',
        text: '被动选择的损失远高于主动加注（' + (byAction.check.bb + byAction.call.bb).toFixed(1) +
          'BB vs ' + byAction.raise.bb.toFixed(1) + 'BB）——该下注/加注的时候退了。',
        weight: passive - aggr,
      });
    }

    return out.sort((a, b) => b.weight - a.weight);
  }

  /* ============================================================
   * 7. 供界面使用的小工具
   * 7. Small helpers for the UI
   * ============================================================ */

  /** 把一个决策的三种动作整理成便于渲染的数组 */
  /** Arrange a decision's three actions into an array that is convenient to render */
  function options(d) {
    const CN = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注' };
    const out = [];
    for (const k of ['fold', 'check', 'call', 'raise']) {
      if (d.evs[k] === undefined) continue;
      out.push({
        key: k, cn: CN[k], ev: d.evs[k],
        bb: d.evs[k],
        isBest: k === d.best,
        isTaken: k === d.taken,
      });
    }
    out.sort((a, b) => b.ev - a.ev);
    return out;
  }

  const VERDICT_CN = {
    best: '最佳', ok: '可以接受', inaccuracy: '轻微偏差',
    mistake: '失误', blunder: '严重失误',
  };

  PK.EVLoss = {
    review, audit, options, walk, continueRange, needCat, preflopTop,
    evCall, evRaise, mergeRanges, liveSeatsAt,
    reliabilityOf, verdictOf,
    REL_CN, VERDICT_CN, ACT_CN, ITERS, RAISE_FRAC,
    CACHE_KEY,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PK;
})(typeof globalThis !== 'undefined' ? globalThis : this);
