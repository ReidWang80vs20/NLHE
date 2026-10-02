/* ============================================================
 * check-profile.js — 玩家漏洞画像自检（Node）
 * check-profile.js — player leak profile self-check (Node)
 *   重点验证两件事：
 *   Two things are verified in particular:
 *     1. 合成出"弃牌太多 / 跟注太多 / 太紧 / 怕 3-bet"的玩家后，
 *     1. After synthesizing a player who "folds too much / calls too much / is too tight / fears 3-bets,"
 *        画像要能指向正确的漏洞，并给出正确方向的剥削权重；
 *        the profile must point to the right leak and give exploitation weights in the right direction;
 *     2. **样本不足时必须完全不调整**（这是防止 AI 乱打的关键红线）。
 *     2. **With insufficient sample it must not adjust at all** (the key red line preventing the AI from playing wildly).
 *   node test/check-profile.js
 * ============================================================ */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'profile.js'));
const PK = globalThis.PK;
const P = PK.Profile;
/* 合成玩家生成器抽到 synth-player.js —— 与 probe-profile-stats.js 共用同一份，
 * The synthetic player generator is extracted to synth-player.js — shared with probe-profile-stats.js,
   否则探针测的就不是被测对象（统计性断言必须能反复采样才可定标）。
 * otherwise the probe would measure something other than the object under test (statistical assertions can only be calibrated with repeatable sampling). */
const { synth, SCENARIOS, MONO_FOLDS } = require('./synth-player.js');

let pass = 0, fail = 0;
const bad = [];
let gName = '', gPass = 0, gFail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; gPass++; }
  else { fail++; gFail++; bad.push('[' + gName + '] ' + name + (extra ? '  → ' + extra : '')); }
}
function group(t) {
  if (gName) console.log('   ' + (gFail ? '✗ ' + gFail + ' 项失败' : '✓ ' + gPass + ' 项通过'));
  gName = t; gPass = 0; gFail = 0;
  console.log('\n── ' + t);
}
const has = (leaks, id) => leaks.some(l => l.id === id);

/* synth() 见 test/synth-player.js
 * See synth() in test/synth-player.js */


/* ============ 1. 样本不足必须完全不调整 ============
 * ============ 1. Insufficient sample must mean zero adjustment ============ */
group('1. 样本不足 → 零调整（防噪声红线）');
{
  const p = P.create();
  for (let h = 0; h < 6; h++) {
    p.startHand();
    p.markPreflop({ invested: true, aggressive: true });
    p.observe({ street: 'preflop', action: 'raise', toCall: 2, pot: 3, invested: 6, raiseCount: 1 });
    for (const st of ['flop', 'turn', 'river']) {
      p.observe({ street: st, action: 'fold', toCall: 10, pot: 20, invested: 0, raiseCount: 0 });
    }
    p.endHand({ sawFlop: true });
  }
  const ex = p.exploit();
  ok(ex.confidence === 0, '6 手后置信度为 0', String(ex.confidence));
  ok(ex.bluffBoost === 1, '6 手后不提高诈唬（bluffBoost = 1）', String(ex.bluffBoost));
  ok(ex.stealBoost === 1 && ex.threeBetBluffBoost === 1, '偷盲 / 3-bet 权重均为 1');
  ok(p.leaks().length === 0, '6 手后不输出任何漏洞结论', p.leaks().map(l => l.id).join(','));
  ok(/还在观察/.test(p.summary().text), '摘要提示"还在观察"', p.summary().text);
}

/* ============ 2. 弃牌太多的玩家 → AI 应该多诈唬 ============
 * ============ 2. A player who folds too much → the AI should bluff more ============ */
