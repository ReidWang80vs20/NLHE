/* 回归断言：教练建议里"跟注所需"这个数字，必须与它真正用的门槛一致。
 * Regression assertion: the "required to call" number in the coach's advice must match the threshold it actually uses.
 *
 * 事故背景（2026-09-29 截图）：BTN 6 人桌，K9s，翻牌 A 高，底池 45，对手下注 24。
 * Incident background (2026-09-29 screenshot): BTN at a 6-handed table, K9s, A-high flop, pot 45, opponent bets 24.
 *   面板显示：当前胜率 47.6% / 底池赔率 34.8% / 建议弃牌
 *   Panel showed: current equity 47.6% / pot odds 34.8% / advice fold
 *   弃牌理由："胜率约 48%，低于跟注所需的 35%，长期来看跟注是亏损的。"  ← 48 < 35 为假
 *   Fold reason: "equity about 48%, below the 35% required to call, so calling loses long-term."  ← "48 < 35" is false
 * 两处根因：
 * Two root causes:
 *   ① 文案引用了 potOdds（裸底池赔率），而决策门槛是 need = potOdds + 余量 + 分层 + 压力 − 位置；
 *   ① The copy referenced potOdds (raw pot odds), while the decision threshold is need = potOdds + margin + tier + pressure − position;
 *   ② 面板展示的是"对随机手牌"胜率，决策用的是"对对手下注范围"胜率 —— 两个不同的数。
 *   ② The panel displayed equity "vs random hand", while the decision used equity "vs opponent's betting range" — two different numbers.
 *
 * 本断言不读公式、不猜，而是**实测** coreDecide 的 call/fold 翻转点（二分搜索），
 * This assertion does not read the formula or guess; it **measures** coreDecide's call/fold flip point (binary search),
 * 再核对文案引用的变量名。判别力：修复前 3 条中 3 条为红。
 * then cross-checks the variable names referenced in the copy. Discriminating power: before the fix, 3 of 3 assertions were red.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const PK = require('../src/ai.js');

const D = (v) => (v * 100).toFixed(1) + '%';
let pass = 0, fail = 0;
const ok = (cond, msg, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (detail ? '  ← ' + detail : '')); }
};

/* ---- 复刻截图局面 ---- */
/* ---- Reproduce the screenshot situation ---- */
const POT = 45, TO_CALL = 24;
const potOdds = TO_CALL / (POT + TO_CALL);
const posFrac = 1.0;
const posAdj = (posFrac - 0.5) * 0.03;
const margin = PK.STYLES.tag.callMargin * (2 - PK.NEUTRAL_EX.callDownBoost);
const streetPressure = 0.02;
const tierBonusOf = (t) => (t >= 2 ? 0 : (t === 1 ? 0.07 : 0.16));

function makeCtx(tier) {
  return {
    G: { cfg: { bb: 2 }, pot: POT, street: 'flop', board: [1, 2, 3],
         currentBet: TO_CALL, raiseCount: 1, players: [], button: 0 },
    me: { seat: 0, hole: [], bet: 0, stack: 400, folded: false, allIn: false },
    style: PK.STYLES.tag,
    street: 'flop', nOpp: 1, toCall: TO_CALL, pot: POT,
    equity: 0.5, pct: 0.5, key: 'K9s', posFrac,
    raiseCount: 1, behind: 0, isPair: false, isSuited: true,
    tier, ex: PK.NEUTRAL_EX,
  };
}

