/* ============================================================
 * range.js — 169 类对手范围模型
 * range.js — 169-class opponent range model
 *
 * 与 equity.js 里"按百分位切一刀"的范围不同，这里的范围是一个
 * Unlike the "cut at a percentile" range in equity.js, this range is a
 * **权重向量**：169 类起手牌每类给一个 0~1 的权重，表示"对手手持这一类
 * **weight vector**: each of the 169 starting-hand classes gets a 0~1 weight, meaning "the relative
 * 牌时做出我们观察到的这些动作"的相对可能性。
 * likelihood that the opponent takes the actions we observed while holding this class".
 *
 * 为什么必须是向量而不是一刀切：
 * Why it must be a vector rather than a single cutoff:
 *   真实的范围是**两极化的**。一个人 3-bet 的牌可能是 AA/KK，也可能是 76s，
 *   The real range is **polarized**. A player's 3-bet hands may be AA/KK, or 76s,
 *   但绝不是 A9o。用 "top 5%" 这种连续区间去近似，会把一堆根本不在范围里的
 *   but never A9o. Approximating with a continuous band like "top 5%" drags in a pile of
 *   中游牌算进去，从而高估对手强度（我们的胜率被低估）；反过来放宽又会
 *   mid-strength hands that are not in the range at all, overestimating opponent strength (underestimating our equity); loosening it instead
 *   把垃圾牌算进来。矩阵向量才能表达"强的和弱的都在、中间的不在"。
 *   drags junk in. Only a matrix vector can express "both strong and weak present, the middle absent".
 *
 * 权重口径：未归一化的相对概率，最大值不一定为 1（见 normalize()）。
 * Weight convention: unnormalized relative probability; the maximum is not necessarily 1 (see normalize()).
 *   翻前由动作决定（open / 3bet / call / limp …）
 *   Preflop it is determined by the action (open / 3bet / call / limp …)
 *   翻后按"这一类牌在当前牌面上会成什么"再乘一个因子（bet / call / check）
 *   Postflop it is multiplied by a factor based on "what this class becomes on the current board" (bet / call / check)
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK || (global.PK = {});
  const ORDER = PK.HAND_RANK_ORDER;      // 169 类，按强度排名（0 = AA） / 169 classes, ranked by strength (0 = AA)
  const N = ORDER.length;

  const RANK_IDX = {};
  ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
    .forEach((ch, i) => { RANK_IDX[ch] = i; });

  /* ============================================================
   * 1. 每一类的全部具体组合
   * 1. All concrete combos for each class
   *   对子 6 / 同花 4 / 不同花 12，合计 1326
   *   Pairs 6 / suited 4 / offsuit 12, 1326 in total
   * ============================================================ */
  const COMBOS = new Array(N);
  (function buildCombos() {
    let total = 0;
    for (let i = 0; i < N; i++) {
      const key = ORDER[i];
      const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/.exec(key);
      const r1 = RANK_IDX[m[1]], r2 = RANK_IDX[m[2]], kind = m[3];
      const list = [];
      if (r1 === r2) {
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) list.push([r1 * 4 + a, r1 * 4 + b]);
      } else if (kind === 's') {
        for (let s = 0; s < 4; s++) list.push([r1 * 4 + s, r2 * 4 + s]);
      } else {
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) list.push([r1 * 4 + a, r2 * 4 + b]);
      }
      COMBOS[i] = list;
      total += list.length;
    }
    COMBOS._total = total;
  })();

  const IDX_BY_KEY = new Map();
  ORDER.forEach((k, i) => IDX_BY_KEY.set(k, i));

  /* 位置系数：0 = 最早行动，1 = 按钮位。
     Position coefficient: 0 = earliest to act, 1 = button.
     刻意在本文件内自带一份，而不是调用 ai.js 的 positionFrac ——
     Deliberately kept local to this file rather than calling ai.js's positionFrac ——
     否则 range.js 会被绑定在 ai.js 之后加载，测试与复用都会变得脆弱。
     Otherwise range.js would be tied to loading after ai.js, making tests and reuse fragile. */
  function positionFrac(seat, button, n) {
    const order = (seat - button - 1 + n) % n;   // 0 = 小盲 / 0 = small blind
    return n > 2 ? order / (n - 1) : order;
  }

  /** 由两张牌定位类别下标；两种调用形式都接受：idxOf(c1, c2) / idxOf([c1, c2])
   * Locate the class index from two cards; both call forms are accepted: idxOf(c1, c2) / idxOf([c1, c2]) */
  function idxOf(a, b) {
    if (typeof a === 'object' && a !== null) { b = a[1]; a = a[0]; }
    const i = IDX_BY_KEY.get(PK.holeKey(a, b));
    return i === undefined ? -1 : i;
  }
  function idxOfKey(key) {
    const i = IDX_BY_KEY.get(key);
    return i === undefined ? -1 : i;
  }

  /* ============================================================
   * 2. 向量基础操作
   * 2. Basic vector operations
   * ============================================================ */
  function emptyWeights() { return new Float64Array(N); }
  function uniformWeights(v) {
    const w = new Float64Array(N);
    w.fill(v === undefined ? 1 : v);
    return w;
  }
  /**
   * 百分位以内的牌给 1，其余给 0。
   * Hands within the percentile get 1, the rest get 0.
   *
   * ⚠️ 口径说明（很容易踩）：这里的百分位是**按类别数**切的 —— 169 类各占 1/169，
   * ⚠️ Convention note (very easy to trip on): the percentile here is **by class count** —— each of the 169 classes occupies 1/169,
   * 所以 topWeights(0.1) 取的是排名前 17 类，而它们只占**全部组合的约 8.3%**
   * so topWeights(0.1) takes the top 17 classes, which cover only **about 8.3% of all combos**
   * （强牌里对子/同花占多数，组合数天生少）。扑克圈说的"前 10% 的牌"通常指
   * (pairs/suited dominate among strong hands, so their combo count is inherently small). Poker circles' "top 10% of hands" usually means
   * 按**组合数**算的前 10%，那是 topCombos()。
   * the top 10% **by combo count**, which is topCombos().
   * 保留这个"按类别数"的口径，是为了与 equity.js 既有的 estimateEquity(rangePct)
   * This "by class count" convention is kept to stay fully consistent with equity.js's existing estimateEquity(rangePct)
   * 完全一致（两者可交叉校验），AI 的范围表也建立在这个口径上。
   * (the two cross-check each other), and the AI's range tables are also built on this convention.
   */
  function topWeights(pct) {
    const w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = i / (N - 1) <= pct ? 1 : 0;
    return w;
  }

  /** 按**组合数**取前 pct（符合扑克惯例的"前 X% 的牌"）
   * Take the top pct **by combo count** (matching the poker convention of "top X% of hands") */
  function topCombos(pct) {
    const idx = [];
    for (let i = 0; i < N; i++) idx.push(i);
    idx.sort((a, b) => a - b);                 // ORDER 本身即按强度排序 / ORDER itself is sorted by strength
    const target = Math.max(0, Math.min(1, pct)) * 1326;
    const w = new Float64Array(N);
    let acc = 0;
    for (const i of idx) {
      const c = COMBOS[i].length;
      if (acc + c <= target + 1e-9) { w[i] = 1; acc += c; }
      else { w[i] = Math.max(0, (target - acc) / c); acc = target; break; }
    }
    return w;
  }

  /**
   * 把"占全部组合数的比例"换算成 topWeights()/pct2() 使用的**类别百分位**阈值。
   * Convert a "share of all combos" into the **class percentile** threshold used by topWeights()/pct2().
   *
   * 为什么需要它：AI 的开池范围表按扑克惯例写成"枪口 12% / 按钮 42%"，
   * Why it's needed: the AI's open-raise range tables follow the poker convention and are written as "UTG 12% / button 42%",
   * 那是**手牌（组合）占比**；而 pct2() 给的是类别百分位（169 类各占 1/169）。
   * which is a **hand (combo) share**; but pct2() gives a class percentile (each of the 169 classes occupies 1/169).
   * 两者差着一个明显的系数 —— 前 10% 的类别只覆盖约 6.4% 的组合，因为
   * The two differ by a sizable factor —— the top 10% of classes covers only about 6.4% of combos, because
   * 强牌里对子与同花占多数，组合数天生偏少。直接把 0.12 丢给 pct2() 比较，
   * pairs and suited hands dominate among strong hands, so their combo count is inherently small. Feeding 0.12 straight into pct2()
   * 等于把范围收得比设计值紧一大截（实测 VPIP 因此偏低约 4~6 个百分点）。
   * tightens the range far more than intended (measured VPIP comes out roughly 4~6 percentage points low).
   *
   * @param {number} frac 目标组合占比，0~1
   * @param {number} frac target combo share, 0~1
   * @returns {number} 对应的类别百分位阈值，可直接与 pct2() 比较
   * @returns {number} the corresponding class percentile threshold, directly comparable with pct2()
   */
  function classPctForCombos(frac) {
    const target = Math.max(0, Math.min(1, frac)) * 1326;
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const c = COMBOS[i].length;
      if (acc + c > target) return i / (N - 1);
      acc += c;
    }
    return 1;
  }

  /** 反向换算：类别百分位阈值实际覆盖的组合占比（诊断与测试用）
   * Inverse conversion: the combo share actually covered by a class percentile threshold (for diagnostics and tests) */
  function combosForClassPct(pct) {
    let acc = 0;
    for (let i = 0; i < N; i++) if (i / (N - 1) <= pct) acc += COMBOS[i].length;
    return acc / 1326;
  }
  /** 就地归一化到最大值为 1（保留相对形状，避免 0/0）
   * Normalize in place to a maximum of 1 (preserving relative shape, avoiding 0/0) */
  function normalize(w) {
    let mx = 0;
    for (let i = 0; i < N; i++) if (w[i] > mx) mx = w[i];
    if (mx > 0) for (let i = 0; i < N; i++) w[i] /= mx;
    return w;
  }
  /** 把范围整体收缩/扩张：pct 保留权重最高的那部分组合（按组合数加权）
   * Shrink/expand the whole range: pct keeps the highest-weight portion of combos (weighted by combo count) */
  function keepPct(w, pct) {
    const idx = [];
    for (let i = 0; i < N; i++) if (w[i] > 0) idx.push(i);
    idx.sort((a, b) => (w[b] * COMBOS[b].length) - (w[a] * COMBOS[a].length));
    const target = Math.max(0, Math.min(1, pct)) * combosInRange(w);
    const out = new Float64Array(N);
    let acc = 0;
    for (const i of idx) {
      const c = w[i] * COMBOS[i].length;
      if (acc + c <= target + 1e-9) { out[i] = w[i]; acc += c; }
      else { out[i] = w[i] * Math.max(0, (target - acc) / c); acc = target; break; }
    }
    return out;
  }

  /**
   * 范围内的可用组合数（已扣除阻断牌）
   * Number of usable combos in the range (blockers already excluded)
   * @param {Float64Array} w
   * @param {number[]} [known] 已知牌（自己底牌 + 公共牌）
   * @param {number[]} [known] known cards (own hole cards + board)
   */
  function combosInRange(w, known) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      if (w[i] <= 0) continue;
      const list = COMBOS[i];
      let c = 0;
      for (let k = 0; k < list.length; k++) {
        if (known && (known.indexOf(list[k][0]) >= 0 || known.indexOf(list[k][1]) >= 0)) continue;
        c += w[i];
      }
      sum += c;
    }
    return sum;
  }

  /** 范围占全部起手牌的比例（0~1）；扣除阻断牌后按剩余组合计算
   * Share of all starting hands occupied by the range (0~1); computed over remaining combos after blockers are removed */
  function pctOfRange(w, known) {
    /* 注意 combosInRange 返回的**就是**扣除阻断牌后的剩余组合数，
       Note that combosInRange returns **exactly** the remaining combo count after blockers,
       不要再拿 1326 去减它（曾经这么写导致占比算成 78%）
       so do not subtract it from 1326 (doing that once made the share come out as 78%) */
    const total = (known && known.length) ? combosInRange(uniformWeights(1), known) : 1326;
    const inR = combosInRange(w, known);
    return total <= 0 ? 0 : inR / total;
  }

  /* ============================================================
   * 3. 翻前范围（按动作构造）
   * 3. Preflop ranges (built from actions)
   * ============================================================ */
  /* 3-bet 的"极化尾巴"：这些牌本身强度一般，但可玩性好、阻断强，
     The "polarized tail" of 3-bets: these hands are only average in raw strength, but have good playability and strong blockers,
     是标准的 3-bet 诈唬候选。用显式牌表而不是百分位区间。
     so they are standard 3-bet bluff candidates. An explicit hand list is used rather than a percentile band. */
  const BLUFF_3BET = new Set([
    'A5s', 'A4s', 'A3s', 'A2s', 'K9s', 'K8s', 'Q9s', 'J9s', 'T8s', '97s', '86s', '76s', '65s', '54s',
    'AJo', 'ATo', 'KQo', 'KJo', 'QJo',
  ]);
  /* 3-bet 的价值部分。用显式牌表而不是"百分位 <= 0.03"：
     The value part of 3-bets. An explicit hand list is used rather than "percentile <= 0.03":
     按百分位切会把 99 也划进来（99 实战里更常跟注），显式表才不会误伤。
     cutting by percentile would include 99 as well (in practice 99 more often calls), whereas an explicit list avoids the collateral damage. */
  const VALUE_3BET = new Set(['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo', 'AQs']);
  /* 4-bet 范围：强对子 + AK，与 3-bet 尾部不重合
     4-bet range: strong pairs + AK, not overlapping the 3-bet tail */
  const VALUE_4BET = new Set(['AA', 'KK', 'QQ', 'AKs', 'AKo']);

  const PREFLOP_BUILDERS = {
    /** 开池加注：位置越靠后范围越宽
     * Open-raise: the later the position, the wider the range */
    open(posPct) {
      const p = 0.10 + (posPct === undefined ? 0.5 : posPct) * 0.34;
      return topWeights(p);
    },
    /** 面对加注再加注（3-bet）：强牌 + 极化诈唬尾
     * Re-raise against a raise (3-bet): strong hands + polarized bluff tail */
    threebet(posPct) {
      const w = emptyWeights();
      for (let i = 0; i < N; i++) {
        const key = ORDER[i];
        if (VALUE_3BET.has(key)) w[i] = 1;
        else if (BLUFF_3BET.has(key)) w[i] = 0.55 * (0.6 + (posPct === undefined ? 0.5 : posPct) * 0.6);
      }
      return w;
    },
    /** 面对 3-bet 的 4-bet：极窄，纯价值
     * 4-bet against a 3-bet: extremely narrow, pure value */
    fourbet() {
      const w = emptyWeights();
      for (let i = 0; i < N; i++) if (VALUE_4BET.has(ORDER[i])) w[i] = 1;
      return w;
    },
    /** 跟注开池：中游为主，剔除会去 3-bet 的强牌；3-bet 诈唬尾只留一部分
     * Call an open: mostly middle strength, excluding strong hands that would 3-bet; keep only part of the 3-bet bluff tail */
    callOpen(posPct) {
      const hi = 0.22 + (posPct === undefined ? 0.5 : posPct) * 0.10;
      const w = emptyWeights();
      for (let i = 0; i < N; i++) {
        const key = ORDER[i];
        if (VALUE_3BET.has(key)) continue;          // 这些牌宁可 3-bet / these hands prefer to 3-bet
        if (i / (N - 1) > hi) continue;
        w[i] = BLUFF_3BET.has(key) ? 0.6 : 1;       // 有时 3-bet、有时跟注 / sometimes 3-bet, sometimes call
      }
      return w;
    },
    /** 溜入：范围宽而弱
     * Limp: a wide and weak range */
    limp() { return topWeights(0.52); },
    /** 大盲防守：已投入 1BB，防守范围可以宽
     * Big blind defense: 1BB is already invested, so the defending range can be wide */
    bbDefend() {
      const w = emptyWeights();
      for (let i = 0; i < N; i++) {
        const pct = i / (N - 1);
        if (pct <= 0.42) w[i] = 1;
        else if (BLUFF_3BET.has(ORDER[i])) w[i] = 0.7;
        else if (pct <= 0.58) w[i] = 0.45;
      }
      return w;
    },
    /** 小盲补盲看牌
     * Small blind completing to see a flop */
    sbComplete() { return topWeights(0.62); },
  };

  /* ============================================================
   * 4. 翻后因子（同一类牌在不同牌面上会成什么）
   * 4. Postflop factors (what the same class becomes on different boards)
   * ============================================================ */

  /** 取该类别与给定牌面组合下的代表强度：牌型等级与听牌等级的最大值
   * Representative strength for this class combined with the given board: the max of made-hand tier and draw tier */
  /* classStrength 是热力图与 EV 复盘的性能热点：每次调用要对某一类的至多 4 个
     classStrength is the performance hotspot of the heatmap and EV review: each call runs PK.evaluate on up to 4
     具体组合做 PK.evaluate。而它对同一个 (类, 牌面, 阻断牌) 的结果是**不变**的 ——
     concrete combos of a class. Yet its result for the same (class, board, blockers) is **invariant** ——
     一次复盘会以同一牌面反复调用上万次（169 类 × 每个决策的 continueRange ×
     a single review calls it tens of thousands of times on the same board (169 classes × continueRange per decision ×
     多个对手）。加一层记忆化后，重复牌面的开销降到查表。
     multiple opponents). Adding a memoization layer reduces the cost of repeated boards to a table lookup.
     键里带上阻断牌：不同底牌下同一类的可用组合不同，成牌等级可能不同。
     Blockers are included in the key: with different hole cards the usable combos of a class differ, so the made-hand tier may differ. */
  const CS_CACHE = new Map();
  const CS_CACHE_MAX = 8000;

  function csKey(i, board, known) {
    let s = i + ':';
    for (let k = 0; k < board.length; k++) s += board[k].toString(36) + '.';
    s += '|';
    if (known) for (let k = 0; k < known.length; k++) s += known[k].toString(36) + '.';
    return s;
  }

  function classStrength(i, board, known) {
    const key = csKey(i, board, known);
    const hit = CS_CACHE.get(key);
    if (hit !== undefined) return hit;

    const list = COMBOS[i];
    let best = -1, bestDraw = 0, n = 0;
    for (let k = 0; k < list.length && n < 4; k++) {
      const c1 = list[k][0], c2 = list[k][1];
      if (known && (known.indexOf(c1) >= 0 || known.indexOf(c2) >= 0)) continue;
      const cat = PK.evaluate([c1, c2].concat(board)) >> 20;
      const draw = PK.drawTier([c1, c2], board);
      if (cat > best) best = cat;
      if (draw > bestDraw) bestDraw = draw;
      n++;
    }
    const out = best < 0 ? { cat: 0, draw: 0, empty: true }
                         : { cat: best, draw: bestDraw, empty: false };
    /* 上限保护：牌局持续进行时牌面会不断变化，不能让缓存无限增长
       Size cap: boards keep changing as the game goes on, so the cache must not grow without bound */
    if (CS_CACHE.size >= CS_CACHE_MAX) CS_CACHE.clear();
    CS_CACHE.set(key, out);
    return out;
  }

  /* 各动作的"强度 → 相对频率"曲线。
     "Strength → relative frequency" curves for each action.
     数值是经验设定，不是求解结果；目的是让形状正确：
     The values are empirical, not solver output; the goal is the right shape:
     主动下注/加注偏强，跟注偏中等，过牌最宽。
     betting/raising skews strong, calling skews medium, checking is widest. */
  const ACT_CURVE = {
    bet:   { cat: [0.20, 0.62, 0.86, 0.96, 1.00, 1.00, 1.00, 1.00, 1.00], draw: [0, 0.10, 0.24] },
    raise: { cat: [0.12, 0.30, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00], draw: [0, 0.06, 0.14] },
    call:  { cat: [0.26, 1.00, 0.90, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85], draw: [0, 0.14, 0.45] },
    check: { cat: [1.00, 0.80, 0.42, 0.30, 0.28, 0.28, 0.28, 0.28, 0.28], draw: [0, 0.55, 0.75] },
  };

  function postflopFactor(i, board, action, known) {
    const s = classStrength(i, board, known);
    const cur = ACT_CURVE[action];
    if (!cur) return 1;
    let f = cur.cat[Math.min(s.cat, 8)] + cur.draw[Math.min(s.draw, 2)];
    return Math.max(0.02, Math.min(1.6, f));
  }

  /* ============================================================
   * 5. 由「对手的整条行动线」构造范围向量
   * 5. Build a range vector from the opponent's entire action line
   * ============================================================ */

  /**
   * @param {object} line 对手的行动线描述
   * @param {object} line description of the opponent's action line
   *   preflop  'open' | 'threebet' | 'fourbet' | 'callOpen' | 'limp' | 'bbDefend' | 'sbComplete'
   *   postflop 数组，元素为 'bet' | 'raise' | 'call' | 'check'（按发生顺序）
   *   postflop array whose elements are 'bet' | 'raise' | 'call' | 'check' (in order of occurrence)
   *   posPct   0~1 位置系数（1 = 按钮位）
   *   posPct   0~1 position coefficient (1 = button)
   *   board    已知公共牌（翻后因子用）
   *   board    known board cards (used by postflop factors)
   *   known    自己的底牌（阻断牌，可省略）
   *   known    own hole cards (blockers, optional)
   *   tighten  额外的整体收紧系数（0~1，越小范围越窄）
   *   tighten  additional overall tightening coefficient (0~1, smaller = narrower range)
   */
  function fromLine(line) {
    line = line || {};
    let w;
    const b = PREFLOP_BUILDERS[line.preflop];
    w = b ? b(line.posPct) : uniformWeights(1);
    w = Float64Array.from(w);

    const acts = line.postflop || [];
    for (let k = 0; k < acts.length; k++) {
      const board = line.board || [];
      for (let i = 0; i < N; i++) {
        if (w[i] <= 0) continue;
        w[i] *= postflopFactor(i, board, acts[k], line.known);
      }
    }
    if (line.tighten !== undefined) w = keepPct(w, line.tighten);
    return normalize(w);
  }

  /**
   * 从复盘记录中还原某个对手在"第 uptoStep 步之前"的范围。
   * Reconstruct an opponent's range "before step uptoStep" from a hand record.
   * 这是热力图与 EV 复盘共用的入口。
   * This is the shared entry point for the heatmap and EV review.
   *
   * @param {object} rec   engine._packHand 产出的记录
   * @param {object} rec   the record produced by engine._packHand
   * @param {number} seat  对手座位
   * @param {number} seat  opponent seat
   * @param {number} boardLen 当时已发出的公共牌数
   * @param {number} boardLen number of board cards dealt at that time
   * @param {number} upto 只看 actions 的前 upto 条
   * @param {number} upto look at only the first upto entries of actions
   */
  function fromRecord(rec, seat, boardLen, upto) {
    const board = rec.board.slice(0, boardLen);
    let preflop = null;
    const postflop = [];
    const acts = rec.actions || [];
    const n = upto === undefined ? acts.length : Math.min(upto, acts.length);

    /* 翻后要区分"主动下注"和"加注别人的下注"：
       Postflop we must distinguish "leading out" from "raising someone else's bet":
       engine.js 的 _apply 对两者**都**记 action:'raise'（只按"是否超过当前下注额"判定），
       engine.js's _apply records action:'raise' for **both** (it decides only by whether the amount exceeds the current bet),
       记录里看不出哪一个是本街的第一枪。若一律当 raise 处理，就会套用
       so the record alone cannot tell which one is the first bet of the street. Treating all of them as raises would apply
       ACT_CURVE.raise（一对只有 0.30 权重）而不是 ACT_CURVE.bet（一对 0.62）——
       ACT_CURVE.raise (a pair gets only 0.30) instead of ACT_CURVE.bet (a pair gets 0.62) ——
       对手的下注范围会被算得**偏强**，我们的胜率被低估，EV 复盘跟着失真。
       the opponent's betting range would be computed as **too strong**, our equity would be underestimated, and the EV review would be distorted.
       这里用"本街第几个主动动作"来还原：第 1 个是下注(bet)，第 2 个起是加注(raise)。
       Here we reconstruct it from "which aggressive action of the street this is": the 1st is a bet, the 2nd onward is a raise. */
    let cur = 0;        // 本街当前下注额 / current bet amount on this street
    let aggr = 0;       // 本街已经发生过几次主动动作 / how many aggressive actions have occurred on this street

    for (let i = 0; i < n; i++) {
      const a = acts[i];
      /* 换街：下注额与主动动作计数都要清零，街与街之间互不影响
         Street change: both the bet amount and the aggressive-action count reset; streets do not affect each other */
      if (i > 0 && acts[i - 1].street !== a.street) { cur = 0; aggr = 0; }

      const isAggr = a.action === 'raise' ||
        (a.action === 'allin' && a.betAfter > cur);   // 全下也可能只是"跟注式全下" / an all-in may just be a "call-style all-in"
      if (isAggr) aggr++;
      if (a.betAfter > cur) cur = a.betAfter;

      if (a.seat !== seat) continue;
      if (a.action === 'fold') break;
      if (a.street === 'preflop') {
        if (isAggr) preflop = 'open';
        else if (a.action === 'call') preflop = 'callOpen';
      } else {
        if (a.action === 'check') postflop.push('check');
        else if (a.action === 'call') postflop.push('call');
        else if (isAggr) postflop.push(aggr === 1 ? 'bet' : 'raise');
      }
    }
    /* 翻前一次都没行动过（大盲免行动）→ 按大盲防守处理
       No preflop action at all (the big blind's option is checked) → treat as big blind defense */
    if (!preflop) preflop = 'bbDefend';

    const posFrac = positionFrac(seat, rec.button, rec.seats);
    return fromLine({ preflop, postflop, posPct: posFrac, board, known: rec.heroHole });
  }

  /* ============================================================
   * 6. 按权重的胜率计算
   * 6. Equity computation over weights
   * ============================================================ */

  /** 按权重抽取一个不与 busy 冲突的具体组合；极端情况返回 null
   * Draw a concrete combo by weight that does not conflict with busy; returns null in extreme cases */
  function drawCombo(cdf, total, busy, rnd) {
    if (total <= 0) return null;
    for (let t = 0; t < 28; t++) {
      const x = (rnd || Math.random)() * total;
      /* 二分查找 cdf
       * binary search over cdf */
      let lo = 0, hi = N - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] < x) lo = mid + 1; else hi = mid;
      }
      const list = COMBOS[lo];
      const c = list[(Math.random() * list.length) | 0];
      if (!busy[c[0]] && !busy[c[1]]) return c;
    }
    return null;
  }

  /**
   * 对"加权范围"的胜率（平局记半分）
   * Equity against a "weighted range" (a tie counts as half)
   *
   * @param {number[]} hole   自己的底牌
   * @param {number[]} hole   own hole cards
   * @param {number[]} board  已知公共牌
   * @param {number[]} board  known board cards
   * @param {Float64Array} weights 对手范围权重（未归一化亦可）
   * @param {Float64Array} weights opponent range weights (unnormalized is fine)
   * @param {number} iters
   * @param {object} [opts] { nOpp=1, rnd, filter=fn(cat)=>bool 额外的牌型门槛 }
   * @param {object} [opts] { nOpp=1, rnd, filter=fn(cat)=>bool additional made-hand threshold }
   */
  function equityVsWeights(hole, board, weights, iters, opts) {
    opts = opts || {};
    iters = Math.max(30, (iters | 0) || 700);
    const nOpp = Math.max(1, opts.nOpp || 1);
    const rnd = opts.rnd || Math.random;
    const known = hole.concat(board || []);

    /* cdf 只建一次。
       The cdf is built only once.
       ⚠️ 必须按**组合数**加权：对子 6 组合 / 同花 4 / 不同花 12。
       ⚠️ It must be weighted **by combo count**: pairs 6 combos / suited 4 / offsuit 12.
       只累加 weights[i]（每类等权）会让 AA 与 AKo 出现率相同，
       Accumulating only weights[i] (equal weight per class) makes AA and AKo equally likely,
       而正确口径下 AA 只有 AKo 的一半。这与 combosInRange / pctOfRange /
       whereas under the correct convention AA is only half as likely as AKo. This is inconsistent with the conventions used by combosInRange / pctOfRange /
       strongShare 的口径不一致，会让"对随机牌的胜率"和"对某范围的胜率"
       strongShare, and would systematically distort both "equity against random hands" and "equity against a range"
       双双系统性失真（对子被高估、不同花被低估）。
       (pairs overestimated, offsuit underestimated). */
    const cdf = new Float64Array(N);
    let acc = 0;
    for (let i = 0; i < N; i++) {
      acc += Math.max(0, weights[i]) * COMBOS[i].length;
      cdf[i] = acc;
    }
    const total = acc;
    const useUniform = !(total > 0);

    const bl = board ? board.length : 0;
    const nExtra = 5 - bl;
    if (nExtra + nOpp * 2 > 52 - known.length) return 0;

    const busy = new Uint8Array(52);
    const free = [];                 // 每轮重建的"还没被占用的牌"
                                     // EN: cards not yet used, rebuilt each iteration

    const full = new Array(5);
    for (let i = 0; i < bl; i++) full[i] = board[i];
    const myFull = new Array(7);
    myFull[0] = hole[0]; myFull[1] = hole[1];
    const oppFull = new Array(7);
    const oppHole = new Array(nOpp * 2);

    let win = 0, tie = 0, counted = 0;

    for (let it = 0; it < iters; it++) {
      /* ============================================================
       * 发牌顺序：**先发对手、再发公共牌**。
       * Dealing order: **deal the opponents first, then the board**.
       *
       * ⚠️ 这个顺序不是随意的，它决定了抽样分布对不对。
       * ⚠️ This order is not arbitrary; it determines whether the sampling distribution is correct.
       *
       * 曾经的写法是"先把 5 张公共牌从 50 张里发完，再让对手在范围里挑
       * The old implementation was "deal all 5 board cards out of 50 first, then let the opponent pick
       * 两张避开公共牌的牌"。那样得到的 (牌面, 对手底牌) 联合分布**不是**
       * two cards from the range that avoid the board". The joint distribution of (board, opponent hole cards) obtained that way is **not**
       * 真实发牌：公共牌是从一副**还含着对手底牌**的牌堆里发出来的，
       * a real deal: the board was dealt from a deck that **still contained the opponent's hole cards**,
       * 于是"能挡住对手范围的牌面"被系统性放大。
       * so "boards that block the opponent's range" were systematically overrepresented.
       *
       * 实测量级（AA 对纯 KK）：公共牌出现 K 的概率本应是 20.0%
       * Measured magnitude (AA vs pure KK): the probability of a K appearing on the board should be 20.0%
       * （48 张里 2 张 K 发 5 张），旧写法给到 35.3%；AA 的胜率因此从
       * (2 kings among 48 cards, dealing 5), but the old code gave 35.3%; AA's equity therefore fell from
       * 正确的 81.95% 掉到 69.55%。范围越窄、阻断越强，偏差越大。
       * the correct 81.95% to 69.55%. The narrower the range and the stronger the blockers, the larger the bias.
       *
       * 正确做法就是真实发牌的顺序：先定对手的牌，再从剩下的牌里发牌面。
       * The correct approach is simply the real dealing order: fix the opponent's cards first, then deal the board from the rest.
       * ============================================================ */
      busy.fill(0);
      for (let i = 0; i < known.length; i++) busy[known[i]] = 1;

      /* 1) 依次发各对手的底牌
       * 1) deal each opponent's hole cards in turn */
      for (let k = 0; k < nOpp; k++) {
        let c1 = -1, c2 = -1;
        if (!useUniform) {
          const c = drawCombo(cdf, total, busy, rnd);
          if (c) { c1 = c[0]; c2 = c[1]; }
        }
        if (c1 < 0) {
          /* 均匀兜底：从未占用的牌里随机取两张（范围为空或反复被挡时）
             Uniform fallback: pick two cards at random from unused cards (when the range is empty or repeatedly blocked) */
          free.length = 0;
          for (let c = 0; c < 52; c++) if (!busy[c]) free.push(c);
          if (free.length < 2) { c1 = -1; break; }
          const j1 = (rnd() * free.length) | 0;
          c1 = free[j1]; free[j1] = free[free.length - 1]; free.pop();
          const j2 = (rnd() * free.length) | 0;
          c2 = free[j2];
        }
        busy[c1] = 1; busy[c2] = 1;
        oppHole[k * 2] = c1; oppHole[k * 2 + 1] = c2;
      }
      if (oppHole[0] < 0) continue;

      /* 2) 再从剩下的牌里发追加的公共牌（转牌、河牌）
       * 2) then deal the remaining board cards from what's left (turn, river) */
      free.length = 0;
      for (let c = 0; c < 52; c++) if (!busy[c]) free.push(c);
      if (free.length < nExtra) continue;
      for (let i = 0; i < nExtra; i++) {
        const j = i + ((rnd() * (free.length - i)) | 0);
        const t = free[i]; free[i] = free[j]; free[j] = t;
        full[bl + i] = free[i];
      }

      for (let i = 0; i < 5; i++) myFull[2 + i] = full[i];
      const myScore = PK.evaluate(myFull);

      let best = -1;
      for (let k = 0; k < nOpp; k++) {
        const c1 = oppHole[k * 2], c2 = oppHole[k * 2 + 1];
        oppFull[0] = c1; oppFull[1] = c2;
        for (let i = 0; i < 5; i++) oppFull[2 + i] = full[i];
        let s = PK.evaluate(oppFull);

        if (opts.filter && !opts.filter(s >> 20)) {
          /* 不满足额外门槛 → 这一轮不计入（相当于该样本作废）
             Does not meet the extra threshold → this iteration is not counted (the sample is discarded) */
          s = -2;
        }
        if (s > best) best = s;
      }

      if (best === -2) continue;          // 存在被过滤掉的对手，整轮作废
                                          // EN: some opponent was filtered out, discard the whole iteration
      counted++;
      if (myScore > best) win++;
      else if (myScore === best) tie++;
    }

    if (!counted) return 0;
    return (win + tie * 0.5) / counted;
  }

  /* ============================================================
   * 7. 热力图布局（标准 13×13：上三角同花、下三角不同花、对角对子）
   * 7. Heatmap layout (standard 13×13: upper triangle suited, lower triangle offsuit, diagonal pairs)
   * ============================================================ */
  const HEAT_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  const HEATMAP = [];        // HEATMAP[r][c] = 类别下标 / HEATMAP[r][c] = class index
  (function buildHeat() {
    for (let r = 0; r < 13; r++) {
      const row = [];
      for (let c = 0; c < 13; c++) {
        let key;
        if (r === c) key = HEAT_RANKS[r] + HEAT_RANKS[c];
        else {
          const hi = Math.min(r, c), lo = Math.max(r, c);
          key = HEAT_RANKS[hi] + HEAT_RANKS[lo] + (r < c ? 's' : 'o');
        }
        row.push(IDX_BY_KEY.get(key) === undefined ? -1 : IDX_BY_KEY.get(key));
      }
      HEATMAP.push(row);
    }
  })();
  /** 每个类别在 13×13 里的行列位置
   * Row/column position of each class in the 13×13 grid */
  const HEAT_POS = new Array(N);
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) if (HEATMAP[r][c] >= 0) HEAT_POS[HEATMAP[r][c]] = [r, c];

  /** 范围的文字摘要
   * Textual summary of the range */
  function describe(w, known) {
    const combos = combosInRange(w, known);
    const list = [];
    for (let i = 0; i < N; i++) if (w[i] > 0.25) list.push({ key: ORDER[i], pct: i / (N - 1), w: w[i], combos: w[i] * COMBOS[i].length });
    list.sort((a, b) => b.combos - a.combos);
    return {
      combos: combos,
      pct: pctOfRange(w, known),
      classes: list.length,
      top: list.slice(0, 8),
    };
  }

  /** 范围中"已成强牌"（两对以上）的组合占比 —— 用于估计弃牌率
   * Combo share of "already strong" hands (two pair or better) in the range —— used to estimate fold rate */
  function strongShare(w, board, known) {
    let tot = 0, strong = 0;
    for (let i = 0; i < N; i++) {
      if (w[i] <= 0) continue;
      const s = classStrength(i, board, known);
      const c = w[i] * COMBOS[i].length;
      tot += c;
      if (s.cat >= 2) strong += c;
    }
    return tot <= 0 ? 0 : strong / tot;
  }

  PK.Range = {
    N, ORDER, COMBOS, HEATMAP, HEAT_POS, HEAT_RANKS,
    BLUFF_3BET, VALUE_4BET,
    idxOf, idxOfKey,
    emptyWeights, uniformWeights, topWeights, topCombos, normalize, keepPct,
    classPctForCombos, combosForClassPct,
    combosInRange, pctOfRange,
    fromLine, fromRecord,
    classStrength, postflopFactor,
    equityVsWeights, drawCombo,
    describe, strongShare,
    get totalCombos() { return COMBOS._total; },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PK;
})(typeof globalThis !== 'undefined' ? globalThis : this);
