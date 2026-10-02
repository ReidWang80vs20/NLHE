/* ============================================================
 * smoke.js — 浏览器冒烟测试（Playwright）
 * smoke.js — browser smoke test (Playwright)
 *   1. 加载单文件 poker-trainer.html
 *   1. Load the single-file poker-trainer.html
 *   2. 捕获所有 JS 报错与 console 错误
 *   2. Capture all JS errors and console errors
 *   3. 让真人座位交给 AI 托管，自动跑若干手
 *   3. Hand the human seat over to AI autopilot and automatically play several hands
 *   4. 截图 + 输出关键状态
 *   4. Screenshot + output key state
 *   node test/smoke.js
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

/* 默认测打包产物；传入文件名参数可改测多文件版本（如 index.html） */
/* Tests the bundled artifact by default; pass a filename argument to test the multi-file version instead (e.g. index.html) */
const TARGET_HTML = process.argv[2] || 'poker-trainer.html';
const FILE = 'file:///' + path.join(__dirname, '..', TARGET_HTML).replace(/\\/g, '/');
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

/* 本机只装了这个版本的 chromium，直接指定可执行文件，避免版本探测失败 */
/* Only this version of chromium is installed locally, so point directly at the executable to avoid version-probing failures */
const CHROME_CANDIDATES = [
  'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const CHROME = CHROME_CANDIDATES.find(p => fs.existsSync(p));

const HANDS = 25;

(async function () {
  if (!CHROME) {
    console.error('❌ 未找到可用的浏览器可执行文件');
    process.exit(1);
  }
  console.log('浏览器：' + CHROME);
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors = [];
  const warnings = [];
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('[console.error] ' + m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });

  console.log('加载：' + FILE);
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  /* 首屏截图 */
  /* First-screen screenshot */
  await page.screenshot({ path: path.join(SHOT_DIR, '01-初始界面.png') });

  /* 基本结构检查 */
  /* Basic structure check */
  const struct = await page.evaluate(() => {
    const g = window.__game;
    const count = s => document.querySelectorAll(s).length;
    return {
      hasGame: !!g,
      seats: g ? g.players.length : 0,
      players: g ? g.players.map(p => p.name + '(' + (p.style ? p.style.name : '你') + ')') : [],
      stage: g ? g.stage : null,
      street: g ? g.street : null,
      felt: count('.felt'),
      seatNodes: count('.seat'),
      cards: count('.card'),
      actionBar: document.querySelector('#action-bar') ? document.querySelector('#action-bar').children.length : -1,
      panels: count('.panel'),
      modal: count('.modal'),
    };
  });
  console.log('结构检查：' + JSON.stringify(struct, null, 2));

  /* 加速：AI 零延迟 + 真人座位托管给 AI */
  /* Speed-up: zero AI delay + hand the human seat over to AI autopilot */
  await page.evaluate(() => {
    const g = window.__game;
    g.cfg.aiSpeed = 0;
    g._delay = () => Promise.resolve();
    window.__handEnds = 0;
    g.on('hand-end', () => { window.__handEnds++; });
    g.on('hero-turn', () => {
      const d = window.PK.aiDecide(g, 0);
      setTimeout(() => g.heroAct(d.action, d.amount), 0);
    });
  });

  /* 自动跑若干手 */
  /* Automatically play several hands */
  const t0 = Date.now();
  for (let i = 0; i < HANDS; i++) {
    await page.evaluate(() => { window.__game.newHand(); });
    /* 等这一手结束（或超时 4 秒） */
    /* Wait for this hand to end (or time out after 4 seconds) */
    await page.waitForFunction(
      () => window.__game.stage === 'over' || window.__game.stage === 'idle',
      null, { timeout: 4000 }
    ).catch(() => {});
    await page.waitForTimeout(20);
  }
  const elapsed = Date.now() - t0;

  const after = await page.evaluate(() => {
    const g = window.__game;
    return {
      handNo: g.handNo,
      handEnds: window.__handEnds,
      stage: g.stage,
      stacksSum: g.players.reduce((a, p) => a + p.stack, 0),
      anyNegative: g.players.some(p => p.stack < 0),
      stats: {
        hands: g.stats.hands, vpip: g.stats.vpip, pfr: g.stats.pfr,
        showdowns: g.stats.showdowns, netProfit: g.stats.netProfit,
      },
      logLines: g.log.length,
      lastLogs: g.log.slice(-6).map(l => l.text),
    };
  });
  console.log('\n自动对局 ' + HANDS + ' 手完成，用时 ' + elapsed + 'ms');
  console.log(JSON.stringify(after, null, 2));

  await page.screenshot({ path: path.join(SHOT_DIR, '02-对局进行中.png') });

  /* 测试交互：设置弹窗、帮助弹窗、透视开关、键盘快捷键 */
  /* Test interactions: settings modal, help modal, peek toggle, keyboard shortcuts */
  await page.click('#btn-help');
  await page.waitForTimeout(200);
  const helpOpen = await page.evaluate(() => document.querySelector('#modal-mask').classList.contains('open'));
  await page.screenshot({ path: path.join(SHOT_DIR, '03-帮助弹窗.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const helpClosed = await page.evaluate(() => !document.querySelector('#modal-mask').classList.contains('open'));

  await page.click('#btn-settings');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, '04-设置弹窗.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  /* 透视：先让一手牌进行到翻牌后 */
  /* Peek: first let a hand advance to post-flop */
  await page.evaluate(() => { window.__game.newHand(); });
  await page.waitForTimeout(600);
  await page.check('#chk-peek');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOT_DIR, '05-透视模式.png') });
  const peekCards = await page.evaluate(() => document.querySelectorAll('.card.back').length);

  /* 检查是否有元素溢出视口（横向滚动条） */
  /* Check whether any element overflows the viewport (horizontal scrollbar) */
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
  }));

  console.log('\n弹窗：帮助 ' + (helpOpen ? '✅打开' : '❌未打开') + ' / ' +
    (helpClosed ? '✅Esc关闭' : '❌Esc未关闭'));
  console.log('透视：关闭后仍可见的背面牌 = ' + peekCards + '（透视开启时电脑底牌应可见）');
  console.log('溢出检查：scrollW ' + overflow.scrollW + ' vs clientW ' + overflow.clientW +
    (overflow.scrollW <= overflow.clientW + 2 ? ' ✅ 无横向溢出' : ' ⚠️ 存在横向溢出'));

  console.log('\n══════ 结果 ══════');
  if (errors.length) {
    console.log('❌ JS 报错 ' + errors.length + ' 条：');
    errors.slice(0, 25).forEach(e => console.log('   ' + e));
  } else {
    console.log('✅ 无 JS 报错');
  }
  if (warnings.length) {
    console.log('ℹ️ console 警告 ' + warnings.length + ' 条（前 5）：');
    warnings.slice(0, 5).forEach(w => console.log('   ' + w));
  }
  console.log('截图目录：' + SHOT_DIR);

  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
