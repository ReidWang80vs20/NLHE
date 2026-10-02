/* ============================================================
 * ui.js — 界面渲染与交互
 * ui.js — UI rendering and interaction
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK;
  const $ = s => document.querySelector(s);

  const opts = { peek: false, hints: true, equity: true, odds: true };

  let game = null;
  let eqToken = 0;
  let adviceToken = 0;
  let actionBarSig = '';
  let lastBoardLen = 0;
  let staticBound = false;
  /* 教练面板默认收起：练习时不想被建议抢走注意力，需要时手动点开。
   * Coach panel is collapsed by default: during practice you don't want advice stealing your attention, so open it manually when needed.
     每手牌开始都会重新收起（见 init 里的 hand-start），这是有意为之 ——
   * It is re-collapsed at the start of every hand (see hand-start in init); this is intentional —
     上一手你手动展开过，不代表这一手还想看。
   * the fact that you expanded it manually last hand does not mean you want to see it this hand. */
  let coachOpen = false;

  /* ---------------- 牌桌尺寸与元素缩放 / Table size and element scaling ---------------- */
  const FELT_RATIO = 16 / 9.4;    // 设计比例，任何窗口下都必须严格保持
  // EN: Design ratio; must be strictly maintained at any window size
  const FELT_BASE_W = 1100;       // 基准宽度：此宽度下 --ui-scale = 1
  // EN: Base width; --ui-scale = 1 at this width
  let uiScale = 1;
  let lastFeltW = -1;

  /**
   * 按可用空间计算牌桌尺寸：严格保持设计比例，并跟随可用高度放大/缩小。
   * Compute the table size from the available space: strictly keep the design ratio and scale up/down with the available height.
   * 同时把元素缩放系数写进 --ui-scale，使牌、座位、字号等比变化 ——
   * Also write the element scale factor into --ui-scale so cards, seats and font sizes change proportionally —
   * 这样「牌与牌桌的相对关系」在任何分辨率下都完全一致。
   * this keeps the relative relationship between cards and table identical at any resolution.
   * @returns {boolean} 尺寸是否有变化（需要重绘座位）
   * @returns {boolean} whether the size changed (seats need re-rendering)
   */
  function measureFelt() {
    const outer = document.querySelector('.table-outer');
    const felt = document.getElementById('felt');
    if (!outer || !felt) return false;

    const availW = outer.clientWidth;
    const availH = outer.clientHeight;
    if (availW < 80 || availH < 80) return false;

    const w = Math.min(availW, availH * FELT_RATIO);
    const h = w / FELT_RATIO;
    /* 缩放必须与牌桌宽度严格成正比，否则座位相对牌桌会忽大忽小并探出桌沿。
     * The scale must be strictly proportional to the table width, otherwise seats would grow/shrink relative to the table and spill over the edge.
       下限取得足够低，保证 1000px 级的小窗口也不会触发截断。
     * The lower bound is set low enough so that even a small ~1000px window won't trigger clipping. */
    const scale = Math.max(0.55, Math.min(1.6, w / FELT_BASE_W));
    const changed = Math.abs(w - lastFeltW) > 0.5;

    lastFeltW = w;
    uiScale = scale;
    felt.style.width = Math.round(w) + 'px';
    felt.style.height = Math.round(h) + 'px';
    document.documentElement.style.setProperty('--ui-scale', scale.toFixed(3));
    return changed;
  }

  /* ---------------- 座位坐标 / Seat coordinates ----------------
   * 座位按椭圆分布，再按「座位自身的实际尺寸」向内收边，
   * Seats are distributed along an ellipse, then inset by the seat's own actual size,
   * 确保座位矩形永不探出牌桌 —— 一旦探出就会被外层留白挤压，
   * ensuring the seat rectangle never spills outside the table — if it did, the outer padding would squeeze it,
   * 表现为座位被裁切或与操作栏撞在一起。
   * making the seat look clipped or collide with the action bar.
   */
  function seatPos(i, n) {
    const theta = (90 + i * (360 / n)) * Math.PI / 180;
    let a = 40.5, b = 37;
    if (n >= 8) { a = 39; b = 35.5; }
    if (n <= 3) { a = 31; b = 32.5; }

    const felt = document.getElementById('felt');
    /* left/top 百分比的基准是 padding box（不含 11px 边框） / left/top percentages are relative to the padding box (excluding the 11px border) */
    const fw = (felt && felt.clientWidth) || FELT_BASE_W;
    const fh = (felt && felt.clientHeight) || Math.round(FELT_BASE_W / FELT_RATIO);

    /* 真人座位最宽、最高，统一按它留边最安全 / The hero seat is the widest and tallest, so insetting by it uniformly is the safest */
    const halfW = (168 * uiScale / 2) / fw * 100;
    const halfH = (140 * uiScale / 2) / fh * 100;

    let x = 50 + a * Math.cos(theta);
    let y = 50 + b * Math.sin(theta);

    x = Math.max(halfW + 0.5, Math.min(100 - halfW - 0.5, x));
    y = Math.max(halfH + 0.5, Math.min(100 - halfH - 0.5, y));
    return { x: x, y: y };
  }

  /**
   * 位置名称。order = 相对按钮的位置序号（0 = 小盲，n-1 = 按钮）
   * Position name. order = seat index relative to the button (0 = small blind, n-1 = button)
   *   2 人：BTN/SB、BB
   *   2 players: BTN/SB, BB
   *   6 人：SB、BB、UTG、HJ、CO、BTN
   *   6 players: SB, BB, UTG, HJ, CO, BTN
   *   9 人：SB、BB、UTG、UTG+1、UTG+2、MP、HJ、CO、BTN
   *   9 players: SB, BB, UTG, UTG+1, UTG+2, MP, HJ, CO, BTN
   */
  function posName(order, n) {
    if (n === 2) return order === 0 ? 'BTN/SB' : 'BB';
    if (order === 0) return 'SB';
    if (order === 1) return 'BB';
    if (order === n - 1) return 'BTN';
    if (order === n - 2) return 'CO';
    if (n >= 6 && order === n - 3) return 'HJ';
    /* 其余位置从最早行动者开始依次命名 / Remaining positions are named in order starting from the earliest actor */
    const nEarly = Math.max(1, n - 5);
    const idx = order - 2;
    if (idx <= 0) return 'UTG';
    if (idx >= nEarly) return 'UTG+' + idx;
    if (idx === nEarly - 1 && nEarly >= 3) return 'MP';
    return 'UTG+' + idx;
  }

  /* ---------------- 小工具 / Helpers ---------------- */
  function cardHTML(card, extra) {
    if (card === undefined || card === null) return '<div class="card-slot"></div>';
    if (card === -1) return '<div class="card back ' + (extra || '') + '"></div>';
    const red = PK.SUITS[PK.suitOf(card)].red ? ' red' : '';
    return '<div class="card' + red + ' ' + (extra || '') + '">' +
      '<span class="rank">' + PK.RANK_LABELS[PK.rankOf(card)] + '</span>' +
      '<span class="suit">' + PK.SUITS[PK.suitOf(card)].sym + '</span></div>';
  }

  function showCardsFor(p) {
    if (p.isHero) return true;
    if (opts.peek) return true;
    if (game.stage === 'over' && game.handResult && game.handResult.type === 'showdown' && !p.folded) return true;
    return false;
  }

  function actionClass(a) {
    if (!a) return '';
    if (a === 'fold') return 'a-fold';
    if (a === 'check') return 'a-check';
    if (a === 'call') return 'a-call';
    if (a === 'raise') return 'a-raise';
    if (a === 'allin') return 'a-allin';
    return '';
  }

  function actionLabel(p) {
    const a = p.lastAction;
    if (!a) return '';
    if (a === 'fold') return '弃牌';
    if (a === 'check') return '过牌';
    if (a === 'call') return '跟注';
    if (a === 'raise') return '加注';
    if (a === 'allin') return '全下';
    return '';
  }

  /* ---------------- 渲染：座位 / Render: seats ---------------- */
  function renderSeats() {
    const felt = $('#felt');
    const n = game.players.length;
    let html = '';

    for (let i = 0; i < n; i++) {
      const p = game.players[i];
      const pos = seatPos(i, n);
      const isTurn = game.toAct === i && game.stage === 'betting';
      const isWinner = game.handResult && game.handResult.winners &&
        game.handResult.winners.some(w => w.seat === i);

      const cls = ['seat'];
      if (p.isHero) cls.push('hero');
      if (p.folded) cls.push('out');
      if (isTurn) cls.push('active');
      if (isWinner) cls.push('winner');

      /* 底牌 / Hole cards */
      let cardsHTML = '';
      if (p.hole.length) {
        const show = showCardsFor(p);
        const dim = p.folded ? ' dim' : '';
        const dealt = ' dealt';
        cardsHTML = '<div class="seat-cards">' +
          p.hole.map(c => cardHTML(show ? c : -1, (p.isHero ? 'hole-hero' : '') + dim + dealt)).join('') +
          '</div>';
      } else {
        cardsHTML = '<div class="seat-cards"></div>';
      }

      /* 本轮已下注 / Amount bet this round */
      const betHTML = p.bet > 0
        ? '<div class="seat-bet">🪙 ' + p.bet + '</div>'
        : '';

      /* 位置标签 / Position label */
      const order = game._orderAfterButton(i);
      const pName = posName(order, n);

      /* 庄家按钮 / Dealer button */
      const dealerHTML = (game.button === i)
        ? '<div class="badge-dealer">D</div>'
        : '';

      /* 动作气泡 / Action bubble */
      const actHTML = p.lastAction
        ? '<div class="seat-action ' + actionClass(p.lastAction) + '">' + actionLabel(p) + '</div>'
        : '';

      const styleHTML = (p.style && !p.isHero)
        ? '<span class="seat-style">' + p.style.avatar + p.style.name + '</span>'
        : '';

      const stackCls = p.stack <= 0 ? '' : '';

      html += '<div class="' + cls.join(' ') + '" data-seat="' + i + '" ' +
        'style="left:' + pos.x.toFixed(2) + '%;top:' + pos.y.toFixed(2) + '%">' +
        actHTML +
        cardsHTML +
        betHTML +
        '<div class="seat-box">' +
          dealerHTML +
          '<span class="seat-pos">' + pName + '</span>' +
          '<div class="seat-name">' + p.name + (p.allIn ? ' · 全下' : '') + '</div>' +
          '<div class="seat-meta">' +
            '<span class="seat-stack ' + stackCls + '">' + p.stack + '</span>' +
            styleHTML +
          '</div>' +
        '</div>' +
      '</div>';
    }

    /* 移除旧座位后插入（保留中心元素） / Remove old seats then insert (keeping the center elements) */
    felt.querySelectorAll('.seat').forEach(el => el.remove());
    felt.insertAdjacentHTML('beforeend', html);
  }

  /* ---------------- 渲染：公共牌 / Render: board ---------------- */
  function renderBoard() {
    const board = $('#board');
    const cards = game.board;
    const isNew = cards.length > lastBoardLen;
    lastBoardLen = cards.length;

    let html = '';
    for (let i = 0; i < 5; i++) {
      if (i < cards.length) {
        html += cardHTML(cards[i], isNew && i >= cards.length - 3 ? 'dealt' : '');
      } else {
        html += '<div class="card-slot"></div>';
      }
    }
    board.innerHTML = html;

    const pot = $('#pot-display');
    pot.innerHTML = '底池&nbsp;<b>' + game.pot + '</b>';
    $('#hud-pot').textContent = game.pot;
    $('#street-tag').textContent = game.handResult ? '本手结束' : (game.handNo ? game.streetCN : '等待开始');
    $('#hud-street').textContent = game.handNo ? (game.handResult ? '已结束' : game.streetCN) : '等待开始';
    $('#hud-hand').textContent = game.handNo;
  }

  /* ---------------- 渲染：操作栏 / Render: action bar ---------------- */
  function renderActionBar() {
    const bar = $('#action-bar');
    const hero = game.players[0];

    if (game.stage === 'over' && game.handResult) {
      const sig = 'over|' + game.handNo;
      if (sig !== actionBarSig) {
        actionBarSig = sig;
        bar.innerHTML = renderResultBanner();
      }
      return;
    }

    /* 还没开始 / Not started yet */
    if (game.stage === 'idle') {
      const sig = 'idle';
      if (sig !== actionBarSig) {
        actionBarSig = sig;
        bar.innerHTML = '<div class="waiting">点击右上角「开始新一手」发牌 <kbd>N</kbd></div>';
      }
      return;
    }

    /* 等待其他玩家 / Waiting for other players */
    if (!game.canHeroAct()) {
      const actor = game.toAct !== null ? game.players[game.toAct] : null;
      const sig = 'wait|' + (actor ? actor.seat : -1) + '|' + game.street;
      if (sig !== actionBarSig) {
        actionBarSig = sig;
        bar.innerHTML = '<div class="waiting"><span class="spinner"></span>' +
          (actor ? actor.name + ' 正在思考…' : '正在结算…') + '</div>';
      }
      return;
    }

    /* 轮到真人 / Hero's turn */
    const toCall = Math.max(0, game.currentBet - hero.bet);
    const sig = 'hero|' + game.handNo + '|' + game.street + '|' + toCall + '|' + game.currentBet + '|' + hero.stack + '|' + game.pot;
    if (sig === actionBarSig) return;
    actionBarSig = sig;

    const bb = game.cfg.bb;
    const maxTarget = hero.bet + hero.stack;
    const minTarget = Math.min(game.currentBet + Math.max(game.lastRaiseSize, bb), maxTarget);
    let defTarget = Math.max(minTarget, Math.round((game.currentBet * 3) / bb) * bb);
    defTarget = Math.min(defTarget, maxTarget);

    const canRaise = maxTarget > game.currentBet;

    bar.innerHTML =
      '<div class="act-row">' +
        '<button class="abtn fold" data-act="fold">弃牌<small>FOLD · F</small></button>' +
        (toCall === 0
          ? '<button class="abtn check" data-act="check">过牌<small>CHECK · C</small></button>'
          : '<button class="abtn call" data-act="call">跟注 ' + Math.min(toCall, hero.stack) +
            '<small>所需 ' + toCall + ' · C</small></button>') +
        '<div class="grow"></div>' +
        (canRaise
          ? '<button class="abtn raise" data-act="raise">加注<small>RAISE · R</small></button>' +
            '<button class="abtn allin" data-act="allin">全下 ' + maxTarget + '<small>ALL-IN · A</small></button>'
          : '') +
      '</div>' +
      (canRaise
        ? '<div class="act-row">' +
            '<div class="raise-box">' +
              '<label>加注到</label>' +
              '<input type="range" id="raise-range" min="' + minTarget + '" max="' + maxTarget +
                '" step="' + bb + '" value="' + defTarget + '">' +
              '<span class="raise-amount" id="raise-amt">' + defTarget + '</span>' +
            '</div>' +
            '<div class="quick-btns">' +
              '<button data-frac="0.5">½ 池</button>' +
              '<button data-frac="0.75">¾ 池</button>' +
              '<button data-frac="1">满池</button>' +
            '</div>' +
          '</div>'
        : '');

    /* 绑定 / Bind handlers */
    bar.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'raise') {
          const v = parseInt($('#raise-range').value, 10);
          game.heroAct('raise', v);
        } else {
          game.heroAct(act);
        }
        actionBarSig = '';
        render();
      });
    });

    const range = $('#raise-range');
    if (range) {
      const amt = $('#raise-amt');
      const update = () => {
        amt.textContent = range.value;
        const pct = (range.value - range.min) / (range.max - range.min || 1) * 100;
        range.style.setProperty('--pct', pct + '%');
      };
      range.addEventListener('input', update);
      update();

      bar.querySelectorAll('[data-frac]').forEach(b => {
        b.addEventListener('click', () => {
          const f = parseFloat(b.dataset.frac);
          const callAmt = Math.max(0, game.currentBet - hero.bet);
          let t = game.currentBet + (game.pot + callAmt) * f;
          t = Math.round(t / bb) * bb;
          t = Math.max(minTarget, Math.min(maxTarget, t));
          range.value = t;
          update();
        });
      });
    }
  }

  function renderResultBanner() {
    const r = game.handResult;
    const hero = game.players[0];
    const heroWin = r.winners.find(w => w.seat === 0);
    const heroNet = hero.stack - game._heroStackAtStart;

    let cls = 'neutral', icon = '🃏', main = '';
    if (hero.won > 0) {
      cls = 'win';
      icon = '🏆';
      main = '你赢得 ' + hero.won;
    } else if (hero.folded) {
      cls = 'lose';
      icon = '🏳️';
      main = '你已弃牌';
    } else if (heroNet < 0) {
      cls = 'lose';
      icon = '💧';
      main = '你输掉 ' + Math.abs(heroNet);
    } else {
      cls = 'neutral';
      icon = '🤝';
      main = '平分 / 无损失';
    }

    let detail = '';
    if (r.type === 'showdown') {
      const my = r.evals.find(e => e.seat === 0);
      if (my && !hero.folded) detail = '你的牌型：' + my.text;
      else if (hero.folded) detail = '（已弃牌，未参与摊牌）';
    } else {
      const w = r.winners[0];
      detail = game.players[w.seat].name + ' 收下底池（其他人弃牌）';
    }

    return '<div class="result-banner ' + cls + '">' +
      '<span style="font-size:22px">' + icon + '</span>' +
      '<span class="amt">' + main + '</span>' +
      '<span style="color:#64748b;font-weight:500;font-size:13px">' + detail + '</span>' +
      '<button class="btn primary" id="btn-next-hand">下一手 <kbd>N</kbd></button>' +
      '</div>';
  }

  /* ---------------- 渲染：教练面板 / Render: coach panel ---------------- */
  function renderCoach() {
    const box = $('#coach-body');
    const panel = $('#panel-coach');
    if (panel) {
      panel.classList.toggle('collapsed', !coachOpen);
      panel.classList.toggle('open', coachOpen);
    }
    /* 收起时连算都不算：对随机手牌是 1200 次蒙特卡洛，建议是 1400 次。
     * When collapsed, don't even compute: it's 1200 Monte Carlo runs for random hands and 1400 for advice.
       没人看的时候白算，就是白烧 CPU。
     * Computing while nobody is watching is just burning CPU for nothing. */
    if (!coachOpen) {
      box.innerHTML = '';
      return;
    }

    const hero = game.players[0];
    const n = game.players.length;

    if (!hero.hole.length) {
      box.innerHTML = '<div class="coach-empty">开始新一手后，<br>这里会显示胜率与建议</div>';
      return;
    }

    if (hero.folded) {
      box.innerHTML = '<div class="coach-empty">你已弃牌，等待本手结束</div>';
      return;
    }

    if (!opts.hints) {
      box.innerHTML = '<div class="coach-empty">教练建议已在设置中关闭</div>';
      return;
    }

    const order = game._orderAfterButton(0);
    const pName = posName(order, n);
    const nOpp = Math.max(1, game.players.filter(p => !p.folded && p.seat !== 0).length);

    const cardsAll = hero.hole.concat(game.board);
    const d = PK.describe(cardsAll);

    const toCall = Math.max(0, game.currentBet - hero.bet);
    const potOdds = toCall > 0 ? toCall / (game.pot + toCall) : 0;

    box.innerHTML =
      '<div class="coach-row"><span class="k">你的位置</span><span class="v">' + pName +
        ' · ' + n + ' 人桌</span></div>' +
      '<div class="coach-row"><span class="k">底牌</span><span class="v">' +
        hero.hole.map(PK.cardLabel).join(' ') + '</span></div>' +
      '<div class="hand-desc">' + d.text + '</div>' +
      /* 主指标（进度条 + 大数字）必须走**决策口径**：翻后对对手下注范围，翻前对当前对手数。
       * The primary metric (progress bar + big number) must use the **decision basis**: postflop against the opponents' betting range, preflop against the current number of opponents.
         次指标才是"对随机手牌"的胜率。两者通常差好几个点（对手下注的范围强于随机），
       * Only the secondary metric is the win rate against random hands. The two usually differ by several points (a betting range is stronger than random),
         混着看就会出现"胜率 47.6% 越过 34.8% 的赔率线，却建议弃牌"这种自相矛盾的面板。
       * and mixing them would produce a self-contradictory panel like "win rate 47.6% crosses the 34.8% odds line, yet it advises folding". */
      '<div class="eq-wrap">' +
        '<div class="eq-head"><span>' + (game.board.length ? '对对手范围' : '当前胜率') +
          '</span><b id="eq-range-val">计算中…</b></div>' +
        '<div class="eq-bar"><div class="eq-fill" id="eq-fill" style="width:0%"></div>' +
          (opts.odds && potOdds > 0 ? '<div class="eq-need" id="eq-need"></div>' : '') +
        '</div>' +
        '<div class="eq-head" style="font-size:11px"><span>' +
          (opts.odds && toCall > 0
            ? '底池赔率 ' + (potOdds * 100).toFixed(1) + '% → 跟注需 ' + toCall + ' 赢 ' + (game.pot + toCall)
            : (toCall > 0 ? '需要跟注 ' + toCall : '无需跟注')) +
        '</span><span>对手 ' + nOpp + ' 个</span></div>' +
        '<div class="eq-head" style="font-size:11px"><span>对随机手牌</span>' +
          '<b id="eq-val" style="font-size:12px">计算中…</b></div>' +
      '</div>' +
      '<div id="advice-slot"><div class="coach-empty" style="padding:4px 0">分析中…</div></div>';

    updateEquity(nOpp, toCall, potOdds);
    updateAdvice();
  }

  /* 只负责"对随机手牌"这个参考值。进度条与主数字已交给建议（决策口径）接管，
   * Only responsible for the "against random hands" reference value. The progress bar and main number are now handled by the advice (decision basis),
     所以这里不再染色、也不再用底池赔率当判据 —— 底池赔率只是门槛的一个组成项。
   * so we no longer color it here or use pot odds as the criterion — pot odds are just one component of the threshold. */
  function updateEquity(nOpp, toCall, potOdds) {
    const token = ++eqToken;
    const hero = game.players[0];
    if (!opts.equity) {
      const v = $('#eq-val');
      if (v) v.textContent = '已关闭';
      return;
    }
    PK.equityAsync(hero.hole, game.board, nOpp, game.board.length ? 1200 : 0).then(eq => {
      if (token !== eqToken) return;
      const v = $('#eq-val');
      if (!v) return;
      v.textContent = (eq * 100).toFixed(1) + '%';
      /* 建议关闭时没人接管主指标，退化成用参考值填充，至少还有进度可看 / When advice is off, nobody takes over the primary metric; it falls back to filling with the reference value so at least there is progress to see */
      if (!opts.hints) paintMain(eq, 0);
    });
  }

  /* 主指标 = 决策口径胜率 + 跟注门槛刻度线（need，不是底池赔率） / Primary metric = decision-basis win rate + call threshold marker (need, not pot odds) */
  function paintMain(eqRange, needEq) {
    const rv = $('#eq-range-val'), f = $('#eq-fill'), line = $('#eq-need');
    if (rv) rv.textContent = (eqRange * 100).toFixed(1) + '%';
    if (f) f.style.width = Math.max(1.5, eqRange * 100) + '%';
    if (line) {
      if (needEq > 0) {
        line.style.display = '';
        line.style.left = Math.min(100, needEq * 100) + '%';
      } else {
        /* 翻前按范围表判断、或建议未开启时，没有"赔率门槛"这条线可画 / Preflop (judged by the range chart) or when advice is off, there is no "odds threshold" line to draw */
        line.style.display = 'none';
      }
    }
    if (rv) rv.style.color = needEq > 0 ? (eqRange > needEq ? '#16a34a' : '#d92d2d') : '';
  }

  function updateAdvice() {
    const token = ++adviceToken;
    setTimeout(() => {
      if (token !== adviceToken) return;
      const slot = $('#advice-slot');
      if (!slot) return;
      if (!opts.hints || !game.canHeroAct()) {
        slot.innerHTML = '<div class="coach-empty" style="padding:4px 0">等待轮到你行动</div>';
        return;
      }
      const adv = PK.adviseHero(game, 0);
      slot.innerHTML = adviceHTML(adv);
      /* 主指标与刻度线都取自同一份建议：胜率用决策口径，线画在真实门槛 need 上。
       * Both the primary metric and the threshold marker come from the same advice: the win rate uses the decision basis and the line is drawn at the real threshold "need".
         这样"数字越过线"与"该跟还是该弃"必然一致，玩家可以自己复核。
       * This way "the number crossing the line" and "call or fold" are guaranteed to agree, so the player can verify it themselves. */
      paintMain(adv.equityVsRange != null ? adv.equityVsRange : adv.equity,
        adv.need != null ? adv.need : 0);
    }, 0);
  }

  function adviceHTML(adv) {
    const map = {
      fold:  { cls: 'fold',  icon: '🛑', title: '建议弃牌' },
      check: { cls: 'check', icon: '✋', title: '建议过牌' },
      call:  { cls: 'call',  icon: '📞', title: '建议跟注' },
      raise: { cls: 'raise', icon: '📈', title: '建议加注' },
      allin: { cls: 'allin', icon: '🚀', title: '建议全下' },
    };
    const m = map[adv.action] || map.check;
    /* 判据分两套，文案必须跟着判据走：
     * There are two criteria sets; the copy must follow whichever criterion is actually used:
       翻后 = "对对手范围的胜率 vs 跟注门槛 need"；翻前 = "位置 + 起手牌范围表"。
     * postflop = "win rate vs opponents' range vs the call threshold need"; preflop = "position + starting-hand range chart".
       旧版一律拿底池赔率当"跟注所需"，于是出现"胜率约 48%，低于跟注所需的 35%"——
     * The old version always used pot odds as the "required to call", producing "win rate about 48%, below the 35% needed to call" —
       48 与 35 的大小关系与"低于"相反，字面就是假命题。
     * the relation between 48 and 35 is the opposite of "below", so it is literally false. */
    const needPct = adv.need != null ? (adv.need * 100).toFixed(0) : null;
    const oddsPct = adv.potOdds > 0 ? (adv.potOdds * 100).toFixed(1) : null;
    const eqPct = ((adv.equityVsRange != null ? adv.equityVsRange : adv.equity) * 100).toFixed(0);
    const eqWord = needPct ? '对对手范围的胜率约 ' : '胜率约 ';
    let reason = '';
    if (adv.action === 'fold') {
      reason = needPct
        ? eqWord + eqPct + '%，低于跟注所需的 ' + needPct + '%（底池赔率 ' + oddsPct +
          '% 加上纪律余量），长期来看跟注是亏损的。'
        : '当前手牌不在跟注范围内，翻前按位置与起手牌范围表判断。';
    } else if (adv.action === 'check') {
      reason = '当前无人下注，' + eqWord + eqPct + '%，可以选择过牌控制底池。';
    } else if (adv.action === 'call') {
      reason = needPct
        ? eqWord + eqPct + '%，高于跟注所需的 ' + needPct + '%，跟注有利可图。'
        : '当前手牌在跟注范围内，翻前按位置与起手牌范围表判断。';
    } else {
      reason = eqWord + eqPct + '%，' + (adv.note || '主动加注') + '可以榨取更多价值或逼走对手。';
    }
    return '<div class="advice ' + m.cls + '"><span class="icon">' + m.icon + '</span>' +
      '<span class="txt"><b>' + m.title + '　<span style="font-weight:500;opacity:.8">' +
      (adv.note || '') + '</span></b>' + reason + '</span></div>';
  }

  /* ---------------- 渲染：统计 / Render: stats ---------------- */
  function renderStats() {
    const s = game.stats;
    const hands = Math.max(1, s.hands);
    const vpip = (s.vpip / hands * 100).toFixed(0);
    const pfr = (s.pfr / hands * 100).toFixed(0);
    const wsd = s.showdowns ? (s.showdownWins / s.showdowns * 100).toFixed(0) + '%' : '—';
    const net = s.netProfit;
    const netCls = net > 0 ? 'up' : (net < 0 ? 'down' : '');

    $('#stats-body').innerHTML =
      '<div class="stat-item"><span class="k">累计盈亏</span><span class="v ' + netCls + '">' +
        (net > 0 ? '+' : '') + net + '</span></div>' +
      '<div class="stat-item"><span class="k">当前筹码</span><span class="v">' + game.players[0].stack + '</span></div>' +
      '<div class="stat-item"><span class="k">已玩手数</span><span class="v">' + s.hands + '</span></div>' +
      '<div class="stat-item"><span class="k">最大底池</span><span class="v">' + s.biggestPot + '</span></div>' +
      '<div class="stat-item"><span class="k">入池率 VPIP</span><span class="v">' + vpip + '%</span></div>' +
      '<div class="stat-item"><span class="k">翻前加注 PFR</span><span class="v">' + pfr + '%</span></div>' +
      '<div class="stat-item"><span class="k">摊牌胜率</span><span class="v">' + wsd + '</span></div>' +
      '<div class="stat-item"><span class="k">摊牌次数</span><span class="v">' + s.showdowns + '</span></div>';

    renderSpark();
  }

  function renderSpark() {
    const h = game.stats.history;
    const svg = $('#spark');
    const W = 300, H = 64, pad = 6;
    if (h.length < 2) {
      svg.innerHTML = '<text x="150" y="36" text-anchor="middle" font-size="11" fill="#94a3b8">' +
        '打完两手后显示盈亏曲线</text>';
      return;
    }
    let acc = 0;
    const cum = h.map(v => (acc += v));
    const min = Math.min(0, Math.min.apply(null, cum));
    const max = Math.max(0, Math.max.apply(null, cum));
    const range = (max - min) || 1;
    const X = i => pad + (i / (cum.length - 1)) * (W - pad * 2);
    const Y = v => H - pad - ((v - min) / range) * (H - pad * 2);

    const pts = cum.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
    const zeroY = Y(0);
    const lastY = Y(cum[cum.length - 1]);
    const color = cum[cum.length - 1] >= 0 ? '#16a34a' : '#dc2626';
    const areaPts = pad + ',' + zeroY + ' ' + pts + ' ' + (W - pad) + ',' + zeroY;

    svg.innerHTML =
      '<defs><linearGradient id="gfill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.22"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/></linearGradient></defs>' +
      '<polygon points="' + areaPts + '" fill="url(#gfill)"/>' +
      '<line x1="0" y1="' + zeroY.toFixed(1) + '" x2="' + W + '" y2="' + zeroY.toFixed(1) +
        '" stroke="#dbe3ec" stroke-width="1" stroke-dasharray="3 3"/>' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color +
        '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + X(cum.length - 1).toFixed(1) + '" cy="' + lastY.toFixed(1) +
        '" r="2.8" fill="' + color + '"/>';
  }

  /* ---------------- 渲染：日志 / Render: log ---------------- */
  function renderLog() {
    const box = $('#log-body');
    const lines = game.log;
    let html = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      let cls = 'log-line';
      if (l.text.indexOf('——') === 0) cls += ' head';
      else if (l.text.indexOf('【') === 0) cls += ' street';
      else if (l.text.indexOf('你 ') === 0) cls += ' you';
      else if (l.text.indexOf('摊牌') === 0 || l.text.indexOf('赢得底池') >= 0) cls += ' win';
      html += '<div class="' + cls + '">' + escapeHTML(l.text) + '</div>';
    }
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ---------------- 总渲染 / Full render ---------------- */
  function render() {
    if (!game) return;
    renderSeats();
    renderBoard();
    renderActionBar();
    renderCoach();
    renderStats();
  }

  function appendLog() {
    renderLog();
  }

  /* ---------------- 初始化 / Initialization ---------------- */
  /** 重算牌桌尺寸后再重绘（窗口变化、切换人数时调用） / Re-measure the table size then re-render (called on window resize or player-count change) */
  function layoutAndRender() {
    measureFelt();
    render();
  }

  function init(g) {
    game = g;
    g.on('change', render);
    g.on('log', appendLog);
    g.on('hand-end', () => { actionBarSig = ''; render(); });
    g.on('hand-start', () => {
      lastBoardLen = 0; actionBarSig = '';
      coachOpen = false;                 // 每手都从收起态开始
      // EN: Start every hand in the collapsed state
      renderCoach();
    });
    g.on('hero-turn', () => { render(); });

    if (!staticBound) {
      staticBound = true;

      /* 教练面板折叠开关（标题栏整块可点） / Coach panel collapse toggle (the whole header bar is clickable) */
      const ct = $('#coach-toggle');
      if (ct) {
        const toggleCoach = () => { coachOpen = !coachOpen; renderCoach(); };
        ct.addEventListener('click', toggleCoach);
        ct.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCoach(); }
        });
      }

      /* 弹窗控制 / Modal controls */
      document.querySelectorAll('[data-close]').forEach(b => {
        b.addEventListener('click', closeModal);
      });
      $('#modal-mask').addEventListener('click', e => {
        if (e.target.id === 'modal-mask') closeModal();
      });

      /* 透视开关 / Peek toggle */
      $('#chk-peek').addEventListener('change', e => {
        opts.peek = e.target.checked;
        render();
      });

      /* 清空日志 / Clear log */
      $('#btn-clear-log').addEventListener('click', () => {
        game.log = [];
        renderLog();
      });

      /* 窗口尺寸变化：重算牌桌与座位。用 rAF 节流，避免拖动窗口时狂重绘 / Window resize: re-measure the table and seats. Throttled with rAF to avoid a redraw storm while dragging the window */
      let raf = 0;
      const schedule = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; layoutAndRender(); });
      };
      window.addEventListener('resize', schedule);
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(schedule).observe(document.querySelector('.table-outer'));
      }
    }

    eqToken++; adviceToken++; actionBarSig = ''; lastBoardLen = 0;
    measureFelt();
    renderLog();
    render();
  }

  function openModal(id) {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
    $('#' + id).classList.add('open');
    $('#modal-mask').classList.add('open');
  }

  function closeModal() {
    $('#modal-mask').classList.remove('open');
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  }

  PK.UI = {
    init, render, openModal, closeModal, opts,
    seatPos, posName, measureFelt, layoutAndRender,
    get uiScale() { return uiScale; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
