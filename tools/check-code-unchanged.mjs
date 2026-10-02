#!/usr/bin/env node
/* ============================================================
 * tools/check-code-unchanged.mjs
 *   证明"只改注释、没动代码"的严格校验器。
 *   A strict verifier that proves "comments only — no code change".
 *
 * 原理 / How it works:
 *   JS   —— 用 acorn 把基线版本与当前版本各自解析成 token 流，
 *           逐 token 比对（类型 + 值）。注释与空白不产生 token，
 *           因此只要 token 流一致，就能断定代码语义未被改动；
 *           同时解析过程本身就是一次语法检查。
 *           JS — parse both the baseline and the current file with acorn
 *           and compare their token streams (type + value). Comments and
 *           whitespace produce no tokens, so identical streams prove the
 *           code is untouched; parsing also doubles as a syntax check.
 *   HTML —— 剥掉 <!-- --> 与 <script>/<style> 之外的空行后比对正文，
 *           用于确认结构（标签、属性、favicon data URI）未被改动。
 *           HTML — strip <!-- --> comments, then compare the remaining
 *           body so structure (tags, attributes, the favicon data URI)
 *           is provably unchanged.
 *   CSS  —— 剥掉 /* *\/ 注释后比对剩余规则文本。
 *           CSS — strip /* *\/ comments and compare the remaining rules.
 *
 * 用法 / Usage:
 *   node tools/check-code-unchanged.mjs <基线目录> [文件...]
 *   node tools/check-code-unchanged.mjs .workbuddy/baseline
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* acorn 优先从本地 node_modules 解析，找不到就退回 NODE_PATH
   Resolve acorn from the local node_modules first, then fall back to NODE_PATH. */
let acorn;
try {
  acorn = require('acorn');
} catch (e) {
  console.error('找不到 acorn —— 请先 `npm install`（acorn 已列入 devDependencies）');
  console.error('acorn not found — run `npm install` (acorn is a devDependency)');
  process.exit(2);
}

const DEFAULT_FILES = [
  'build.js',
  'index.html',
  'src/style.css',
  ...fs.readdirSync(new URL('../src', import.meta.url))
    .filter(f => f.endsWith('.js')).map(f => 'src/' + f),
  ...fs.readdirSync(new URL('../test', import.meta.url))
    .filter(f => f.endsWith('.js') || f.endsWith('.mjs')).map(f => 'test/' + f),
];

const baselineRoot = process.argv[2] || '.workbuddy/baseline';
const files = process.argv.length > 3 ? process.argv.slice(3) : DEFAULT_FILES;
const repoRoot = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/* 取出 JS 的 token 流（类型|值）/ Extract the JS token stream (label|value) */
function jsTokens(code, label) {
  /* .mjs 按 ES 模块解析，其余按脚本解析
     .mjs files are parsed as ES modules, everything else as scripts. */
  const sourceType = /\.mjs$/.test(label) ? 'module' : 'script';
  const opts = {
    ecmaVersion: 'latest',
    sourceType,
    allowHashBang: true,
    allowReturnOutsideFunction: true,
  };
  const out = [];
  const tokenizer = acorn.tokenizer(code, opts);
  for (;;) {
    const t = tokenizer.getToken();
    if (t.type.label === 'eof') break;
    out.push(t.type.label + '|' + String(t.value));
  }
  /* 完整解析一次，语法错误会在这里抛出（比 tokenizer 更容易定位）
     A full parse catches syntax errors with a better position report. */
  acorn.parse(code, opts);
  return out;
}

/* 取出非 JS 文本的"去注释正文" / Strip comments from non-JS text */
function plainBody(text, kind) {
  let s = text;
  if (kind === 'html') {
    s = s.replace(/<!--[\s\S]*?-->/g, '');
  } else if (kind === 'css') {
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  }
  /* 归一化空白：只关心"可见结构"是否变化
     Normalise whitespace: only the visible structure matters. */
  return s.replace(/\s+/g, ' ').trim();
}

function kindOf(file) {
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'js';
  if (file.endsWith('.html')) return 'html';
  if (file.endsWith('.css')) return 'css';
  return 'plain';
}

let failed = 0, passed = 0;
const rows = [];

for (const rel of files) {
  const curPath = path.join(repoRoot, rel);
  const basePath = path.join(repoRoot, baselineRoot, rel);
  if (!fs.existsSync(basePath)) { rows.push([rel, 'SKIP', '基线中不存在 / not in baseline']); continue; }
  if (!fs.existsSync(curPath))  { rows.push([rel, 'FAIL', '文件缺失 / missing']); failed++; continue; }

  const a = fs.readFileSync(basePath, 'utf8');
  const b = fs.readFileSync(curPath, 'utf8');
  const kind = kindOf(rel);

  try {
    if (kind === 'js') {
      const ta = jsTokens(a, rel);
      const tb = jsTokens(b, rel);
      if (ta.length !== tb.length) {
        rows.push([rel, 'FAIL', `token 数不同 / token count ${ta.length} → ${tb.length}`]);
        failed++;
        continue;
      }
      let diff = -1;
      for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) { diff = i; break; }
      if (diff >= 0) {
        rows.push([rel, 'FAIL', `第 ${diff} 个 token 不同 / token #${diff}: ${ta[diff]} → ${tb[diff]}`]);
        failed++;
        continue;
      }
      rows.push([rel, 'OK', `token ${ta.length} 个完全一致 / ${ta.length} tokens identical`]);
      passed++;
    } else {
      const ba = plainBody(a, kind), bb = plainBody(b, kind);
      if (ba !== bb) {
        rows.push([rel, 'FAIL', '去注释正文不一致 / body differs after comment stripping']);
        failed++;
        continue;
      }
      rows.push([rel, 'OK', '去注释正文一致 / body identical']);
      passed++;
    }
  } catch (e) {
    rows.push([rel, 'FAIL', '解析失败 / parse error: ' + e.message]);
    failed++;
  }
}

/* 输出报表 / Report */
const w = Math.max(...rows.map(r => r[0].length), 12);
console.log('\n代码零改动校验（基线：' + baselineRoot + '）');
console.log('Code-unchanged verification (baseline: ' + baselineRoot + ')');
console.log('─'.repeat(w + 60));
for (const r of rows) {
  console.log(r[0].padEnd(w) + '  ' + r[1].padEnd(5) + '  ' + r[2]);
}
console.log('─'.repeat(w + 60));
console.log(`${failed === 0 ? '✅ 通过' : '❌ 失败'}：${passed} OK / ${failed} FAIL / ${rows.length - passed - failed} SKIP\n`);
process.exit(failed === 0 ? 0 : 1);
