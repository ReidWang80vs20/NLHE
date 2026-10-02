/* ============================================================
 * check-scenarios.js — 题库自洽性校验
 * check-scenarios.js — scenario bank self-consistency checks
 *   教学材料里的数字必须站得住：牌面与街道要匹配、不能出现重复牌、
 *   Numbers in the teaching material must hold up: the board must match the street, no duplicate cards,
 *   选项必须恰好有一个最优解、跟注额不能超过有效筹码。
 *   each question must have exactly one optimal answer, and the call amount must not exceed the effective stack.
 *   用法：node test/check-scenarios.js
 *   Usage: node test/check-scenarios.js
 * ============================================================ */
'use strict';
const path = require('path');

require(path.join(__dirname, '..', 'src', 'poker.js'));
const PK = globalThis.PK;
require(path.join(__dirname, '..', 'src', 'scenarios.js'));
const SCENARIOS = PK.SCENARIOS;

const STREET_BOARD = { preflop: 0, flop: 3, turn: 4, river: 5 };
const VERDICTS = ['best', 'ok', 'bad'];

let fail = 0;
const ids = new Set();

function bad(sc, msg) {
  fail++;
  console.log('  ✗ [' + (sc ? sc.id : '?') + '] ' + msg);
}

console.log('题库校验：共 ' + SCENARIOS.length + ' 个场景\n');

for (const sc of SCENARIOS) {
  /* id 唯一
   * id must be unique */
  if (ids.has(sc.id)) bad(sc, 'id 重复');
  ids.add(sc.id);

  /* 基本字段
   * Required fields */
  if (!sc.title || !sc.desc || !sc.question) bad(sc, '缺少标题 / 说明 / 问题');
  if (!sc.cat) bad(sc, '缺少分类');
  if (!(sc.pot > 0)) bad(sc, '底池必须为正，当前 ' + sc.pot);
  if (!(sc.effStack > 0)) bad(sc, '有效筹码必须为正，当前 ' + sc.effStack);
  if (sc.toCall > sc.effStack) bad(sc, '跟注额 ' + sc.toCall + ' 超过有效筹码 ' + sc.effStack);
  if (sc.toCall < 0) bad(sc, '跟注额为负');
  if (!Array.isArray(sc.points) || sc.points.length < 2) bad(sc, '要点少于 2 条');

  /* 街道与公共牌数量必须匹配
   * Street and board card count must match */
  const wantBoard = STREET_BOARD[sc.street];
  if (wantBoard === undefined) bad(sc, '未知街道 ' + sc.street);
  else if (sc.board.length !== wantBoard) {
    bad(sc, sc.street + ' 应有 ' + wantBoard + ' 张公共牌，实际 ' + sc.board.length);
  }

  /* 牌能解析、且不重复
   * Cards must parse and must not repeat */
  const seen = new Set();
  const all = sc.heroHole.concat(sc.board);
  for (const txt of all) {
    const c = PK.parseCard(txt);
    if (c < 0 || c > 51) { bad(sc, '无法解析的牌 "' + txt + '"'); continue; }
    if (seen.has(c)) bad(sc, '重复的牌 ' + txt);
    seen.add(c);
  }
  if (sc.heroHole.length !== 2) bad(sc, '底牌必须是 2 张，实际 ' + sc.heroHole.length);

  /* 选项
   * Options */
  if (!Array.isArray(sc.options) || sc.options.length < 2) {
    bad(sc, '选项少于 2 个');
  } else {
    const bests = sc.options.filter(o => o.verdict === 'best');
    if (bests.length !== 1) bad(sc, '必须恰好有 1 个最优解，实际 ' + bests.length + ' 个');
    const keys = new Set();
    for (const o of sc.options) {
      if (!o.key || !o.text || !o.comment) bad(sc, '选项缺少 key / 文案 / 解析');
      if (keys.has(o.key)) bad(sc, '选项 key 重复：' + o.key);
      keys.add(o.key);
      if (VERDICTS.indexOf(o.verdict) < 0) bad(sc, '选项 verdict 非法：' + o.verdict);
    }
  }
}

/* ---------------- 汇总 ----------------
 * ---------------- Summary ---------------- */
console.log('分类分布：');
const byCat = {};
for (const sc of SCENARIOS) byCat[sc.cat] = (byCat[sc.cat] || 0) + 1;
for (const k of Object.keys(byCat)) console.log('  ' + k + '：' + byCat[k] + ' 题');

console.log('\n街道分布：');
const byStreet = {};
for (const sc of SCENARIOS) byStreet[sc.street] = (byStreet[sc.street] || 0) + 1;
for (const k of Object.keys(byStreet)) console.log('  ' + k + '：' + byStreet[k] + ' 题');

/* 答案分布：别让"最优解"总是同一个动作，否则可以靠猜
 * Answer distribution: don't let the "optimal" answer always be the same action, or it can be guessed */
const bestActions = {};
for (const sc of SCENARIOS) {
  const b = sc.options.find(o => o.verdict === 'best');
  if (b) bestActions[b.key] = (bestActions[b.key] || 0) + 1;
}
console.log('\n最优解动作分布（应尽量分散，避免靠模式猜答案）：');
for (const k of Object.keys(bestActions)) console.log('  ' + k + '：' + bestActions[k] + ' 题');

console.log('\n════ ' + (fail ? '❌ ' + fail + ' 项问题' : '✅ 全部通过') + ' ════');
process.exit(fail ? 1 : 0);
