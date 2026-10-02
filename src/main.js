/* ============================================================
 * main.js — 启动、设置、快捷键与战绩持久化接线
 * main.js — Startup, settings, keyboard shortcuts, and results-persistence wiring
 * ============================================================ */
(function (global) {
  'use strict';
  const PK = global.PK;
  const $ = s => document.querySelector(s);

  /* ---------------- 配置状态 ---------------- */
  /* ---------------- Config state ---------------- */
  const cfgState = {
    seats: 6,
    blinds: '1/2',
    stackBB: 100,
    aiSpeed: 900,
  };

  let game = null;
  let saved = null;      // 从 localStorage 读到的历史（战绩 / 设置 / 复盘记录）
  // EN: history loaded from localStorage (results / settings / review records)

  function blindValues() {
    const parts = cfgState.blinds.split('/');
    return { sb: parseInt(parts[0], 10), bb: parseInt(parts[1], 10) };
  }

  /* ---------------- 持久化 ---------------- */
  /* ---------------- Persistence ---------------- */
  function persist() {
    if (!game || !PK.Store) return;
    saved = PK.Store.collect(game, cfgState);
    PK.Store.save(saved);
  }

  function restoreIntoGame() {
    if (!saved) return;
    /* 用副本，避免多处共享同一个数组引用 */
    /* Use a copy to avoid several places sharing the same array reference */
    const s = saved.stats;
    game.stats = {
      hands: s.hands, vpip: s.vpip, pfr: s.pfr, netProfit: s.netProfit,
      history: s.history.slice(),
      showdowns: s.showdowns, showdownWins: s.showdownWins, biggestPot: s.biggestPot,
    };
    game.handNo = saved.handNo || 0;
    game.recents = (saved.recents || []).slice();
    if (typeof saved.heroStack === 'number' && saved.heroStack > 0) {
      game.players[0].stack = saved.heroStack;
    }
    game.players.forEach(p => { p.vpipCounted = false; p.pfrCounted = false; });
    /* 漏洞画像要一起恢复：AI 的剥削权重完全由它推导，
       The leak profile must be restored as well: the AI's exploit weights are
       derived entirely from it,
       不恢复的话每次开页 AI 都从"不认识你"重新开始学。
       and if it is not restored, the AI restarts learning from "I don't know you"
       on every page load. */
    if (PK.Profile && saved.profile) PK.Profile.stats = saved.profile;
  }

  function createGame() {
    /* 先把上一局**终止**掉再换新的。
       Terminate the previous hand **first**, then build the new one.
       ⚠️ 不终止的后果不是"内存泄漏"这么轻：旧 Game 是个独立对象，它的
       ⚠️ The consequence of not terminating is not as mild as a "memory leak":
       the old Game is an independent object, and its
       `_loop(gen)` 比的是**自己**的 generation，所以换新实例并不会让它停下。
       `_loop(gen)` compares **its own** generation, so swapping in a new instance
       does not make it stop.
       若它当时正轮到英雄行动，会永远挂在 `_waitHero` 上（无害）；但只要英雄
       If it happened to be the hero's turn, it would hang forever on `_waitHero`
       (harmless); but as long as the hero
       已经弃牌、剩下全是电脑，它就会**把这手打完**，并在 `_finalizeHand()` 里
       has already folded and the rest are all bots, it will **play the hand to
       the end** and, inside `_finalizeHand()`,
       调用 PK.Profile.endHand() / observe() —— 而 PK.Profile 是**单例**，
       call PK.Profile.endHand() / observe() — and PK.Profile is a **singleton**,
       于是"应用设置重开一局"会往你的漏洞画像里塞进一整手幽灵数据，
       so "apply settings and restart a hand" stuffs a whole hand of ghost data
       into your leak profile,
       并被 storage 持久化下来，AI 之后就会照着这份脏画像针对你。
       which storage then persists, after which the AI targets you based on this
       dirty profile.
       resetAll() 会自增 generation 并 resolve 挂起的等待，旧循环随即退出。
       resetAll() increments the generation and resolves any pending wait, and the
       old loop exits right away. */
    if (game && typeof game.resetAll === 'function') game.resetAll();

    const b = blindValues();
    game = new PK.Game({
      seats: cfgState.seats,
      sb: b.sb,
      bb: b.bb,
      startStack: cfgState.stackBB * b.bb,
      aiSpeed: cfgState.aiSpeed,
    });
    restoreIntoGame();

    PK.UI.init(game);
    PK.Replay.init(game);
    if (PK.Leaks) PK.Leaks.init(game);
    global.__game = game;

    game.on('hand-end', persist);
    /* 重置画像后立即落盘，否则刷新页面又会被旧存档覆盖回来 */
    /* Persist immediately after resetting the profile, otherwise a page refresh overwrites it back from the old save */
    if (PK.Leaks) PK.Leaks.onChange = persist;

    $('#hud-blinds').textContent = b.sb + ' / ' + b.bb;
    return game;
  }

  /* ---------------- 分段选择器 ---------------- */
  /* ---------------- Segmented selectors ---------------- */
  function setupSeg(id, key, cast) {
    const el = $('#' + id);
    el.addEventListener('click', function (e) {
      const btn = e.target.closest('button');
      if (!btn) return;
      el.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      cfgState[key] = cast ? cast(btn.dataset.v) : btn.dataset.v;
    });
  }

  function syncSeg(id, value) {
    const el = $('#' + id);
    el.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', String(b.dataset.v) === String(value));
    });
  }

  /* ---------------- 初始化 ---------------- */
  /* ---------------- Initialization ---------------- */
  function boot() {
    /* 先读历史：设置也要恢复，否则每次打开都回到默认桌型 */
    /* Load history first: settings must be restored too, otherwise every open falls back to the default table */
    if (PK.Store) {
      saved = PK.Store.load();
      if (saved.cfg) {
        cfgState.seats = saved.cfg.seats;
        cfgState.blinds = saved.cfg.blinds;
        cfgState.stackBB = saved.cfg.stackBB;
        cfgState.aiSpeed = saved.cfg.aiSpeed;
      }
    }

    createGame();

    setupSeg('seg-seats', 'seats', v => parseInt(v, 10));
    setupSeg('seg-blinds', 'blinds');
    setupSeg('seg-stack', 'stackBB', v => parseInt(v, 10));
    setupSeg('seg-speed', 'aiSpeed', v => parseInt(v, 10));

    syncSeg('seg-seats', cfgState.seats);
    syncSeg('seg-blinds', cfgState.blinds);
    syncSeg('seg-stack', cfgState.stackBB);
    syncSeg('seg-speed', cfgState.aiSpeed);

    /* 顶栏按钮 */
    /* Top bar buttons */
    $('#btn-new').addEventListener('click', () => {
      if (game.stage === 'idle' || game.stage === 'over') game.newHand();
    });

    $('#btn-settings').addEventListener('click', () => PK.UI.openModal('modal-settings'));
    $('#btn-help').addEventListener('click', () => PK.UI.openModal('modal-help'));

    /* 全屏开关
     * Fullscreen toggle
     * 桌面入口以 --start-maximized 启动（**不再写死窗口尺寸**，任何屏幕都不会被裁），
     * The desktop entry launches with --start-maximized (**no hardcoded window size
     * anymore**, so no screen gets clipped),
     * 这里再给一个"真全屏"入口：盖住任务栏、无窗口边框。
     * and here we add a "true fullscreen" entry: it covers the taskbar with no
     * window border.
     * 两种全屏要分别识别，否则按钮状态会与实际不符：
     * The two kinds of fullscreen must be detected separately, otherwise the
     * button state would not match reality:
     *   页面级   —— document.fullscreenElement（本按钮走这条，Esc 可退）
     *   page-level —— document.fullscreenElement (this button uses this path; Esc exits)
     *   浏览器级 —— display-mode 媒体查询（Chrome 自带的 F11 / 启动参数 --start-fullscreen）
     *   browser-level —— the display-mode media query (Chrome's own F11 / the --start-fullscreen launch flag) */
    (function initFullscreen() {
      const btn = $('#btn-fullscreen');
      if (!btn) return;

      const pageFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
      const mediaFs = () => !!(window.matchMedia && matchMedia('(display-mode: fullscreen)').matches);
      const isFs = () => pageFs() || mediaFs();

      function sync() {
        const on = isFs();
        btn.classList.toggle('on', on);
        btn.title = on ? '退出全屏（Esc 或 F11）' : '全屏（F11）';
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }

      function fail(err) {
        btn.classList.remove('on');
        btn.title = '浏览器拒绝了全屏请求：' + ((err && err.message) || '未知原因');
        setTimeout(sync, 2000);
      }

      function toggle() {
        try {
          if (pageFs()) {
            const ex = document.exitFullscreen || document.webkitExitFullscreen;
            ex.call(document);
          } else {
            const el = document.documentElement;
            const req = el.requestFullscreen || el.webkitRequestFullscreen;
            const p = req.call(el);
            /* 没有用户手势时 requestFullscreen 会 reject。不接住就是未捕获异常，
               会直接让 verify-render 的"无控制台错误"断言变红。 */
            /* Without a user gesture, requestFullscreen rejects. Not catching it
               means an uncaught exception, which would directly turn the
               verify-render "no console errors" assertion red. */
            if (p && typeof p.catch === 'function') p.catch(fail);
          }
        } catch (err) { fail(err); }
      }

      btn.addEventListener('click', toggle);
      document.addEventListener('fullscreenchange', sync);
      document.addEventListener('webkitfullscreenchange', sync);
      const mq = window.matchMedia && matchMedia('(display-mode: fullscreen)');
      if (mq) {
        if (mq.addEventListener) mq.addEventListener('change', sync);
        else if (mq.addListener) mq.addListener(sync);
      }
      sync();
      PK.fullscreen = { toggle, isFullscreen: isFs };
    })();

    /* 情境训练 */
    /* Scenario drill */
    $('#btn-drill').addEventListener('click', () => {
      PK.UI.openModal('modal-drill');
      PK.Drill.open();
    });

    /* 手牌复盘 */
    /* Hand replay */
    $('#btn-replay').addEventListener('click', () => {
      PK.UI.openModal('modal-replay');
      PK.Replay.open();
    });

    /* 结果横幅里的"下一手"（动态元素，用委托） */
    /* The "next hand" button in the result banner (a dynamic element, so use delegation) */
    $('#action-bar').addEventListener('click', e => {
      if (e.target.closest('#btn-next-hand')) game.newHand();
    });

    /* 应用设置 */
    /* Apply settings */
    $('#btn-apply').addEventListener('click', () => {
      PK.UI.closeModal();
      createGame();
      persist();
      setTimeout(() => game.newHand(), 60);
    });

    /* 辅助功能开关 */
    /* Assist toggle switches */
    $('#cfg-hints').addEventListener('change', e => { PK.UI.opts.hints = e.target.checked; PK.UI.render(); });
    $('#cfg-equity').addEventListener('change', e => { PK.UI.opts.equity = e.target.checked; PK.UI.render(); });
    $('#cfg-odds').addEventListener('change', e => { PK.UI.opts.odds = e.target.checked; PK.UI.render(); });

    /* 清空统计：战绩、盈亏曲线、复盘记录一并清掉，并同步抹掉本地存档 */
    /* Clear stats: wipe results, the profit/loss curve, and review records together, and erase the local save as well */
    $('#btn-reset-stats').addEventListener('click', () => {
      game.stats = PK.Store.emptyStats();
      game.recents = [];
      game.players.forEach(p => { p.vpipCounted = false; p.pfrCounted = false; });
      game._heroStackAtStart = game.players[0].stack;
      /* 漏洞画像也要一并清空：否则"清空统计"之后 AI 仍在按旧漏洞剥削你 */
      /* The leak profile must be cleared as well: otherwise the AI keeps exploiting your old leaks after "clear stats" */
      if (PK.Profile) PK.Profile.reset();
      if (PK.Store) PK.Store.clear();
      saved = null;
      PK.UI.render();
    });

    /* 复盘 / 训练面板 */
    /* Replay / drill panels */
    if (PK.Replay) PK.Replay.bind();
    if (PK.Leaks) PK.Leaks.bind();
    if (PK.Drill) {
      PK.Drill.bind();
      PK.Drill.restore(saved ? saved.drill : null);
      PK.Drill.onChange = persist;
    }

    /* 快捷键 */
    /* Keyboard shortcuts */
    document.addEventListener('keydown', onKey);

    /* 关页面前把防抖中的存档落盘 */
    /* Flush the debounced save to disk before the page closes */
    if (PK.Store) {
      window.addEventListener('beforeunload', () => PK.Store.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) PK.Store.flush();
      });
    }

    /* 开局 */
    /* Kick off the first hand */
    setTimeout(() => game.newHand(), 200);
  }

  /* ---------------- 键盘 ---------------- */
  /* ---------------- Keyboard ---------------- */
  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const k = e.key.toLowerCase();
    const maskOpen = $('#modal-mask').classList.contains('open');

    /* F11 全屏：故意放在"弹窗打开就吞掉按键"的判断之前 ——
       F11 fullscreen: deliberately placed before the "modal open swallows keys"
       check —
       开着帮助/设置弹窗时，切全屏依然应该生效。
       with the help/settings modal open, toggling fullscreen should still work. */
    if (k === 'f11') {
      e.preventDefault();
      if (PK.fullscreen) PK.fullscreen.toggle();
      return;
    }

    if (k === 'escape') {
      if (maskOpen) PK.UI.closeModal();
      return;
    }
    if (maskOpen) return;

    if (k === 'n') {
      e.preventDefault();
      if (game.stage === 'idle' || game.stage === 'over') game.newHand();
      return;
    }
    if (k === 'h') { e.preventDefault(); PK.UI.openModal('modal-replay'); PK.Replay.open(); return; }
    if (k === 'd') { e.preventDefault(); PK.UI.openModal('modal-drill'); PK.Drill.open(); return; }
    if (k === 'p' && PK.Leaks) {
      e.preventDefault(); PK.UI.openModal('modal-leaks'); PK.Leaks.open(); return;
    }

    if (!game.canHeroAct()) return;
    const hero = game.players[0];
    const toCall = Math.max(0, game.currentBet - hero.bet);

    if (k === 'f') { e.preventDefault(); game.heroAct('fold'); PK.UI.render(); }
    else if (k === 'c') { e.preventDefault(); game.heroAct(toCall > 0 ? 'call' : 'check'); PK.UI.render(); }
    else if (k === 'a') { e.preventDefault(); game.heroAct('allin'); PK.UI.render(); }
    else if (k === 'r') {
      e.preventDefault();
      const r = $('#raise-range');
      const v = r ? parseInt(r.value, 10) : Math.max(game.currentBet * 3, game.currentBet + game.lastRaiseSize);
      game.heroAct('raise', v);
      PK.UI.render();
    } else if (k === 'arrowup' || k === 'arrowdown') {
      const r = $('#raise-range');
      if (!r) return;
      e.preventDefault();
      const step = game.cfg.bb;
      let v = parseInt(r.value, 10) + (k === 'arrowup' ? step : -step);
      v = Math.max(parseInt(r.min, 10), Math.min(parseInt(r.max, 10), v));
      r.value = v;
      r.dispatchEvent(new Event('input'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
