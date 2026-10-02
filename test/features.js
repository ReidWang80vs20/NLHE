/* ============================================================
 * features.js — 新功能验收（复盘 / 持久化 / 情境训练）
 * features.js — new-feature acceptance test (replay / persistence / situational drill)
 *   在真实浏览器里跑完整链路：打牌 → 复盘回放 → 做题 → 刷新恢复 → 清零
 *   Runs the full chain in a real browser: play → replay review → drill → restore on refresh → reset
 *   用法：node test/features.js [poker-trainer.html]
 *   Usage: node test/features.js [poker-trainer.html]
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

const HANDS = 6;
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}

const SHOT = path.join(__dirname, 'shots', 'features');
fs.mkdirSync(SHOT, { recursive: true });

(async function () {
  if (!CHROME) { console.error('未找到可用浏览器'); process.exit(1); }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 880 } });
  const page = await ctx.newPage();

  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  /* ---------- 0. 存储可用性 ---------- */
  /* ---------- 0. Storage availability ---------- */
  console.log('【0】存储可用性');
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const storeOk = await page.evaluate(() => !!(window.PK && PK.Store && PK.Store.isAvailable()));
  ok('localStorage 可读写', storeOk === true, storeOk ? '' : '（file:// 下被禁用，持久化会降级为内存）');

  /* 清空历史，从干净状态开始 */
  /* Clear history and start from a clean state */
  await page.evaluate(() => {
    try { localStorage.removeItem('nlhe-trainer-v1'); } catch (e) { /* ignore */ }
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);

  /* ---------- 1. 快速打完若干手 ---------- */
  /* ---------- 1. Quickly play through a number of hands ---------- */
  console.log('\n【1】自动打 ' + HANDS + ' 手');
  await page.evaluate(() => {
    const g = window.__game;
    g.cfg.aiSpeed = 25;                     // 测试时让电脑快速行动 / fast AI during the test
    /* 用轮询而不是只监听 hero-turn：页面加载 200ms 后就已经自动开了一手，
       Poll instead of only listening for hero-turn: a hand is already auto-started 200ms after page load, and
       如果此刻正好轮到真人，事件早发过了，纯监听会永远等不到。
       if it is exactly the human's turn at that moment the event has already fired, so pure listening would wait forever. */
    window.__tick = setInterval(() => {
      if (!g.canHeroAct()) return;
      const toCall = Math.max(0, g.currentBet - g.players[0].bet);
      if (toCall <= g.cfg.bb * 2) g.heroAct(toCall > 0 ? 'call' : 'check');
      else g.heroAct('fold');
    }, 50);
  });

  const t0 = Date.now();
  await page.waitForFunction(() => window.__game.stage === 'over', { timeout: 30000 });
  for (let i = 1; i < HANDS; i++) {
    await page.click('#btn-new');
    await page.waitForFunction(() => window.__game.stage === 'over', { timeout: 30000 });
  }
  console.log('   用时 ' + (Date.now() - t0) + 'ms');

  const rec = await page.evaluate(() => {
    const g = window.__game;
    return {
      n: g.recents.length,
      hands: g.stats.hands,
      noAction: g.recents.filter(r => !r.actions || !r.actions.length).length,
      noResult: g.recents.filter(r => !r.result).length,
      badHole: g.recents.filter(r => !r.heroHole || r.heroHole.length !== 2).length,
      streets: g.recents.map(r => Array.from(new Set(r.actions.map(a => a.street))).join('/')),
    };
  });
  ok('复盘记录已生成', rec.n === HANDS, rec.n + ' / ' + HANDS + ' 手');
  ok('每手都有行动序列', rec.noAction === 0, rec.noAction + ' 手为空');
  ok('每手都有结果', rec.noResult === 0, rec.noResult + ' 手无结果');
  ok('每手都记录了你的底牌', rec.badHole === 0);
  ok('已玩手数 = 实际打完的手数', rec.hands === HANDS, rec.hands + ' / ' + HANDS);
  console.log('   各手经历的街：' + rec.streets.join(' | '));

  /* ---------- 2. 复盘回放 ---------- */
  /* ---------- 2. Replay review ---------- */
  console.log('\n【2】手牌复盘');
  await page.click('#btn-replay');
  await page.waitForTimeout(250);
  ok('复盘弹窗打开', await page.isVisible('#modal-replay'));

  const items = await page.$$eval('#replay-list .rp-item', els => els.length);
  ok('左侧列出全部手牌', items === HANDS, items + ' 项');

  await page.click('#replay-list .rp-item:first-child');
  await page.waitForTimeout(200);
  const head = await page.$eval('#replay-stage .rp-head', el => el.textContent.trim());
  ok('舞台渲染出手牌信息', head.length > 5, head.replace(/\s+/g, ' ').trim());

  const p0 = await page.$eval('#rp-progress', el => el.textContent.trim());
  await page.click('#rp-next');
  await page.waitForTimeout(120);
  const p1 = await page.$eval('#rp-progress', el => el.textContent.trim());
  await page.click('#rp-next');
  await page.waitForTimeout(120);
  const p2 = await page.$eval('#rp-progress', el => el.textContent.trim());
  ok('步进推进进度', p0 !== p1 && p1 !== p2, p0 + ' → ' + p1 + ' → ' + p2);

  await page.click('#rp-last');
  await page.waitForTimeout(400);
  const rpState = await page.evaluate(() => ({
    acts: document.querySelectorAll('#replay-stage .rp-act').length,
    eq: document.querySelectorAll('#replay-stage .rp-eq').length,
    result: !!document.querySelector('#replay-stage .rp-result'),
    eqText: (document.querySelector('#replay-stage .rp-eq') || {}).textContent || '',
  }));
  ok('重放出全部行动', rpState.acts > 0, rpState.acts + ' 条');
  ok('显示了每次行动时的胜率', rpState.eq > 0, rpState.eq + ' 处，例：' + rpState.eqText);
  ok('末尾显示本手结果', rpState.result === true);

  await page.evaluate(() => { document.querySelector('#replay-stage').scrollTop = 0; });
  await page.screenshot({ path: path.join(SHOT, '01-复盘回放.png') });

  /* 播放功能 */
  /* Playback feature */
  await page.click('#rp-first');
  await page.waitForTimeout(100);
  await page.click('#rp-play');
  await page.waitForTimeout(900);
  const playing = await page.$eval('#rp-progress', el => el.textContent.trim());
  await page.click('#rp-play');   // 暂停 / pause
  await page.waitForTimeout(150);
  const afterPause = await page.$eval('#rp-progress', el => el.textContent.trim());
  await page.waitForTimeout(900);
  const afterPause2 = await page.$eval('#rp-progress', el => el.textContent.trim());
  ok('播放能自动推进', playing !== '0 / 0', playing);
  ok('暂停能停住', afterPause === afterPause2, afterPause + ' 保持 ' + afterPause2);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Esc 关闭复盘', !(await page.isVisible('#modal-replay')));

  /* ---------- 3. 情境训练 ---------- */
  /* ---------- 3. Situational drill ---------- */
  console.log('\n【3】情境训练');
  await page.click('#btn-drill');
  await page.waitForTimeout(300);
  ok('训练弹窗打开', await page.isVisible('#modal-drill'));

  const drill0 = await page.evaluate(() => ({
    opts: document.querySelectorAll('.drill-opt').length,
    /* 本题**应该**有几个选项 —— 直接从题库数据取，不要写死。
       How many options this question **should** have — read directly from the question-bank data, do not hard-code it.
       题库里 river-bluffcatch（河牌面对超池全下）只有「弃牌/跟注」2 个选项，
       In the bank, river-bluffcatch (river facing an overbet shove) has only 2 options, "fold/call",
       而题目顺序是随机洗牌的，所以"首题恰好 >=3 个"是 12/13 的概率命题：
       and the question order is randomly shuffled, so "the first question happens to have >=3" is a 12/13 probability claim:
       写成 >=3 会以约 7.7% 的概率假失败（实测 5 次挂 1 次），
       hard-coding >=3 would falsely fail about 7.7% of the time (observed 1 failure in 5 runs),
       把"渲染失败"这个真问题淹没在噪声里。改成与数据比对后，
       drowning the real problem of "render failure" in noise. After switching to comparing against the data,
       判别力反而更强（漏渲染 / 多渲染都会被抓到），且不再随洗牌抖动。
       the discriminating power is actually stronger (both under-render and over-render are caught), and it no longer jitters with the shuffle. */
    expect: (function () {
      const st = PK.Drill.state;
      const s = PK.Drill.SCENARIOS[st.order[st.pos % st.order.length]];
      return s ? s.options.length : -1;
    })(),
    q: (document.querySelector('.drill-q') || {}).textContent || '',
    title: (document.querySelector('#drill-stage .rp-head b') || {}).textContent || '',
    stat: (document.querySelector('#drill-stats') || {}).textContent || '',
  }));
  ok('渲染出选项按钮', drill0.opts === drill0.expect && drill0.opts >= 2,
    drill0.opts + ' 个（本题应有 ' + drill0.expect + ' 个）');
  ok('显示题目与场景', drill0.q.length > 5, drill0.title);
  console.log('   题目：' + drill0.q.replace(/\s+/g, ' ').trim().slice(0, 60));
  console.log('   统计：' + drill0.stat.replace(/\s+/g, ' ').trim());

  await page.click('.drill-opt:nth-child(1)');
  await page.waitForTimeout(250);
  const fb = await page.evaluate(() => {
    const el = document.querySelector('.drill-fb');
    return { cls: el ? el.className : '', text: el ? el.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  ok('选择后给出评价', /drill-fb\s+(best|ok|bad)/.test(fb.cls), fb.cls + ' → ' + fb.text.slice(0, 46));
  const pts = await page.$$eval('.drill-points li', els => els.length);
  ok('给出本题要点', pts >= 2, pts + ' 条');

  const stat1 = await page.$eval('#drill-stats', el => el.textContent.replace(/\s+/g, ' ').trim());
  ok('训练统计已累加', stat1 !== drill0.stat.replace(/\s+/g, ' ').trim(),
    drill0.stat.replace(/\s+/g, ' ').trim() + '  →  ' + stat1);

  await page.screenshot({ path: path.join(SHOT, '02-情境训练.png') });

  await page.click('#drill-next');
  await page.waitForTimeout(250);
  const reset = await page.$eval('#drill-stage', el => !!el.querySelector('.drill-fb.hint'));
  ok('下一题清空评价', reset === true);

  /* 分类筛选 */
  /* Category filter */
  await page.click('#drill-filter button[data-f="翻牌前"]');
  await page.waitForTimeout(250);
  const preTitle = await page.$eval('#drill-stage .rp-head b', el => el.textContent);
  const preStat = await page.$eval('#drill-stats', el => el.textContent);
  ok('分类筛选生效', /翻牌前|开池|防守|小盲|枪口/.test(preTitle), preTitle + '（' + preStat.replace(/\s+/g, ' ').trim() + '）');

  /* 数字键路由：题库里 river-bluffcatch（河牌面对超池全下）只有 2 个选项，
     Number-key routing: river-bluffcatch in the bank (river facing an overbet shove) has only 2 options,
     按 3 取不到 options[2]。曾经未判空 → 抛 TypeError
     so pressing 3 cannot reach options[2]. Previously there was no null check → a TypeError was thrown
     （"Cannot read properties of undefined (reading 'key')"）。
     ("Cannot read properties of undefined (reading 'key')").
     这条断言同时钉住两件事：不报错、也不误选。
     This assertion pins down two things at once: no error is thrown, and no wrong option is selected. */
  const twoOpt = await page.evaluate(() => {
    const S = PK.Drill.SCENARIOS;
    const i = S.findIndex(s => s.options.length < 3);
    const st = PK.Drill.state;
    st.filter = '全部'; st.order = [i]; st.pos = 0; st.chosen = null;
    PK.Drill.open();
    return { i: i, id: S[i].id, opts: S[i].options.length,
             rendered: document.querySelectorAll('.drill-opt').length };
  });
  const errsBeforeKey = errs.length;
  const attemptsBeforeKey = await page.evaluate(() => PK.Drill.state.attempts);
  await page.keyboard.press('3');
  await page.waitForTimeout(250);
  const keyAfter = await page.evaluate(() => ({
    chosen: PK.Drill.state.chosen ? PK.Drill.state.chosen.key : null,
    attempts: PK.Drill.state.attempts,
  }));
  ok('选项不足 3 个时按 3 不报错也不误选',
    twoOpt.i >= 0 && twoOpt.rendered === twoOpt.opts &&
    errs.length === errsBeforeKey && keyAfter.attempts === attemptsBeforeKey &&
    keyAfter.chosen === null,
    twoOpt.id + '（' + twoOpt.opts + ' 个选项）→ chosen=' + keyAfter.chosen +
    (errs.length > errsBeforeKey ? '，报错：' + String(errs[errs.length - 1]).slice(0, 70) : ''));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* ---------- 4. 刷新后战绩恢复 ---------- */
  /* ---------- 4. Restore stats after refresh ---------- */
  console.log('\n【4】持久化：刷新页面');
  await page.waitForTimeout(500);   // 等防抖写盘 / wait for the debounced disk write
  const before = await page.evaluate(() => ({
    hands: window.__game.stats.hands,
    recents: window.__game.recents.length,
    net: window.__game.stats.netProfit,
    vpip: window.__game.stats.vpip,
    drill: PK.Drill.stats(),
    raw: (function () { try { return (localStorage.getItem('nlhe-trainer-v1') || '').length; } catch (e) { return -1; } })(),
  }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    hands: window.__game.stats.hands,
    recents: window.__game.recents.length,
    net: window.__game.stats.netProfit,
    vpip: window.__game.stats.vpip,
    drill: PK.Drill.stats(),
  }));

  ok('存档已写入本地', before.raw > 50, before.raw + ' 字节');
  ok('手数已恢复', after.hands === before.hands, before.hands + ' → ' + after.hands);
  ok('复盘记录已恢复', after.recents === before.recents, before.recents + ' → ' + after.recents);
  ok('累计盈亏已恢复', after.net === before.net, before.net + ' → ' + after.net);
  ok('VPIP 计数已恢复', after.vpip === before.vpip, before.vpip + ' → ' + after.vpip);
  ok('训练进度已恢复', after.drill.attempts === before.drill.attempts,
    before.drill.attempts + ' → ' + after.drill.attempts);

  /* 刷新后不应因为"开局即算一手"而虚增手数 */
  /* After refresh, the hand count must not be inflated by "counting a hand the moment it starts" */
  ok('刷新未虚增手数', after.hands === before.hands, '（这条专门防开局重复计数）');

  /* 复盘记录在刷新后仍可打开 */
  /* Replay records can still be opened after refresh */
  await page.click('#btn-replay');
  await page.waitForTimeout(250);
  const items2 = await page.$$eval('#replay-list .rp-item', els => els.length);
  ok('刷新后仍能复盘', items2 === after.recents, items2 + ' 项');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* ---------- 5. 清零 ---------- */
  /* ---------- 5. Reset ---------- */
  console.log('\n【5】清零');
  await page.click('#btn-reset-stats');
  await page.waitForTimeout(500);
  const cleared = await page.evaluate(() => ({
    hands: window.__game.stats.hands,
    recents: window.__game.recents.length,
    net: window.__game.stats.netProfit,
  }));
  ok('清零后手数为 0', cleared.hands === 0, String(cleared.hands));
  ok('清零后复盘记录为空', cleared.recents === 0, String(cleared.recents));
  ok('清零后盈亏归零', cleared.net === 0, String(cleared.net));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(900);
  const afterClear = await page.evaluate(() => window.__game.stats.hands);
  ok('清空后刷新不再复活', afterClear === 0, String(afterClear));

  /* ---------- 6. 报错检查 ---------- */
  /* ---------- 6. Error check ---------- */
  console.log('\n【6】运行期报错');
  ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\n════ ' + (fail ? '❌ ' + fail + ' 项失败 / ' : '✅ ') + pass + ' 项通过 ════');
  console.log('截图：' + SHOT);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