group('2. 你老弃牌 → 对手多诈唬');
{
  const p = synth(SCENARIOS.overFolder);
  const m = p.metrics(), ex = p.exploit(), lk = p.leaks();
  ok(m.foldToBet > 0.6, '画像正确识别出弃牌率高', (m.foldToBet * 100).toFixed(0) + '%');
  ok(has(lk, 'foldTooMuch'), '漏洞清单含 foldTooMuch', lk.map(l => l.id).join(','));
  ok(ex.bluffBoost > 1.25, 'AI 提高诈唬频率', 'bluffBoost=' + ex.bluffBoost.toFixed(2));
  ok(ex.sizeBoost > 1.05, 'AI 放大下注尺度', 'sizeBoost=' + ex.sizeBoost.toFixed(2));
  ok(ex.thinValue < 0.03, '爱弃牌的对手不需要薄价值下注', 'thinValue=' + ex.thinValue.toFixed(3));
  ok(ex.confidence > 0.9, '高样本下置信度接近满值', ex.confidence.toFixed(2));
  ok(ex.bluffBoost <= 3.2 && ex.sizeBoost <= 1.45, '剥削权重有上限，不会失控');
}

/* ============ 3. 跟注站 → AI 应该砍诈唬、加薄价值 ============
 * ============ 3. Calling station → the AI should cut bluffs and add thin value ============ */
group('3. 你什么牌都跟 → 对手砍诈唬、改薄价值');
{
  const p = synth(SCENARIOS.station);
  const m = p.metrics(), ex = p.exploit(), lk = p.leaks();
  ok(m.foldToBet < 0.32, '画像识别出弃牌率过低', (m.foldToBet * 100).toFixed(0) + '%');
  ok(has(lk, 'callTooMuch'), '漏洞清单含 callTooMuch', lk.map(l => l.id).join(','));
  ok(ex.bluffBoost < 0.85, 'AI 砍掉诈唬', 'bluffBoost=' + ex.bluffBoost.toFixed(2));
  ok(ex.thinValue > 0.05, 'AI 增加薄价值下注（thinValue > 0）', 'thinValue=' + ex.thinValue.toFixed(3));
  ok(ex.callDownBoost > 1.0, 'AI 更愿意跟我们的下注到底', 'callDownBoost=' + ex.callDownBoost.toFixed(2));
  ok(ex.bluffBoost >= 0.15, '诈唬权重有下限，不会归零');
}

/* ============ 4. 太紧的玩家 → 对手多偷盲 ============
 * ============ 4. Too tight a player → opponents steal blinds more ============ */
group('4. 你太紧 → 对手多偷盲');
{
  const p = synth(SCENARIOS.nit);
  const m = p.metrics(), ex = p.exploit(), lk = p.leaks();
  ok(m.raw.vpip < 0.17, '画像识别出 VPIP 过低', (m.raw.vpip * 100).toFixed(0) + '%');
  ok(has(lk, 'tooTight'), '漏洞清单含 tooTight', lk.map(l => l.id).join(','));
  ok(ex.stealBoost > 1.15, 'AI 提高偷盲强度', 'stealBoost=' + ex.stealBoost.toFixed(2));
  ok(ex.stealBoost <= 2.0, '偷盲权重有上限');
}

/* ============ 5. 太松的玩家 → 对手收紧 ============
 * ============ 5. Too loose a player → opponents tighten up ============ */
group('5. 你太松 → 对手收紧偷盲');
{
  const p = synth(SCENARIOS.loose);
  const m = p.metrics(), ex = p.exploit(), lk = p.leaks();
  ok(m.raw.vpip > 0.5, '画像识别出 VPIP 过高', (m.raw.vpip * 100).toFixed(0) + '%');
  ok(has(lk, 'tooLoose'), '漏洞清单含 tooLoose', lk.map(l => l.id).join(','));
  ok(ex.stealBoost < 1.0, 'AI 降低偷盲强度（不必偷太多）', 'stealBoost=' + ex.stealBoost.toFixed(2));
}

/* ============ 6. 怕 3-bet 的玩家 ============
 * ============ 6. A player afraid of 3-bets ============ */
group('6. 你怕 3-bet → 对手多 3-bet 诈唬');
{
  const p = synth(SCENARIOS.scared3Bet);
  const m = p.metrics(), ex = p.exploit(), lk = p.leaks();
  ok(m.foldTo3Bet > 0.68, '画像识别出面对 3-bet 弃牌过多', (m.foldTo3Bet * 100).toFixed(0) + '%');
  ok(has(lk, 'overFold3Bet'), '漏洞清单含 overFold3Bet', lk.map(l => l.id).join(','));
  ok(ex.threeBetBluffBoost > 1.3, 'AI 提高 3-bet 诈唬频率', 'threeBetBluffBoost=' + ex.threeBetBluffBoost.toFixed(2));
}

