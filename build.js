/* ============================================================
 * build.js — 把 index.html + src/* 打包成单文件 HTML
 * build.js — bundle index.html + src/* into a self-contained single-file HTML
 * 产物：poker-trainer.html（双击即可离线游玩，便于分享）
 * Output: poker-trainer.html (double-click to play offline, easy to share)
 *   node build.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
/* 加载顺序即依赖顺序，不能随意调换：
   Load order is dependency order and must not be changed arbitrarily:
   poker → equity（pct2/胜率） → range（169 类加权范围，依赖 poker/equity 的 holeKey/pct2）
   poker → equity (pct2/equity) → range (169 weighted classes, depends on holeKey/pct2 from poker/equity)
   → profile（漏洞画像） → ai（决策，运行时读 PK.Range / PK.Profile） → …
   → profile (leak profile) → ai (decisions, reads PK.Range / PK.Profile at runtime) → …
   range.js 必须排在 ai.js 之前：ai 的开池范围要经 PK.Range.classPctForCombos() 换算，
   range.js must come before ai.js: ai's opening range is converted via PK.Range.classPctForCombos(),
   极化 3-bet 也依赖 PK.Range.BLUFF_3BET；缺了它 AI 会静默退化成"范围偏紧 + 不做 3-bet 诈唬"。
   polarized 3-bet also relies on PK.Range.BLUFF_3BET; without it AI silently degrades to "tight range + no 3-bet bluff". */
const JS_ORDER = [
  'poker.js', 'equity.js', 'range.js', 'profile.js', 'ai.js', 'evloss.js', 'engine.js',
  'storage.js', 'ui.js', 'replay.js', 'scenarios.js', 'drill.js', 'bridge.js', 'leaks.js',
  'main.js',
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

let html = read('index.html');
const css = read('src/style.css');

/* 1. 内联样式 / 1. Inline styles */
html = html.replace(/<link rel="stylesheet" href="src\/style\.css">/,
  '<style>\n' + css + '\n</style>');

/* 2. 内联脚本（严格按依赖顺序） / 2. Inline scripts (strictly in dependency order) */
const scripts = JS_ORDER.map(function (f) {
  return '<script>\n/* ===== ' + f + ' ===== */\n' + read(path.join('src', f)) + '\n</script>';
}).join('\n');
html = html.replace(/(?:<script src="src\/[a-z]+\.js"><\/script>\s*)+/, scripts + '\n');

/* 3. 校验：不应再残留外部引用 / 3. Validate: no external references should remain */
const leftovers = html.match(/src="src\/|href="src\//g);
if (leftovers) {
  console.error('❌ 仍有未内联的外部引用：' + leftovers.join(', '));
  process.exit(1);
}
if (html.indexOf('<style>') < 0 || html.indexOf('/* ===== main.js ===== */') < 0) {
  console.error('❌ 内联失败：未找到 style 或 main.js 标记');
  process.exit(1);
}

const out = path.join(ROOT, 'poker-trainer.html');
fs.writeFileSync(out, html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('✅ 已生成 ' + out + '（' + kb + ' KB，单文件、零依赖、可离线运行）');
