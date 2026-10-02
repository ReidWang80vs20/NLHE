/* ============================================================
 * probe-behind.js — 一次性诊断：playersBehind() 数的是"行动顺序"还是"座位顺序"？
 * probe-behind.js — one-off diagnostic: does playersBehind() count "action order" or "seat order"?
 *
 * playersBehind 的语义应当是"翻前我还要等几个人行动"，也就是**行动顺序**里
 * playersBehind should mean "how many players I still wait for pre-flop", i.e. the number of players
 * 位于我之后的人数。实现却按座位编号往后数：
 * positioned after me in **action order**. The implementation instead counts forward by seat index:
 *     for (i=1..n-1) if (!players[(seat+i)%n].folded) cnt++
 * 这两者在按钮位/盲注位并不相等。
 * These two are not equal at the button / blind positions.
 *
 * 本脚本对 6 人桌的每种按钮位置，逐座比较两种算法。
 * This script compares the two algorithms seat by seat for every button position at a 6-handed table.
 *   node test/probe-behind.js
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'poker.js'));
require(path.join(__dirname, '..', 'src', 'equity.js'));
require(path.join(__dirname, '..', 'src', 'ai.js'));
const PK = globalThis.PK;

/** 按真实行动顺序统计"我之后还有几个未行动的人" */
/** Count, by the true action order, "how many players after me have not yet acted" */
function trueBehind(seat, button, n) {
  const twoHanded = n === 2;
  const sb = twoHanded ? button : (button + 1) % n;
  const bb = twoHanded ? (button + 1) % n : (button + 2) % n;
  const first = twoHanded ? button : (bb + 1) % n;   // 与 engine._firstPreflopActor 一致 / same as engine._firstPreflopActor
  /* 行动顺序：first, first+1, ... 长度为 n */
  /* Action order: first, first+1, ... with length n */
  const order = [];
  for (let i = 0; i < n; i++) order.push((first + i) % n);
  const myIdx = order.indexOf(seat);
  return n - 1 - myIdx;                              // 我之后的人数 / players after me
}

(function () {
  const n = 6;
  const players = Array.from({ length: n }, (_, i) => ({ seat: i, folded: false, allIn: false }));
  console.log(n + ' 人桌：playersBehind（现状） vs 真实行动顺序\n');
  let bad = 0;
  for (let button = 0; button < n; button++) {
    const sb = (button + 1) % n, bb = (button + 2) % n;
    const first = (bb + 1) % n;
    console.log('按钮 = 座位 ' + button + '（小盲 ' + sb + ' / 大盲 ' + bb + ' / 首位行动 ' + first + '）');
    console.log('  座位   现状   正确   开池范围(现状)   开池范围(正确)');
    for (let seat = 0; seat < n; seat++) {
      const got = PK.playersBehind(seat, players, button);
      const want = trueBehind(seat, button, n);
      if (got !== want) bad++;
      const gotR = PK.openRangeFor(got, PK.STYLES.tag);
      const wantR = PK.openRangeFor(want, PK.STYLES.tag);
      const mark = got === want ? ' ' : '⚠';
      console.log('   ' + seat + '     ' + String(got).padStart(3) +
        '    ' + String(want).padStart(3) +
        '        ' + (gotR * 100).toFixed(1).padStart(5) + '%' +
        '          ' + (wantR * 100).toFixed(1).padStart(5) + '%   ' + mark);
    }
    console.log('');
  }
  console.log(bad === 0
    ? '✅ 两种算法完全一致'
    : '❌ 有 ' + bad + '/' + (n * n) + ' 个座位的"身后人数"算错 —— 开池范围会整体偏紧');
  process.exit(0);
})();
