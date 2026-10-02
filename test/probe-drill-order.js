/* 探针：连开 400 次训练面板，统计"首题只有 2 个选项"的真实频率 */
/* Probe: open the drill panel 400 times and measure the true frequency of "the first question has only 2 options" */
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

(async function () {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 880 } });
  const page = await ctx.newPage();
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const N = 400, hist = {}, byId = {};
    for (let t = 0; t < N; t++) {
      PK.Drill.state.order = [];          // 清空 → open() 会重新洗牌 / clear → open() reshuffles
      PK.Drill.open();
      const st = PK.Drill.state;
      const s = PK.Drill.SCENARIOS[st.order[0]];
      const domN = document.querySelectorAll('.drill-opt').length;
      hist[s.options.length] = (hist[s.options.length] || 0) + 1;
      byId[s.id] = (byId[s.id] || 0) + 1;
      if (domN !== s.options.length) hist['DOM不符:' + s.id + ':' + domN] = 1;
    }
    return { N: N, hist: hist, byId: byId };
  });

  console.log('打开 ' + r.N + ' 次，首题选项数分布：');
  for (const k of Object.keys(r.hist).sort()) {
    console.log('  ' + k + ' 个选项：' + r.hist[k] + ' 次（' + (r.hist[k] / r.N * 100).toFixed(1) + '%）');
  }
  const ids = Object.keys(r.byId).sort((a, b) => r.byId[b] - r.byId[a]);
  console.log('首题出现的题（应接近均匀 1/13 = 7.7%）：');
  for (const id of ids) console.log('  ' + id + '：' + r.byId[id] + ' 次（' + (r.byId[id] / r.N * 100).toFixed(1) + '%）');
  await browser.close();
})();
