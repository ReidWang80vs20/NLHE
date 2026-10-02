/* ============================================================
 * poker.js — 牌面基础与牌型评估器
 * Card primitives and hand evaluator
 * 牌编码：card = rank * 4 + suit
 * Card encoding: card = rank * 4 + suit
 *   rank: 0=2, 1=3, ... 11=K, 12=A
 *   suit: 0=♠ 1=♥ 2=♦ 3=♣
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK || (global.PK = {});

  /* ---------------- 基础 ---------------- */
  /* ---------------- Basics ---------------- */
  const RANK_CHARS  = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = [
    { ch: 's', sym: '♠', red: false },
    { ch: 'h', sym: '♥', red: true  },
    { ch: 'd', sym: '♦', red: true  },
    { ch: 'c', sym: '♣', red: false },
  ];
  const SUIT_INDEX = { s: 0, h: 1, d: 2, c: 3 };

  const makeCard  = (rank, suit) => (rank << 2) | suit;
  const rankOf    = c => c >> 2;
  const suitOf    = c => c & 3;
  const cardText  = c => RANK_CHARS[c >> 2] + SUITS[c & 3].ch;    // "As"
  const cardLabel = c => RANK_LABELS[c >> 2] + SUITS[c & 3].sym;  // "A♠"

  function parseCard(str) {
    if (typeof str !== 'string' || str.length < 2) return -1;
    const r = RANK_CHARS.indexOf(str[0].toUpperCase());
    const s = SUIT_INDEX[str[1].toLowerCase()];
    if (r < 0 || s === undefined) return -1;
    return makeCard(r, s);
  }

  function freshDeck() {
    const d = new Array(52);
    for (let i = 0; i < 52; i++) d[i] = i;
    return d;
  }

  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------------- 牌型等级 ---------------- */
  /* ---------------- Hand categories ---------------- */
  const CAT_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

  /**
   * 顺子检测：返回最大顺子的最高牌 rank（如 A 高顺子返回 12，轮子返回 3），无顺子返回 -1
   * Straight detection: high rank of the best straight (12 for A-high, 3 for the wheel), or -1
   * @param {number} mask 13 位点数掩码
   * @param {number} mask 13-bit rank mask
   */
  function straightHigh(mask) {
    for (let hi = 12; hi >= 4; hi--) {
      const need = 0b11111 << (hi - 4);
      if ((mask & need) === need) return hi;
    }
    /* 轮子 A-2-3-4-5：A(bit12) + 2,3,4,5(bit0~3) */
    /* Wheel A-2-3-4-5: A (bit 12) + 2,3,4,5 (bits 0-3) */
    if ((mask & 0b1111) === 0b1111 && (mask & (1 << 12))) return 3;
    return -1;
  }

  /** 打包为可比较分数：cat * 16^5 + k0..k4 */
  /** Pack into a comparable score: cat * 16^5 + k0..k4 */
  function pack(cat, ks) {
    let v = cat;
    for (let i = 0; i < 5; i++) v = v * 16 + (ks[i] === undefined ? 0 : ks[i]);
    return v;
  }

  /** 解包分数 */
  /** Unpack a score */
  function unpack(score) {
    const ks = new Array(5);
    let v = score;
    for (let i = 4; i >= 0; i--) { ks[i] = v % 16; v = Math.floor(v / 16); }
    return { cat: v, ks: ks };
  }

  /* 复用缓冲区：单线程下安全，避免蒙特卡洛中成千上万次的内存分配 */
  /* Reusable buffers: safe single-threaded, avoids thousands of allocations in Monte Carlo */
  const _rankCnt  = new Uint8Array(13);
  const _suitCnt  = new Uint8Array(4);
  const _suitMask = new Uint16Array(4);

  /**
   * 评估 5~7 张牌的最强牌型
   * Evaluate the best hand from 5-7 cards
   * @param {number[]} cards 牌的数组
   * @param {number[]} cards array of cards
   * @returns {number} 分数，越大越强（同分数即平手）
   * @returns {number} score, higher is stronger (equal scores tie)
   */
  function evaluate(cards) {
    const n = cards.length;
    const rankCnt = _rankCnt, suitCnt = _suitCnt, suitMask = _suitMask;
    rankCnt.fill(0); suitCnt.fill(0); suitMask[0] = suitMask[1] = suitMask[2] = suitMask[3] = 0;
    let rankMask = 0;

    for (let i = 0; i < n; i++) {
      const c = cards[i], r = c >> 2, s = c & 3;
      rankCnt[r]++;
      suitCnt[s]++;
      suitMask[s] |= (1 << r);
      rankMask |= (1 << r);
    }

    /* 同花 / 同花顺 */
    /* Flush / straight flush */
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) {
      if (suitCnt[s] >= 5) { flushSuit = s; break; }
    }
    if (flushSuit >= 0) {
      const sf = straightHigh(suitMask[flushSuit]);
      if (sf >= 0) return pack(8, [sf]);
    }

    /* 多条统计 */
    /* Multiplicity counts */
    let quad = -1;
    const trips = [], pairs = [];
    for (let r = 12; r >= 0; r--) {
      const k = rankCnt[r];
      if (k === 4) quad = r;
      else if (k === 3) trips.push(r);
      else if (k === 2) pairs.push(r);
    }

    /* 四条 */
    /* Four of a kind */
    if (quad >= 0) {
      let kick = 0;
      for (let r = 12; r >= 0; r--) {
        if (r !== quad && rankCnt[r] > 0) { kick = r; break; }
      }
      return pack(7, [quad, kick]);
    }

    /* 葫芦（可能是两个三条） */
    /* Full house (possibly from two trips) */
    if (trips.length >= 2) return pack(6, [trips[0], trips[1]]);
    if (trips.length === 1 && pairs.length >= 1) return pack(6, [trips[0], pairs[0]]);

    /* 同花 */
    /* Flush */
    if (flushSuit >= 0) {
      const ks = [];
      for (let r = 12; r >= 0 && ks.length < 5; r--) {
        if (suitMask[flushSuit] & (1 << r)) ks.push(r);
      }
      return pack(5, ks);
    }

    /* 顺子 */
    /* Straight */
    const st = straightHigh(rankMask);
    if (st >= 0) return pack(4, [st]);

    /* 三条 */
    /* Three of a kind */
    if (trips.length === 1) {
      const ks = [trips[0]];
      for (let r = 12; r >= 0 && ks.length < 3; r--) {
        if (r !== trips[0] && rankCnt[r] > 0) ks.push(r);
      }
      return pack(3, ks);
    }

    /* 两对 */
    /* Two pair */
    if (pairs.length >= 2) {
      const ks = [pairs[0], pairs[1]];
      for (let r = 12; r >= 0 && ks.length < 3; r--) {
        if (r !== pairs[0] && r !== pairs[1] && rankCnt[r] > 0) ks.push(r);
      }
      return pack(2, ks);
    }

    /* 一对 */
    /* One pair */
    if (pairs.length === 1) {
      const ks = [pairs[0]];
      for (let r = 12; r >= 0 && ks.length < 4; r--) {
        if (r !== pairs[0] && rankCnt[r] > 0) ks.push(r);
      }
      return pack(1, ks);
    }

    /* 高牌 */
    /* High card */
    const ks = [];
    for (let r = 12; r >= 0 && ks.length < 5; r--) {
      if (rankCnt[r] > 0) ks.push(r);
    }
    return pack(0, ks);
  }

  /** 人类可读的牌型描述 */
  /** Human-readable hand description */
  function describe(cards) {
    const score = evaluate(cards);
    const u = unpack(score);
    const cat = u.cat, ks = u.ks;
    const L = r => RANK_LABELS[r];
    let text;
    switch (cat) {
      case 8: text = '同花顺 · ' + (ks[0] === 3 ? '5 高（钢轮）' : L(ks[0]) + ' 高'); break;
      case 7: text = '四条 · ' + L(ks[0]); break;
      case 6: text = '葫芦 · ' + L(ks[0]) + ' 带 ' + L(ks[1]); break;
      case 5: text = '同花 · ' + L(ks[0]) + ' 高'; break;
      case 4: text = '顺子 · ' + (ks[0] === 3 ? '5 高（钢轮）' : L(ks[0]) + ' 高'); break;
      case 3: text = '三条 · ' + L(ks[0]); break;
      case 2: text = '两对 · ' + L(ks[0]) + ' 和 ' + L(ks[1]); break;
      case 1: text = '一对 · ' + L(ks[0]); break;
      default: text = '高牌 · ' + L(ks[0]);
    }
    return { score: score, cat: cat, catName: CAT_NAMES[cat], text: text, ks: ks };
  }

  /** 找出贡献最强牌型的 5 张牌（用于高亮展示） */
  /** Find the 5 cards forming the best hand (for highlight display) */
  function bestFive(cards) {
    const n = cards.length;
    if (n <= 5) return { cards: cards.slice(), score: evaluate(cards) };
    let bestScore = -1, bestCombo = null;
    const comb = [];
    (function rec(start) {
      if (comb.length === 5) {
        const s = evaluate(comb);
        if (s > bestScore) { bestScore = s; bestCombo = comb.slice(); }
        return;
      }
      for (let i = start; i < n; i++) { comb.push(cards[i]); rec(i + 1); comb.pop(); }
    })(0);
    return { cards: bestCombo, score: bestScore };
  }

  /* ---------------- 听牌识别 ---------------- */
  /* ---------------- Draw detection ---------------- */
  /**
   * 听牌强度
   * Draw strength
   *   0 = 无听牌
   *   0 = no draw
   *   1 = 弱听牌（卡顺、双高张）
   *   1 = weak draw (gutshot, two overcards)
   *   2 = 强听牌（同花听牌 / 两头顺 / 组合听牌）
   *   2 = strong draw (flush draw / open-ended / combo draw)
   * @param {number[]} hole  自己的 2 张底牌
   * @param {number[]} hole  your 2 hole cards
   * @param {number[]} board 公共牌（3/4 张时才有意义）
   * @param {number[]} board community cards (meaningful with 3/4 cards)
   */
  function drawTier(hole, board) {
    if (board.length === 0 || board.length >= 5) return 0;
    const all = hole.concat(board);

    /* 同花听牌：某一花色恰好 4 张 */
    /* Flush draw: exactly 4 cards of one suit */
    const suitCnt = [0, 0, 0, 0];
    for (let i = 0; i < all.length; i++) suitCnt[all[i] & 3]++;
    let flushDraw = false;
    for (let s = 0; s < 4; s++) if (suitCnt[s] >= 4) flushDraw = true;

    /* 顺子听牌：统计 5 连窗口中的命中数（含 A 低位） */
    /* Straight draw: count hits in 5-card windows (including the low-A wheel) */
    let mask = 0;
    for (let i = 0; i < all.length; i++) mask |= (1 << (all[i] >> 2));
    let oesd = false, gutshot = false;
    /* hi 从 4 起步：hi=3 的窗口只有 4 个有效点数（2~5），不是合法五连窗口，
       hi starts at 4: the hi=3 window has only 4 valid ranks (2-5), not a legal 5-card window,
       且 1<<(hi-4) 会退化成 1<<-1（JS 位移回绕为 1<<31）。
       and 1<<(hi-4) degenerates to 1<<-1 (JS shifts wrap around to 1<<31).
       A-2-3-4-5 轮子由下方单独处理。
       The A-2-3-4-5 wheel is handled separately below. */
    for (let hi = 4; hi <= 12; hi++) {
      /* 窗口 [hi-4, hi]，以及 A 低位窗口 2-3-4-5-A */
      /* Window [hi-4, hi], plus the low-A wheel window 2-3-4-5-A */
      let window = 0, cnt = 0;
      for (let r = hi - 4; r <= hi; r++) {
        window |= (1 << r);
        if (mask & (1 << r)) cnt++;
      }
      if (cnt !== 4) continue;
      const missing = window & ~(mask & window);
      /* 缺的那张在窗口两端 → 两头顺；在中间 → 卡顺 */
      /* Missing card at either end of the window = open-ended; in the middle = gutshot */
      if (missing === (1 << (hi - 4)) || missing === (1 << hi)) oesd = true;
      else gutshot = true;
    }
    /* 轮子听牌 A-2-3-4-5：A 记在 bit12，低位窗口需要单独处理 */
    /* Wheel draw A-2-3-4-5: A is bit 12, the low window needs separate handling */
    const wheel = (1 << 12) | (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3);
    const wheelCnt = [12, 0, 1, 2, 3].reduce((a, r) => a + ((mask >> r) & 1), 0);
    if (wheelCnt === 4) {
      const miss = [12, 0, 1, 2, 3].filter(r => !((mask >> r) & 1));
      if (miss.length === 1 && (miss[0] === 3 || miss[0] === 12)) oesd = true;
      else gutshot = true;
    }

    if (flushDraw || oesd) return 2;
    if (gutshot) return 1;
    /* 双高张（两张牌都高于所有公共牌）视为弱听牌 */
    /* Two overcards (both higher than every board card) count as a weak draw */
    let maxBoard = -1;
    for (let i = 0; i < board.length; i++) maxBoard = Math.max(maxBoard, board[i] >> 2);
    const overcards = ((hole[0] >> 2) > maxBoard ? 1 : 0) + ((hole[1] >> 2) > maxBoard ? 1 : 0);
    if (overcards === 2 && board.length === 3) return 1;
    return 0;
  }

  /* ---------------- 起手牌抽象（169 类） ---------------- */
  /* ---------------- Starting-hand abstraction (169 classes) ---------------- */
  /** "AKs" / "QQ" / "T9o" */
  function holeKey(c1, c2) {
    let r1 = c1 >> 2, r2 = c2 >> 2;
    const suited = (c1 & 3) === (c2 & 3);
    if (r1 < r2) { const t = r1; r1 = r2; r2 = t; }
    if (r1 === r2) return RANK_CHARS[r1] + RANK_CHARS[r2];
    return RANK_CHARS[r1] + RANK_CHARS[r2] + (suited ? 's' : 'o');
  }

  /** 由抽象 key 还原一副代表牌 */
  /** Reconstruct a representative hand from an abstract key */
  function holeFromKey(key) {
    const r1 = RANK_CHARS.indexOf(key[0]);
    const r2 = RANK_CHARS.indexOf(key[1]);
    if (key.length === 2) return [makeCard(r1, 0), makeCard(r2, 1)];
    const suited = key[2] === 's';
    return [makeCard(r1, 0), makeCard(r2, suited ? 0 : 1)];
  }

  /* ---------------- 导出 ---------------- */
  /* ---------------- Exports ---------------- */
  PK.RANK_CHARS = RANK_CHARS;
  PK.RANK_LABELS = RANK_LABELS;
  PK.SUITS = SUITS;
  PK.CAT_NAMES = CAT_NAMES;
  PK.makeCard = makeCard;
  PK.rankOf = rankOf;
  PK.suitOf = suitOf;
  PK.cardText = cardText;
  PK.cardLabel = cardLabel;
  PK.parseCard = parseCard;
  PK.freshDeck = freshDeck;
  PK.shuffle = shuffle;
  PK.evaluate = evaluate;
  PK.unpack = unpack;
  PK.describe = describe;
  PK.bestFive = bestFive;
  PK.drawTier = drawTier;
  PK.holeKey = holeKey;
  PK.holeFromKey = holeFromKey;

  if (typeof module !== 'undefined' && module.exports) module.exports = PK;
})(typeof globalThis !== 'undefined' ? globalThis : this);
