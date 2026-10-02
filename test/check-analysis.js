/* ============================================================
 * check-analysis.js — C 组界面验收（对手范围热力图 + EV 损失复盘 + 漏洞画像）
 * check-analysis.js — Group C UI acceptance (opponent range heatmap + EV loss review + leak profile)
 *
 *   在真实浏览器里跑：打牌 → 打开复盘 → 逐步回放看热力图是否跟着变
 *   Runs in a real browser: play hands → open the review → step through the replay to see whether the heatmap follows
 *   → 点 EV 行跳转 → 打开漏洞画像面板
 *   → click an EV row to jump → open the leak profile panel
 *
 *   判定全部基于**真实 DOM 读取与计算样式**，不使用截图。
 *   All judgments are based on **real DOM reads and computed styles**, never screenshots.
 *   用法：node test/check-analysis.js [poker-trainer.html]
 *   Usage: node test/check-analysis.js [poker-trainer.html]
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const TARGET_HTML = process.argv[2] || 'poker-trainer.html';
const FILE = 'file:///' + path.join(__dirname, '..', TARGET_HTML).replace(/\\/g, '/');

/* 浏览器自动探测：NLHE_CHROME → playwright 自报 → 缓存扫描 → 标准安装 → PATH
   Browser auto-detection: NLHE_CHROME → playwright-reported → cache scan → standard install → PATH */
const CHROME = require('../tools/find-browser.cjs').findBrowserExe();

const HANDS = 8;
let pass = 0, fail = 0;
const bad = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; bad.push(name + (extra ? '  → ' + extra : '')); console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}
function group(t) { console.log('\n【' + t + '】'); }

const SHOT = path.join(__dirname, 'shots', 'analysis');
fs.mkdirSync(SHOT, { recursive: true });

