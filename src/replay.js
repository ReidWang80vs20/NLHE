/* ============================================================
 * replay.js — 手牌复盘回放
 *   把每一手的行动序列逐步重放：公共牌、底池、谁做了什么，
 *   并在你每次行动处标出「当时的胜率」，用来回答"这条街我打错了没"。
 * replay.js — hand replay / playback
 *   Replays each hand's action sequence step by step: community cards, pot, who did what,
 *   and annotates the equity at each of your actions, to answer "did I misplay this street?"
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK;
  const $ = s => document.querySelector(s);

  const STREET_CN = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };
  const ACT_CN = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', allin: '全下' };
  const EQ_ITERS = 900;          // 复盘胜率的模拟次数（不需太精确，重速度） / simulations for replay equity (favor speed)
  const PLAY_INTERVAL = 620;

  let game = null;
  let activeIdx = -1;    // 当前查看的手牌在 game.recents 中的下标 / index of the viewed hand in game.recents
  let steps = [];
  let step = 0;          // 已重放到第几步（0 = 手牌开始前） / how many steps replayed (0 = before the hand)
  let playTimer = null;
  let bound = false;

  /* ---- C 组：分析栏的状态 ---- */
  /* ---- Group C: analysis panel state ---- */
  let heatEls = null;    // 169 个热力图格子，按类别下标索引 / 169 heatmap cells, indexed by class
  let evHandIdx = -1;    // EV 数据缓存对应的手牌下标 / hand index the cached EV data belongs to
  let evData = null;

  /* ---------------- 分析栏：热力图 ---------------- */
  /* ---------------- Analysis panel: heatmap ---------------- */
  const HEAT_LO = [232, 239, 252];   // 极浅蓝（权重≈0） / very light blue (weight ≈ 0)
  const HEAT_HI = [37, 99, 235];     // 主题蓝（权重=1） / theme blue (weight = 1)

  function heatColor(v) {
    const t = Math.max(0, Math.min(1, v));
    const c = [];
    for (let i = 0; i < 3; i++) c.push(Math.round(HEAT_LO[i] + (HEAT_HI[i] - HEAT_LO[i]) * t));
    return 'rgb(' + c.join(',') + ')';
  }

  /**
   * 这一类被已知牌（自己的底牌 + 公共牌）挡住了多少组合。
   * How many combos of this class are blocked by known cards (your hole cards + community cards).
   *
   * 为什么必须区分"部分"和"完全"：
   *   完全阻断要求**同一花色的四张牌全在已知牌里**（如自己拿 A♥A♦ 且牌面发出
   *   A♠A♣），这在实战中极罕见 —— 只标"完全阻断"等于这个标记常年不亮，纯装饰。
   *   而部分阻断（自己拿一张 A → 所有 Ax 类都少掉 1/4 组合）几乎每手都会发生，
   *   它直接改变对手实际能持有的组合数，是有信息量的。
   * Why "partial" and "complete" must be distinguished: complete blocking requires that
   * **all four cards of the same rank be among the known cards** (e.g. you hold A♥A♦ and the
   * board runs out A♠A♣), which is extremely rare in practice — marking only "complete
   * blocking" means the flag would never light up and is pure decoration. Partial blocking
   * (you hold one A → every Ax class loses 1/4 of its combos), by contrast, happens almost
   * every hand and directly changes the number of combos the opponent can actually hold, so
   * it carries real information.
   */
  function blockInfo(i, known) {
    const R = PK.Range;
    const list = R.COMBOS[i];
    if (!known || !known.length) return { alive: list.length, total: list.length, dead: 0 };
    let alive = 0;
    for (let k = 0; k < list.length; k++) {
      if (known.indexOf(list[k][0]) < 0 && known.indexOf(list[k][1]) < 0) alive++;
    }
    return { alive: alive, total: list.length, dead: list.length - alive };
  }

  /** 13×13 网格只建一次，之后只改颜色 —— 每次翻页重建 169 个 DOM 会明显卡顿 */
  /** The 13×13 grid is built only once, then only its colors change — rebuilding 169 DOM nodes per page turn would noticeably stutter */
  function buildHeatGrid() {
    const g = $('#heat-grid');
    if (!g || !PK.Range) return;
    const R = PK.Range;
    let html = '';
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const i = R.HEATMAP[r][c];
        /* 只显示两张牌的字符：上三角=同花、下三角=不同花、对角=对子，
           这是约定俗成的读法，比塞进 'AKs/AKo' 更能看清楚 */
        /* Show only the two ranks: upper triangle = suited, lower triangle = offsuit,
           diagonal = pair. This is the conventional reading and is clearer than cramming
           in 'AKs/AKo' */
        html += '<div class="heat-cell" data-i="' + i + '">' + R.ORDER[i].slice(0, 2) + '</div>';
      }
    }
    g.innerHTML = html;
    heatEls = new Array(R.N);
    g.querySelectorAll('.heat-cell').forEach(el => { heatEls[+el.dataset.i] = el; });
  }

  function updateHeat(w, known) {
    if (!heatEls) buildHeatGrid();
    if (!heatEls) return;
    const R = PK.Range;
    for (let i = 0; i < R.N; i++) {
      const el = heatEls[i];
      if (!el) continue;
      const bk = blockInfo(i, known);
      const v = w ? w[i] : 0;
      const cls = ['heat-cell'];
      /* 完全阻断 → 对手不可能持有；部分阻断 → 组合数被压掉一截 */
      /* Fully blocked → the opponent cannot hold it; partially blocked → the combo count is reduced */
      if (bk.alive === 0) cls.push('blocked');
      else if (bk.dead > 0) cls.push('part');

      el.className = cls.join(' ');
      if (bk.alive === 0) {
        el.style.background = '';
        el.style.color = '';
        el.title = R.ORDER[i] + '：' + bk.total + ' 个组合全部在你的已知牌里，对手不可能持有';
        continue;
      }
      if (v > 0.001 && w) {
        el.style.background = heatColor(v);
        el.style.color = v >= 0.62 ? '#fff' : 'var(--text)';
      } else {
        el.style.background = '';
        el.style.color = '';
      }
      let tip = R.ORDER[i] + '：' + (w && v > 0.001
        ? '相对权重 ' + Math.round(v * 100) + '%' : '不在估计范围内');
      if (bk.dead > 0) tip += '　可用组合 ' + bk.alive + '/' + bk.total + '（被挡掉 ' + bk.dead + '）';
      el.title = tip;
    }
  }

  /** 第 step 步之前，已经消耗掉几条行动 */
  /** How many actions have been consumed before step */
  function consumedActions() {
    let n = 0;
    for (let i = 0; i < step && i < steps.length; i++) {
      if (steps[i].type === 'action') n++;
    }
    return n;
  }

  /** 某条行动在 steps 里的下标（按对象身份匹配，比算偏移可靠） */
  /** Index of an action within steps (matched by object identity, more reliable than computing an offset) */
  function stepOfAction(k) {
    const rec = game.recents ? game.recents[activeIdx] : null;
    if (!rec || !rec.actions || !rec.actions[k]) return -1;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].type === 'action' && steps[i].a === rec.actions[k]) return i;
    }
    return -1;
  }

  const STREET_SHORT = { preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌' };
  const ACT_SHORT = { fold: '弃', check: '过', call: '跟', raise: '加' };

  function renderAnalysis() {
    const pctEl = $('#heat-pct');
    const rec = game.recents ? game.recents[activeIdx] : null;
    if (!pctEl || !rec || !PK.Range || !PK.EVLoss) return;

    /* ---- 热力图：当前步的对手范围 ---- */
    /* ---- Heatmap: opponent range at the current step ---- */
    const consumed = consumedActions();
    if (consumed <= 0) {
      updateHeat(null, null);
      pctEl.textContent = '—';
      pctEl.title = '有人行动之后才会显示范围估计';
    } else {
      const st = stateAt(rec, step);
      const liveSeats = PK.EVLoss.liveSeatsAt(rec, consumed);
      if (!liveSeats.length) {
        updateHeat(null, null);
        pctEl.textContent = '无人';
        pctEl.title = '所有对手都已弃牌';
      } else {
        const known = rec.heroHole.concat(rec.board.slice(0, st.boardLen));
        const w = PK.EVLoss.mergeRanges(rec, liveSeats, st.boardLen, consumed);
        updateHeat(w, known);
        const d = PK.Range.describe(w, known);
        pctEl.textContent = Math.round(d.pct * 100) + '% · ' + liveSeats.length + ' 家';
        pctEl.title = '约 ' + Math.round(d.combos) + ' 个组合 / 覆盖 ' + d.classes + ' 类起手牌';
      }
    }

    /* ---- EV 列表 ---- */
    /* ---- EV list ---- */
    const listEl = $('#ev-list');
    const totalEl = $('#ev-total');
    const whyEl = $('#ev-why');
    if (!listEl || !totalEl || !whyEl) return;

    if (evHandIdx !== activeIdx) {
      evData = PK.EVLoss.review(rec);
      evHandIdx = activeIdx;
    }
    const ds = (evData && evData.decisions) || [];
    if (!ds.length) {
      listEl.innerHTML = '<div class="ev-empty">这手牌没有需要复盘的决策点</div>';
      totalEl.textContent = '—';
      whyEl.style.display = 'none';
      return;
    }
    totalEl.textContent = '共 ' + evData.totalLossBB.toFixed(1) + ' BB';

    /* 当前步刚做完的那条行动 → 高亮对应的决策行 */
    /* The action just completed at the current step → highlight the matching decision row */
    const curAction = (step > 0 && steps[step - 1] && steps[step - 1].type === 'action')
      ? steps[step - 1].a : null;

    let html = '';
    let curD = null;
    for (const d of ds) {
      const a = rec.actions[d.i];
      const on = curAction && a === curAction;
      if (on) curD = d;
      const lossTxt = d.loss < 0.005 ? '0' : '−' + d.lossBB.toFixed(1);
      html += '<button class="ev-row' + (on ? ' on' : '') + '" data-i="' + d.i + '">' +
        '<span class="ev-street">' + (STREET_SHORT[d.street] || d.street) + '</span>' +
        '<span class="ev-act">' + (PK.EVLoss.ACT_CN[d.taken] || d.taken) + '</span>' +
        '<span class="ev-badge v-' + d.verdict + '">' + d.verdictCN + '</span>' +
        '<span class="ev-score ' + (d.loss < 0.005 ? 'zero' : 'loss') + '">' + lossTxt + '</span>' +
        '</button>';
    }
    listEl.innerHTML = html;

    /* ---- 解说 ---- */
    /* ---- Explanation ---- */
    const show = curD || ds[ds.length - 1];
    const pctS = (x) => Math.round(x * 100) + '%';
    let why = '<div><b>' + (STREET_SHORT[show.street] || show.street) + '　底池 ' +
      Math.round(show.potBefore) + '，需跟 ' + Math.round(show.toCall) + '</b></div>' +
      show.advice;
    let odds = '<span>胜率 ' + pctS(show.eq) + '</span>' +
      '<span>需要 ' + pctS(show.needEq) + '</span>' +
      '<span>底池赔率 ' + pctS(show.needEq) + '</span>' +
      '<span>最优 ' + (PK.EVLoss.ACT_CN[show.best] || show.best) +
      ' ' + (show.bestEV >= 0 ? '+' : '') + (show.bestEV / (rec.bb || 1)).toFixed(1) + 'BB</span>' +
      '<span>' + PK.EVLoss.REL_CN[show.reliability] + '</span>';
    why += '<div class="ev-odds">' + odds + '</div>';
    if (show.caveat) why += '<div class="ev-caveat">※ ' + show.caveat + '</div>';
    whyEl.innerHTML = why;
    whyEl.style.display = '';
  }

  /* ---------------- 牌面小工具 ---------------- */
  /* ---------------- Card rendering helpers ---------------- */
  function cardHTML(c) {
    if (c === undefined || c === null) return '<div class="rp-slot"></div>';
    const red = PK.SUITS[PK.suitOf(c)].red ? ' red' : '';
    return '<div class="rp-card' + red + '">' +
      '<span class="r">' + PK.RANK_LABELS[PK.rankOf(c)] + '</span>' +
      '<span class="s">' + PK.SUITS[PK.suitOf(c)].sym + '</span></div>';
  }

  /* ---------------- 把行动序列展开成"步" ----------------
   * 公共牌是在街与街之间发的，行动序列里没有对应条目，
   * 因此在 boardLen 变大处插入一个 deal 步骤，回放时才能看到翻牌/转牌/河牌逐张出现。
   * ---------------- Expand the action sequence into "steps" ----------------
   * Community cards are dealt between streets, with no corresponding entry in the action
   * sequence, so a deal step is inserted wherever boardLen increases; only then does the
   * replay show the flop/turn/river appearing one by one.
   */
  function buildSteps(rec) {
    /* 开头补一个翻牌前节点，否则时间线第一行会缺少街标题 */
    /* Prepend a preflop node, otherwise the first line of the timeline would lack a street header */
    const out = [{ type: 'deal', boardLen: 0, street: 'preflop' }];
    let lastBoard = 0;
    for (let i = 0; i < rec.actions.length; i++) {
      const a = rec.actions[i];
      if (a.boardLen > lastBoard) {
        out.push({ type: 'deal', boardLen: a.boardLen, street: a.street });
        lastBoard = a.boardLen;
      }
      out.push({ type: 'action', a: a });
    }
    out.push({ type: 'end', boardLen: rec.board.length });
    return out;
  }

  /** 重放到第 n 步时的局面快照 */
  /** Snapshot of the situation after replaying to step n */
  function stateAt(rec, n) {
    let boardLen = 0, pot = 0;
    const lastBySeat = {};
    const folded = {};
    for (let i = 0; i < n && i < steps.length; i++) {
      const s = steps[i];
      if (s.type === 'deal') { boardLen = s.boardLen; }
      else if (s.type === 'end') { boardLen = s.boardLen; }
      else {
        const a = s.a;
        if (a.boardLen > boardLen) boardLen = a.boardLen;
        pot = a.pot;
        lastBySeat[a.seat] = a;
        if (a.action === 'fold') folded[a.seat] = true;
      }
    }
    return { boardLen: boardLen, pot: pot, lastBySeat: lastBySeat, folded: folded };
  }

  /** 第 i 步之后仍未弃牌的对手数（用于重算当时的胜率） */
  /** Number of opponents still not folded after step i (used to recompute the equity at that time) */
  function opponentsAt(rec, i) {
    const folded = {};
    for (let k = 0; k <= i && k < steps.length; k++) {
      const s = steps[k];
      if (s.type === 'action' && s.a.action === 'fold') folded[s.a.seat] = true;
    }
    let n = 0;
    for (const p of rec.players) {
      if (p.seat === 0) continue;
      if (!folded[p.seat]) n++;
    }
    return Math.max(1, n);
  }

  /** 你在某一步行动时的胜率（结果缓存在该手上，避免反复模拟） */
  /** Your equity when acting at a given step (result cached per hand to avoid repeated simulation) */
  function heroEquityAt(rec, i) {
    if (!rec._eq) rec._eq = {};
    if (rec._eq[i] !== undefined) return rec._eq[i];
    const a = steps[i].a;
    let eq;
    try {
      const board = rec.board.slice(0, a.boardLen);
      eq = PK.equity(rec.heroHole, board, opponentsAt(rec, i), EQ_ITERS);
    } catch (e) {
      eq = null;
    }
    rec._eq[i] = eq;
    return eq;
  }

  /* ---------------- 渲染：左侧手牌列表 ---------------- */
  /* ---------------- Rendering: hand list on the left ---------------- */
  function renderList() {
    const list = $('#replay-list');
    const recs = game.recents || [];
    if (!recs.length) {
      list.innerHTML = '<div class="rp-empty">还没有打完的牌局<br><span>打完一手后这里会出现记录</span></div>';
      return;
    }
    let html = '';
    for (let i = recs.length - 1; i >= 0; i--) {
      const r = recs[i];
      const net = r.heroNet || 0;
      const netCls = net > 0 ? 'up' : (net < 0 ? 'down' : '');
      const heroWon = r.result && r.result.winners && r.result.winners.some(w => w.seat === 0);
      const tag = heroWon ? '🏆' : (r.players[0] && r.players[0].folded ? '🏳️' : '·');
      const hole = (r.heroHole || []).map(PK.cardLabel).join(' ');
      html += '<button class="rp-item' + (i === activeIdx ? ' on' : '') + '" data-i="' + i + '">' +
        '<span class="rp-no">#' + r.no + '</span>' +
        '<span class="rp-hole">' + hole + '</span>' +
        '<span class="rp-net ' + netCls + '">' + (net > 0 ? '+' : '') + net + '</span>' +
        '<span class="rp-tag">' + tag + '</span>' +
        '</button>';
    }
    list.innerHTML = html;
  }

  /* ---------------- 渲染：右侧回放舞台 ---------------- */
  /* ---------------- Rendering: replay stage on the right ---------------- */
  function renderStage() {
    const box = $('#replay-stage');
    const rec = game.recents ? game.recents[activeIdx] : null;
    if (!rec) {
      box.innerHTML = '<div class="rp-empty">从左侧点选一手牌开始复盘</div>';
      renderAnalysis();
      return;
    }

    const st = stateAt(rec, step);

    /* 公共牌 */
    /* Community cards */
    let board = '';
    for (let i = 0; i < 5; i++) {
      board += i < st.boardLen ? cardHTML(rec.board[i]) : '<div class="rp-slot"></div>';
    }

    /* 我的底牌 */
    /* My hole cards */
    const hole = rec.heroHole.map(cardHTML).join('');

    /* 时间线 */
    /* Timeline */
    let tl = '';
    let curStreet = '';
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];

      if (s.type === 'deal') {
        const cn = STREET_CN[s.street] || s.street;
        const cards = s.boardLen ? rec.board.slice(0, s.boardLen).map(PK.cardLabel).join(' ') : '';
        tl += '<div class="rp-street' + (i < step ? '' : ' future') + '">【' + cn + '】' + cards + '</div>';
        curStreet = s.street;
        continue;
      }

      if (s.type === 'end') {
        const r = rec.result;
        let text = '';
        if (r) {
          if (r.type === 'fold') {
            const w = rec.players[r.winners[0].seat];
            text = w.name + ' 收下底池 ' + r.pot + '（其余弃牌）';
          } else {
            text = r.winners.map(w => rec.players[w.seat].name + ' 赢 ' + w.amount).join('、') +
              '　底池 ' + r.pot;
          }
        }
        const cls = (rec.heroNet > 0 ? 'win' : (rec.heroNet < 0 ? 'lose' : ''));
        tl += '<div class="rp-street rp-result ' + cls + (i < step ? '' : ' future') + '">' +
          '本手结束：' + text + '　（你 ' + (rec.heroNet > 0 ? '+' : '') + rec.heroNet + '）</div>';
        continue;
      }

      /* 一条行动 */
      /* One action */
      const a = s.a;
      const p = rec.players[a.seat];
      const isHero = p.isHero;
      const done = i < step;
      const cur = i === step - 1;
      const cls = ['rp-act'];
      if (isHero) cls.push('hero');
      if (done) cls.push('done');
      if (cur) cls.push('cur');
      if (!done) cls.push('future');

      let amt = '';
      if (a.action === 'call') amt = ' ' + a.toCall;
      else if (a.action === 'raise' || a.action === 'allin') amt = ' 到 ' + a.betAfter;
      if (a.action === 'check' || a.action === 'fold') amt = '';

      let eqTag = '';
      if (isHero && done) {
        /* 弃牌也标注胜率 —— "我扔掉的那手当时到底有多少胜率"正是复盘要回答的问题 */
        /* Folds are annotated with equity too — "how much equity did the hand I threw away
           actually have at the time" is exactly what the replay is meant to answer */
        const eq = heroEquityAt(rec, i);
        if (eq !== null) eqTag = '<span class="rp-eq">胜率 ' + (eq * 100).toFixed(0) + '%</span>';
      }

      tl += '<div class="' + cls.join(' ') + '">' +
        '<span class="rp-who">' + p.name + '</span>' +
        '<span class="rp-do">' + (ACT_CN[a.action] || a.action) + amt + '</span>' +
        (isHero ? '<span class="rp-you">你</span>' : '') +
        eqTag +
        (a.note ? '<span class="rp-note">' + a.note + '</span>' : '') +
        '</div>';
    }

    /* 当前对手状态 */
    /* Current opponent states */
    let opps = '';
    for (const p of rec.players) {
      if (p.isHero) continue;
      const last = st.lastBySeat[p.seat];
      const state = st.folded[p.seat] ? 'folded' : (last ? 'acted' : '');
      opps += '<span class="rp-opp ' + state + '">' + p.name +
        (st.folded[p.seat] ? '<i>弃</i>' : (last ? '<i>' + (ACT_CN[last.action] || '') + '</i>' : '')) +
        '</span>';
    }

    box.innerHTML =
      '<div class="rp-head">' +
        '<b>第 ' + rec.no + ' 手</b>' +
        '<span>按钮位 ' + rec.players[rec.button].name + '</span>' +
        '<span>盲注 ' + rec.sb + '/' + rec.bb + '</span>' +
        '<span>' + rec.seats + ' 人桌</span>' +
      '</div>' +
      '<div class="rp-line"><span class="rp-label">公共牌</span><div class="rp-board">' + board + '</div></div>' +
      '<div class="rp-line"><span class="rp-label">你的底牌</span><div class="rp-board">' + hole + '</div>' +
        '<span class="rp-pot">底池 <b>' + st.pot + '</b></span></div>' +
      '<div class="rp-opps">' + opps + '</div>' +
      '<div class="rp-timeline">' + tl + '</div>';

    /* 高亮当前步 */
    /* Highlight the current step */
    const curEl = box.querySelector('.rp-act.cur') || box.querySelector('.rp-street:not(.future)');
    if (curEl && curEl.scrollIntoView) {
      curEl.scrollIntoView({ block: 'nearest' });
    }

    /* 分析栏跟着当前步走：热力图 = 此刻的对手范围，EV 列表高亮当前决策 */
    /* The analysis panel follows the current step: heatmap = opponent range right now, EV list highlights the current decision */
    renderAnalysis();
  }

  function updateControls() {
    const rec = game.recents ? game.recents[activeIdx] : null;
    const total = steps.length;
    $('#rp-progress').textContent = rec ? (step + ' / ' + total) : '0 / 0';
    $('#rp-prev').disabled = !rec || step <= 0;
    $('#rp-next').disabled = !rec || step >= total;
    $('#rp-play').disabled = !rec || step >= total;
  }

  function renderAll() {
    renderList();
    renderStage();
    updateControls();
  }

  /* ---------------- 播放控制 ---------------- */
  /* ---------------- Playback control ---------------- */
  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    const b = $('#rp-play');
    if (b) b.textContent = '▶ 播放';
  }

  function gotoStep(n) {
    const total = steps.length;
    step = Math.max(0, Math.min(total, n));
    renderStage();
    updateControls();
  }

  function togglePlay() {
    if (playTimer) { stopPlay(); return; }
    if (step >= steps.length) step = 0;
    const b = $('#rp-play');
    if (b) b.textContent = '⏸ 暂停';
    playTimer = setInterval(() => {
      if (step >= steps.length) { stopPlay(); return; }
      gotoStep(step + 1);
    }, PLAY_INTERVAL);
  }

  function selectHand(idx) {
    stopPlay();
    activeIdx = idx;
    steps = buildSteps(game.recents[idx]);
    step = 0;
    evHandIdx = -1;                 // 换了一手牌，EV 缓存失效 / switched hand, EV cache invalidated
    evData = null;
    renderAll();
  }

  /** 跳到某一手牌的某个决策点（EV 损失列表点击用） */
  /** Jump to a decision point of a hand (used when clicking the EV loss list) */
  function jumpToAction(k) {
    const s = stepOfAction(k);
    if (s < 0) return false;
    stopPlay();
    gotoStep(s + 1);                // +1 让这次行动处于"已完成"状态并被高亮
    // EN: +1 puts this action in the "done" state and highlights it
    return true;
  }

  /** 直接打开某一手牌（可指定跳到第 k 条行动），供漏洞画像面板调用 */
  /** Open a hand directly (optionally jumping to the k-th action), called by the leak-profile panel */
  function openHand(idx, k) {
    if (!game.recents || !game.recents[idx]) return;
    selectHand(idx);
    if (k !== undefined && k !== null) jumpToAction(k);
  }

  /* ---------------- 初始化 ---------------- */
  /* ---------------- Initialization ---------------- */
  function open() {
    stopPlay();
    /* 每次打开都重算 EV：期间可能又打了几手，手牌列表也变了 */
    /* Recompute the EV on every open: more hands may have been played since, and the hand list changed too */
    evHandIdx = -1;
    evData = null;
    /* 默认选中最后一手 */
    /* Select the last hand by default */
    const recs = game.recents || [];
    if (recs.length) {
      if (activeIdx < 0 || activeIdx >= recs.length) selectHand(recs.length - 1);
      else { steps = buildSteps(recs[activeIdx]); step = 0; renderAll(); }
    } else {
      activeIdx = -1; steps = []; step = 0; renderAll();
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    $('#replay-list').addEventListener('click', e => {
      const btn = e.target.closest('.rp-item');
      if (!btn) return;
      selectHand(parseInt(btn.dataset.i, 10));
    });

    /* EV 损失列表：点一行就跳到那次行动的复盘位置 */
    /* EV loss list: clicking a row jumps to that action's replay position */
    const evList = $('#ev-list');
    if (evList) {
      evList.addEventListener('click', e => {
        const row = e.target.closest('.ev-row');
        if (!row) return;
        jumpToAction(parseInt(row.dataset.i, 10));
      });
    }

    $('#rp-prev').addEventListener('click', () => { stopPlay(); gotoStep(step - 1); });
    $('#rp-next').addEventListener('click', () => { stopPlay(); gotoStep(step + 1); });
    $('#rp-play').addEventListener('click', togglePlay);
    $('#rp-first').addEventListener('click', () => { stopPlay(); gotoStep(0); });
    $('#rp-last').addEventListener('click', () => { stopPlay(); gotoStep(steps.length); });

    document.addEventListener('keydown', e => {
      if (!$('#modal-mask').classList.contains('open')) return;
      if (!$('#modal-replay').classList.contains('open')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); stopPlay(); gotoStep(step - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stopPlay(); gotoStep(step + 1); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    });
  }

  PK.Replay = {
    init(g) { game = g; },
    open, bind, selectHand, jumpToAction, openHand, stepOfAction,
    renderAnalysis,
    get activeIdx() { return activeIdx; },
    get step() { return step; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
