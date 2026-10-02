/* ============================================================
 * drill.js — 情境训练（Drill）
 * drill.js — Scenario drill
 *   固定牌局局面 + 明确决策点，选完立刻给出「最优 / 可接受 / 失误」
 *   Fixed poker situations + explicit decision points; once you choose, it
 *   immediately gives "best / acceptable / blunder"
 *   以及为什么。随机对局练的是手感，这里练的是具体决策。
 *   plus the reasoning. Random play trains your feel; this trains specific decisions.
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK;
  const $ = s => document.querySelector(s);

  const STREET_CN = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };

  /* ---------------- 场景库 ----------------
   * ---------------- Scenario library ----------------
   * 题库数据在 scenarios.js（每个场景的筹码/底池/下注额都已按真实牌局推演过）。
   * Question bank data lives in scenarios.js (every scenario's chips/pot/bet sizing
   * has been played out as a real hand).
   */
  const SCENARIOS = PK.SCENARIOS || [];

  const KEY_STATS = ['翻牌前', '翻牌后'];

  let state = {
    filter: '全部',
    order: [],      // 过滤后的场景下标顺序（可打乱） / order of filtered scenario indices (can be shuffled)
    pos: 0,         // 当前在第几个 / index of the current one
    chosen: null,   // 本轮选择 / this round's choice
    attempts: 0,
    correct: 0,
    byId: {},
  };

  let bound = false;

  /* ---------------- 持久化 ---------------- */
  /* ---------------- Persistence ---------------- */
  function stats() {
    return { attempts: state.attempts, correct: state.correct, byId: state.byId };
  }
  function restore(data) {
    if (!data) return;
    state.attempts = Math.max(0, data.attempts | 0);
    state.correct = Math.max(0, data.correct | 0);
    state.byId = data.byId && typeof data.byId === 'object' ? data.byId : {};
  }

  /* ---------------- 工具 ---------------- */
  /* ---------------- Utilities ---------------- */
  function cardHTML(c) {
    const red = PK.SUITS[PK.suitOf(c)].red ? ' red' : '';
    return '<div class="rp-card' + red + '">' +
      '<span class="r">' + PK.RANK_LABELS[PK.rankOf(c)] + '</span>' +
      '<span class="s">' + PK.SUITS[PK.suitOf(c)].sym + '</span></div>';
  }

  function rebuildOrder() {
    const idx = [];
    for (let i = 0; i < SCENARIOS.length; i++) {
      if (state.filter === '全部' || SCENARIOS[i].cat === state.filter) idx.push(i);
    }
    /* 打乱，避免每次都是同样顺序 */
    /* Shuffle, so the order is not always the same */
    for (let i = idx.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    state.order = idx;
    state.pos = 0;
    state.chosen = null;
  }

  function current() {
    if (!state.order.length) return null;
    return SCENARIOS[state.order[state.pos % state.order.length]];
  }

  /* ---------------- 渲染 ---------------- */
  /* ---------------- Rendering ---------------- */
  function renderStats() {
    const acc = state.attempts ? Math.round(state.correct / state.attempts * 100) : 0;
    $('#drill-stats').innerHTML =
      '<span>已练 <b>' + state.attempts + '</b> 题</span>' +
      '<span>答对 <b class="ok">' + state.correct + '</b></span>' +
      '<span>正确率 <b>' + (state.attempts ? acc + '%' : '—') + '</b></span>' +
      '<span class="drill-progress">' +
        (state.order.length ? (state.pos % state.order.length + 1) + ' / ' + state.order.length : '0 / 0') +
      '</span>';
  }

  function renderScene() {
    const box = $('#drill-stage');
    const s = current();

    if (!s) {
      box.innerHTML = '<div class="rp-empty">该分类下暂无题目</div>';
      return;
    }

    let board = '';
    for (let i = 0; i < 5; i++) {
      board += i < s.board.length ? cardHTML(PK.parseCard(s.board[i])) : '<div class="rp-slot"></div>';
    }
    const hole = s.heroHole.map(c => cardHTML(PK.parseCard(c))).join('');

    let opts = '';
    for (let i = 0; i < s.options.length; i++) {
      const o = s.options[i];
      let cls = 'drill-opt';
      if (state.chosen) {
        if (o.key === state.chosen.key) cls += ' picked v-' + o.verdict;
        else cls += ' muted';
        if (o.verdict === 'best' && state.chosen.key !== o.key) cls += ' wasbest';
      }
      opts += '<button class="' + cls + '" data-key="' + o.key + '"' +
        (state.chosen ? ' disabled' : '') + '>' + o.text + '</button>';
    }

    /* 评价区 */
    /* Feedback area */
    let feedback = '';
    if (state.chosen) {
      const c = state.chosen;
      const label = { best: '✅ 最优解', ok: '🟡 可以接受', bad: '❌ 失误' }[c.verdict] || '';
      const bestOpt = s.options.find(o => o.verdict === 'best');
      feedback =
        '<div class="drill-fb ' + c.verdict + '">' +
          '<div class="fb-head">' + label + '　你选了「' + c.text + '」</div>' +
          (c.verdict === 'best' ? '' :
            '<div class="fb-best">参考最优：「' + bestOpt.text + '」</div>') +
          '<div class="fb-body">' + c.comment + '</div>' +
          (c.key !== bestOpt.key ? '<div class="fb-body fb-note">最优解的理由：' + bestOpt.comment + '</div>' : '') +
        '</div>';
    } else {
      feedback = '<div class="drill-fb hint">选择你的动作，立刻看到评价</div>';
    }

    let points = '';
    if (state.chosen) {
      points = '<div class="drill-points"><h4>本题要点</h4><ul>' +
        s.points.map(p => '<li>' + p + '</li>').join('') + '</ul></div>';
    }

    box.innerHTML =
      '<div class="rp-head">' +
        '<b>' + s.title + '</b>' +
        '<span>' + STREET_CN[s.street] + '</span>' +
        '<span>' + (s.seats === 2 ? '单挑底池' : s.seats + ' 人池') + '</span>' +
        '<span>你的位置 ' + s.heroPos + '</span>' +
      '</div>' +
      '<div class="rp-line"><span class="rp-label">公共牌</span><div class="rp-board">' + board + '</div>' +
        '<span class="rp-pot">底池 <b>' + s.pot + '</b></span></div>' +
      '<div class="rp-line"><span class="rp-label">你的底牌</span><div class="rp-board">' + hole + '</div>' +
        '<span class="rp-pot">有效筹码 <b>' + s.effStack + '</b></span></div>' +
      '<div class="drill-desc">' + s.desc + '</div>' +
      '<div class="drill-q">' + s.question +
        (s.toCall > 0 ? '　<span class="need">需要跟注 ' + s.toCall + '</span>' : '　<span class="need">无人下注</span>') +
      '</div>' +
      '<div class="drill-opts">' + opts + '</div>' +
      feedback + points;
  }

  function renderAll() {
    renderStats();
    renderScene();
  }

  /* ---------------- 交互 ---------------- */
  /* ---------------- Interaction ---------------- */
  function choose(key) {
    const s = current();
    if (!s || state.chosen) return;
    const opt = s.options.find(o => o.key === key);
    if (!opt) return;

    state.chosen = opt;
    state.attempts++;
    if (opt.verdict === 'best') state.correct++;
    state.byId[s.id] = {
      n: (state.byId[s.id] ? state.byId[s.id].n : 0) + 1,
      best: (state.byId[s.id] ? state.byId[s.id].best : 0) + (opt.verdict === 'best' ? 1 : 0),
    };
    renderAll();
    if (typeof PK.Drill.onChange === 'function') PK.Drill.onChange();
  }

  function next() {
    if (!state.order.length) return;
    state.pos++;
    /* 一轮做完后重新洗牌，保证不总是同序 */
    /* Reshuffle after finishing a round, so the order is not always the same */
    if (state.pos >= state.order.length) rebuildOrder();
    state.chosen = null;
    renderAll();
  }

  function setFilter(f) {
    state.filter = f;
    rebuildOrder();
    state.chosen = null;
    document.querySelectorAll('#drill-filter button').forEach(b => {
      b.classList.toggle('on', b.dataset.f === f);
    });
    renderAll();
  }

  function bind() {
    if (bound) return;
    bound = true;

    $('#drill-stage').addEventListener('click', e => {
      const btn = e.target.closest('.drill-opt');
      if (!btn || btn.disabled) return;
      choose(btn.dataset.key);
    });

    $('#drill-next').addEventListener('click', next);
    $('#drill-reshuffle').addEventListener('click', () => { rebuildOrder(); state.chosen = null; renderAll(); });

    $('#drill-filter').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      setFilter(btn.dataset.f);
    });

    document.addEventListener('keydown', e => {
      if (!$('#modal-mask').classList.contains('open')) return;
      if (!$('#modal-drill').classList.contains('open')) return;
      if (e.key === 'Enter') { e.preventDefault(); next(); }
      /* 数字键 1~3 直接选第 n 个选项。
         Number keys 1~3 directly pick the n-th option.
         ⚠️ 必须先确认"这一题真的有第 n 个选项"：题库里 `river-bluffcatch`
         ⚠️ You must first confirm "this question really has an n-th option":
         in the question bank `river-bluffcatch`
         （河牌面对超池全下）只有「弃牌 / 跟注」两个选项，按 3 会取到 undefined，
         (facing an overbet shove on the river) has only two options, "fold / call",
         so pressing 3 yields undefined,
         直接抛 TypeError（"Cannot read properties of undefined (reading 'key')"）。
         which throws a TypeError right away ("Cannot read properties of undefined
         (reading 'key')").
         选项数与题面绑定、不保证恒为 3，所以这里必须逐个判空。
         The number of options is bound to each question and is not guaranteed to
         be 3, so each one must be null-checked here. */
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 3 && !state.chosen) {
        const s = current();
        const opt = s && s.options[n - 1];
        if (opt) choose(opt.key);
      }
    });
  }

  function open() {
    if (!state.order.length) {
      rebuildOrder();
      const el = document.querySelector('#drill-filter button[data-f="' + state.filter + '"]');
      if (el) el.classList.add('on');
    }
    state.chosen = null;
    renderAll();
  }

  PK.Drill = {
    SCENARIOS, bind, open, stats, restore, choose, next,
    get state() { return state; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
