/* ============================================================
 * check-settings-apply.js — 回归：切换设置重开时，旧对局必须被终止
 * check-settings-apply.js — regression: restarting after a settings change must terminate the old match
 *
 * 背景（真实缺陷，2026-09-28 修）：
 * Background (real defect, fixed 2026-09-28):
 *   main.js 的「应用并重开」只做 `game = new PK.Game(...)`，**没有**终止上一个
 *   main.js's "Apply and restart" only does `game = new PK.Game(...)` and does **not** terminate the previous
 *   Game 实例。而旧实例的 `_loop(gen)` 比的是它**自己**的 generation，
 *   Game instance. The old instance's `_loop(gen)` compares its **own** generation,
 *   换新对象并不会让它停下来：只要英雄已不需要行动（弃牌 / 全下）、剩下全是
 *   so swapping in a new object does not stop it: as long as the hero no longer needs to act (folded / all-in) and
 *   电脑，旧实例就会继续把这手打完，并在 `_finalizeHand()` 里调用
 *   only bots remain, the old instance keeps playing the hand to the end and, inside `_finalizeHand()`, calls
 *   PK.Profile.endHand() —— PK.Profile 是**单例**，于是"应用设置"会顺带把
 *   PK.Profile.endHand() — PK.Profile is a **singleton**, so "apply settings" incidentally writes a
 *   一整手幽灵数据写进漏洞画像，并被 storage 持久化下来。
 *   whole hand of ghost data into the leak profile, which storage then persists.
 *
 *   （实测过这条后果：英雄全下 + aiSpeed=25 时，摘掉修复后旧实例的
 *   (This consequence was measured: with hero all-in + aiSpeed=25, after removing the fix the old instance's
 *    `recents` 会从 0 变 1、`stage` 停在 'over'。此处**不**把它写成断言 ——
 *    `recents` goes from 0 to 1 and `stage` stays at 'over'. This is deliberately **not** written as an assertion —
 *   "旧实例什么时候跑完"受时序摆布，会变成时红时绿的脆弱断言；
 *   "when the old instance finishes" is timing-dependent and would become a flaky, red-then-green assertion;
 *   真正确定性、且能反证修复的判据是下面这组"终止不变式"。）
 *   the genuinely deterministic, fix-refuting criteria are the "termination invariants" below.)
 *
 * 判据为什么有判别力（已用反向对照实测：摘掉修复后 3 项转红）：
 * Why these criteria have discriminating power (verified by reverse control: removing the fix turns 3 items red):
 *   `stage` 全项目只有三处赋值 —— 构造 / `resetAll()` 给 'idle'，
 *   Across the whole project `stage` is assigned in only three places — the constructor / `resetAll()` sets 'idle',
 *   `newHand()` 给 'betting'，结算给 'over'/'showdown'。所以旧实例在切换设置后
 *   `newHand()` sets 'betting', settlement sets 'over'/'showdown'. So if the old instance, after a settings change,
 *   读到 'idle'，**只能**说明它被显式终止了；修复前 `resetAll()` 在全项目
 *   reads 'idle', that **can only** mean it was explicitly terminated; before the fix `resetAll()` had
 *   零调用点（`grep -rn resetAll src/` 只有 engine.js 的定义行），必然为红。
 *   zero call sites project-wide (`grep -rn resetAll src/` shows only the definition line in engine.js), so it must be red.
 *
 * 用法：NODE_PATH=<node_modules> node test/check-settings-apply.js
 * Usage: NODE_PATH=<node_modules> node test/check-settings-apply.js
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const FILE = 'file:///' + path.join(__dirname, '..', 'poker-trainer.html').replace(/\\/g, '/');
/* 浏览器自动探测：NLHE_CHROME → playwright 自报 → 缓存扫描 → 标准安装 → PATH
   Browser auto-detection: NLHE_CHROME → playwright-reported → cache scan → standard install → PATH */
const CHROME = require('../tools/find-browser.cjs').findBrowserExe();

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}

(async function () {
  if (!CHROME) { console.error('未找到可用浏览器'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 880 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  console.log('【1】取一份"牌局进行中"的旧实例');
  await page.waitForFunction(() => window.__game && window.__game.stage === 'betting',
    { timeout: 10000 });
  const before = await page.evaluate(() => {
    const g = window.__game;
    window.__oldGame = g;                 // 留住引用，之后 __game 会被换掉 / Keep this ref; __game is swapped later
    return { stage: g.stage, gen: g.generation, handNo: g.handNo, toAct: g.toAct };
  });
  ok('已捕获进行中的旧实例', before.stage === 'betting', 
    'stage=' + before.stage + ' gen=' + before.gen + ' handNo=' + before.handNo +
    ' toAct=' + before.toAct);

  console.log('\n【2】点击「设置 → 应用并重开」');
  await page.click('#btn-settings');
  await page.waitForTimeout(200);
  await page.click('#btn-apply');
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => {
    const old = window.__oldGame, now = window.__game;
    return {
      sameRef: old === now,
      oldStage: old.stage, oldGen: old.generation,
      oldToAct: old.toAct, oldHeroResolve: !!old._heroResolve, oldHandNo: old.handNo,
      newStage: now.stage, newSeats: now.players.length,
    };
  });

  ok('确实换成了新的 Game 实例', after.sameRef === false, 'sameRef=' + after.sameRef);
  ok('旧实例已被终止（stage 回到 idle）', after.oldStage === 'idle',
    '旧 stage=' + after.oldStage + '（修复前为 betting/over）');
  ok('旧实例的 generation 已自增（旧 _loop 随即退出）', after.oldGen > before.gen,
    before.gen + ' → ' + after.oldGen);
  ok('旧实例没有挂起的行动者/英雄等待',
    after.oldToAct === null && after.oldHeroResolve === false,
    'toAct=' + after.oldToAct + ' _heroResolve=' + after.oldHeroResolve);
  ok('新实例已开新局', after.newStage === 'betting',
    '新 stage=' + after.newStage + '，' + after.newSeats + ' 人');

  /* 终止之后必须**保持**终止：再等一会，旧实例不得自己推进。
   * Termination must **stay** terminated: wait a bit longer and the old instance must not advance on its own.
     参照点取"终止之后"的取值 —— resetAll() 会把 handNo 归零，
   * The reference point is the value *after* termination — resetAll() zeroes handNo,
     拿终止**之前**的 handNo 去比会误判。
   * Comparing against the handNo *before* termination would misjudge. */
  await page.waitForTimeout(2000);
  const later = await page.evaluate(() => ({
    stage: window.__oldGame.stage,
    gen: window.__oldGame.generation,
    handNo: window.__oldGame.handNo,
  }));
  ok('旧实例在观察窗内始终未再推进',
    later.stage === 'idle' && later.gen === after.oldGen && later.handNo === after.oldHandNo,
    'stage=' + later.stage + ' gen=' + later.gen + ' handNo=' + later.handNo);

  console.log('\n【3】运行期报错');
  ok('无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n════ ' + (fail ? '❌ ' + fail + ' 项失败 / ' : '✅ ') + pass + ' 项通过 ════');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