/* ============ 7. 河牌跟注过多 + 下注尺度过大 ============
 * ============ 7. Over-calling the river + oversized bets ============ */
group('7. 河牌跟太多 / 尺度太大');
{
  const p = synth(SCENARIOS.riverCaller);
  const m = p.metrics(), lk = p.leaks();
  ok(m.riverCall > 0.56, '画像识别出河牌跟注过多', (m.riverCall * 100).toFixed(0) + '%');
  ok(has(lk, 'riverOverCall'), '漏洞清单含 riverOverCall', lk.map(l => l.id).join(','));
  ok(m.betSize > 0.98, '画像识别出下注尺度偏大', m.betSize.toFixed(2));
  ok(has(lk, 'bigBetSize'), '漏洞清单含 bigBetSize', lk.map(l => l.id).join(','));
}

/* ============ 8. 标准玩家 → 不产生漏洞 ============
 * ============ 8. A standard player → no leaks are produced ============ */
group('8. 标准紧凶 → 不该报出漏洞');
{
  /* 河牌跟注率不显式给出 → 由 1 − 弃牌率推出，三条街口径一致才是真正"标准"。
   * The river call rate is not given explicitly → it is derived from 1 − fold rate; only a metric consistent across all three streets is truly "standard".
   *
   * ⚠ 为什么是 1600 手而不是 500（别调回去）：
   * ⚠ Why 1600 hands instead of 500 (do not change it back):
   *   本组是**零容差**断言（warnings.length === 0），却建立在随机合成样本上，
   *   This group is a **zero-tolerance** assertion (warnings.length === 0), yet it rests on random synthetic samples,
   *   实际是"整条测试里唯一会偶发假红的一条"。实测（6000 次采样）：
   *   and is in fact "the only one in the whole suite that can spuriously flash red." Measured (6000 samples):
   *     hands= 500 → 假失败 0.367%，riverCall 距 warn 线仅 2.9σ、foldTo3Bet 3.1σ
   *     hands= 500 → false failure 0.367%, riverCall only 2.9σ from the warn line, foldTo3Bet 3.1σ
   *     hands= 800 → 0.067%（3.3σ / 3.6σ）
   *     hands= 800 → 0.067% (3.3σ / 3.6σ)
   *     hands=1200 → 0.000%（3.9σ / 4.2σ）
   *     hands=1200 → 0.000% (3.9σ / 4.2σ)
   *     hands=1600 → 0.000%（4.3σ / 4.9σ）← 取此档
   *     hands=1600 → 0.000% (4.3σ / 4.9σ) ← the chosen setting
   *   触发机理：标准玩家 riverCall 真值 0.417 / warn 线 0.56，
   *   Mechanism: for a standard player the true riverCall is 0.417 vs the warn line 0.56,
   *   foldTo3Bet 真值 0.520 / warn 线 0.68，样本比例偶然越线即被报漏洞。
   *   foldTo3Bet true value 0.520 vs the warn line 0.68; a sample proportion that strays over the line is reported as a leak.
   *   300 次采样下曾误读成 1.00%（3/300），那是稀有事件的估计误差 ——
   *   Under 300 samples it was once misread as 1.00% (3/300) — that is estimation error for a rare event,
   *   稀有事件的定标必须用大样本，别用小样本反复"确认"。
   *   calibrating a rare event requires large samples; do not use small samples to repeatedly "confirm" things.
   *   修法是**加样本**（σ ∝ 1/√n），不是放宽断言或加 ± 余量。
   *   The fix is to **add samples** (σ ∝ 1/√n), not to loosen the assertion or add a ± margin. */
  const p = synth(SCENARIOS.standard);
  const lk = p.leaks(), ex = p.exploit();
  const warnings = lk.filter(l => l.level === 'warn');
  ok(warnings.length === 0, '标准打法下不产生警告级漏洞', warnings.map(l => l.id).join(',') || '（无）');
  ok(Math.abs(ex.bluffBoost - 1) < 0.25, '标准打法下诈唬权重接近 1', ex.bluffBoost.toFixed(2));
  ok(Math.abs(ex.stealBoost - 1) < 0.30, '标准打法下偷盲权重接近 1', ex.stealBoost.toFixed(2));
}

