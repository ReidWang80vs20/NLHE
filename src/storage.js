/* ============================================================
 * storage.js — 战绩与设置的本地持久化
 * storage.js — Local persistence of results and settings
 *   把累计战绩、盈亏曲线、设置、最近手牌记录写进 localStorage，
 *   Writes cumulative results, the profit/loss curve, settings, and recent
 *   hand records into localStorage,
 *   关闭浏览器再打开仍然累积，长期趋势才有意义。
 *   so they keep accumulating after the browser is closed and reopened,
 *   which is what makes long-term trends meaningful.
 *   数据损坏 / 存储不可用（隐私模式）时自动降级为内存模式，不影响游玩。
 *   On corrupt data / unavailable storage (private mode), it automatically
 *   degrades to in-memory mode without affecting gameplay.
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK;

  const KEY = 'nlhe-trainer-v1';
  const VERSION = 1;
  const LIMIT_HISTORY = 600;   // 盈亏曲线保留的点数 / number of points kept for the profit/loss curve
  const LIMIT_RECENTS = 60;    // 复盘保留的手数 / number of hands kept for review
  const SAVE_DEBOUNCE = 250;   // 写盘合并窗口（ms） / write coalescing window (ms)

  function emptyStats() {
    return {
      hands: 0, vpip: 0, pfr: 0, netProfit: 0, history: [],
      showdowns: 0, showdownWins: 0, biggestPot: 0,
    };
  }

  function defaults() {
    return {
      version: VERSION,
      cfg: { seats: 6, blinds: '1/2', stackBB: 100, aiSpeed: 900 },
      stats: emptyStats(),
      handNo: 0,
      heroStack: null,
      recents: [],
      drill: { attempts: 0, correct: 0, byId: {} },
      profile: null,
    };
  }

  /* ---------------- 存储后端探测 ---------------- */
  /* ---------------- Storage backend detection ---------------- */
  let backend = null;
  let usable = null;

  function getBackend() {
    if (usable !== null) return backend;
    try {
      const ls = global.localStorage;
      const probe = '__nlhe_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      backend = ls;
      usable = true;
    } catch (e) {
      /* file:// 下被禁用、或浏览器处于无痕模式 */
      /* Disabled under file://, or the browser is in incognito mode */
      backend = null;
      usable = false;
    }
    return backend;
  }

  function isAvailable() { getBackend(); return usable; }

  /* ---------------- 读取 ---------------- */
  /* ---------------- Load ---------------- */
  function num(v, dft) {
    return typeof v === 'number' && isFinite(v) ? v : dft;
  }

  function sanitizeStats(raw) {
    const s = emptyStats();
    if (!raw || typeof raw !== 'object') return s;
    s.hands = Math.max(0, num(raw.hands, 0));
    s.vpip = Math.max(0, num(raw.vpip, 0));
    s.pfr = Math.max(0, num(raw.pfr, 0));
    s.netProfit = num(raw.netProfit, 0);
    s.showdowns = Math.max(0, num(raw.showdowns, 0));
    s.showdownWins = Math.max(0, num(raw.showdownWins, 0));
    s.biggestPot = Math.max(0, num(raw.biggestPot, 0));
    if (Array.isArray(raw.history)) {
      s.history = raw.history.filter(v => typeof v === 'number' && isFinite(v));
      if (s.history.length > LIMIT_HISTORY) s.history = s.history.slice(-LIMIT_HISTORY);
    }
    return s;
  }

  /**
   * 漏洞画像存档：这里只做"是不是一个对象"的粗校验。
   * Leak profile persistence: only a rough "is it an object?" check is done here.
   * 字段形状（尤其是嵌套的 faced 缺街）由 PK.Profile 的 stats setter 统一保证 ——
   * The field shape (especially the nested faced street gaps) is guaranteed in one
   * place by PK.Profile's stats setter —
   * 结构定义只留一处，避免两个文件各写一份、日后改字段时漏改一边。
   * the structure is defined in only one place, avoiding two files each keeping a
   * copy and one side being missed when a field changes later.
   */
  function sanitizeProfile(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw;
  }

  function load() {
    const dft = defaults();
    const ls = getBackend();
    if (!ls) return dft;

    let raw;
    try {
      const text = ls.getItem(KEY);
      if (!text) return dft;
      raw = JSON.parse(text);
    } catch (e) {
      /* 数据损坏：丢掉这份坏数据，回到默认值 */
      /* Corrupted data: drop this bad copy and fall back to defaults */
      try { ls.removeItem(KEY); } catch (e2) { /* ignore */ }
      return dft;
    }
    if (!raw || typeof raw !== 'object') return dft;

    const out = dft;
    out.version = VERSION;

    if (raw.cfg && typeof raw.cfg === 'object') {
      const c = raw.cfg;
      out.cfg = {
        seats: [2, 3, 4, 6, 9].indexOf(num(c.seats, 6)) >= 0 ? c.seats : 6,
        blinds: ['1/2', '2/5', '5/10'].indexOf(c.blinds) >= 0 ? c.blinds : '1/2',
        stackBB: [50, 100, 200].indexOf(num(c.stackBB, 100)) >= 0 ? c.stackBB : 100,
        aiSpeed: num(c.aiSpeed, 900),
      };
    }

    out.stats = sanitizeStats(raw.stats);
    out.handNo = Math.max(0, num(raw.handNo, 0));
    out.heroStack = raw.heroStack === null || raw.heroStack === undefined ? null : num(raw.heroStack, null);
    /* 旧存档里可能已经带着被撑大的缓存（历史版本的 recents 是原样存下来的），
       这里顺手剥一次，下次写盘就回收了空间。 */
    /* Older saves may already carry bloated caches (older versions stored
       recents verbatim); strip them once here, and the next write reclaims
       the space. */
    out.recents = Array.isArray(raw.recents) ? raw.recents.slice(-LIMIT_RECENTS).map(stripRec) : [];

    if (raw.drill && typeof raw.drill === 'object') {
      out.drill = {
        attempts: Math.max(0, num(raw.drill.attempts, 0)),
        correct: Math.max(0, num(raw.drill.correct, 0)),
        byId: raw.drill.byId && typeof raw.drill.byId === 'object' ? raw.drill.byId : {},
      };
    }
    out.profile = sanitizeProfile(raw.profile);
    return out;
  }

  /* ---------------- 写入（防抖） ---------------- */
  /* ---------------- Write (debounced) ---------------- */
  let pending = null;
  let timer = null;

  function writeNow(state) {
    const ls = getBackend();
    if (!ls) return false;
    try {
      ls.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      /* 超出配额等情况：静默降级 */
      /* Over quota, etc.: degrade silently */
      return false;
    }
  }

  /**
   * 保存一份快照。短时间内多次调用只会写一次盘。
   * Save a snapshot. Repeated calls within a short window write to disk only once.
   * @param {object} state 由 collect() 生成的完整状态
   * @param {object} state full state produced by collect()
   */
  function save(state) {
    pending = state;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const s = pending;
      pending = null;
      if (s) writeNow(s);
    }, SAVE_DEBOUNCE);
  }

  /** 立即写盘（页面隐藏 / 关闭前调用，防抖中的数据不能丢） */
  /** Flush to disk immediately (called before page hide / close; debounced data must not be lost) */
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending) { writeNow(pending); pending = null; }
  }

  function clear() {
    if (timer) { clearTimeout(timer); timer = null; }
    pending = null;
    const ls = getBackend();
    if (ls) { try { ls.removeItem(KEY); } catch (e) { /* ignore */ } }
  }

  /**
   * 剥掉一手记录里的运行时缓存字段（约定：下划线开头，如 replay.js 的 `_eq`、
   * evloss.js 的 `_evloss`），只保留牌局本身的数据。
   * Strip runtime cache fields from a hand record (by convention, underscore-
   * prefixed names such as replay.js's `_eq` and evloss.js's `_evloss`), keeping
   * only the hand's own data.
   *
   * 为什么必须剥：缓存里装着 Float64Array（169 类范围权重向量）。
   * Why this is mandatory: the cache holds a Float64Array (a 169-class range
   * weight vector).
   * JSON.stringify 会把它序列化成 {"0":0.13,"1":0.98,...} —— 一个 60 手牌的存档
   * JSON.stringify serializes it as {"0":0.13,"1":0.98,...} — a 60-hand save
   * 会被撑到几 MB，直接顶穿 localStorage 配额（5MB），之后**整个存档静默写不进去**，
   * balloons to several MB, blowing straight through the localStorage quota (5MB),
   * after which **the entire save silently fails to write**,
   * 玩家的战绩与画像从此不再落盘，而且不报任何错。剥完只剩几百字节。
   * the player's results and profile stop being persisted from then on, with no
   * error reported at all. After stripping, only a few hundred bytes remain.
   */
  function stripRec(r) {
    if (!r || typeof r !== 'object') return r;
    const out = {};
    for (const k of Object.keys(r)) {
      if (k.charCodeAt(0) === 95 /* '_' */) continue;
      out[k] = r[k];
    }
    return out;
  }

  /** 从一局游戏对象采集可持久化的状态 */
  /** Collect the persistable state from a game object */
  function collect(game, cfgState) {
    const s = game.stats || emptyStats();
    const history = s.history.length > LIMIT_HISTORY ? s.history.slice(-LIMIT_HISTORY) : s.history.slice();
    return {
      version: VERSION,
      cfg: cfgState ? {
        seats: cfgState.seats, blinds: cfgState.blinds,
        stackBB: cfgState.stackBB, aiSpeed: cfgState.aiSpeed,
      } : undefined,
      stats: {
        hands: s.hands, vpip: s.vpip, pfr: s.pfr, netProfit: s.netProfit,
        history: history,
        showdowns: s.showdowns, showdownWins: s.showdownWins, biggestPot: s.biggestPot,
      },
      handNo: game.handNo,
      heroStack: game.players && game.players[0] ? game.players[0].stack : null,
      recents: (game.recents || []).slice(-LIMIT_RECENTS).map(stripRec),
      drill: PK.Drill ? PK.Drill.stats() : undefined,
      /* 漏洞画像：AI 的剥削权重完全由它推导，不存下来就等于每次开页从零学起 */
      /* Leak profile: the AI's exploit weights are derived entirely from it, so not persisting it means relearning from scratch on every page load */
      profile: PK.Profile ? PK.Profile.stats : undefined,
    };
  }

  PK.Store = {
    KEY, LIMIT_HISTORY, LIMIT_RECENTS,
    emptyStats, defaults,
    load, save, flush, clear, collect, isAvailable,
    sanitizeProfile, stripRec,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
