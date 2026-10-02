/* ============================================================
 * shot-coach-fold.js — 教练面板"折叠 / 展开"对照截图
 * shot-coach-fold.js — comparative screenshots of the coach panel "collapsed / expanded"
 *   node test/shot-coach-fold.js
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const FILE = 'file:///' + path.join(__dirname, '..', 'poker-trainer.html').replace(/\\/g, '/');
const SHOT = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT, { recursive: true });
const CHROME = [
  'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

(async function () {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.__game;
    g.cfg.aiSpeed = 0;
    g._delay = () => Promise.resolve();
  });

  let found = false;
  for (let i = 0; i < 80 && !found; i++) {
    await page.evaluate(() => {
      const g = window.__game;
      if (g.stage === 'over' || g.stage === 'idle') g.newHand();
    });
    await page.waitForFunction(() => {
      const g = window.__game;
      return g.canHeroAct() || g.stage === 'over';
    }, null, { timeout: 3000 }).catch(() => {});
    const st = await page.evaluate(() => {
      const g = window.__game;
      return { a: g.canHeroAct(), b: g.board.length, t: Math.max(0, g.currentBet - g.players[0].bet) };
    });
    if (st.a && st.b >= 3 && st.t > 0) { found = true; break; }
    if (st.a) {
      await page.evaluate(() => {
        const g = window.__game;
        const t = Math.max(0, g.currentBet - g.players[0].bet);
        g.heroAct(t > 0 ? 'call' : 'check');
      });
      await page.waitForTimeout(60);
    }
  }
  console.log('翻后面对下注的场景：' + found);

  const panel = await page.$('#panel-coach');
  await panel.screenshot({ path: path.join(SHOT, '30-教练面板-默认折叠.png') });

  await page.click('#coach-toggle');
  await page.waitForSelector('#advice-slot .advice', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  await panel.screenshot({ path: path.join(SHOT, '31-教练面板-展开.png') });
  await page.screenshot({ path: path.join(SHOT, '32-整页-展开.png') });

  await page.click('#coach-toggle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, '33-整页-折叠.png') });

  console.log('已输出到 ' + SHOT);
  await browser.close();
})();
