/* ============================================================
 * debug-chips.js — 逐手追踪筹码总量，定位泄漏
 * debug-chips.js — track total chips hand by hand to locate leaks
 *   node test/debug-chips.js
 * ============================================================ */
'use strict';
const path = require('path');
['poker.js', 'equity.js', 'ai.js', 'engine.js'].forEach(f => require(path.join(__dirname, '..', 'src', f)));
const PK = globalThis.PK;

const SEATS = 6;
const STACK = parseInt(process.env.STACK || '200', 10);
const TARGET = parseInt(process.argv[2] || '200', 10);

const sim = new PK.Game({ seats: SEATS, bb: 2, sb: 1, startStack: STACK, aiSpeed: 0, dealDelay: 0 });
sim._delay = () => Promise.resolve();
sim.players.forEach(p => { p.style = PK.STYLES.tag; p.isHero = false; });

const sumStack = () => sim.players.reduce((a, p) => a + p.stack, 0);
const sumBet = () => sim.players.reduce((a, p) => a + p.bet, 0);
const sumContrib = () => sim.players.reduce((a, p) => a + p.contrib, 0);

let prevEnd = null;
let hands = 0;
let leaks = 0;

sim.on('hand-start', () => {
  const t = sumStack() + sumBet();
  if (prevEnd !== null) {
    const diff = t - prevEnd;
    if (diff !== 0) {
      leaks++;
      console.log(`\n⚠ 第 ${sim.handNo} 手开始时总量异常：${prevEnd} → ${t}（差 ${diff}）`);
      console.log('   上一手类型：' + (sim.handResult ? sim.handResult.type : '?') +
        '，底池 ' + (sim.handResult ? sim.handResult.pot : '?'));
      sim.log.slice(-14).forEach(l => console.log('     ' + l.text));
      sim.players.forEach((p, i) => console.log('     seat' + i + ' stack=' + p.stack +
        ' bet=' + p.bet + ' contrib=' + p.contrib + ' folded=' + p.folded));
    }
  }
});

sim.on('hand-end', () => {
  hands++;
  /* 记录本手结束时的真实总量 */
  /* Record the true total at the end of this hand */
  const endTotal = sumStack();
  const contribs = sumContrib();
  const potFromContrib = contribs;

  if (sim.handResult && sim.handResult.pot !== potFromContrib) {
    console.log(`\n⚠ 第 ${sim.handNo} 手：handResult.pot=${sim.handResult.pot} 但 contrib 总额=${potFromContrib}`);
  }

  prevEnd = endTotal;

  if (hands < TARGET) sim.newHand();
  else {
    console.log('\n══════ 完成 ' + hands + ' 手 ══════');
    console.log('初始总量：' + (SEATS * STACK));
    console.log('结束总量：' + sumStack());
    console.log('异常次数：' + leaks);
    console.log('各座位：' + sim.players.map((p, i) => 'seat' + i + '=' + p.stack).join('  '));
    process.exit(0);
  }
});

setTimeout(() => { console.log('超时，完成 ' + hands + ' 手'); process.exit(1); }, 60000);
sim.newHand();
