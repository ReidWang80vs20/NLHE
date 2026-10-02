/* ============================================================
 * shot-panels.js — 多分辨率下截取复盘 / 训练面板，并检查弹窗是否溢出
 * shot-panels.js — capture the replay / drill panels at multiple resolutions and check whether the modals overflow
 *   用法：node test/shot-panels.js [index.html]
 *   Usage: node test/shot-panels.js [index.html]
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const TARGET_HTML = process.argv[2] || 'index.html';
const FILE = 'file:///' + path.join(__dirname, '..', TARGET_HTML).replace(/\\/g, '/');

/* 浏览器自动探测：NLHE_CHROME → playwright 自报 → 缓存扫描 → 标准安装 → PATH
   Browser auto-detection: NLHE_CHROME → playwright-reported → cache scan → standard install → PATH */
const CHROME = require('../tools/find-browser.cjs').findBrowserExe();

const SHOT = path.join(__dirname, 'shots', 'panels');
fs.mkdirSync(SHOT, { recursive: true });

const VIEWPORTS = [
  { w: 1080, h: 660, tag: '1080x660' },
  { w: 1366, h: 728, tag: '1366x728' },
  { w: 1920, h: 1040, tag: '1920x1040' },
];

let fail = 0;

(async function () {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    /* 快速打几手，让复盘有内容 */
    /* Play a few hands quickly so the replay has content */
    await page.evaluate(() => {
      const g = window.__game;
      g.cfg.aiSpeed = 20;
      window.__tick = setInterval(() => {
        if (!g.canHeroAct()) return;
        const toCall = Math.max(0, g.currentBet - g.players[0].bet);
        if (toCall <= g.cfg.bb * 2) g.heroAct(toCall > 0 ? 'call' : 'check');
        else g.heroAct('fold');
      }, 40);
    });
    await page.waitForFunction(() => window.__game.stage === 'over', { timeout: 20000 });
    for (let i = 1; i < 4; i++) {
      await page.click('#btn-new');
      await page.waitForFunction(() => window.__game.stage === 'over', { timeout: 20000 });
    }

    /* ---- 复盘面板 ---- */
    /* ---- Replay panel ---- */
    await page.click('#btn-replay');
    await page.waitForTimeout(300);
    const rp = await page.evaluate(() => {
      const m = document.querySelector('#modal-replay');
      const b = m.getBoundingClientRect();
      const wrap = document.querySelector('.replay-wrap');
      const stage = document.querySelector('#replay-stage');
      return {
        w: +b.width.toFixed(1), h: +b.height.toFixed(1),
        left: +b.left.toFixed(1), top: +b.top.toFixed(1),
        overX: +(b.right - window.innerWidth).toFixed(1),
        overY: +(b.bottom - window.innerHeight).toFixed(1),
        stageOverflow: stage.scrollHeight > stage.clientHeight,
        listScroll: document.querySelector('#replay-list').scrollHeight > document.querySelector('#replay-list').clientHeight,
        wrapH: +wrap.getBoundingClientRect().height.toFixed(1),
      };
    });
    const rpOk = rp.overX <= 0 && rp.overY <= 0 && rp.left >= 0 && rp.top >= 0;
    if (!rpOk) fail++;
    console.log((rpOk ? '✓' : '✗') + ' ' + vp.tag.padEnd(11) + ' 复盘弹窗 ' +
      rp.w + '×' + rp.h + ' @(' + rp.left + ',' + rp.top + ')  超出视口 ' + rp.overX + '/' + rp.overY +
      '  舞台内容可滚动=' + rp.stageOverflow);
    await page.screenshot({ path: path.join(SHOT, vp.tag + '-复盘.png') });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* ---- 训练面板 ---- */
    /* ---- Drill panel ---- */
    await page.click('#btn-drill');
    await page.waitForTimeout(300);
    const dr = await page.evaluate(() => {
      const m = document.querySelector('#modal-drill');
      const b = m.getBoundingClientRect();
      const st = document.querySelector('#drill-stage');
      return {
        w: +b.width.toFixed(1), h: +b.height.toFixed(1),
        left: +b.left.toFixed(1), top: +b.top.toFixed(1),
        overX: +(b.right - window.innerWidth).toFixed(1),
        overY: +(b.bottom - window.innerHeight).toFixed(1),
        stageScroll: st.scrollHeight > st.clientHeight,
        opts: document.querySelectorAll('.drill-opt').length,
      };
    });
    const drOk = dr.overX <= 0 && dr.overY <= 0 && dr.left >= 0 && dr.top >= 0 && dr.opts >= 2;
    if (!drOk) fail++;
    console.log((drOk ? '✓' : '✗') + ' ' + vp.tag.padEnd(11) + ' 训练弹窗 ' +
      dr.w + '×' + dr.h + ' @(' + dr.left + ',' + dr.top + ')  超出视口 ' + dr.overX + '/' + dr.overY +
      '  选项 ' + dr.opts + ' 个  可滚动=' + dr.stageScroll);

    /* 答题后的样子 */
    /* Appearance after answering */
    await page.click('.drill-opt:nth-child(1)');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOT, vp.tag + '-训练.png') });

    /* 检查选项按钮是否换行挤压 */
    /* Check whether the option buttons wrap and get squeezed */
    const optBox = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.drill-opt')];
      const tops = els.map(e => Math.round(e.getBoundingClientRect().top));
      return { rows: new Set(tops).size, minW: Math.min.apply(null, els.map(e => Math.round(e.getBoundingClientRect().width))) };
    });
    console.log('            ' + '选项排布：' + optBox.rows + ' 行，最窄 ' + optBox.minW + 'px');

    if (errs.length) { fail++; console.log('   ✗ JS 报错：' + errs.slice(0, 2).join(' | ')); }

    await page.close();
  }

  console.log('\n════ ' + (fail ? '❌ ' + fail + ' 项问题' : '✅ 全部通过') + ' ════');
  console.log('截图：' + SHOT);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
