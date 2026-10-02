/* ============================================================
 * check-positions.js — 座位位置标签校验
 * check-positions.js — seat position label verification
 *   1) 纯函数：2/3/4/6/9 人桌的位置名必须互不重复
 *   1) Pure function: position names must be unique for 2/3/4/6/9-handed tables
 *   2) 实际渲染：切换人数并发牌，读取牌桌上真实显示的位置标签
 *   2) Actual rendering: switch table sizes and deal, then read the position labels really shown on the table
 *   用法：node test/check-positions.js [index.html]
 *   Usage: node test/check-positions.js [index.html]
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

const SEAT_COUNTS = [2, 3, 4, 6, 9];
let fail = 0;

(async function () {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  await page.goto(FILE, { waitUntil: 'load' });

  /* ---------- 1. 纯函数检查 ----------
   * ---------- 1. Pure-function checks ---------- */
  const pure = await page.evaluate(ns => {
    const out = {};
    ns.forEach(n => {
      const names = [];
      for (let o = 0; o < n; o++) names.push(PK.UI.posName(o, n));
      out[n] = { names: names, unique: new Set(names).size === names.length };
    });
    return out;
  }, SEAT_COUNTS);

  console.log('【1】位置命名函数（order 0 = 小盲，n-1 = 按钮）');
  for (const n of SEAT_COUNTS) {
    const r = pure[n];
    if (!r.unique) fail++;
    console.log('  ' + (r.unique ? '✓' : '✗') + ' ' + n + ' 人桌：' + r.names.join(' / '));
  }

  /* ---------- 2. 实际渲染检查 ----------
   * ---------- 2. Actual rendering checks ---------- */
  console.log('\n【2】实际渲染的座位标签');
  for (const n of SEAT_COUNTS) {
    await page.click('#btn-settings');
    await page.click('#seg-seats button[data-v="' + n + '"]');
    await page.click('#btn-apply');
    await page.waitForTimeout(320);
    await page.click('#btn-new').catch(() => {});
    await page.waitForTimeout(700);

    const rows = await page.evaluate(() => {
      const cx = window.innerWidth / 2;
      return [...document.querySelectorAll('.seat')].map(el => {
        const b = el.getBoundingClientRect();
        return {
          seat: +el.dataset.seat,
          name: (el.querySelector('.seat-name') || {}).textContent || '?',
          pos: (el.querySelector('.seat-pos') || {}).textContent || '?',
          side: b.left + b.width / 2 < cx ? 'L' : 'R',
        };
      }).sort((a, b) => a.seat - b.seat);
    });

    const labels = rows.map(r => r.pos);
    const ok = labels.length === n && new Set(labels).size === n;
    if (!ok) fail++;
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + n + ' 人桌（渲染 ' + labels.length + ' 个座位）：' +
      rows.map(r => r.name + '=' + r.pos).join('  '));
    if (!ok) {
      const dup = labels.filter((v, i) => labels.indexOf(v) !== i);
      console.log('      重复标签：' + (dup.length ? dup.join(', ') : '无') +
        '，期望 ' + n + ' 个唯一标签');
    }
  }

  console.log('\n【3】JS 报错：' + (errs.length ? '✗ ' + errs.slice(0, 3).join(' | ') : '✓ 无'));
  if (errs.length) fail++;

  console.log('\n════ ' + (fail ? '发现 ' + fail + ' 项问题' : '全部通过') + ' ════');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
