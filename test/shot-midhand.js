/* ============================================================
 * shot-midhand.js — 截取"轮到你行动"的中局画面（用于目视验收）
 * shot-midhand.js — capture a mid-hand frame at "your turn to act" (for visual acceptance)
 *   node test/shot-midhand.js
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const FILE = 'file:///' + path.join(__dirname, '..', 'poker-trainer.html').replace(/\\/g, '/');
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const CHROME = 'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

(async function () {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  /* 不托管真人：手动推进 AI，直到轮到自己且已发到翻牌 */
  /* Do not auto-play the human: manually advance the AI until it is your turn with the flop already dealt */
  await page.evaluate(() => {
    const g = window.__game;
    g.cfg.aiSpeed = 0;
    g._delay = () => Promise.resolve();
  });

  /* 反复开新手，直到出现"翻牌后轮到你行动"的场景 */
  /* Repeatedly start new hands until a "post-flop, your turn to act" situation appears */
  let found = false;
  for (let attempt = 0; attempt < 60 && !found; attempt++) {
    await page.evaluate(() => {
      const g = window.__game;
      if (g.stage === 'over' || g.stage === 'idle') g.newHand();
    });
    /* 等 AI 全部行动完，停在真人回合 */
    /* Wait for all AI to finish acting, stopping at the human's turn */
    await page.waitForFunction(
      () => {
        const g = window.__game;
        return g.canHeroAct() || g.stage === 'over';
      }, null, { timeout: 3000 }
    ).catch(() => {});
    const st = await page.evaluate(() => {
      const g = window.__game;
      return { canAct: g.canHeroAct(), board: g.board.length, stage: g.stage };
    });
    if (st.canAct && st.board >= 3) { found = true; break; }
    /* 若在翻前轮到自己，就跟注/过牌继续，让牌局推进 */
    /* If it is your turn pre-flop, call/check to continue and let the hand proceed */
    await page.evaluate(() => {
      const g = window.__game;
      if (!g.canHeroAct()) return;
      const toCall = Math.max(0, g.currentBet - g.players[0].bet);
      g.heroAct(toCall > 0 ? 'call' : 'check');
    });
    await page.waitForTimeout(60);
  }

  console.log('找到翻牌后真人行动场景：' + found);
  /* 教练面板默认是收起的，截图前先展开，否则特写只能拍到一条标题栏 */
  /* The coach panel is collapsed by default, so expand it before the screenshot; otherwise the close-up only captures a title bar */
  await page.click('#coach-toggle');
  await page.waitForSelector('#advice-slot .advice', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => {
    const g = window.__game;
    const el = document.querySelector('#action-bar');
    return {
      street: g.street,
      board: g.board.map(c => window.PK.cardLabel(c)),
      pot: g.pot,
      heroStack: g.players[0].stack,
      heroCards: g.players[0].hole.map(c => window.PK.cardLabel(c)),
      actionBarHTML: el ? el.innerHTML.slice(0, 400) : null,
      coachText: (document.querySelector('#coach-body') || {}).innerText,
      backCards: document.querySelectorAll('.card.back').length,
    };
  });
  console.log(JSON.stringify(state, null, 2));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, '10-中局行动.png') });

  /* 放大截取操作栏与教练面板，便于核对细节 */
  /* Capture zoomed-in shots of the action bar and coach panel for detail checking */
  const bar = await page.$('#action-bar');
  if (bar) await bar.screenshot({ path: path.join(SHOT_DIR, '11-操作栏特写.png') });
  const coach = await page.$('#panel-coach');
  if (coach) await coach.screenshot({ path: path.join(SHOT_DIR, '12-教练面板特写.png') });
  const felt = await page.$('.table-outer');
  if (felt) await felt.screenshot({ path: path.join(SHOT_DIR, '13-牌桌特写.png') });

  console.log('JS 报错：' + (errors.length ? errors.join(' | ') : '无'));
  await browser.close();
})();
