/* ============================================================
 * check-coach-fold.js — 教练面板折叠 + 面板自洽验收
 * check-coach-fold.js — coach panel collapse + panel self-consistency acceptance test
 *   node test/check-coach-fold.js
 *
 * 覆盖两件事：
 * Covers two things:
 *   A. 折叠行为：默认收起、点击切换、**每手开始都回到收起态**、收起时不启动计算
 *   A. Collapse behavior: collapsed by default, toggled on click, **returns to collapsed at the start of every hand**, no computation started while collapsed
 *   B. 面板自洽：主指标（对对手范围）与门槛刻度线必须同源 ——
 *   B. Panel self-consistency: the primary metric (against opponent range) and the threshold tick line must share one source —
 *      "数字越过线"与"建议该跟"必须一致，且线必须画在 need 上、不是底池赔率上。
 *      "the number crossing the line" and "the advice to call" must agree, and the line must be drawn on need, not on pot odds.
 *      （2026-09-29 事故：面板显示 47.6% 越过 34.8% 的线却建议弃牌。）
 *      (2026-09-29 incident: the panel showed 47.6% crossing the 34.8% line yet advised a fold.)
 *
 * 判别力：把 ai.js 的 cont() 去掉（不回传 need）或把 ui.js 的线改回 potOdds，
 * Discriminating power: remove ai.js's cont() (not passing back need) or revert ui.js's line to potOdds,
 *        第 5、6 组断言应当变红。
 *        then assertion groups 5 and 6 should turn red.
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const FILE = 'file:///' + path.join(__dirname, '..', 'poker-trainer.html').replace(/\\/g, '/');
const CAND = [
  'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const CHROME = CAND.find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (c, m, d) => {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (d !== undefined ? '   ← ' + d : '')); }
};

(async function () {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const g = window.__game;
    g.cfg.aiSpeed = 0;
    g._delay = () => Promise.resolve();
  });

  const readPanel = () => page.evaluate(() => {
    const p = document.querySelector('#panel-coach');
    const b = document.querySelector('#coach-body');
    return {
      collapsed: p.classList.contains('collapsed'),
      open: p.classList.contains('open'),
      bodyH: b ? b.offsetHeight : -1,
      bodyLen: b ? b.textContent.trim().length : -1,
      panelH: p.offsetHeight,
    };
  });

  /* ---------- A1. 默认收起 ---------- */
  /* ---------- A1. Collapsed by default ---------- */
  console.log('\n【1】默认收起');
  await page.evaluate(() => window.__game.newHand());
  await page.waitForTimeout(250);
  let s = await readPanel();
  ok(s.collapsed && !s.open, '面板带 collapsed 类（默认收起）', JSON.stringify(s));
  ok(s.bodyH === 0, '折叠时提示区高度为 0', 'bodyH=' + s.bodyH);
  ok(s.bodyLen === 0, '折叠时提示区是空的（说明没有启动计算）', 'bodyLen=' + s.bodyLen);
  ok(s.panelH < 60, '折叠后整块只剩标题栏', 'panelH=' + s.panelH);

  /* ---------- A2. 点击展开 ---------- */
  /* ---------- A2. Expand on click ---------- */
  console.log('\n【2】点击标题展开');
  await page.click('#coach-toggle');
  await page.waitForTimeout(250);
  s = await readPanel();
  ok(!s.collapsed && s.open, '点击后切到 open 态', JSON.stringify(s));
  ok(s.bodyH > 40, '提示区展开出内容', 'bodyH=' + s.bodyH);
  const label = await page.$eval('#coach-body', el => el.innerText);
  ok(/你的位置|底牌|等待轮到你行动|你已弃牌/.test(label), '展开后渲染出教练内容',
    label.slice(0, 30).replace(/\n/g, ' '));

  /* ---------- A3. 再点收起 ---------- */
  /* ---------- A3. Click again to collapse ---------- */
  console.log('\n【3】再点一次收起');
  await page.click('#coach-toggle');
  await page.waitForTimeout(250);
  s = await readPanel();
  ok(s.collapsed && s.bodyH === 0 && s.bodyLen === 0, '回到收起态且内容被清空', JSON.stringify(s));

  /* ---------- A4. 每手都回到收起态 ---------- */
  /* ---------- A4. Return to collapsed state every hand ---------- */
  console.log('\n【4】每手开始都回到收起态');
  await page.click('#coach-toggle');
  await page.waitForTimeout(200);
  const before = await readPanel();
  ok(before.open, '先手动展开（否则下面一条会假通过）', JSON.stringify(before));
  await page.evaluate(() => { const g = window.__game; if (g.stage !== 'idle') g.newHand(); });
  await page.waitForTimeout(300);
  const after = await readPanel();
  ok(after.collapsed && !after.open, '开新手后自动收起', JSON.stringify(after));

  /* ---------- B. 面板自洽（翻后、面对下注） ---------- */
  /* ---------- B. Panel self-consistency (post-flop, facing a bet) ---------- */
  console.log('\n【5】面板自洽：数字越过线 ⇔ 建议该继续');
  let sam = 0, consistency = 0, lineAboveOdds = 0, mismatches = [], noLine = 0;
  for (let attempt = 0; attempt < 80 && sam < 4; attempt++) {
    /* 只在上一手结束时开新局。若写成 stage !== 'idle' 就重开，会每轮都把牌局
       Start a new hand only when the previous hand has ended. If written to restart on stage !== 'idle', every round would
       打回翻前，永远取不到翻后样本（这里踩过一次）。
       push the hand back to pre-flop, so a post-flop sample could never be captured (we tripped on this once). */
    await page.evaluate(() => {
      const g = window.__game;
      if (g.stage === 'over' || g.stage === 'idle') g.newHand();
    });
    await page.waitForFunction(() => {
      const g = window.__game;
      return g.canHeroAct() || g.stage === 'over';
    }, null, { timeout: 3000 }).catch(() => {});

    const info = await page.evaluate(() => {
      const g = window.__game;
      const toCall = Math.max(0, g.currentBet - g.players[0].bet);
      return { canAct: g.canHeroAct(), board: g.board.length, toCall };
    });

    if (info.canAct && info.board >= 3 && info.toCall > 0) {
      await page.click('#coach-toggle');                       // 展开 / expand
      await page.waitForSelector('#advice-slot .advice', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(120);
      const r = await page.evaluate(() => {
        const rv = document.querySelector('#eq-range-val');
        const ln = document.querySelector('#eq-need');
        const ad = document.querySelector('#advice-slot .advice');
        const head = document.querySelector('#coach-body');
        const m = head && /底池赔率\s*([\d.]+)%/.exec(head.textContent);
        if (!rv || !ad) return null;
        return {
          rangePct: parseFloat(rv.textContent),
          lineShown: ln ? ln.style.display !== 'none' : false,
          linePct: ln && ln.style.display !== 'none' ? parseFloat(ln.style.left) : null,
          fold: ad.className.indexOf('fold') >= 0,
          call: ad.className.indexOf('call') >= 0,
          oddsPct: m ? parseFloat(m[1]) : null,
          advice: ad.innerText.replace(/\n/g, ' ').slice(0, 70),
        };
      });
      if (r && r.linePct !== null && !isNaN(r.rangePct)) {
        sam++;
        /* 边界样本（两值相差 < 0.5pp）判方向不可靠，跳过以免时红时绿 */
        /* Boundary samples (two values differ by < 0.5pp) give an unreliable direction, so skip them to avoid flaky red/green */
        if (Math.abs(r.rangePct - r.linePct) >= 0.5) {
          const shouldFold = r.rangePct < r.linePct;
          if (shouldFold === r.fold) consistency++;
          else mismatches.push(r.rangePct + '% vs 线' + r.linePct + '% / ' + r.advice);
        }
        if (r.oddsPct !== null && r.linePct > r.oddsPct + 0.5) lineAboveOdds++;
      } else if (r && !r.lineShown) {
        noLine++;
      }
      await page.click('#coach-toggle');                        // 收起，准备下一局 / collapse, ready for next hand
      await page.waitForTimeout(80);
    } else if (info.canAct) {
      await page.evaluate(() => {
        const g = window.__game;
        const tc = Math.max(0, g.currentBet - g.players[0].bet);
        g.heroAct(tc > 0 ? 'call' : 'check');
      });
      await page.waitForTimeout(60);
    }
  }
  ok(sam > 0, '取到翻后面对下注的样本', '样本 ' + sam + ' 个');
  ok(consistency > 0, '展示的胜率与建议方向一致（' + consistency + '/' + sam + '）',
    mismatches.join(' | '));
  ok(mismatches.length === 0, '没有"数字越过线却建议弃牌"这类自相矛盾', mismatches.join(' | '));
  ok(lineAboveOdds === sam, '门槛刻度线画在 need 上、严格高于底池赔率（' + lineAboveOdds + '/' + sam + '）',
    '若为 0 说明线退回了 potOdds 位置');

  /* ---------- C. 收起时不计算 ---------- */
  /* ---------- C. No computation while collapsed ---------- */
  console.log('\n【6】收起时不启动计算');
  await page.evaluate(() => { const g = window.__game; if (g.stage !== 'idle') g.newHand(); });
  await page.waitForTimeout(300);
  const idle = await page.evaluate(() => {
    const b = document.querySelector('#coach-body');
    const ln = document.querySelector('#eq-need');
    return {
      html: b ? b.innerHTML.length : -1,
      hasRangeVal: !!document.querySelector('#eq-range-val'),
      lineShown: ln ? ln.style.display !== 'none' : null,
    };
  });
  ok(idle.html === 0, '收起状态下提示区没有任何 DOM（未发起胜率/建议计算）', 'html.len=' + idle.html);

  console.log('\n【7】运行期报错');
  ok(errors.length === 0, '无 JS 报错', errors.join(' | '));

  console.log('\n════ ' + pass + ' 项通过，' + fail + ' 项失败 ════');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