(async function () {
  if (!CHROME) { console.error('未找到可用浏览器'); process.exit(1); }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  /* 清空历史，从干净状态开始
   * Clear history to start from a clean state */
  await page.evaluate(() => {
    try { localStorage.removeItem('nlhe-trainer-v1'); } catch (e) { /* ignore */ }
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);

  /* ---------- 0. 模块加载 ----------
   * ---------- 0. Module loading ---------- */
  group('0. 新模块已加载');
  const mods = await page.evaluate(() => ({
    range: !!(window.PK && PK.Range),
    evloss: !!(window.PK && PK.EVLoss),
    bridge: !!(window.PK && PK.Bridge),
    leaks: !!(window.PK && PK.Leaks),
  }));
  ok('PK.Range 可用', mods.range);
  ok('PK.EVLoss 可用', mods.evloss);
  ok('PK.Bridge 可用', mods.bridge);
  ok('PK.Leaks 可用', mods.leaks);

  /* ---------- 1. 打若干手（故意松一点，制造能看出问题的决策） ----------
   * ---------- 1. Play several hands (deliberately loose, to create decisions that reveal problems) ---------- */
  group('1. 自动打 ' + HANDS + ' 手');
  await page.evaluate(() => {
    const g = window.__game;
    g.cfg.aiSpeed = 20;
    window.__tick = setInterval(() => {
      if (!g.canHeroAct()) return;
      const toCall = Math.max(0, g.currentBet - g.players[0].bet);
      const pot = Math.max(1, g.pot);
      /* 翻后放宽一点：敢跟，才能产生"跟注 vs 弃牌"这种有 EV 差异的决策
       * Loosen up postflop: daring to call is what produces decisions like "call vs fold" with an EV difference */
      const limit = g.street === 'preflop' ? g.cfg.bb * 4 : pot * 0.55;
      if (toCall === 0) g.heroAct('check');
      else if (toCall <= limit) g.heroAct('call');
      else g.heroAct('fold');
    }, 40);
  });

  await page.waitForFunction(() => window.__game.stage === 'over', { timeout: 30000 });
  for (let i = 1; i < HANDS; i++) {
    await page.click('#btn-new');
    await page.waitForFunction(() => window.__game.stage === 'over', { timeout: 30000 });
  }
  await page.evaluate(() => clearInterval(window.__tick));

  const st = await page.evaluate(() => {
    const g = window.__game;
    const noDecision = g.recents.filter(r => PK.EVLoss.review(r).decisions.length === 0);
    /* 独立的合法性判据：一次决策都算不出来的手，只可能是「所有人都弃牌到你的大盲，
     * Independent validity criterion: a hand with zero computable decisions can only be "everyone folded to your big blind
       你从头到尾没轮到行动」。只要行动日志里出现过真人的动作，那一刻就必然还有
     * and you never got to act". As long as the action log contains a human action, at that moment there must still be
       未弃牌的对手（否则牌局早就结束了），因此一定有决策点可算。
     * a non-folded opponent (otherwise the hand would already be over), so a decision point must exist.
       这里不调用 EVLoss 自己的函数，避免用被测对象担保被测对象。
     * EVLoss's own functions are deliberately not called here, to avoid the object under test vouching for itself. */
    const unexplained = noDecision.filter(r =>
      (r.actions || []).some(a => a.seat === 0));
    return {
      hands: g.recents.length,
      withDecisions: g.recents.filter(r => PK.EVLoss.review(r).decisions.length > 0).length,
      totalDecisions: g.recents.reduce((s, r) => s + PK.EVLoss.review(r).decisions.length, 0),
      noDecisionN: noDecision.length,
      unexplained: unexplained.length,
      errored: g.recents.filter(r => {
        try { PK.EVLoss.review(r); return false; } catch (e) { return true; }
      }).length,
    };
  });
  ok('复盘记录已生成', st.hands === HANDS, st.hands + ' / ' + HANDS);
  ok('几乎每手都能算出决策点', st.withDecisions >= HANDS - 1,
    st.withDecisions + ' / ' + HANDS + '（' + st.noDecisionN + ' 手无决策点）');
  ok('无决策点的手都能用「轮不到你行动」解释',
    st.unexplained === 0, st.unexplained + ' 手无法解释');
  ok('决策点总数大于零', st.totalDecisions > 0, String(st.totalDecisions));
  ok('EV 复盘全程不抛异常', st.errored === 0, st.errored + ' 手报错');
  console.log('   共 ' + st.totalDecisions + ' 个决策点');

  /* ---------- 2. 打开复盘，检查热力图结构 ----------
   * ---------- 2. Open the review and check the heatmap structure ---------- */
  group('2. 热力图结构');
  await page.click('#btn-replay');
  await page.waitForSelector('#modal-replay.open', { timeout: 5000 });
  await page.waitForTimeout(300);

  const heat = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('#heat-grid .heat-cell'));
    const R = PK.Range;
    let labelBad = 0;
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const i = R.HEATMAP[r][c];
        const el = cells[r * 13 + c];
        if (!el || el.textContent !== R.ORDER[i].slice(0, 2)) labelBad++;
      }
    }
    const g = document.querySelector('#heat-grid');
    const cols = getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length;
    const side = document.querySelector('.replay-side');
    const stage = document.querySelector('.replay-stage');
    return {
      count: cells.length,
      labelBad: labelBad,
      cols: cols,
      gridW: g.clientWidth,
      sideScroll: side.scrollWidth - side.clientWidth,
      sideRightOfStage: side.getBoundingClientRect().left >= stage.getBoundingClientRect().right - 1,
    };
  });
  ok('热力图共 169 个格子', heat.count === 169, String(heat.count));
  ok('每个格子的标签与类别一一对应', heat.labelBad === 0, heat.labelBad + ' 处不符');
  ok('网格为 13 列', heat.cols === 13, String(heat.cols));
  ok('分析栏与回放舞台并排（三列布局）', heat.sideRightOfStage === true,
    '分析栏宽 ' + heat.gridW + 'px');
  ok('分析栏无横向溢出', heat.sideScroll <= 1, 'scrollWidth 超出 ' + heat.sideScroll + 'px');

  /* ---------- 3. 热力图跟着回放步走 ----------
   * ---------- 3. The heatmap follows the replay steps ---------- */
  group('3. 热力图随回放步进更新');

  const sigAt = () => page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('#heat-grid .heat-cell'));
    return {
      pct: document.querySelector('#heat-pct').textContent,
      sig: cells.map(el => el.style.background).join('|'),
      colored: cells.filter(el => el.style.background).length,
      blocked: cells.filter(el => el.classList.contains('blocked')).length,
    };
  });

  /* 回放刚打开时在第 0 步：还没人行动，不给范围估计
   * When the replay just opens it is at step 0: nobody has acted, so no range estimate */
  await page.evaluate(() => PK.Replay.open());
  await page.waitForTimeout(120);
  const s0 = await sigAt();
  ok('第 0 步不给范围估计（—）', s0.pct === '—', s0.pct);
  ok('第 0 步没有着色格子', s0.colored === 0, String(s0.colored));

  /* 走到某个"已经有人行动过"的位置
   * Step to a position where "someone has already acted" */
  await page.evaluate(() => PK.Replay.jumpToAction(0));
  await page.waitForTimeout(120);
  const s1 = await sigAt();
  ok('开始行动后给出范围占比', /^\d+% · \d+ 家$/.test(s1.pct), s1.pct);
  ok('开始行动后出现着色格子', s1.colored > 20, String(s1.colored));

  /* 只看两张底牌时，没有哪一类会被**完全**阻断（每类都还剩组合），
   * With only two hole cards known, no class is **completely** blocked (every class still has combos left),
     所以阻断标记必须到公共牌发出后才检查。这里先选定"公共牌最多"的那一手，
   * so the blocking markers can only be checked after the board is dealt. First pick the hand with the most board cards,
     保证后面那条断言不是空洞的。
   * to guarantee the later assertion is not vacuous. */
  const pick = await page.evaluate(() => {
    const recs = window.__game.recents;
    let best = 0, bestLen = -1;
    recs.forEach((r, i) => { if (r.board.length > bestLen) { bestLen = r.board.length; best = i; } });
    return { idx: best, boardLen: bestLen };
  });
  ok('存在看到翻牌的手牌（保证阻断断言可检验）', pick.boardLen >= 3,
    '最长公共牌 ' + pick.boardLen + ' 张');

  await page.evaluate((i) => {
    PK.Replay.openHand(i);
    document.querySelector('#rp-last').click();     // 跳到末步：公共牌已全部发出
                                                    // EN: Jump to the last step: the board is fully dealt
  }, pick.idx);
  await page.waitForTimeout(200);

  const s2 = await sigAt();
  const blockedCheck = await page.evaluate(() => {
    const rec = window.__game.recents[PK.Replay.activeIdx];
    const known = rec.heroHole.concat(rec.board);
    const R = PK.Range;
    const expectedPart = [], expectedFull = [];
    for (let i = 0; i < R.N; i++) {
      const list = R.COMBOS[i];
      let alive = 0;
      for (let k = 0; k < list.length; k++) {
        const c1 = list[k][0], c2 = list[k][1];
        if (known.indexOf(c1) < 0 && known.indexOf(c2) < 0) alive++;
      }
      if (alive === 0) expectedFull.push(i);
      else if (alive < list.length) expectedPart.push(i);
    }
    const cells = Array.from(document.querySelectorAll('#heat-grid .heat-cell'));
    const gotPart = [], gotFull = [];
    cells.forEach(el => {
      if (el.classList.contains('blocked')) gotFull.push(+el.dataset.i);
      else if (el.classList.contains('part')) gotPart.push(+el.dataset.i);
    });
    const same = (a, b) => {
      a = a.slice().sort((x, y) => x - y); b = b.slice().sort((x, y) => x - y);
      return a.length === b.length && a.every((v, i) => v === b[i]);
    };
    return {
      partN: expectedPart.length, fullN: expectedFull.length,
      gotPartN: gotPart.length, gotFullN: gotFull.length,
      partSame: same(expectedPart, gotPart),
      fullSame: same(expectedFull, gotFull),
      knownN: known.length,
    };
  });

  ok('末步仍给出范围', /^\d+% · \d+ 家$/.test(s2.pct), s2.pct);
  ok('范围估计随步推进而改变（不是静态图）', s1.sig !== s2.sig);
  /* 只断言"非空"。范围会随对手持续加注而收窄 —— 末步只剩十几类才是正确结果，
   * Assert only "non-empty". The range narrows as the opponent keeps raising — ending with only a dozen classes is the correct result,
     把阈值定成"格子足够多"会把正确的收窄误判成失败。
   * so setting a "enough cells" threshold would misjudge a correct narrowing as a failure. */
  ok('末步范围非空', s2.colored > 0 && parseFloat(s2.pct) > 0,
    s2.colored + ' 类 / ' + s2.pct);
  ok('存在被部分阻断的类别（几乎每手都有，保证断言非空洞）',
    blockedCheck.partN > 0, blockedCheck.partN + ' 类 / 已知 ' + blockedCheck.knownN + ' 张牌');
  ok('"部分阻断"标记与模型独立算出的集合完全一致',
    blockedCheck.partSame === true,
    '模型 ' + blockedCheck.partN + ' 类 / 界面 ' + blockedCheck.gotPartN + ' 类');
  ok('"完全阻断"标记也与模型一致（通常为 0，但必须一致）',
    blockedCheck.fullSame === true,
    '模型 ' + blockedCheck.fullN + ' 类 / 界面 ' + blockedCheck.gotFullN + ' 类');

  /* ---------- 4. EV 损失列表 ----------
   * ---------- 4. EV loss list ---------- */
  group('4. EV 损失列表');
  const ev = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#ev-list .ev-row'));
    const rec = window.__game.recents[PK.Replay.activeIdx];
    const expect = PK.EVLoss.review(rec).decisions.length;
    const badges = rows.map(r => r.querySelector('.ev-badge'));
    const validVerdicts = ['v-best', 'v-ok', 'v-inaccuracy', 'v-mistake', 'v-blunder'];
    let badgeBad = 0, scoreBad = 0;
    rows.forEach((r, i) => {
      const b = badges[i];
      if (!b || !validVerdicts.some(v => b.classList.contains(v))) badgeBad++;
      const sc = r.querySelector('.ev-score');
      if (!sc || !/^(0|−\d+\.\d)$/.test(sc.textContent)) scoreBad++;
    });
    return {
      n: rows.length, expect: expect, badgeBad: badgeBad, scoreBad: scoreBad,
      total: document.querySelector('#ev-total').textContent,
      why: document.querySelector('#ev-why').textContent,
      whyVisible: getComputedStyle(document.querySelector('#ev-why')).display !== 'none',
    };
  });
  ok('EV 行数 = 该手的决策点数', ev.n === ev.expect && ev.n > 0, ev.n + ' vs ' + ev.expect);
  ok('每行都有合法的分级徽章', ev.badgeBad === 0, ev.badgeBad + ' 处异常');
  ok('每行都有损失数值', ev.scoreBad === 0, ev.scoreBad + ' 处异常');
  ok('显示了该手总损失', /^共 [\d.]+ BB$/.test(ev.total), ev.total);
  ok('解说区可见且有内容', ev.whyVisible && ev.why.length > 20, ev.why.slice(0, 30) + '…');
  ok('解说里给出了底池赔率', /底池赔率/.test(ev.why));
  ok('解说里给出了所需胜率', /需要 \d+%/.test(ev.why));

  /* 点击 EV 行 → 跳转
   * Click an EV row → jump */
  group('5. 点击 EV 行跳转');
  const jump = await page.evaluate(async () => {
    const rows = Array.from(document.querySelectorAll('#ev-list .ev-row'));
    const before = document.querySelector('#rp-progress').textContent;
    rows[rows.length - 1].click();
    await new Promise(r => setTimeout(r, 120));
    const rows2 = Array.from(document.querySelectorAll('#ev-list .ev-row'));
    return {
      before: before,
      after: document.querySelector('#rp-progress').textContent,
      onIdx: rows2.findIndex(r => r.classList.contains('on')),
      lastIdx: rows2.length - 1,
    };
  });
  ok('跳转后进度变化', jump.before !== jump.after, jump.before + ' → ' + jump.after);
  ok('被点击的那一行高亮', jump.onIdx === jump.lastIdx,
    '高亮行 ' + jump.onIdx + ' / 目标 ' + jump.lastIdx);

  /* ---------- 6. 漏洞画像面板 ----------
   * ---------- 6. Leak profile panel ---------- */
  group('6. 漏洞画像面板');
  await page.evaluate(() => PK.UI.closeModal());
  await page.click('#btn-leaks');
  await page.waitForSelector('#modal-leaks.open', { timeout: 5000 });
  await page.waitForTimeout(600);          // 等异步的 EV 汇总填进来 / Wait for the async EV summary to fill in

  const leaks = await page.evaluate(() => {
    const body = document.querySelector('#leaks-body');
    return {
      cards: body.querySelectorAll('.metric-card').length,
      sub: document.querySelector('#leaks-sub').textContent,
      note: (body.querySelector('.leaks-note') || {}).textContent || '',
      hasEv: !!document.querySelector('#leaks-ev'),
      evText: (document.querySelector('#leaks-ev') || {}).textContent || '',
      hasBridge: !!document.querySelector('#leaks-bridge'),
      scroll: body.scrollWidth - body.clientWidth,
    };
  });
  ok('面板已渲染出指标卡片', leaks.cards >= 8, leaks.cards + ' 张');
  ok('副标题显示样本与置信度', /样本 \d+ 手/.test(leaks.sub), leaks.sub);
  ok('顶部给了 AI 的一句人话总结', leaks.note.length > 10, leaks.note.slice(0, 34) + '…');
  ok('存在 EV 汇总区块', leaks.hasEv);
  ok('EV 汇总已异步填入内容（每手平均损失）', /每手平均 EV 损失/.test(leaks.evText),
    leaks.evText.slice(0, 40));
  ok('EV 汇总给出了严重失误次数', /明显失误/.test(leaks.evText));
  ok('存在题库联动区块', leaks.hasBridge);
  ok('面板无横向溢出', leaks.scroll <= 1, '超出 ' + leaks.scroll + 'px');

  /* 面板里的"最贵决策"应当能跳回复盘。
   * The panel's "most expensive decision" should be able to jump back to the review.
     这条断言的前提是"确实存在被判定为失误的决策" —— 先把前提也验一遍，
   * This assertion presupposes that "a decision judged as a mistake really exists" — so verify the presupposition too,
     否则一旦 EV 模型变得过于宽松，这条测试会退化成永远通过。
   * otherwise, if the EV model becomes too lenient, this test degenerates into always passing. */
  const bigMistakes = await page.evaluate(() =>
    PK.EVLoss.audit(window.__game.recents, { iters: 200 }).bigMistakes);
  ok('EV 模型确实标出了失误（保证下一条断言非空洞）', bigMistakes > 0,
    bigMistakes + ' 次');

  const jumpFromLeaks = await page.evaluate(async () => {
    const row = document.querySelector('#leaks-body .ev-row[data-idx]');
    if (!row) return { skipped: true };
    row.click();
    await new Promise(r => setTimeout(r, 250));
    return {
      skipped: false,
      replayOpen: document.querySelector('#modal-replay').classList.contains('open'),
      leaksOpen: document.querySelector('#modal-leaks').classList.contains('open'),
      progress: document.querySelector('#rp-progress').textContent,
      heat: document.querySelector('#heat-pct').textContent,
    };
  });
  ok('存在可点击的最贵决策', jumpFromLeaks.skipped === false);
  ok('点击最贵决策跳到复盘弹窗', jumpFromLeaks.replayOpen === true);
  ok('跳转后漏洞面板已关闭', jumpFromLeaks.leaksOpen === false);
  ok('跳转后热力图也随之更新', jumpFromLeaks.heat !== '—', jumpFromLeaks.heat);

  /* ---------- 7. 窄屏降级 ----------
   * ---------- 7. Narrow-screen degradation ---------- */
  group('7. 窄屏（三列降级为上下排列）');
  await page.evaluate(() => PK.UI.closeModal());
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(200);
  await page.click('#btn-replay');
  await page.waitForTimeout(250);
  const narrow = await page.evaluate(() => {
    const side = document.querySelector('.replay-side');
    const stage = document.querySelector('.replay-stage');
    const body = document.querySelector('.modal-body');
    return {
      sideBelowStage: side.getBoundingClientRect().top >= stage.getBoundingClientRect().bottom - 2,
      modalOverflow: document.querySelector('#modal-replay').scrollWidth -
        document.querySelector('#modal-replay').clientWidth,
      heatCells: document.querySelectorAll('#heat-grid .heat-cell').length,
    };
  });
  ok('分析栏落到回放舞台下方', narrow.sideBelowStage === true);
  ok('窄屏下弹窗无横向溢出', narrow.modalOverflow <= 1, '超出 ' + narrow.modalOverflow + 'px');
  ok('窄屏下热力图仍完整', narrow.heatCells === 169, String(narrow.heatCells));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT, 'analysis.png') });

  /* ---------- 8. 题库联动（喂一份真实存档） ----------
   * ---------- 8. Drill-app integration (feed a realistic save) ---------- */
  group('8. 题库联动：读出另一个应用的进度');
  /* 前提：Chrome 下所有 file:// 页面共享同一个 localStorage 源。
   * Precondition: under Chrome all file:// pages share the same localStorage origin.
     这里从训练器页面写入题库的键，正好也在验证这个前提 —— 若源不共享，
   * Writing the drill-app key from the trainer page here also verifies that precondition — if the origin were not shared,
     题库里真实的数据同样读不到，这条断言会失败。
   * the real drill-app data would be unreadable too and this assertion would fail. */
  const seeded = await page.evaluate(() => {
    const now = new Date();
    const p = (x) => (x < 10 ? '0' + x : '' + x);
    const k = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());
    const data = {
      version: 1, createdAt: '2026-09-01T00:00:00.000Z',
      settings: { goalPerDay: 40, keypad: true, sessionSize: 10 },
      stages: { 1: { att: 34, ok: 27 }, 2: { att: 21, ok: 16 }, 3: { att: 6, ok: 4 }, 4: { att: 0, ok: 0 }, 5: { att: 0, ok: 0 } },
      forcedUnlock: false,
      topics: { s3_req: { att: 10, ok: 3 }, s3_decide: { att: 9, ok: 8, ms: 100 } },
      daily: (() => { const o = {}; o[k] = { att: 8, ok: 6 }; return o; })(),
      streak: { last: k, days: 5, best: 12 },
      history: [{ t: 1, stage: 3, topic: 's3_req', ok: 0, ms: 900 },
                { t: 2, stage: 3, topic: 's3_decide', ok: 1, ms: 700 }],
      mistakes: [{}],
    };
    localStorage.setItem('nlhe_trainer_v1', JSON.stringify(data));
    PK.Bridge.invalidate();
    return {
      readBack: !!PK.Bridge.progress({ fresh: true }),
      todaySeed: k,
      todayAtt: PK.Bridge.today().att,
      attempts: PK.Bridge.progress({ fresh: true }).attempts,
    };
  });
  ok('能从训练器页面读到题库的存档键', seeded.readBack === true,
    '跨页面同源 localStorage');
  ok('读出的今日题数与喂进去的一致', seeded.todayAtt === 8, String(seeded.todayAtt));
  ok('读出的累计题数取自阶段合计', seeded.attempts === 61, String(seeded.attempts));

  await page.evaluate(() => PK.UI.closeModal());
  await page.click('#btn-leaks');
  await page.waitForSelector('#modal-leaks.open', { timeout: 5000 });
  await page.waitForTimeout(500);

  const br = await page.evaluate(() => {
    const block = document.querySelector('#leaks-bridge');
    const txt = block.textContent;
    const readPlan = () => ({
      heads: Array.from(block.querySelectorAll('.leak-section h4')).map(e => e.textContent),
      items: block.querySelectorAll('.leak-item').length,
      reasons: Array.from(block.querySelectorAll('.lk-text'))
        .map(e => e.textContent).filter(t => t.indexOf('→ 因为') === 0),
      weakMarked: /⚠ 偏弱/.test(block.textContent),
    });
    return {
      txt: txt,
      openBtn: !!block.querySelector('#leaks-open-drill'),
      todayShown: /8 \/ 40/.test(txt),
      streakShown: /5 天/.test(txt),
      bestShown: /最长 12 天/.test(txt),
      totalShown: /共 61 题/.test(txt),
      scroll: block.scrollWidth - block.clientWidth,
      empty: /还没用过心算题库/.test(txt),
      noLeaksYet: PK.Profile.leaks().length === 0,
      plan: readPlan(),
    };
  });
  ok('联动区块渲染出了题库数据（不是"还没用过题库"的提示）',
    br.empty === false && br.txt.indexOf('61') >= 0);
  ok('今日进度显示为 8 / 40（读的是题库目标，不是默认 30）', br.todayShown,
    br.txt.slice(0, 60));
  ok('连续打卡显示 5 天', br.streakShown);
  ok('显示了历史最长 12 天', br.bestShown);
  ok('累计题数显示 61 题（阶段合计口径）', br.totalShown);
  ok('这个阶段的牌局确实还没攒够样本（保证下面的兜底路径可检验）',
    br.noLeaksYet === true, '画像样本 ' + '8 手 < 20');
  /* 兜底：还没诊断出漏洞时，改推题库自己的弱项，而不是给一句空话
   * Fallback: when no leak has been diagnosed yet, recommend the drill app's own weak spots instead of an empty phrase */
  ok('没诊断出漏洞时，用题库弱项兜底（清单非空）', br.plan.items >= 1,
    br.plan.items + ' 项');
  ok('兜底理由写明是"题库里正确率偏低"',
    br.plan.reasons.some(r => r.indexOf('题库里正确率偏低') >= 0),
    br.plan.reasons[0] || '（无）');
  ok('正确率偏低的题被标为⚠偏弱（30% 的那道）', br.plan.weakMarked === true);
  ok('存在「打开心算题库」按钮', br.openBtn === true);
  ok('联动区块无横向溢出', br.scroll <= 1, '超出 ' + br.scroll + 'px');

  /* ---------- 8b. 有漏洞时改用"漏洞 → 题目"的映射 ----------
   * ---------- 8b. When leaks exist, switch to the "leak → topic" mapping ---------- */
  group('8b. 有漏洞时改推漏洞对应的题目');
  const br2 = await page.evaluate(() => {
    /* 直接构造画像统计：翻后面对下注 62 次弃 49 次（79%），远超基准 45%，
     * Directly construct profile stats: postflop facing a bet, fold 49 of 62 (79%), far above the 45% baseline,
       z 值远大于 2 —— 这在真实牌局里就是"见注就跑"的经典漏洞。
     * with a z value far greater than 2 — in real play this is the classic "flee at the first bet" leak. */
    const st = PK.Profile.emptyStats();
    st.hands = 60; st.vpip = 20; st.pfr = 8;
    st.faced = { flop: { opp: 30, fold: 24 }, turn: { opp: 20, fold: 16 }, river: { opp: 12, fold: 9 } };
    PK.Profile.stats = st;
    const ids = PK.Profile.leaks().map(l => l.id);
    PK.Leaks.render();
    const block = document.querySelector('#leaks-bridge');
    const txt = block.textContent;
    return {
      ids: ids,
      heads: Array.from(block.querySelectorAll('.leak-section h4')).map(e => e.textContent),
      items: Array.from(block.querySelectorAll('.leak-item')).map(e => ({
        title: (e.querySelector('.lk-title') || {}).textContent || '',
        text: (e.querySelector('.lk-text') || {}).textContent || '',
      })),
      reasons: Array.from(block.querySelectorAll('.lk-text'))
        .map(e => e.textContent).filter(t => t.indexOf('→ 因为') === 0),
      txt: txt,
    };
  });
  /* 前提：这个统计确实应该被判定为漏洞
   * Precondition: these stats really should be judged as a leak */
  ok('构造的统计被识别出 foldTooMuch 漏洞', br2.ids.indexOf('foldTooMuch') >= 0,
    br2.ids.join(',') || '（无）');
  ok('标题改为"按你的漏洞，建议练这几项"',
    br2.heads.some(h => h.indexOf('按你的漏洞，建议练这几项') >= 0), br2.heads.join(' | '));
  ok('理由改为漏洞的人话（不再是题库口径）',
    br2.reasons.some(r => r.indexOf('面对下注弃牌过多') >= 0), br2.reasons.join(' | '));
  const titles = br2.items.map(x => x.title).join(' | ');
  ok('推出的正是 foldTooMuch 映射的题目（s3_req / s3_decide）',
    titles.indexOf('所需最低胜率') >= 0 && titles.indexOf('跟注/弃牌判断') >= 0, titles);
  ok('每项都带阶段与公式', br2.items.length > 0 &&
    br2.items.every(x => /第 \d 阶段 · /.test(x.title) && x.text.length > 0),
    br2.items.length + ' 项');

  /* ---------- 9. 运行期报错 ----------
   * ---------- 9. Runtime errors ---------- */
  group('9. 运行期报错');
  ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' / '));

  await browser.close();

  console.log('\n════════════════════════════════');
  console.log('界面验收：' + pass + ' 项通过，' + fail + ' 项失败');
  if (fail) {
    console.log('\n失败明细：');
    for (const b of bad) console.log('  ✗ ' + b);
    process.exit(1);
  }
  console.log('✅ 全部通过');
})().catch(e => { console.error('运行失败：', e); process.exit(1); });