/* ============ 9. 单调性：越爱弃牌，诈唬权重越高 ============
 * ============ 9. Monotonicity: the more one folds, the higher the bluff weight ============ */
group('9. 单调性（关键的"有道理"检验）');
{
  /* 只扫弃牌率这一个变量，其余固定 —— 否则测的不是"单调性"而是多个变量混在一起的净效果
   * Only the fold rate is swept; everything else is fixed — otherwise this tests a net effect of several mixed variables, not "monotonicity" */
  const mk = (r) => synth(Object.assign({}, SCENARIOS.monotonic, { foldToBetRate: r })).exploit().bluffBoost;
  const b20 = mk(MONO_FOLDS[0]), b45 = mk(MONO_FOLDS[1]), b70 = mk(MONO_FOLDS[2]);
  ok(b20 < b45 && b45 < b70, '弃牌率越高 → 诈唬权重单调越高',
    [b20, b45, b70].map(x => x.toFixed(2)).join(' < '));
}

/* ============ 10. 映射到心算题库主题 ============
 * ============ 10. Mapping to mental-math drill topics ============ */
group('10. 漏洞 → 心算主题映射');
{
  /* 复用组 2 的"弃牌过多"场景 —— 本组关心的是**映射**，不是场景配置。
   * Reuses the "folds too much" scenario from group 2 — this group cares about the **mapping**, not the scenario config.
     原先在这里另写一份近似配置（fold 0.8 / riverCall 0.2）且连调两次 synth，
   * Originally a near-duplicate config (fold 0.8 / riverCall 0.2) was written here and synth was called twice,
     既多一份会分叉的定义、又白跑一遍 400 手（同一断言重复取数）。
   * adding a divergent definition and wasting a 400-hand run (re-sampling for the same assertion). */
  const lk = synth(SCENARIOS.overFolder).leaks();
  const fm = lk.find(l => l.id === 'foldTooMuch');
  ok(!!fm, 'foldTooMuch 可复现', lk.map(l => l.id).join(','));
  ok(fm && fm.topics.includes('s3_req'), 'foldTooMuch 映射到 s3_req（所需最低胜率）',
    fm ? fm.topics.join(',') : '');
  for (const k of Object.keys(P.TOPIC_FOR)) {
    ok(P.TOPIC_FOR[k].length > 0, '每个漏洞都配了练习主题：' + k);
  }
}

/* ============ 11. 持久化往返 ============
 * ============ 11. Persistence round-trip ============ */
group('11. 存档往返');
{
  const a = synth({ hands: 120, vpipRate: 0.4, foldToBetRate: 0.7, foldTo3BetRate: 0.6, riverCallRate: 0.5, wtsdRate: 0.35 });
  const b = P.create();
  b.stats = JSON.parse(JSON.stringify(a.stats));
  ok(b.metrics().opp.hands === a.metrics().opp.hands, '手数一致',
    b.metrics().opp.hands + ' vs ' + a.metrics().opp.hands);
  ok(Math.abs(b.exploit().bluffBoost - a.exploit().bluffBoost) < 1e-9, '剥削权重一致',
    b.exploit().bluffBoost.toFixed(4));
  ok(b.leaks().length === a.leaks().length, '漏洞数量一致');
}

if (gName) console.log('   ' + (gFail ? '✗ ' + gFail + ' 项失败' : '✓ ' + gPass + ' 项通过'));
console.log('\n' + '─'.repeat(56));
if (fail) {
  console.log('❌ 失败 ' + fail + ' 项：');
  bad.forEach(b => console.log('   · ' + b));
} else {
  console.log('✅ 全部通过：' + pass + ' 项断言');
}
console.log('─'.repeat(56));
process.exit(fail ? 1 : 0);
