/* ============================================================
 * leaks.js — 「我的漏洞画像」面板
 * leaks.js — "My leak profile" panel
 *
 * 把三个数据层拼成一张可读的画像：
 *   · PK.Profile  —— 统计口径上的偏差（VPIP / 面对下注弃牌率 / …）与剥削权重
 *   · PK.EVLoss   —— 用 EV 口径量化"这些偏差一共值多少筹码"，并指出最贵的几个决策
 *   · PK.Bridge   —— 心算题库的进度，把每个漏洞映射成"该练哪几道题"
 * Assembles three data layers into one readable profile:
 *   · PK.Profile — deviations in the statistical sense (VPIP / fold-to-bet / …) and exploit weights
 *   · PK.EVLoss  — quantifies in EV terms "how many chips these deviations are worth in total" and points out the costliest decisions
 *   · PK.Bridge  — progress on the mental-math drill bank, mapping each leak to "which problems to practise"
 *
 * 界面存在的意义：B 组"会记住你漏洞的针对性 AI"如果看不见，玩家就无法理解
 * 对手为什么突然开始频繁诈唬。这里把 AI 正在用的权重直接摊开给玩家看。
 * Why this UI exists: if Group B's "targeted AI that remembers your leaks" were invisible, the
 * player could not understand why the opponent suddenly starts bluffing heavily. Here the
 * weights the AI is using are laid out plainly for the player to see.
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK;
  const $ = s => document.querySelector(s);

  const pct = (x) => Math.round(x * 100) + '%';
  const bbc = (x) => (x >= 0 ? '+' : '') + x.toFixed(1) + 'BB';

  let game = null;
  let bound = false;
  let evToken = 0;               // EV 汇总异步填充的竞态令牌 / race token for the async EV summary fill

  /* 指标卡片：值 / 参考区间 / 样本来源 */
  /* Metric cards: value / reference range / sample source */
  const CARDS = [
    { k: 'vpip', label: '入池率 VPIP', base: PK.Profile.BASE.vpip, lo: 0.24, hi: 0.30,
      fmt: pct, opp: 'hands', oppCN: '手' },
    { k: 'pfrRatio', label: '加注率 PFR/VPIP', base: PK.Profile.BASE.pfrRatio, lo: 0.38, hi: 0.52,
      fmt: pct, opp: 'hands', oppCN: '手' },
    { k: 'foldToBet', label: '面对下注弃牌率', base: PK.Profile.BASE.foldToBet, lo: 0.38, hi: 0.52,
      fmt: pct, opp: 'facedBet', oppCN: '次' },
    { k: 'foldTo3Bet', label: '面对 3-bet 弃牌率', base: PK.Profile.BASE.foldTo3Bet, lo: 0.45, hi: 0.60,
      fmt: pct, opp: 'foldTo3Bet', oppCN: '次' },
    { k: 'riverCall', label: '河牌跟注率', base: PK.Profile.BASE.riverCall, lo: 0.33, hi: 0.47,
      fmt: pct, opp: 'river', oppCN: '次' },
    { k: 'wtsd', label: '摊牌率 WTSD', base: PK.Profile.BASE.wtsd, lo: 0.22, hi: 0.38,
      fmt: pct, opp: 'hands', oppCN: '手' },
    { k: 'betSize', label: '平均下注尺度', base: PK.Profile.BASE.betSize, lo: 0.50, hi: 0.75,
      fmt: x => x.toFixed(2) + '×池', opp: 'betSize', oppCN: '次' },
    { k: 'aggr', label: '激进度（加注/跟注）', base: PK.Profile.BASE.aggr, lo: 0.85, hi: 1.25,
      fmt: x => x.toFixed(2), opp: 'hands', oppCN: '手' },
  ];

  /* 剥削权重的说明文案 */
  /* Exploit-weight tooltip copy */
  const EX_LABEL = [
    { k: 'bluffBoost', name: '诈唬频率', lo: 1, hi: 1, dir: 'up',
      tip: '你越爱弃牌，它越频繁诈唬' },
    { k: 'threeBetBluffBoost', name: '3-bet 诈唬', lo: 1, hi: 1, dir: 'up',
      tip: '你面对 3-bet 弃太多 → 它用弱牌 3-bet' },
    { k: 'stealBoost', name: '后位偷盲', lo: 1, hi: 1, dir: 'up',
      tip: '你越紧，它越偷你的盲' },
    { k: 'sizeBoost', name: '下注尺度', lo: 1, hi: 1, dir: 'up', tip: '你爱弃牌 → 它把尺度放大' },
    { k: 'callDownBoost', name: '跟到底倾向', lo: 1, hi: 1, dir: 'up', tip: '你爱跟注 → 它砍掉诈唬' },
    { k: 'thinValue', name: '薄价值（附加）', lo: 0, hi: 0, dir: 'up', tip: '你爱跟注 → 它用中等牌力收费' },
  ];

  /* ---------------- 渲染 ---------------- */
  /* ---------------- Rendering ---------------- */

  function metricCards(m) {
    let html = '';
    for (const c of CARDS) {
      const v = m[c.k];
      const n = (m.opp && m.opp[c.opp]) || 0;
      const thin = n < PK.Profile.MIN_OPP;
      let cls = 'metric-card';
      if (v > c.hi) cls += ' dev-up';
      else if (v < c.lo) cls += ' dev-down';
      if (thin) cls += ' thin';
      html += '<div class="' + cls + '">' +
        '<div class="m-label">' + c.label + '</div>' +
        '<div class="m-value">' + c.fmt(v) + '</div>' +
        '<div class="m-ref">参考 ' + c.fmt(c.lo) + '~' + c.fmt(c.hi) +
        '　样本 ' + n + ' ' + c.oppCN + (thin ? '（不足）' : '') + '</div>' +
        '</div>';
    }
    return '<div class="leak-grid">' + html + '</div>';
  }

  function exploitBlock() {
    const ex = PK.Profile.exploit();
    if (!ex.confidence) {
      return '<div class="leaks-empty">样本还不够（' + PK.Profile.MIN_OPP +
        ' 手起才做调整），AI 目前按标准打法出牌。</div>';
    }
    let html = '<div class="leak-grid">';
    for (const it of EX_LABEL) {
      const v = ex[it.k];
      const delta = v - 1;
      const flat = Math.abs(delta) < 0.04 && Math.abs(v) < 0.02;
      let cls = 'metric-card' + (flat ? ' thin' : '');
      if (it.k === 'thinValue') cls = 'metric-card' + (v < 0.02 ? ' thin' : ' dev-up');
      else if (delta > 0.04) cls += ' dev-up';
      else if (delta < -0.04) cls += ' dev-down';
      const shown = it.k === 'thinValue' ? (v >= 0.02 ? '有' : '无') : '×' + v.toFixed(2);
      html += '<div class="' + cls + '" title="' + it.tip + '">' +
        '<div class="m-label">' + it.name + '</div>' +
        '<div class="m-value">' + shown + '</div>' +
        '<div class="m-ref">' + (it.k === 'thinValue' ? it.tip : '基准 ×1.00') + '</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function leakList() {
    const ls = PK.Profile.leaks();
    if (!ls.length) {
      const o = PK.Profile.metrics().opp;
      return '<div class="leaks-empty">' +
        (o.hands < PK.Profile.MIN_OPP
          ? '已记录 ' + o.hands + ' / ' + PK.Profile.MIN_OPP + ' 手，样本不足不下结论。'
          : '没有统计上显著的偏差 —— 打法比较均衡。') + '</div>';
    }
    let html = '';
    for (const l of ls) {
      const z = l.z === null || l.z === undefined ? '' : '|z| = ' + Math.abs(l.z).toFixed(1);
      const sev = Math.abs(l.z || 0) >= 3 ? ' sev-high' : (l.level === 'info' ? ' sev-low' : '');
      html += '<div class="leak-item' + sev + '">' +
        '<div class="lk-main">' +
        '<div class="lk-title">' + l.title + '</div>' +
        '<div class="lk-text">' + l.evidence + '</div>' +
        '<div class="lk-text" style="color:#b45309">→ ' + l.fix + '</div>' +
        '</div>' +
        '<div class="lk-z">' + z + '<br>' + pct(l.confidence) + '</div>' +
        '</div>';
    }
    return html;
  }

  /** 横向条形图（用于"损失集中在哪条街 / 哪类动作"） */
  /** Horizontal bar chart (used for "which street / which action type losses concentrate in") */
  function barRows(obj, order, cn, fmtVal) {
    const max = Math.max.apply(null, order.map(k => obj[k].loss).concat([0.0001]));
    let html = '';
    for (const k of order) {
      const v = obj[k];
      const w = Math.max(2, Math.round(v.loss / max * 100));
      html += '<div class="ev-row" style="cursor:default">' +
        '<span class="ev-street" style="width:42px">' + cn[k] + '</span>' +
        '<span style="flex:1;background:#eef2f7;border-radius:3px;height:7px;position:relative">' +
        '<i style="position:absolute;left:0;top:0;bottom:0;width:' + w +
        '%;background:var(--blue);border-radius:3px;display:block"></i></span>' +
        '<span class="ev-score">' + fmtVal(v) + '</span>' +
        '</div>';
    }
    return html;
  }

  function evBlock() {
    const recents = (game && game.recents) || [];
    if (!recents.length) return '<div class="leaks-empty">还没有打完的牌局。</div>';
    return '<div class="metric-card"><div class="m-label">正在按 EV 口径计算…</div>' +
      '<div class="m-value" style="font-size:13px">已复盘 ' + recents.length + ' 手</div></div>';
  }

  function renderEvBlock() {
    const box = $('#leaks-ev');
    if (!box || !PK.EVLoss) return;
    const recents = (game && game.recents) || [];
    if (!recents.length) { box.innerHTML = '<div class="leaks-empty">还没有打完的牌局。</div>'; return; }

    /* 汇总用较低的模拟次数：60 手 × 7 个决策如果按 600 次跑，面板会卡住一秒以上。
       EV 的排序与结论对次数不敏感，只有小数点后一位会晃。 */
    /* The aggregate uses a lower iteration count: running 60 hands × 7 decisions at 600
       iterations would freeze the panel for over a second. EV ordering and conclusions are
       insensitive to the count; only the last decimal wobbles. */
    const ag = PK.EVLoss.audit(recents, { iters: 260 });
    if (!ag.decisions) { box.innerHTML = '<div class="leaks-empty">还没有可复盘的决策。</div>'; return; }

    const ST_CN = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };
    const AC_CN = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注' };

    let html = '<div class="leak-grid">' +
      '<div class="metric-card"><div class="m-label">每手平均 EV 损失</div>' +
      '<div class="m-value">' + ag.perHandBB.toFixed(2) + ' BB</div>' +
      '<div class="m-ref">共 ' + ag.hands + ' 手 / ' + ag.decisions + ' 个决策</div></div>' +
      '<div class="metric-card' + (ag.bigMistakes ? ' dev-up' : '') + '">' +
      '<div class="m-label">明显失误</div>' +
      '<div class="m-value">' + ag.bigMistakes + ' 次</div>' +
      '<div class="m-ref">按最差动作计，≥0.8BB 记一次</div></div>' +
      '</div>';

    html += '<div class="leak-section" style="margin-top:12px"><h4>损失集中在哪条街</h4>' +
      barRows(ag.byStreet, ['preflop', 'flop', 'turn', 'river'], ST_CN,
        v => v.bb.toFixed(1) + 'BB') + '</div>';

    html += '<div class="leak-section" style="margin-top:12px"><h4>哪类动作最贵</h4>' +
      barRows(ag.byAction, ['fold', 'check', 'call', 'raise'], AC_CN,
        v => v.bb.toFixed(1) + 'BB') + '</div>';

    if (ag.leaks.length) {
      html += '<div class="leak-section" style="margin-top:12px"><h4>模式</h4><div class="leaks-note">' +
        ag.leaks.slice(0, 3).map(l => '· ' + l.text).join('<br>') + '</div></div>';
    }

    if (ag.worst.length) {
      html += '<div class="leak-section" style="margin-top:12px"><h4>最贵的几个决策（点击跳到复盘）</h4>';
      for (const w of ag.worst.slice(0, 6)) {
        const d = w.d;
        html += '<div class="ev-row" data-idx="' + w.idx + '" data-act="' + d.i + '">' +
          '<span class="ev-street">#' + w.no + ' ' + (ST_CN[d.street] || d.street) + '</span>' +
          '<span class="ev-act">' + (AC_CN[d.taken] || d.taken) + '</span>' +
          '<span class="ev-badge v-' + d.verdict + '">' + d.verdictCN + '</span>' +
          '<span class="ev-score loss">−' + d.lossBB.toFixed(1) + 'BB</span>' +
          '</div>';
      }
      html += '</div>';
    }
    box.innerHTML = html;
  }

  function bridgeBlock() {
    if (!PK.Bridge) return '';
    /* 用 available() 而不是在这里重写一遍判断 —— "题库有没有数据"只该有一个定义 */
    /* Use available() instead of rewriting the check here — "does the drill bank have data" should have exactly one definition */
    if (!PK.Bridge.available()) {
      return '<div class="leaks-empty">还没用过心算题库（`D:\\todo\\NLHE`）。' +
        '上面的漏洞大多能在那里针对性补上。' +
        '<button class="btn ghost sm" id="leaks-open-drill" style="margin-top:10px">打开心算题库</button>' +
        '</div>';
    }
    const p = PK.Bridge.progress();
    const t = PK.Bridge.today();
    const ls = PK.Profile.leaks().map(l => l.id);
    let plan = PK.Bridge.practiceFor(ls);
    let planHead = '按你的漏洞，建议练这几项';
    if (!plan.length) {
      /* 还没攒够手数、诊断不出漏洞时，用题库自己的弱项兜底。
         给一句"暂未发现"就结束，等于告诉用户"回去接着打牌吧" —— 而这里
         明明已经知道他哪几项心算正确率不合格。 */
      /* When there are not yet enough hands to diagnose a leak, fall back to the drill bank's
         own weak spots. Ending with a plain "nothing found" amounts to telling the user "go
         play more" — yet here we already know which mental-math items they are failing. */
      plan = PK.Bridge.topicStats().filter(x => x.weak).map(x => ({
        key: x.key, stage: x.stage, name: x.name, formula: x.formula,
        reason: '题库里正确率偏低', att: x.att, acc: x.acc, weak: true,
      }));
      if (plan.length) planHead = '题库里你正确率偏低的项（还没观察够你的牌局，先按这个练）';
    }
    let html = '<div class="leak-grid">' +
      '<div class="metric-card"><div class="m-label">今日刷题</div>' +
      '<div class="m-value">' + t.att + ' / ' + t.goal + '</div>' +
      '<div class="m-ref">' + (t.done ? '已达标' : '还差 ' + t.remain + ' 题') + '</div></div>' +
      '<div class="metric-card"><div class="m-label">连续打卡</div>' +
      '<div class="m-value">' + p.streak.days + ' 天</div>' +
      '<div class="m-ref">最长 ' + p.streak.best + ' 天</div></div>' +
      '<div class="metric-card' + (p.overallAcc !== null && p.overallAcc < 0.7 ? ' dev-up' : '') + '">' +
      '<div class="m-label">累计正确率</div>' +
      '<div class="m-value">' + (p.overallAcc === null ? '—' : pct(p.overallAcc)) + '</div>' +
      '<div class="m-ref">共 ' + p.attempts + ' 题</div></div>' +
      '<div class="metric-card' + (p.recentAcc !== null && p.recentAcc < 0.7 ? ' dev-up' : '') + '">' +
      '<div class="m-label">最近 20 题</div>' +
      '<div class="m-value">' + (p.recentAcc === null ? '—' : pct(p.recentAcc)) + '</div>' +
      '<div class="m-ref">更能反映当前状态</div></div>' +
      '</div>';

    if (plan.length) {
      html += '<div class="leak-section" style="margin-top:12px">' +
        '<h4>' + planHead + '</h4>';
      for (const item of plan.slice(0, 6)) {
        const accTxt = item.acc === null ? '还没练过'
          : '正确率 ' + pct(item.acc) + '（' + item.att + ' 题）' + (item.weak ? ' ⚠ 偏弱' : '');
        html += '<div class="leak-item' + (item.weak || item.acc === null ? ' sev-high' : '') + '">' +
          '<div class="lk-main">' +
          '<div class="lk-title">第 ' + item.stage + ' 阶段 · ' + item.name + '</div>' +
          '<div class="lk-text">' + item.formula + '</div>' +
          '<div class="lk-text" style="color:#b45309">→ 因为「' + item.reason + '」</div>' +
          '</div>' +
          '<div class="lk-z">' + accTxt + '</div>' +
          '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="leaks-note" style="margin-top:12px">' +
        '暂未发现需要补的心算环节 —— 要么样本还不够，要么你的漏洞不在心算范畴（比如尺度选择、下注频率）。</div>';
    }
    /* 跳转按钮：两个页面是独立窗口，只能"打开"，没法定位到具体题目，
       所以清单里把题名列出来，让用户自己照着点。 */
    /* Jump button: the two pages are separate windows, so it can only "open" one and cannot
       locate a specific problem; hence the list names the problems so the user can click them
       themselves. */
    html += '<div style="margin-top:12px">' +
      '<button class="btn ghost sm" id="leaks-open-drill">打开心算题库 ↗</button>' +
      '<span class="lk-text" style="margin-left:8px">题目就在清单里，照着名字点</span>' +
      '</div>';
    return html;
  }

  function render() {
    const body = $('#leaks-body');
    if (!body) return;
    const m = PK.Profile.metrics();
    const sum = PK.Profile.summary();
    const sub = $('#leaks-sub');
    if (sub) {
      sub.textContent = '样本 ' + m.opp.hands + ' 手 · 置信度 ' + pct(sum.confidence || 0);
    }

    body.innerHTML =
      '<div class="leaks-note">' + sum.text + '</div>' +

      '<div class="leak-section"><h4>AI 正在用来对付你的权重</h4>' +
        exploitBlock() + '</div>' +

      '<div class="leak-section"><h4>统计指标（灰底 = 样本不足，仅供参考）</h4>' +
        metricCards(m) + '</div>' +

      '<div class="leak-section"><h4>识别到的漏洞</h4>' + leakList() + '</div>' +

      '<div class="leak-section"><h4>EV 损失汇总</h4>' +
        '<div id="leaks-ev">' + evBlock() + '</div></div>' +

      '<div class="leak-section" id="leaks-bridge"><h4>心算题库联动</h4>' +
        bridgeBlock() + '</div>';

    /* EV 汇总比较贵：先出面板，再异步填 —— 打开面板不该有停顿 */
    /* The EV aggregate is expensive: render the panel first, fill it asynchronously — opening the panel should not stall */
    const token = ++evToken;
    setTimeout(() => {
      if (token !== evToken) return;      // 期间又打开过 / 换过数据，作废 / reopened or data changed; discarded
      renderEvBlock();
    }, 0);
  }

  function open() {
    render();
  }

  function reset() {
    PK.Profile.reset();
    if (typeof PK.Leaks.onChange === 'function') PK.Leaks.onChange();
    render();
  }

  function bind() {
    if (bound) return;
    bound = true;

    const btn = $('#btn-leaks');
    if (btn) btn.addEventListener('click', () => {
      PK.UI.openModal('modal-leaks');
      open();
    });

    const rb = $('#leaks-reset');
    if (rb) rb.addEventListener('click', reset);

    /* 最贵决策 → 跳到复盘那一手那一步；「打开心算题库」→ 打开另一个页面 */
    /* Costliest decision → jump to that hand and step in the replay; "Open drill bank" → open the other page */
    const body = $('#leaks-body');
    if (body) {
      body.addEventListener('click', e => {
        const drillBtn = e.target.closest('#leaks-open-drill');
        if (drillBtn) {
          /* 新窗口可能被浏览器拦截（不是所有 file:// 环境都允许 window.open）。
             拦截时不要静默失败 —— 按钮直接改成"请手动打开"，把路径写给用户看。 */
          /* The new window may be blocked by the browser (not every file:// environment allows
             window.open). Do not fail silently when blocked — change the button to "open it
             manually" and show the user the path. */
          if (!PK.Bridge.openDrill()) {
            drillBtn.textContent = '新窗口被拦截，请手动打开 D:\\todo\\NLHE';
            drillBtn.disabled = true;
          }
          return;
        }
        const row = e.target.closest('.ev-row[data-idx]');
        if (!row) return;
        const idx = parseInt(row.dataset.idx, 10);
        const act = parseInt(row.dataset.act, 10);
        PK.UI.closeModal();
        PK.UI.openModal('modal-replay');
        PK.Replay.open();
        PK.Replay.openHand(idx, act);
      });
    }
  }

  PK.Leaks = {
    init(g) { game = g; },
    open, render, reset, bind,
    onChange: null,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
