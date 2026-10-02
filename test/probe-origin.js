/* 验证：两个 file:// 页面在 Chrome 下是否共享 localStorage */
/* Verify: do two file:// pages share localStorage under Chrome? */
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext();
  const p1 = await ctx.newPage();
  await p1.goto('file:///D:/todo/NLHE/index.html');
  await p1.evaluate(() => localStorage.setItem('__originProbe__', 'from-todo'));
  const p2 = await ctx.newPage();
  await p2.goto('file:///D:/temp/AI/NLHE/poker-trainer.html');
  const v = await p2.evaluate(() => localStorage.getItem('__originProbe__'));
  const wb = await p2.evaluate(() => localStorage.getItem('nlhe_trainer_v1') ? JSON.parse(localStorage.getItem('nlhe_trainer_v1')).version : null);
  console.log('跨路径读取结果 :', v);
  console.log('能读到题库存档 :', wb !== null ? ('version=' + wb) : '读不到');
  await p2.evaluate(() => localStorage.removeItem('__originProbe__'));
  await b.close();
})();
