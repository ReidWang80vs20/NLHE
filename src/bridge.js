/* ============================================================
 * bridge.js — 与心算题库（D:\todo\NLHE）的联动
 * bridge.js — Integration with the mental-math question bank (D:\todo\NLHE)
 *
 * 两个应用是**各自独立的单文件页面**，不能互相 require。它们之间唯一的
 * The two apps are **independent single-file pages** that cannot require each
 * other. The only thing they share
 * 共同点，是浏览器里同一来源（file:// 下的 localStorage）——已实测确认
 * is the same origin in the browser (localStorage under file://) — it has been
 * verified in practice that
 * 跨目录的 file:// 页面共享同一个 localStorage 源，所以这里可以直接读
 * file:// pages across directories share the same localStorage origin, so we can
 * read the question bank's save directly here,
 * 题库的存档，不需要任何后端或文件系统访问。
 * with no backend or file-system access required.
 *
 * 职责：
 * Responsibilities:
 *   1. 读题库存档（nlhe_trainer_v1），解析出进度 / 弱项 / 连胜 / 今日完成
 *   1. Read the question bank's save (nlhe_trainer_v1) and parse progress / weak
 *      spots / streak / today's completion
 *   2. 把"我的漏洞"映射成"该练哪几道题"（映射表在 profile.js 的 TOPIC_FOR）
 *   2. Map "my leaks" to "which questions to practice" (the mapping table is
 *      TOPIC_FOR in profile.js)
 *   3. 生成跳转链接
 *   3. Generate the jump link
 *
 * ⚠️ TOPICS 这张表是对题库侧 TOPICS 的**有意复制**：
 * ⚠️ This TOPICS table is a **deliberate copy** of the question bank's TOPICS:
 *   跨页面读不到对方的代码，只能复制。为避免两边悄悄漂移，
 *   code cannot be read across pages, so copying is the only option. To keep the
 *   two sides from silently drifting apart,
 *   test/check-bridge.js 会直接解析 D:\todo\NLHE\index.html 里的 TOPICS 块，
 *   test/check-bridge.js parses the TOPICS block in D:\todo\NLHE\index.html
 *   directly,
 *   逐键比对 —— 题目增删改名会让测试变红，而不是静默失配。
 *   comparing key by key — adding, removing, or renaming a topic turns the test
 *   red instead of silently mismatching.
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK || (global.PK = {});

  /** 题库的存档键与页面地址 */
  /** The question bank's save key and page URL */
  const DRILL_KEY = 'nlhe_trainer_v1';
  const DRILL_PATH = 'D:/todo/NLHE/index.html';
  const DRILL_URL = 'file:///' + DRILL_PATH;

  /** 与题库侧 UNLOCK_ATT / UNLOCK_ACC 保持一致 */
  /** Kept in sync with the question bank's UNLOCK_ATT / UNLOCK_ACC */
  const UNLOCK_ATT = 20;
  const UNLOCK_ACC = 0.75;
  /** 与题库侧一致：样本少于这个数的题目不上榜 */
  /** Same as the question bank: topics with fewer samples than this do not make the ranking */
  const TOPIC_MIN_ATT = 5;
  /** 正确率低于这个值算"弱项" */
  /** An accuracy below this value counts as a "weak spot" */
  const WEAK_ACC = 0.60;

  /* 题库的 21 个知识点（顺序 = 阶段顺序） */
  /* The question bank's 21 topics (order = stage order) */
  const TOPICS = {
    s1_r2p: { stage: 1, name: '赔率→胜率', formula: '胜率 = 风险 / (风险 + 回报)' },
    s1_p2r: { stage: 1, name: '胜率→赔率', formula: '赔率 = (1−胜率) : 胜率' },
    s1_frac: { stage: 1, name: '分数→百分比', formula: '常用分数秒算' },
    s1_reward: { stage: 1, name: '保本回报额', formula: '回报 = 风险 × (1−胜率) / 胜率' },
    s2_outs: { stage: 2, name: '补牌数', formula: '枚举所有未知牌，统计能成顺/成花的牌' },
    s2_rule: { stage: 2, name: '乘二乘四估算', formula: '翻牌圈 ×4，转牌圈 ×2' },
    s2_exact: { stage: 2, name: '精确成牌率', formula: '翻牌圈 1 − C(47−o,2)/C(47,2)；转牌圈 o/46' },
    s3_req: { stage: 3, name: '所需最低胜率', formula: '胜率 = 跟注额 / (底池 + 2×跟注额)' },
    s3_decide: { stage: 3, name: '跟注/弃牌判断', formula: '实际胜率 ≥ 所需胜率 → 跟注' },
    s3_maxcall: { stage: 3, name: '最大可跟注额', formula: '跟注额 = 底池 × 胜率/(1−胜率)' },
    s3_fe: { stage: 3, name: '所需弃牌率', formula: '弃牌率 = 下注额 / (底池 + 下注额)' },
    s3_size: { stage: 3, name: '下注尺度换算', formula: '下注额 = 底池 × 尺度' },
    s4_single: { stage: 4, name: '单类组合数', formula: '对子 6；同花 4；不同花 12；不指定 16' },
    s4_dead: { stage: 4, name: '已知牌修正', formula: '扣除已知牌后逐张枚举' },
    s4_range: { stage: 4, name: '范围组合数', formula: '各牌型组合数求和' },
    s4_pct: { stage: 4, name: '范围占比', formula: '占比 = 范围组合数 / 1225' },
    s5_callev: { stage: 5, name: '跟注 EV', formula: 'EV = 胜率×(底池+跟注) − (1−胜率)×跟注' },
    s5_bluffev: { stage: 5, name: '诈唬 EV', formula: 'EV = 弃牌率×底池 − (1−弃牌率)×下注额' },
    s5_semiev: { stage: 5, name: '半诈唬 EV', formula: 'EV = F×底池 + (1−F)×[E×(底池+B) − (1−E)×B]' },
    s5_bebet: { stage: 5, name: '保本下注额', formula: 'B = 胜率×底池/(1−2×胜率)' },
    s5_compare: { stage: 5, name: '方案对比', formula: '分别求 EV 后比较' },
  };

  const TOPIC_KEYS = Object.keys(TOPICS);

  /** 漏洞 id → 人话（用于"为什么要练这几题"） */
  /** Leak id → plain language (used for "why practice these questions") */
  const LEAK_CN = {
    foldTooMuch: '面对下注弃牌过多',
    callTooMuch: '跟注过多、弃不掉牌',
    tooTight: '翻前过紧',
    tooLoose: '翻前过松',
    passive: '打得偏被动',
    overFold3Bet: '面对 3-bet 弃牌过多',
    riverOverCall: '河牌跟注过多',
    bigBetSize: '下注尺度过大',
    sticky: '粘牌、不愿放弃',
  };

  /* ============================================================
   * 1. 读题库存档
   * 1. Read the question bank save
   * ============================================================ */

  function readRaw() {
    try {
      const ls = global.localStorage;
      if (!ls) return null;
      const text = ls.getItem(DRILL_KEY);
      if (!text) return null;
      const raw = JSON.parse(text);
      return raw && typeof raw === 'object' ? raw : null;
    } catch (e) {
      /* file:// 下被禁用、无痕模式、或数据损坏 —— 一律当"读不到"处理，
         Disabled under file://, incognito mode, or corrupt data — all are treated
         as "unreadable",
         不能让联动面板因为对方的数据问题而打不开。
         and the bridge panel must not fail to open because of the other side's
         data problems. */
      return null;
    }
  }

  const n0 = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

  /* 只接受"普通对象"。数组 / 字符串 / 数字都不是合法存档 —— 当成无数据，
     Only "plain objects" are accepted. Arrays / strings / numbers are not valid
     saves — treat them as no data,
     否则会把 '[1,2,3]' 这种垃圾读成"有存档但零记录"，面板上显示成"还没练过"
     otherwise junk like '[1,2,3]' would be read as "a save exists but has zero
     records" and the panel would show "not practiced yet"
     而不是"读不到题库"，两种情况该给的提示完全不同。
     instead of "cannot read the question bank"; the two cases warrant completely
     different messages. */
  const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /** 把存档规整成内部形状，缺失字段一律补 0，绝不抛异常 */
  /** Normalize the save into the internal shape, default missing fields to 0, and never throw */
  function normalize(raw) {
    if (!isPlain(raw)) return null;
    const d = {
      available: true,
      settings: { goalPerDay: 30, sessionSize: 10 },
      daily: {}, topics: {}, streak: { last: null, days: 0, best: 0 },
      stages: {}, attempts: 0, correct: 0, mistakes: 0,
      topicAttempts: 0, lastAt: null,
    };
    if (isPlain(raw.settings)) {
      d.settings.goalPerDay = n0(raw.settings.goalPerDay) || 30;
      d.settings.sessionSize = n0(raw.settings.sessionSize) || 10;
    }
    if (isPlain(raw.daily)) {
      for (const k of Object.keys(raw.daily)) {
        const v = raw.daily[k];
        if (isPlain(v)) {
          d.daily[k] = { att: n0(v.att), ok: Math.min(n0(v.ok), n0(v.att)) };
        }
      }
    }
    if (isPlain(raw.topics)) {
      for (const k of Object.keys(raw.topics)) {
        if (!TOPICS[k]) continue;                 // 题库里删掉的题不再显示
        // EN: topics deleted from the question bank are no longer shown
        const v = raw.topics[k];
        if (isPlain(v)) {
          const att = n0(v.att), ok = Math.min(n0(v.ok), n0(v.att));
          d.topics[k] = { att: att, ok: ok, acc: att > 0 ? ok / att : 0 };
          d.topicAttempts += att;
        }
      }
    }
    if (isPlain(raw.streak)) {
      d.streak = {
        last: typeof raw.streak.last === 'string' ? raw.streak.last : null,
        days: n0(raw.streak.days), best: n0(raw.streak.best),
      };
    }
    if (isPlain(raw.stages)) {
      for (let i = 1; i <= 5; i++) {
        const v = raw.stages[i] || raw.stages[String(i)];
        d.stages[i] = isPlain(v)
          ? { att: n0(v.att), ok: Math.min(n0(v.ok), n0(v.att)) }
          : { att: 0, ok: 0 };
      }
    } else {
      for (let i = 1; i <= 5; i++) d.stages[i] = { att: 0, ok: 0 };
    }
    /* 总题数按**阶段累计**求和 —— 题库概览页显示的正是这个口径
       The total question count is summed from the **per-stage totals** — that is
       exactly the figure shown on the question bank's overview page
       （`Object.values(D.stages).reduce(...)`）。若改用 daily 求和，
       (`Object.values(D.stages).reduce(...)`). If it were summed from daily instead,
       一旦存档是导入的、或某天没记 daily，两边的"总题数"就会互相矛盾。
       then once a save is imported, or some day has no daily entry, the two
       sides' "total questions" would contradict each other. */
    for (let i = 1; i <= 5; i++) { d.attempts += d.stages[i].att; d.correct += d.stages[i].ok; }
    /* 题库有一个"强制解锁"开关（设置页），镜像过来，否则两边显示不一致 */
    /* The question bank has a "force unlock" toggle (settings page); mirror it, otherwise the two sides display inconsistently */
    d.forcedUnlock = raw.forcedUnlock === true;
    d.mistakes = Array.isArray(raw.mistakes) ? raw.mistakes.length : 0;
    const hist = Array.isArray(raw.history) ? raw.history : [];
    d.historyCount = hist.length;
    if (hist.length) {
      const lastOk = hist.slice(-20);
      d.recentAcc = lastOk.filter(x => x && x.ok).length / lastOk.length;
      const t = hist[hist.length - 1] && hist[hist.length - 1].t;
      d.lastAt = typeof t === 'number' ? t : null;
      /* 最近 20 题里错得最多的知识点 —— 比"历史正确率"更能反映当前状态 */
      /* The most-missed topic among the last 20 questions — reflects the current state better than historical accuracy */
      const cnt = {};
      for (const h of lastOk) {
        if (!h || h.ok || !TOPICS[h.topic]) continue;
        cnt[h.topic] = (cnt[h.topic] || 0) + 1;
      }
      d.recentMiss = Object.keys(cnt)
        .map(k => ({ key: k, n: cnt[k] }))
        .sort((a, b) => b.n - a.n);
    } else {
      d.recentAcc = null;
      d.recentMiss = [];
    }
    d.overallAcc = d.attempts > 0 ? d.correct / d.attempts : null;
    return d;
  }

  let cached = null;
  let cachedAt = 0;

  /**
   * 读题库进度。默认做短时缓存 —— 面板一次渲染会问好几次，
   * Read the question bank progress. Short-lived caching is on by default —
   * a single panel render asks several times,
   * 而每次都 JSON.parse 整个存档（含最多 4000 条历史）没必要。
   * and JSON.parsing the whole save (up to 4000 history entries) every time is
   * unnecessary.
   */
  function progress(opts) {
    opts = opts || {};
    const now = Date.now();
    if (!opts.fresh && cached && now - cachedAt < 1500) return cached;
    cached = normalize(readRaw());
    cachedAt = now;
    return cached;
  }

  function available() {
    const p = progress();
    return !!(p && p.available &&
      (p.attempts > 0 || p.topicAttempts > 0 || p.historyCount > 0));
  }

  /* ============================================================
   * 2. 弱项与"该练什么"
   * 2. Weak spots and "what to practice"
   * ============================================================ */

  /** 今日完成情况（按本地日期，与题库的 todayKey 同格式 YYYY-MM-DD） */
  /** Today's completion (by local date, same YYYY-MM-DD format as the question bank's todayKey) */
  function todayKey(d) {
    const t = d || new Date();
    const p = (x) => (x < 10 ? '0' + x : '' + x);
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  function today() {
    const p = progress();
    const k = todayKey();
    const d = (p && p.daily[k]) || { att: 0, ok: 0 };
    const goal = (p && p.settings.goalPerDay) || 30;
    return {
      key: k, att: d.att, ok: d.ok, goal: goal,
      acc: d.att > 0 ? d.ok / d.att : null,
      done: d.att >= goal,
      remain: Math.max(0, goal - d.att),
    };
  }

  /** 各知识点的正确率排行（只统计样本够的），弱的在前 */
  /** Topic accuracy ranking (only topics with enough samples); weakest first */
  function topicStats() {
    const p = progress();
    const out = TOPIC_KEYS.map(k => {
      const info = TOPICS[k];
      const v = (p && p.topics[k]) || { att: 0, ok: 0, acc: 0 };
      return {
        key: k, stage: info.stage, name: info.name, formula: info.formula,
        att: v.att, ok: v.ok, acc: v.acc,
        graded: v.att >= TOPIC_MIN_ATT,
        weak: v.att >= TOPIC_MIN_ATT && v.acc < WEAK_ACC,
      };
    });
    out.sort((a, b) => {
      const ag = a.graded ? 0 : 1, bg = b.graded ? 0 : 1;
      if (ag !== bg) return ag - bg;                 // 有样本的排前面 / those with samples come first
      if (a.graded && b.graded) return a.acc - b.acc; // 正确率低的排前面 / lower accuracy comes first
      return a.att - b.att;                          // 都没样本：练得少的排前面
      // EN: neither has samples: the less-practiced one comes first
    });
    return out;
  }

  /**
   * 把画像漏洞映射成练习清单。
   * Map profile leaks to a practice list.
   * @param leakIds 漏洞 id 数组（来自 PK.Profile.leaks()）
   * @param leakIds array of leak ids (from PK.Profile.leaks())
   * @returns [{key, stage, name, formula, reason, acc, att, weak}]
   */
  function practiceFor(leakIds) {
    const p = progress();
    const seen = {};
    const out = [];
    const ids = leakIds && leakIds.length ? leakIds : [];
    for (const id of ids) {
      const keys = (PK.Profile && PK.Profile.TOPIC_FOR && PK.Profile.TOPIC_FOR[id]) || [];
      for (const k of keys) {
        if (seen[k] || !TOPICS[k]) continue;
        seen[k] = true;
        const st = (p && p.topics[k]) || { att: 0, ok: 0, acc: 0 };
        out.push({
          key: k, stage: TOPICS[k].stage, name: TOPICS[k].name,
          formula: TOPICS[k].formula,
          reason: LEAK_CN[id] || id,
          att: st.att, acc: st.att > 0 ? st.acc : null,
          weak: st.att >= TOPIC_MIN_ATT && st.acc < WEAK_ACC,
        });
      }
    }
    /* 已经练得很好的排后面；没练过的排最前（最该补） */
    /* Well-practiced ones go later; never-practiced ones go first (most in need of work) */
    out.sort((a, b) => {
      const av = a.acc === null ? -1 : a.acc;
      const bv = b.acc === null ? -1 : b.acc;
      return av - bv;
    });
    return out;
  }

  /**
   * 阶段解锁状态。
   * Stage unlock status.
   *
   * ⚠️ 语义必须与题库逐字一致：题库的 `isStageOpen(i)` 只看**紧邻的前一阶段**
   * ⚠️ The semantics must match the question bank word for word: the bank's
   * `isStageOpen(i)` only looks at the **immediately preceding stage**,
   *    `i===1 || forcedUnlock || stagePassed(i-1)`，而不是"前面所有阶段都得通过"。
   *    `i===1 || forcedUnlock || stagePassed(i-1)`, not "all previous stages must pass".
   *    平时两者等价（没通过前一阶段就进不去后一阶段），但题库支持**导入存档**
   *    Normally the two are equivalent (you cannot enter the next stage without
   *    passing the previous one), but the bank supports **importing saves**
   *    与**强制解锁**，那时"阶段 3 有数据、阶段 1 没有"是可能的 —— 若这里写成
   *    and **force unlock**, in which case "stage 3 has data but stage 1 does not"
   *    is possible — if this were written as
   *    链式与运算，界面会把题库里明明解锁的阶段显示成锁定。
   *    a chained AND, the UI would show stages as locked that the bank clearly
   *    has unlocked.
   */
  function stages() {
    const p = progress();
    const force = !!(p && p.forcedUnlock);
    const raw = {};
    for (let i = 1; i <= 5; i++) raw[i] = (p && p.stages[i]) || { att: 0, ok: 0 };
    const accOf = (i) => (raw[i].att > 0 ? raw[i].ok / raw[i].att : 0);
    const passed = (i) => raw[i].att >= UNLOCK_ATT && accOf(i) >= UNLOCK_ACC;

    const out = [];
    for (let i = 1; i <= 5; i++) {
      const v = raw[i];
      out.push({
        stage: i, att: v.att, ok: v.ok,
        /* 无样本时给 null（与题库的 stageAcc 一致），不要让界面把"没练过"显示成 0% */
        /* Give null when there are no samples (consistent with the bank's stageAcc); do not let the UI show "never practiced" as 0% */
        acc: v.att > 0 ? v.ok / v.att : null,
        unlocked: i === 1 || force || passed(i - 1),
        passed: passed(i),
        needAtt: Math.max(0, UNLOCK_ATT - v.att),
      });
    }
    return out;
  }

  /* ============================================================
   * 3. 跳转
   * 3. Navigation
   * ============================================================ */

  /**
   * 打开心算题库。
   * Open the mental-math question bank.
   * 两个页面是独立的窗口，Tab 之间无法直接传参，因此这里只负责"打开"，
   * The two pages are separate windows and tabs cannot pass parameters directly,
   * so this only handles "opening" them
   * 不试图定位到具体题目 —— 面板上会把要练的题目名列出来，照着点即可。
   * and does not try to jump to a specific question — the panel lists the topic
   * names to practice, so just click them.
   * @returns {boolean} 是否成功发起打开
   * @returns {boolean} whether the open was successfully initiated
   */
  function openDrill() {
    try {
      const w = global.open(DRILL_URL, '_blank');
      return !!w;
    } catch (e) {
      return false;
    }
  }

  PK.Bridge = {
    DRILL_KEY, DRILL_PATH, DRILL_URL,
    UNLOCK_ATT, UNLOCK_ACC, TOPIC_MIN_ATT, WEAK_ACC,
    TOPICS, TOPIC_KEYS, LEAK_CN,
    readRaw, normalize, progress, available,
    todayKey, today, topicStats, practiceFor, stages, openDrill,
    invalidate() { cached = null; cachedAt = 0; },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PK;
})(typeof globalThis !== 'undefined' ? globalThis : this);
