/* ============================================================
 * measure-layout.js — 多分辨率布局体检
 * measure-layout.js — multi-resolution layout checkup
 *   在真实浏览器里以多种窗口尺寸加载页面，测量：
 *   Loads the page in a real browser at many window sizes and measures:
 *     1. 文档是否有溢出（横向/纵向滚动）
 *     1. Whether the document overflows (horizontal/vertical scrolling)
 *     2. 牌桌 .felt 的实际宽高比（设计值 16 : 9.4 ≈ 1.702）
 *     2. The actual aspect ratio of the table .felt (design value 16 : 9.4 ≈ 1.702)
 *     3. 每个座位是否越出牌桌矩形 / 越出牌桌的椭圆轮廓
 *     3. Whether each seat extends beyond the table rectangle / beyond the table's ellipse outline
 *     4. 操作栏在不同状态下的高度（是否抖动挤压牌桌）
 *     4. The height of the action bar in different states (whether it jitters and squeezes the table)
 *   用法：node test/measure-layout.js [index.html|poker-trainer.html]
 *   Usage: node test/measure-layout.js [index.html|poker-trainer.html]
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const TARGET_HTML = process.argv[2] || 'index.html';
const FILE = 'file:///' + path.join(__dirname, '..', TARGET_HTML).replace(/\\/g, '/');

const CHROME_CANDIDATES = [
  'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  'C:/Users/80vs2/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const CHROME = CHROME_CANDIDATES.find(p => fs.existsSync(p));

const SHOT_DIR = path.join(__dirname, 'shots', 'layout');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const VIEWPORTS = [
  { w: 2560, h: 1400, tag: '2560x1400' },
  { w: 1920, h: 1040, tag: '1920x1040' },
  { w: 1600, h: 900, tag: '1600x900' },
  { w: 1440, h: 780, tag: '1440x780' },
  { w: 1366, h: 728, tag: '1366x728' },
  { w: 1280, h: 680, tag: '1280x680' },
  { w: 1080, h: 660, tag: '1080x660' },
  { w: 1024, h: 720, tag: '1024x720' },
];

/* 页面内测量：返回一份结构化体检报告 */
/* In-page measurement: returns a structured checkup report */
function PAGE_PROBE() {
  const rect = el => {
    const b = el.getBoundingClientRect();
    return { x: +b.left.toFixed(1), y: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) };
  };

  const felt = document.getElementById('felt');
  const fr = rect(felt);
  /* 视觉椭圆：border-radius 50% / 50%，getBoundingClientRect 即 border box */
  /* Visual ellipse: border-radius 50% / 50%, getBoundingClientRect is the border box */
  const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
  const rx = fr.w * 0.50, ry = fr.h * 0.50;

  /* 返回矩形四角中"最越界"那个的超出量（>0 即在椭圆外） */
  /* Return the excess of the "most out-of-bounds" rectangle corner (>0 means outside the ellipse) */
  const ellipseExcess = bb => {
    let worst = -Infinity;
    for (const [px, py] of [[bb.x, bb.y], [bb.r, bb.y], [bb.x, bb.b], [bb.r, bb.b]]) {
      const v = Math.pow((px - cx) / rx, 2) + Math.pow((py - cy) / ry, 2) - 1;
      if (v > worst) worst = v;
    }
    return +worst.toFixed(3);
  };

  const seats = [...document.querySelectorAll('.seat')].map(el => {
    const b = rect(el);
    const boxEl = el.querySelector('.seat-box');
    const bb = boxEl ? rect(boxEl) : b;
    return {
      seat: +el.dataset.seat,
      name: (el.querySelector('.seat-name') || {}).textContent || '',
      rect: b,
      box: bb,
      /* 相对牌桌矩形的越出量（正数 = 超出） */
      /* Excess relative to the table rectangle (positive = beyond) */
      outL: +(fr.x - b.x).toFixed(1),
      outR: +(b.r - fr.r).toFixed(1),
      outT: +(fr.y - b.y).toFixed(1),
      outB: +(b.b - fr.b).toFixed(1),
      ell: ellipseExcess(bb),
    };
  });

  const ab = document.getElementById('action-bar');
  const docEl = document.documentElement;
  const feltStyle = getComputedStyle(felt);

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    scroll: {
      overX: +(docEl.scrollWidth - docEl.clientWidth).toFixed(1),
      overY: +(docEl.scrollHeight - docEl.clientHeight).toFixed(1),
    },
    felt: {
      ...fr,
      ratio: +(fr.w / fr.h).toFixed(3),
      cssW: feltStyle.width,
      cssH: feltStyle.height,
      borderRadius: feltStyle.borderRadius,
    },
    actionBar: rect(ab),
    tableOuter: rect(document.querySelector('.table-outer')),
    seatCount: seats.length,
    seats,
    /* 座位两两重叠面积（面积 > 200px² 才算真重叠，忽略圆角边角料） */
    /* Pairwise seat overlap area (only area > 200px² counts as a real overlap; rounded-corner scraps are ignored) */
    overlaps: (() => {
      const out = [];
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          const a = seats[i].rect, b = seats[j].rect;
          const w = Math.min(a.r, b.r) - Math.max(a.x, b.x);
          const h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
          if (w > 0 && h > 0 && w * h > 200) {
            out.push(seats[i].seat + '×' + seats[j].seat + '=' + Math.round(w * h));
          }
        }
      }
      return out;
    })(),
  };
}