function measureThreshold(tier) {
  const ctx = makeCtx(tier);
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    ctx.equity = mid;
    if (PK.coreDecide(ctx).action === 'fold') lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

console.log('=== 局面：BTN 6人桌 / 底池 ' + POT + '，跟注 ' + TO_CALL +
            ' / 底池赔率 ' + D(potOdds) + ' ===');
console.log('门槛构成：potOdds ' + D(potOdds) + ' + margin ' + D(margin) +
            ' + streetPressure ' + D(streetPressure) + ' - posAdj ' + D(posAdj) + '\n');

console.log('实测门槛（二分搜索 coreDecide 的弃牌临界点）：');
console.log('tier 手牌分层              公式 need   实测门槛   相对底池赔率');
for (const [tier, label] of [[0, '空气（无卡顺/无听牌）'], [1, '弱牌（卡顺/双高张）'], [2, '成牌或强听牌']]) {
  const need = potOdds + margin + tierBonusOf(tier) + streetPressure - posAdj;
  const measured = measureThreshold(tier);
  console.log('  ' + tier + '  ' + label.padEnd(18, ' ') +
              D(need).padStart(7) + '   ' + D(measured).padStart(7) +
              '   +' + ((measured - potOdds) * 100).toFixed(1) + 'pp');
}

console.log('\n=== 断言 ===');
const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8');

/* ① 结构性：need 恒大于 potOdds，所以拿 potOdds 当"跟注所需"必然写出假命题 */
/* ① Structural: need is always greater than potOdds, so treating potOdds as "required to call" necessarily writes a false statement */
let mono = true;
for (const t of [0, 1, 2]) {
  const need = potOdds + margin + tierBonusOf(t) + streetPressure - posAdj;
  if (need <= potOdds) mono = false;
}
ok(mono, 'need 恒大于底池赔率（余量+压力−位置恒为正）',
  '若此项为红，说明门槛参数被改到低于赔率，面板文案的前提失效');

/* ② 实测门槛与公式门槛一致（探针自身有效性） */
/* ② The measured threshold matches the formula threshold (validity of the probe itself) */
for (const t of [0, 1, 2]) {
  const need = potOdds + margin + tierBonusOf(t) + streetPressure - posAdj;
  const measured = measureThreshold(t);
  ok(Math.abs(measured - (need - PK.STYLES.tag.stickiness)) < 1e-9,
    'tier=' + t + ' 实测门槛 = need − stickiness（' + D(measured) + '）',
    '公式 ' + D(need - PK.STYLES.tag.stickiness));
}

/* ③ 决策侧把门槛带出来了 */
/* ③ The decision side passes the threshold out */
const dFold = PK.coreDecide(Object.assign(makeCtx(1), { equity: 0.30 }));
ok(typeof dFold.need === 'number' && typeof dFold.potOdds === 'number',
  'coreDecide 随结果回传 need / potOdds', 'action=' + dFold.action + ' need=' + dFold.need);
ok(dFold.need > dFold.potOdds,
  '回传的 need 严格大于 potOdds（' + D(dFold.need) + ' > ' + D(dFold.potOdds) + '）');

/* ④ 文案引用的是 need，不再是 potOdds */
/* ④ The copy references need, no longer potOdds */
ok(/adv\.need/.test(ui), 'ui.js 文案引用 adv.need');
ok(!/adv\.potOdds\s*\*\s*100/.test(ui.replace(/oddsPct[^;]*;/g, '')),
  'ui.js 不再用 adv.potOdds 当"跟注所需"',
  '仍存在 potOdds*100 直接进文案的写法');
ok(/equityVsRange/.test(ui), '面板主指标使用 equityVsRange（决策口径）');
ok(/adv\.action === 'fold'[\s\S]{0,500}?needPct/.test(ui),
  'fold 分支的判据取自 need（needPct），而非 potOdds');

/* ⑤ 修复后的文案不再自相矛盾：拿真实数字走一遍 */
/* ⑤ The fixed copy is no longer self-contradictory: run through it with real numbers */
const ctx = Object.assign(makeCtx(1), { equity: 0.40 });
const adv = PK.coreDecide(ctx);
const rangePct = Math.round(0.40 * 100);          // 文案用：对对手范围（决策口径） / for copy: vs opponent range
const rawPct = Math.round(0.476 * 100);           // 参考行用：对随机手牌（截图值） / for reference: vs random hand
const needPct = Math.round(adv.need * 100);
const oddsPct = (adv.potOdds * 100).toFixed(1);
console.log('\n  修复后 fold 文案：对对手范围的胜率约 ' + rangePct + '%，低于跟注所需的 ' +
            needPct + '%（底池赔率 ' + oddsPct + '% 加上纪律余量），长期来看跟注是亏损的。');
ok(rangePct < needPct, '文案里的胜率确实低于门槛（' + rangePct + '% < ' + needPct + '%）');
ok(needPct > Math.round(adv.potOdds * 100),
  '"跟注所需"不再等于底池赔率（' + needPct + '% vs ' + Math.round(adv.potOdds * 100) + '%）');
console.log('  面板另有一行参考值「对随机手牌 ' + rawPct + '%」——旧版拿它当判据，');
console.log('  才会出现 ' + rawPct + '% "低于" 35% 这种字面假命题。');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
