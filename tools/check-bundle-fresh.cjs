/* ============================================================
 * check-bundle-fresh.cjs — 校验单文件产物没有过期
 * check-bundle-fresh.cjs — verify the single-file artifact is not stale
 *
 * 为什么需要它 / Why this exists
 * ------------------------------------------------------------
 * Electron 成品（dist/*.exe）里打包的只有 4 个文件，其中唯一承载
 * 游戏逻辑的是 poker-trainer.html。改了 src/ 之后如果只跑测试、
 * 忘了 `node build.js`，测试照样全绿（它们读的是 src/），
 * The Electron artifact (dist/*.exe) bundles only four files, and the only
 * one carrying game logic is poker-trainer.html. If you edit src/ and run
 * the tests but forget `node build.js`, the tests still pass (they read src/),
 * 但打出来的 exe 跑的是旧代码 —— 这类"测试绿、成品旧"的偏差最难发现。
 * yet the built exe runs the old code — a "tests green, artifact stale" gap
 * that is the hardest kind to notice.
 *
 * 判据不用时间戳（git checkout / 复制都会让 mtime 失真），而是
 * **重新算一遍打包结果，跟磁盘上的产物逐字节比对**。
 * The criterion is not timestamps (git checkout and copying both distort
 * mtime) but **recomputing the bundle and comparing it byte-for-byte with
 * the artifact on disk**.
 *
 * 用法 / Usage
 *   node tools/check-bundle-fresh.cjs            # 校验默认产物
 *   node tools/check-bundle-fresh.cjs <path>     # 校验指定文件（自检判别力用）
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { buildBundle, JS_ORDER } = require('../build.js');

const target = process.argv[2] || path.join(__dirname, '..', 'poker-trainer.html');

if (!fs.existsSync(target)) {
  console.error('❌ 产物不存在 / artifact missing: ' + target);
  console.error('   先运行 / run first: node build.js');
  process.exit(1);
}

const fresh = buildBundle();
const onDisk = fs.readFileSync(target, 'utf8');

if (fresh === onDisk) {
  console.log('✅ 产物是最新的 / artifact is up to date');
  console.log('   ' + target);
  console.log('   ' + (Buffer.byteLength(onDisk, 'utf8') / 1024).toFixed(1) + ' KB，'
    + JS_ORDER.length + ' 个模块已内联 / modules inlined');
  process.exit(0);
}

/* 定位是哪个模块脱节，便于直接修 / Pinpoint the drifted module so it can be fixed directly */
console.error('❌ 产物已过期 / artifact is stale: ' + target);
console.error('   运行 `node build.js` 重新打包后重试。');
console.error('   Re-run `node build.js` and try again.');
console.error('');
console.error('   逐模块核对 / per-module check:');

/* 每个 src 模块在产物里应当以 /* ===== <file> ===== *\/ 标记开头，下面是模块正文
   Each src module should appear in the artifact under a /* ===== <file> ===== *\/ marker
   followed by the module body. */
const ROOT = path.join(__dirname, '..');
let offenders = 0;
for (const f of JS_ORDER) {
  const body = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  const marker = '/* ===== ' + f + ' ===== */';
  const at = onDisk.indexOf(marker);
  let verdict;
  if (at < 0) {
    verdict = '缺失 / missing';
    offenders++;
  } else {
    const start = at + marker.length + 1;
    const slice = onDisk.substr(start, body.length);
    if (slice === body) {
      verdict = '一致 / identical';
    } else {
      /* 找第一个不同的字节，报告大致位置
         Find the first differing byte and report its approximate position */
      let i = 0;
      const n = Math.min(slice.length, body.length);
      while (i < n && slice[i] === body[i]) i++;
      const line = body.substr(0, i).split('\n').length;
      verdict = '不一致 / differs (源码第 ~' + line + ' 行 / src line ~' + line + ')'
        + (slice.length !== body.length
          ? '，长度 ' + slice.length + ' vs ' + body.length
          : '');
      offenders++;
    }
  }
  console.error('     ' + (verdict.indexOf('一致') === 0 ? '✓' : '✗') + ' ' + f.padEnd(14) + ' ' + verdict);
}

const css = fs.readFileSync(path.join(ROOT, 'src', 'style.css'), 'utf8');
const cssOk = onDisk.indexOf('<style>\n' + css + '\n</style>') >= 0;
if (!cssOk) offenders++;
console.error('     ' + (cssOk ? '✓' : '✗') + ' style.css      '
  + (cssOk ? '一致 / identical' : '不一致 / differs'));

process.exit(1);