/* 让页面进入"轮到真人行动"的稳定状态 */
/* Drive the page into the stable "it is the human's turn to act" state */
async function toHeroTurn(page) {
  await page.click('#btn-new').catch(() => {});
  await page.waitForSelector('#action-bar [data-act]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
}

(async function () {
  if (!CHROME) { console.error('未找到可用浏览器'); process.exit(1); }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--font-render-hinting=none'] });

  console.log('布局体检：' + TARGET_HTML);
  console.log('设计宽高比 = 16 / 9.4 = 1.702\n');

  const rows = [];
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

    await page.goto(FILE, { waitUntil: 'load' });

    /* 先量"未发牌"态的操作栏高度 */
    /* First measure the action-bar height in the "not yet dealt" state */
    const idleAB = await page.evaluate(() => Math.round(document.getElementById('action-bar').getBoundingClientRect().height));

    await toHeroTurn(page);
    const m = await page.evaluate(PAGE_PROBE);
    const actAB = m.actionBar.h;

    rows.push({ vp, m, errs, idleAB, actAB });

    await page.screenshot({ path: path.join(SHOT_DIR, vp.tag + '.png') });
    await page.close();
  }

  /* ---------------- 输出 ---------------- */
  /* ---------------- Output ---------------- */
  let problems = 0;

  console.log('【1】牌桌比例（目标 1.702，偏差 >4% 视为变形）');
  for (const r of rows) {
    const dev = (r.m.felt.ratio - 1.702) / 1.702 * 100;
    const bad = Math.abs(dev) > 4;
    if (bad) problems++;
    console.log('  ' + (bad ? '✗' : '✓') + ' ' + r.vp.tag.padEnd(11) +
      ' felt ' + String(Math.round(r.m.felt.w)).padStart(5) + '×' + String(Math.round(r.m.felt.h)).padStart(5) +
      '  比例 ' + r.m.felt.ratio.toFixed(3) +
      '  偏差 ' + (dev >= 0 ? '+' : '') + dev.toFixed(1) + '%');
  }

  console.log('\n【2】文档溢出（>0 即出现滚动条 / 内容被裁）');
  for (const r of rows) {
    const bad = r.m.scroll.overX > 1 || r.m.scroll.overY > 1;
    if (bad) problems++;
    console.log('  ' + (bad ? '✗' : '✓') + ' ' + r.vp.tag.padEnd(11) +
      ' 横向溢出 ' + String(r.m.scroll.overX).padStart(6) + 'px' +
      '  纵向溢出 ' + String(r.m.scroll.overY).padStart(6) + 'px');
  }

  console.log('\n【3】座位越界（相对牌桌矩形；正数 = 探出牌桌）');
  for (const r of rows) {
    const bad = r.m.seats.filter(s => s.outL > 2 || s.outR > 2 || s.outT > 2 || s.outB > 2);
    if (bad.length) problems++;
    const detail = bad.map(s => '座' + s.seat + '(L' + s.outL + '/R' + s.outR + '/T' + s.outT + '/B' + s.outB + ')').join(' ');
    console.log('  ' + (bad.length ? '✗' : '✓') + ' ' + r.vp.tag.padEnd(11) +
      (bad.length ? ' ' + detail : ' 全部在牌桌内'));
  }

  console.log('\n【4】座位压在牌桌椭圆边缘外（>0 表示 seat-box 已被椭圆裁掉）');
  for (const r of rows) {
    const bad = r.m.seats.filter(s => s.ell > 0.02);
    if (bad.length) problems++;
    const detail = bad.map(s => '座' + s.seat + '(' + s.ell.toFixed(2) + ')').join(' ');
    console.log('  ' + (bad.length ? '✗' : '✓') + ' ' + r.vp.tag.padEnd(11) +
      (bad.length ? ' ' + detail : ' 全部在椭圆内'));
  }

  console.log('\n【5】座位互相重叠（面积 > 200px²）');
  for (const r of rows) {
    const bad = r.m.overlaps.length;
    if (bad) problems++;
    console.log('  ' + (bad ? '✗' : '✓') + ' ' + r.vp.tag.padEnd(11) + ' ' +
      (bad ? r.m.overlaps.join(' ') : '无重叠'));
  }

  console.log('\n【6】操作栏高度（未发牌 → 轮到你行动；差值大说明牌桌会跳动）');
  for (const r of rows) {
    const jump = Math.abs(r.actAB - r.idleAB);
    const bad = jump > 4;
    if (bad) problems++;
    console.log('  ' + (bad ? '✗' : '✓') + ' ' + r.vp.tag.padEnd(11) +
      ' ' + r.idleAB + 'px → ' + r.actAB + 'px  跳变 ' + jump.toFixed(1) + 'px');
  }

  const allErrs = rows.flatMap(r => r.errs);
  console.log('\n【7】JS 报错：' + (allErrs.length ? '✗ ' + allErrs.slice(0, 3).join(' | ') : '✓ 无'));

  console.log('\n════ 结论：' + (problems ? '发现 ' + problems + ' 类问题' : '全部通过') + ' ════');
  console.log('截图目录：' + SHOT_DIR);

  await browser.close();
  process.exit(problems ? 1 : 0);
})();
