/* 验证：两个 file:// 页面在 Chrome 下是否共享 localStorage */
/* Verify: do two file:// pages share localStorage under Chrome? */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

/* 浏览器自动探测：NLHE_CHROME → playwright 自报 → 缓存扫描 → 标准安装 → PATH
   Browser auto-detection: NLHE_CHROME → playwright-reported → cache scan → standard install → PATH */
const EXE = require('../tools/find-browser.cjs').findBrowserExe();

/* 本仓库位置：从脚本自身推导，不写死绝对路径
   This repository's location: derived from the script itself, no absolute path hard-coded */
const HERE = path.join(__dirname, '..');
const REPO_HTML = path.join(HERE, 'index.html');

/* 对照用的"另一个副本"（同一份代码放在别处，用来比对两个 file:// 路径是否共享存档）：
   The "other copy" used for comparison (the same code placed elsewhere, to compare whether two file://
   paths share their storage):
   默认取与本仓库同级的 ../../temp/AI/NLHE，可用 NLHE_PEER_ROOT 覆盖。
   defaults to the sibling ../../temp/AI/NLHE and can be overridden with NLHE_PEER_ROOT.
   该目录不存在时脚本直接报错退出，而不是静默去比对一个不存在的页面。
   When that directory is missing the script exits with an error instead of silently comparing a missing page. */
const PEER_ROOT = process.env.NLHE_PEER_ROOT || path.join(HERE, '..', '..', 'temp', 'AI', 'NLHE');
const PEER_HTML = path.join(PEER_ROOT, 'poker-trainer.html');

for (const [label, p] of [['本仓库', REPO_HTML], ['对照副本', PEER_HTML]]) {
  if (!fs.existsSync(p)) {
    console.error('找不到' + label + '：' + p);
    console.error('（对照副本可用 NLHE_PEER_ROOT 环境变量指定）');
    process.exit(1);
  }
}

const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext();
  const p1 = await ctx.newPage();
  await p1.goto(toUrl(REPO_HTML));
  await p1.evaluate(() => localStorage.setItem('__originProbe__', 'from-todo'));
  const p2 = await ctx.newPage();
  await p2.goto(toUrl(PEER_HTML));
  const v = await p2.evaluate(() => localStorage.getItem('__originProbe__'));
  const wb = await p2.evaluate(() => localStorage.getItem('nlhe_trainer_v1') ? JSON.parse(localStorage.getItem('nlhe_trainer_v1')).version : null);
  console.log('本仓库页面     :', toUrl(REPO_HTML));
  console.log('对照副本       :', toUrl(PEER_HTML));
  console.log('跨路径读取结果 :', v);
  console.log('能读到题库存档 :', wb !== null ? ('version=' + wb) : '读不到');
  await p2.evaluate(() => localStorage.removeItem('__originProbe__'));
  await b.close();
})();
