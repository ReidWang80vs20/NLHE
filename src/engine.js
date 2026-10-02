/* ============================================================
 * engine.js — 无限注德州扑克游戏状态机
 * No-limit Texas Hold'em game state machine
 *   盲注轮转 / 下注轮推进 / 最小加注 / All-in / 多层边池 / 摊牌结算
 *   Blind rotation / betting-round advance / min-raise / all-in / multi-level side pots / showdown settlement
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK;

  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const STREET_CN = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };

  const DEFAULT_CFG = {
    seats: 6,
    startStack: 200,      // 兜底默认值；main.js 实际以 stackBB × bb 覆盖
    // EN: fallback default; main.js actually overrides it with stackBB × bb
    bb: 2,
    sb: 1,
    aiSpeed: 800,         // AI 行动延迟基数（ms） / AI action delay base (ms)
    dealDelay: 30,        // 发牌到开始行动的间隔（ms） / delay from deal to first action (ms)
  };

  class Game {
    constructor(cfg) {
      this.cfg = Object.assign({}, DEFAULT_CFG, cfg || {});
      this.listeners = {};
      this.generation = 0;
      this.handNo = 0;
      this.button = -1;
      this.stage = 'idle';
      this.players = [];
      this.board = [];
      this.pot = 0;
      this.currentBet = 0;
      this.lastRaiseSize = this.cfg.bb;
      this.raiseCount = 0;
      this.toAct = null;
      this.log = [];
      this.handResult = null;
      this.handActions = [];   // 当前这一手的行动序列（供复盘回放） / action sequence of this hand (for replay)
      this.recents = [];       // 最近若干手的完整记录（复盘用） / full records of recent hands (for review)
      this.stats = {
        hands: 0, vpip: 0, pfr: 0, netProfit: 0, history: [],
        showdowns: 0, showdownWins: 0, biggestPot: 0,
      };
      this._initPlayers();
    }

    /* ---------------- 事件 ---------------- */
    /* ---------------- Events ---------------- */
    on(evt, fn) {
      (this.listeners[evt] || (this.listeners[evt] = [])).push(fn);
      return this;
    }
    emit(evt, payload) {
      const arr = this.listeners[evt];
      if (arr) for (let i = 0; i < arr.length; i++) arr[i](payload);
      return this;
    }

    /* ---------------- 初始化 ---------------- */
    /* ---------------- Initialization ---------------- */
    _initPlayers() {
      const n = this.cfg.seats;
      const keys = PK.shuffle(PK.STYLE_KEYS.slice());
      this.players = [];
      for (let s = 0; s < n; s++) {
        this.players.push({
          seat: s,
          name: s === 0 ? '你' : PK.AI_NAMES[(s - 1) % PK.AI_NAMES.length],
          isHero: s === 0,
          stack: this.cfg.startStack,
          hole: [],
          bet: 0,
          contrib: 0,
          folded: false,
          allIn: false,
          acted: false,
          style: s === 0 ? null : PK.STYLES[keys[(s - 1) % keys.length]],
          lastAction: null,
          won: 0,
          vpipCounted: false,
          pfrCounted: false,
        });
      }
    }

    resetAll() {
      this.generation++;
      if (this._heroResolve) { const r = this._heroResolve; this._heroResolve = null; r(); }
      if (this._timers) { for (const t of this._timers) clearTimeout(t); this._timers = []; }
      this.handNo = 0;
      this.button = -1;
      this.stage = 'idle';
      this.board = [];
      this.pot = 0;
      this.toAct = null;
      this.log = [];
      this.handResult = null;
      this.handActions = [];
      this.recents = [];
      this.stats = { hands: 0, vpip: 0, pfr: 0, netProfit: 0, history: [], showdowns: 0, showdownWins: 0, biggestPot: 0 };
      this._initPlayers();
      this.emit('change');
    }

    _log(text) {
      this.log.push({ hand: this.handNo, street: this.street, text: text });
      if (this.log.length > 500) this.log.shift();
      this.emit('log', text);
    }

    /* ---------------- 一手牌的开始 ---------------- */
    /* ---------------- Start of a hand ---------------- */
    newHand() {
      this.generation++;
      const gen = this.generation;

      /* 打断上一手挂起的等待 */
      /* Interrupt the pending wait from the previous hand */
      if (this._heroResolve) { const r = this._heroResolve; this._heroResolve = null; r(); }
      if (this._timers) { for (const t of this._timers) clearTimeout(t); this._timers = []; }

      this.handNo++;

      for (const p of this.players) {
        if (p.stack < this.cfg.bb) {
          p.stack = this.cfg.startStack;
          this._log(`${p.name} 重新买入至 ${p.stack}`);
        }
        p.hole = []; p.bet = 0; p.contrib = 0;
        p.folded = false; p.allIn = false; p.acted = false;
        p.lastAction = null; p.won = 0;
        p.vpipCounted = false; p.pfrCounted = false;
      }
      this.board = [];
      this.pot = 0;
      this.handResult = null;
      this.handActions = [];
      this.street = 'preflop';
      this.currentBet = this.cfg.bb;
      this.lastRaiseSize = this.cfg.bb;
      this.raiseCount = 0;
      this.noReopen = false;
      this.stage = 'betting';
      this.deck = PK.shuffle(PK.freshDeck());
      this.deckIdx = 0;
      this._heroStackAtStart = this.players[0].stack;
      /* 本手英雄是否看到翻牌。必须在**发翻牌那一刻**判定并落定，
         Whether the hero saw the flop this hand. It must be decided and fixed **the moment the flop is dealt**,
         不能用牌局结束时的 p.folded 反推 —— 那样会把"转牌/河牌弃牌"的手
         not inferred from p.folded at hand end — that would remove hands folded on the turn/river
         从 WTSD 的分母里剔掉。详见 test/diag-style.js 顶部口径说明。
         from the WTSD denominator. See the note at the top of test/diag-style.js. */
      this._heroSawFlop = false;

      /* 漏洞画像：新的一手开始（VPIP 分母在这里 +1） */
      /* Leak profile: a new hand starts (VPIP denominator +1 here) */
      if (PK.Profile && PK.Profile.startHand) PK.Profile.startHand();

      this.button = (this.button + 1) % this.players.length;

      this._log(`—— 第 ${this.handNo} 手 · 按钮位：${this.players[this.button].name} ——`);
      this._postBlinds();
      this._dealHoles();

      this.toAct = this._firstPreflopActor();
      this._lastActionText = '';
      this.emit('hand-start');
      this.emit('change');

      const g = gen;
      setTimeout(() => this._run(g), this.cfg.dealDelay);
    }

    _postBlinds() {
      const n = this.players.length;
      const twoHanded = n === 2;
      this.sbSeat = twoHanded ? this.button : (this.button + 1) % n;
      this.bbSeat = twoHanded ? (this.button + 1) % n : (this.button + 2) % n;

      const sbP = this.players[this.sbSeat];
      const bbP = this.players[this.bbSeat];
      this._commit(sbP, Math.min(this.cfg.sb, sbP.stack));
      this._commit(bbP, Math.min(this.cfg.bb, bbP.stack));
      sbP.acted = false;
      bbP.acted = false;
      this.currentBet = Math.max(this.cfg.bb, sbP.bet, bbP.bet);
    }

    _dealHoles() {
      for (let round = 0; round < 2; round++) {
        for (const p of this.players) {
          p.hole.push(this.deck[this.deckIdx++]);
        }
      }
    }

    _commit(p, amount) {
      amount = Math.max(0, Math.min(amount, p.stack));
      if (amount > 0) {
        p.stack -= amount;
        p.bet += amount;
        p.contrib += amount;
        this.pot += amount;
        if (p.stack === 0) p.allIn = true;
      }
      return amount;
    }

    /* ---------------- 行动者定位 ---------------- */
    /* ---------------- Actor positioning ---------------- */
    _firstPreflopActor() {
      const n = this.players.length;
      const start = n === 2 ? this.button : (this.bbSeat + 1) % n;
      return this._firstActionableFrom(start);
    }

    _firstPostflopActor() {
      const n = this.players.length;
      return this._firstActionableFrom((this.button + 1) % n);
    }

    _firstActionableFrom(seat) {
      const n = this.players.length;
      for (let i = 0; i < n; i++) {
        const s = (seat + i) % n;
        const p = this.players[s];
        if (!p.folded && !p.allIn) return s;
      }
      return null;
    }

    _nextActorFrom(seat) {
      const n = this.players.length;
      for (let i = 1; i <= n; i++) {
        const s = (seat + i) % n;
        const p = this.players[s];
        if (p.folded || p.allIn) continue;
        if (!p.acted || p.bet < this.currentBet) return s;
      }
      return null;
    }

    /* ---------------- 主循环 ---------------- */
    /* ---------------- Main loop ---------------- */
    async _run(gen) {
      try {
        await this._loop(gen);
      } catch (err) {
        console.error('[Game] 运行异常', err);
        this._log('⚠ 内部异常：' + (err && err.message ? err.message : err));
        this.stage = 'over';
        this.toAct = null;
        this.emit('change');
      }
    }

    async _loop(gen) {
      while (gen === this.generation) {
        const alive = this.players.filter(p => !p.folded);
        if (alive.length <= 1) {
          await this._endByFold(gen);
          return;
        }

        if (this.toAct === null) {
          if (this.street === 'river') {
            await this._showdown(gen);
            return;
          }
          await this._advanceStreet(gen);
          continue;
        }

        const seat = this.toAct;
        const p = this.players[seat];
        this.emit('change');

        if (p.isHero) {
          this.emit('hero-turn', seat);
          await this._waitHero(gen);
        } else {
          await this._delay(this._aiDelay(), gen);
          if (gen !== this.generation) return;
          const d = PK.aiDecide(this, seat);
          this._log(`${p.name} ${this._actionText(p, d)}`);
          p.lastNote = d.note;
          this._apply(p, d);
          this.emit('change');
        }
        if (gen !== this.generation) return;
      }
    }

    _delay(ms, gen) {
      return new Promise(resolve => {
        const t = setTimeout(resolve, ms);
        this._timers = this._timers || [];
        this._timers.push(t);
        if (this._timers.length > 20) clearTimeout(this._timers.shift());
      });
    }

    _aiDelay() {
      return Math.round(this.cfg.aiSpeed * (0.55 + Math.random() * 0.85));
    }

    _waitHero(gen) {
      return new Promise(resolve => {
        this._heroResolve = resolve;
        this._heroGen = gen;
      });
    }

    /* ---------------- 应用一个动作 ---------------- */
    /* ---------------- Apply an action ---------------- */
    _apply(p, d) {
      const toCall = Math.max(0, this.currentBet - p.bet);
      const heroPreflopSnapshot = p.isHero && this.street === 'preflop' ? toCall : null;
      /* 画像需要"行动之前"的底池与加注次数，以及本次实际投入的筹码。
         The profile needs the pot and raise count "before the action", plus the chips actually invested now.
         此刻先快照，switch 之后 this.pot / p.stack 都已经变了。
         Snapshot now, because after the switch this.pot / p.stack have already changed. */
      const profileSnap = p.isHero && PK.Profile
        ? { street: this.street, pot: this.pot, raiseCount: this.raiseCount, stack: p.stack }
        : null;

      switch (d.action) {
        case 'fold':
          p.folded = true;
          p.acted = true;
          p.lastAction = 'fold';
          break;

        case 'check':
          p.acted = true;
          p.lastAction = 'check';
          break;

        case 'call': {
          const amt = Math.min(toCall, p.stack);
          this._commit(p, amt);
          p.acted = true;
          p.lastAction = p.allIn ? 'allin' : 'call';
          break;
        }

        case 'raise':
        case 'allin': {
          const maxTarget = p.bet + p.stack;
          let target = d.action === 'allin' ? maxTarget : Math.min(d.amount || maxTarget, maxTarget);
          const delta = target - p.bet;
          this._commit(p, delta);

          if (target > this.currentBet) {
            const inc = target - this.currentBet;
            /* 标准无限注规则：全下加注额不足最小加注（lastRaiseSize）时
               Standard no-limit rule: when an all-in raise is less than the min-raise (lastRaiseSize)
               **不重开下注轮** —— 已行动过的玩家只能跟注/弃牌，不得再加注。
               it **does not reopen the betting round** — players who already acted may only call/fold, not re-raise.
               此前无条件重置全员 acted，会让前位玩家获得本不该有的再加注权。
               Resetting everyone's acted flag unconditionally used to grant earlier players a re-raise they never earned. */
            const fullRaise = inc >= this.lastRaiseSize;
            if (fullRaise) {
              this.lastRaiseSize = inc;
              for (const q of this.players) {
                if (q.seat !== p.seat && !q.folded && !q.allIn) q.acted = false;
              }
            } else {
              /* 短全下：本轮下注不再重开。heroAct / aiDecide 会据此把
                 Short all-in: the betting round does not reopen. heroAct / aiDecide therefore demote
                 已行动玩家的加注降级为跟注（尚未行动者不受影响）。
                 a raise by an already-acted player to a call (players yet to act are unaffected). */
              this.noReopen = true;
            }
            this.currentBet = target;
            this.raiseCount++;
            p.lastAction = 'raise';
          } else {
            p.lastAction = p.allIn ? 'allin' : 'call';
          }
          p.acted = true;
          break;
        }

        default:
          p.acted = true;
          p.lastAction = 'check';
      }

      if (p.isHero) this._recordHeroStat(d, heroPreflopSnapshot);
      if (profileSnap) this._observeHeroProfile(p, d, toCall, profileSnap);
      this._recordAction(p, d, toCall);
      this.toAct = this._nextActorFrom(p.seat);
    }

    /**
     * 把英雄的这次行动喂给漏洞画像（profile.js）。
     * Feed this hero action into the leak profile (profile.js).
     * 只统计真人；画像的观测样本一旦被 AI 掺进来，""针对你的漏洞"就无从谈起。
     * Only real players are counted; once AI samples are mixed in, the "leaks targeting you" idea falls apart.
     */
    _observeHeroProfile(p, d, toCall, snap) {
      const invested = Math.max(0, snap.stack - p.stack);
      const action = p.lastAction || d.action;
      if (snap.street === 'preflop') {
        PK.Profile.markPreflop({
          invested: invested > 0,
          aggressive: action === 'raise' || action === 'allin',
        });
      }
      PK.Profile.observe({
        street: snap.street,
        action: action,
        toCall: toCall,
        pot: snap.pot,          // 行动**之前**的底池（下注尺度用它做分母）
        // EN: pot **before** the action (used as the denominator for bet sizing)
        invested: invested,
        raiseCount: snap.raiseCount,
      });
    }

    /** 记录一次行动，供复盘回放（AI 与真人统一走这里） */
    /** Record one action for replay (both AI and hero go through here) */
    _recordAction(p, d, toCall) {
      this.handActions.push({
        street: this.street,
        seat: p.seat,
        action: p.lastAction || d.action,
        note: d.note || null,
        toCall: Math.max(0, toCall || 0),
        betAfter: p.bet,        // 本轮已投入 / invested this round
        pot: this.pot,          // 行动后的底池 / pot after the action
        stack: p.stack,
        allIn: !!p.allIn,
        boardLen: this.board.length,
      });
    }

    _recordHeroStat(d, preflopToCall) {
      if (preflopToCall === null) return;
      const p = this.players[0];
      const invested = (d.action === 'call' && preflopToCall > 0) ||
                       d.action === 'raise' || d.action === 'allin';
      if (invested && !p.vpipCounted) { this.stats.vpip++; p.vpipCounted = true; }
      if ((d.action === 'raise' || d.action === 'allin') && !p.pfrCounted) {
        this.stats.pfr++; p.pfrCounted = true;
      }
    }

    _actionText(p, d) {
      const toCall = Math.max(0, this.currentBet - p.bet);
      switch (d.action) {
        case 'fold':  return '弃牌';
        case 'check': return '过牌';
        case 'call':  {
          const amt = Math.min(toCall, p.stack);
          return p.stack <= amt ? `全下跟注 ${amt}` : `跟注 ${amt}`;
        }
        case 'raise': {
          const delta = Math.min(Math.max(0, (d.amount || 0) - p.bet), p.stack);
          const total = p.bet + delta;
          return delta >= p.stack ? `全下 ${total}` : `加注到 ${total}`;
        }
        case 'allin': return `全下 ${p.bet + p.stack}`;
        default: return d.action;
      }
    }

    /* ---------------- 真人操作入口 ---------------- */
    /* ---------------- Hero action entry point ---------------- */
    canHeroAct() {
      return this.stage === 'betting' && this.toAct !== null &&
             this.players[this.toAct] && this.players[this.toAct].isHero;
    }

    heroAct(action, amount) {
      if (!this.canHeroAct()) return false;
      const p = this.players[this.toAct];
      const toCall = Math.max(0, this.currentBet - p.bet);
      const maxTarget = p.bet + p.stack;

      if (action === 'check' && toCall > 0) return false;
      if (action === 'call' && toCall === 0) return false;

      const d = { action: action, amount: amount };
      if (action === 'raise') {
        const minTarget = Math.min(this.currentBet + Math.max(this.lastRaiseSize, this.cfg.bb), maxTarget);
        if (!d.amount || d.amount < minTarget) d.amount = minTarget;
        if (d.amount >= maxTarget) { d.action = 'allin'; d.amount = maxTarget; }
      }
      if (d.action === 'allin') d.amount = maxTarget;

      /* 短全下未重开下注轮时，已行动过的玩家只能跟注/弃牌 */
      /* When a short all-in did not reopen the round, an already-acted player may only call/fold */
      if ((d.action === 'raise' || d.action === 'allin') &&
          this.noReopen && p.acted && toCall > 0) {
        d.action = 'call';
        d.amount = undefined;
      }

      this._log(`你 ${this._actionText(p, d)}`);
      this._apply(p, d);
      const r = this._heroResolve;
      this._heroResolve = null;
      if (r) r();
      this.emit('change');
      return true;
    }

    /* ---------------- 街道推进 ---------------- */
    /* ---------------- Street advance ---------------- */
    async _advanceStreet(gen) {
      const idx = STREETS.indexOf(this.street);
      this.street = STREETS[idx + 1];

      if (this.street === 'flop') {
        this.board.push(this.deck[this.deckIdx++], this.deck[this.deckIdx++], this.deck[this.deckIdx++]);
        /* ★ WTSD 的分母在这里落定：英雄此刻还没弃牌，就算"看到了翻牌" */
        /* ★ The WTSD denominator is fixed here: if the hero has not folded yet, it counts as "saw the flop" */
        if (!this.players[0].folded) this._heroSawFlop = true;
      } else {
        this.board.push(this.deck[this.deckIdx++]);
      }

      /* 新一轮：清空本轮下注额与行动标记。
         New round: clear this round's bet amounts and acted flags.
         已弃牌的玩家保留 lastAction，这样"弃牌"标识会一直显示到本手结束。
         Folded players keep lastAction, so the "fold" marker stays visible until the hand ends. */
      for (const p of this.players) {
        p.bet = 0;
        if (p.folded) continue;
        p.acted = false;
        p.lastAction = null;
        p.lastNote = null;
      }
      this.currentBet = 0;
      this.lastRaiseSize = this.cfg.bb;
      this.raiseCount = 0;
      this.noReopen = false;
      this.toAct = this._firstPostflopActor();

      this._log(`【${STREET_CN[this.street]}】公共牌：${this.board.map(PK.cardLabel).join(' ')}`);
      this.emit('street', this.street);
      this.emit('change');
      await this._delay(this.toAct === null ? 480 : 620, gen);
    }

    /* ---------------- 弃牌结束 ---------------- */
    /* ---------------- End by fold ---------------- */
    async _endByFold(gen) {
      const winner = this.players.find(p => !p.folded);
      const amount = this.pot;
      winner.stack += amount;
      winner.won = amount;
      this.handResult = {
        type: 'fold',
        pot: amount,
        winners: [{ seat: winner.seat, amount: amount }],
        evals: [],
      };
      this._log(`${winner.name} 赢得底池 ${amount}（其余玩家弃牌）`);
      this.pot = 0;
      this.stage = 'over';
      this.toAct = null;
      this._finalizeHand();
      this.emit('hand-end', this.handResult);
      this.emit('change');
    }

    /* ---------------- 边池构建 ---------------- */
    /* ---------------- Side pot construction ---------------- */
    _buildPots() {
      const contribs = this.players.map(p => p.contrib);
      const levels = Array.from(new Set(contribs.filter(a => a > 0))).sort((a, b) => a - b);
      const pots = [];
      let prev = 0;
      for (const lvl of levels) {
        let amount = 0;
        for (const p of this.players) {
          amount += Math.min(p.contrib, lvl) - Math.min(p.contrib, prev);
        }
        const eligible = this.players.filter(p => !p.folded && p.contrib >= lvl).map(p => p.seat);
        if (amount > 0) pots.push({ amount: amount, eligible: eligible, level: lvl });
        prev = lvl;
      }
      return pots;
    }

    _orderAfterButton(seat) {
      const n = this.players.length;
      return (seat - this.button - 1 + n) % n;
    }

    /* ---------------- 摊牌 ---------------- */
    /* ---------------- Showdown ---------------- */
    async _showdown(gen) {
      this.stage = 'showdown';
      this.emit('change');
      await this._delay(420, gen);
      if (gen !== this.generation) return;

      const contenders = this.players.filter(p => !p.folded);
      const pots = this._buildPots();
      const evals = new Map();
      for (const p of contenders) {
        const r = PK.describe(p.hole.concat(this.board));
        evals.set(p.seat, r);
      }

      const totalPot = this.pot;
      const winnersAcc = new Map();
      const potDetails = [];

      for (let pi = 0; pi < pots.length; pi++) {
        const pot = pots[pi];
        let elig = contenders.filter(p => pot.eligible.indexOf(p.seat) >= 0);
        if (!elig.length) {
          /* 该层贡献者全部弃牌的极端情形：死钱应由"最接近该层资格"的
             Extreme case where every contributor to this level folded: the dead money should go to the
             未弃牌玩家竞逐（向下一层水位找），不能无差别摊给全体
             non-folded player "closest to qualifying" for this level (search lower levels), not be split
             contender —— 那会把贡献远低于该层水位的玩家也拉进分钱名单。
             among all contenders — that would pull in players whose contribution is far below this level. */
          for (let j = pi - 1; j >= 0 && !elig.length; j--) {
            elig = contenders.filter(p => pots[j].eligible.indexOf(p.seat) >= 0);
          }
        }
        if (!elig.length) elig = contenders;                       // 理论不可达，保底
        // EN: theoretically unreachable, last resort
        let best = -1, winners = [];
        for (const p of elig) {
          const sc = evals.get(p.seat).score;
          if (sc > best) { best = sc; winners = [p]; }
          else if (sc === best) winners.push(p);
        }
        const share = Math.floor(pot.amount / winners.length);
        const rem = pot.amount - share * winners.length;
        const ordered = winners.slice().sort((a, b) => this._orderAfterButton(a.seat) - this._orderAfterButton(b.seat));
        ordered.forEach((w, i) => {
          const amt = share + (i < rem ? 1 : 0);
          w.stack += amt;
          w.won += amt;
          winnersAcc.set(w.seat, (winnersAcc.get(w.seat) || 0) + amt);
        });
        potDetails.push({ amount: pot.amount, winners: winners.map(w => w.seat) });
      }

      this.pot = 0;
      this.stage = 'over';
      this.toAct = null;

      const winners = Array.from(winnersAcc.entries())
        .map(([seat, amt]) => ({ seat: seat, amount: amt }))
        .sort((a, b) => b.amount - a.amount);

      const desc = winners.map(w => `${this.players[w.seat].name} 赢 ${w.amount}`).join('、');
      this._log(`摊牌：${desc}`);

      this.handResult = {
        type: 'showdown',
        pot: totalPot,
        winners: winners,
        pots: potDetails,
        evals: contenders.map(p => ({
          seat: p.seat,
          text: evals.get(p.seat).text,
          cat: evals.get(p.seat).cat,
        })),
      };

      const hero = this.players[0];
      if (!hero.folded) {
        this.stats.showdowns++;
        if (winnersAcc.has(0)) this.stats.showdownWins++;
      }
      this.stats.biggestPot = Math.max(this.stats.biggestPot, totalPot);

      this._finalizeHand();
      this.emit('hand-end', this.handResult);
      this.emit('change');
    }

    _finalizeHand() {
      const hero = this.players[0];
      const net = hero.stack - this._heroStackAtStart;
      /* 手数在「打完」时才累计：这样持久化下来的分母与 VPIP/PFR 分子
         Hands are counted only when the hand is "finished": this keeps the persisted denominator strictly
         严格配对，反复刷新页面也不会虚增（开局就算一手会重复计数）。
         paired with the VPIP/PFR numerators, and refreshing the page repeatedly won't inflate it (counting at deal time would double-count). */
      this.stats.hands++;
      this.stats.history.push(net);
      this.stats.netProfit += net;
      this._packHand(net);

      /* 漏洞画像：结手。分子分母的口径见 profile.js 与 test/diag-style.js —
         Leak profile: end of hand. For denominator/numerator definitions see profile.js and test/diag-style.js —
         分母用 _heroSawFlop（发翻牌那一刻落定），分子要求"英雄本人摊牌"，
         the denominator uses _heroSawFlop (fixed when the flop is dealt), and the numerator requires "the hero reached showdown" —
         不能只看 handResult.type，否则"自己弃牌、别人摊牌"会被误计。
         don't just check handResult.type, or "hero folded, someone else showed down" would be miscounted. */
      if (PK.Profile && PK.Profile.endHand) {
        const r = this.handResult;
        const hero = this.players[0];
        PK.Profile.endHand({
          sawFlop: !!this._heroSawFlop,
          showdown: !!r && r.type === 'showdown' && !hero.folded,
          won: !!r && !!(r.winners || []).some(w => w.seat === 0),
        });
      }
    }

    /** 把这一手打包进 recents，供复盘逐街回放 */
    /** Pack this hand into recents for street-by-street replay */
    _packHand(heroNet) {
      const rec = {
        no: this.handNo,
        button: this.button,
        sb: this.cfg.sb,
        bb: this.cfg.bb,
        seats: this.players.length,
        players: this.players.map(p => ({
          seat: p.seat,
          name: p.name,
          hole: p.hole.slice(),
          styleName: p.style ? p.style.name : null,
          isHero: !!p.isHero,
          folded: !!p.folded,
        })),
        board: this.board.slice(),
        actions: this.handActions.slice(),
        result: this.handResult,
        heroHole: this.players[0].hole.slice(),
        heroNet: heroNet,
      };
      this.recents.push(rec);
      if (this.recents.length > 60) this.recents.shift();
    }

    get streetCN() { return STREET_CN[this.street]; }
  }

  Game.STREETS = STREETS;
  Game.STREET_CN = STREET_CN;
  PK.Game = Game;
  PK.STREET_CN = STREET_CN;
  PK.DEFAULT_CFG = DEFAULT_CFG;

  if (typeof module !== 'undefined' && module.exports) module.exports = PK;
})(typeof globalThis !== 'undefined' ? globalThis : this);
