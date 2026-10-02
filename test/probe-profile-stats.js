/* ============================================================
 * probe-profile-stats.js — 画像断言的统计功效探针（Node，非验收脚本）
 * probe-profile-stats.js — statistical-power probe for profile assertions (Node, not an acceptance script)
 *
 *   背景：check-profile.js 的断言建立在 Math.random() 合成样本上，
 *   Background: check-profile.js's assertions are built on Math.random() synthetic samples and are
 *   天然是统计性的。批跑时曾偶发红过一次，而单独跑 40 次全过 ——
 *   inherently statistical. During a batch run it once turned red intermittently, while 40 standalone runs all passed —
 *   这正是"测不出 ≠ 不存在"的经典局面。
 *   the classic "not detected ≠ does not exist" situation.
 *
 *   本探针把 check-profile.js 里每条断言的**失败率**实测出来，
 *   This probe measures the **failure rate** of each assertion in check-profile.js,
 *   并给出"阈值离均值几个标准差（σ）"。判据：
 *   and reports "how many standard deviations (σ) the threshold is from the mean". Criteria:
 *     σ < 3  → 断言脆弱，必偶发，需要加大样本或改场景
 *     σ < 3  → fragile assertion, guaranteed to be intermittent; enlarge the sample or change the scenario
 *     σ ≥ 4  → 可接受
 *     σ ≥ 4  → acceptable
 *
 *   注意：这里的"失败"指**断言自身的假失败**（场景倾向明明成立，
 *   Note: "failure" here means a **false failure of the assertion itself** (the scenario tendency clearly holds,
 *   却因采样噪声越界）。若某条断言失败率高是因为画像真的判错，
 *   but sampling noise pushes it out of bounds). If an assertion fails often because the profile truly misjudges,
 *   那是产品 bug —— 探针只负责报告，不负责定性。
 *   that is a product bug — the probe only reports, it does not diagnose.
 *
 *   node test/probe-profile-stats.js [trials]
 *
 *   ⚠ 稀有事件必须用大样本定标：默认 1000 次采样时，可分辨的最小失败率是
 *   ⚠ Rare events must be calibrated with large samples: at the default 1000 samples the smallest resolvable failure rate is
 *     0.1%。若某条断言实测失败率落在 0.1%~0.5% 之间，务必把 trials 提到
 *     0.1%. If a measured failure rate falls between 0.1%~0.5%, be sure to raise trials to
 *     5000+ 再下结论 —— 300 次采样测 0.37% 的真实失败率，可能一次给出 1.0%、
 *     5000+ before drawing conclusions — 300 samples measuring a true 0.37% failure rate might report 1.0% one time
 *     下一次给出 0% ，两种读数都不足以定性（本项目已实际踩过）。
 *     and 0% the next; neither reading is conclusive (this project has actually tripped on this).
 * ============================================================ */
'use strict';
const { synth, SCENARIOS, MONO_FOLDS } = require('./synth-player.js');

const T = parseInt(process.argv[2], 10) || 1000;

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

/* 采样一次得到全部待测量，避免同一场景重复跑 */
/* Sample once to obtain all measurements, avoiding re-running the same scenario */
function sample(cfg) {
  const p = synth(cfg);
  const m = p.metrics(), ex = p.exploit(), lk = p.leaks();
  const ids = lk.map(l => l.id);
  return {
    foldToBet: m.foldToBet, vpip: m.raw.vpip, foldTo3Bet: m.foldTo3Bet,
    riverCall: m.riverCall, betSize: m.betSize,
    bluffBoost: ex.bluffBoost, sizeBoost: ex.sizeBoost, thinValue: ex.thinValue,
    confidence: ex.confidence, callDownBoost: ex.callDownBoost,
    stealBoost: ex.stealBoost, threeBetBluffBoost: ex.threeBetBluffBoost,
    has: id => ids.indexOf(id) >= 0,
    warnCount: lk.filter(l => l.level === 'warn').length,
    ids,
  };
}

/* === 逐个场景收集样本 === */
/* === Collect samples scenario by scenario === */
function collect(cfg) {
  const rows = [];
  for (let i = 0; i < T; i++) rows.push(sample(cfg));
  return rows;
}

/* === 断言登记表：与 check-profile.js 逐条对应 === */
/* === Assertion registry: corresponds one-to-one with check-profile.js === */
/* 场景配置**直接引用** synth-player.js 的预设，不在此另抄一份 ——
   Scenario configs **directly reference** synth-player.js presets instead of being copied here —
   抄一份就会出现"改了验收脚本、探针还在测旧配置"的分叉（本项目已踩过）。
   copying would create a fork where "the acceptance script was changed but the probe still tests the old config" (this project has tripped on this). */
const CFG = {
  g2: SCENARIOS.overFolder,
  g3: SCENARIOS.station,
  g4: SCENARIOS.nit,
  g5: SCENARIOS.loose,
  g6: SCENARIOS.scared3Bet,
  g7: SCENARIOS.riverCaller,
  g8: SCENARIOS.standard,
};

const S = {};
for (const k of Object.keys(CFG)) {
  process.stdout.write('采样 ' + k + ' ... ');
  S[k] = collect(CFG[k]);
  console.log(T + ' 次');
}

/* 单调性场景：每次试验同时给出 3 个弃牌率下的 bluffBoost */
/* Monotonicity scenario: each trial yields bluffBoost at 3 fold rates simultaneously */
const mono = [];
for (let i = 0; i < T; i++) {
  mono.push(MONO_FOLDS.map(r => sample(Object.assign({}, SCENARIOS.monotonic, { foldToBetRate: r })).bluffBoost));
}

/* === 断言清单：name / 场景 / 取值函数 / 是否满足 / 方向描述 === */
/* === Assertion list: name / scenario / value getter / satisfied / direction description === */
const CASES = [
  ['g2', 'm.foldToBet > 0.6', r => r.foldToBet, v => v > 0.6, 'high'],
  ['g2', 'has(foldTooMuch)', r => r.has('foldTooMuch') ? 1 : 0, v => v === 1, 'bool'],
  ['g2', 'bluffBoost > 1.25', r => r.bluffBoost, v => v > 1.25, 'high'],
  ['g2', 'sizeBoost > 1.05', r => r.sizeBoost, v => v > 1.05, 'high'],
  ['g2', 'thinValue < 0.03', r => r.thinValue, v => v < 0.03, 'low'],
  ['g2', 'confidence > 0.9', r => r.confidence, v => v > 0.9, 'high'],
  ['g2', 'cap: bluffBoost<=3.2 && sizeBoost<=1.45', r => (r.bluffBoost <= 3.2 && r.sizeBoost <= 1.45) ? 1 : 0, v => v === 1, 'bool'],

  ['g3', 'm.foldToBet < 0.32', r => r.foldToBet, v => v < 0.32, 'low'],
  ['g3', 'has(callTooMuch)', r => r.has('callTooMuch') ? 1 : 0, v => v === 1, 'bool'],
  ['g3', 'bluffBoost < 0.85', r => r.bluffBoost, v => v < 0.85, 'low'],
  ['g3', 'thinValue > 0.05', r => r.thinValue, v => v > 0.05, 'high'],
  ['g3', 'callDownBoost > 1.0', r => r.callDownBoost, v => v > 1.0, 'high'],
  ['g3', 'bluffBoost >= 0.15', r => r.bluffBoost, v => v >= 0.15, 'low'],

  ['g4', 'm.raw.vpip < 0.17', r => r.vpip, v => v < 0.17, 'low'],
  ['g4', 'has(tooTight)', r => r.has('tooTight') ? 1 : 0, v => v === 1, 'bool'],
  ['g4', 'stealBoost > 1.15', r => r.stealBoost, v => v > 1.15, 'high'],
  ['g4', 'stealBoost <= 2.0', r => r.stealBoost, v => v <= 2.0, 'high'],

  ['g5', 'm.raw.vpip > 0.5', r => r.vpip, v => v > 0.5, 'high'],
  ['g5', 'has(tooLoose)', r => r.has('tooLoose') ? 1 : 0, v => v === 1, 'bool'],
  ['g5', 'stealBoost < 1.0', r => r.stealBoost, v => v < 1.0, 'low'],

  ['g6', 'm.foldTo3Bet > 0.68', r => r.foldTo3Bet, v => v > 0.68, 'high'],
  ['g6', 'has(overFold3Bet)', r => r.has('overFold3Bet') ? 1 : 0, v => v === 1, 'bool'],
  ['g6', 'threeBetBluffBoost > 1.3', r => r.threeBetBluffBoost, v => v > 1.3, 'high'],

  ['g7', 'm.riverCall > 0.56', r => r.riverCall, v => v > 0.56, 'high'],
  ['g7', 'has(riverOverCall)', r => r.has('riverOverCall') ? 1 : 0, v => v === 1, 'bool'],
  ['g7', 'm.betSize > 0.98', r => r.betSize, v => v > 0.98, 'high'],
  ['g7', 'has(bigBetSize)', r => r.has('bigBetSize') ? 1 : 0, v => v === 1, 'bool'],

  ['g8', 'warnings.length === 0', r => r.warnCount, v => v === 0, 'low'],
  ['g8', '|bluffBoost-1| < 0.25', r => Math.abs(r.bluffBoost - 1), v => v < 0.25, 'low'],
  ['g8', '|stealBoost-1| < 0.30', r => Math.abs(r.stealBoost - 1), v => v < 0.30, 'low'],
];

/* 断言阈值表（与 check-profile.js 保持一致，仅用于计算 σ 余量） */
/* Assertion threshold table (kept in sync with check-profile.js; used only to compute the σ margin) */
const THRESHOLD = {
  'm.foldToBet > 0.6': 0.6,
  'bluffBoost > 1.25': 1.25,
  'sizeBoost > 1.05': 1.05,
  'thinValue < 0.03': 0.03,
  'confidence > 0.9': 0.9,
  'm.foldToBet < 0.32': 0.32,
  'bluffBoost < 0.85': 0.85,
  'thinValue > 0.05': 0.05,
  'callDownBoost > 1.0': 1.0,
  'bluffBoost >= 0.15': 0.15,
  'm.raw.vpip < 0.17': 0.17,
  'stealBoost > 1.15': 1.15,
  'stealBoost <= 2.0': 2.0,
  'm.raw.vpip > 0.5': 0.5,
  'stealBoost < 1.0': 1.0,
  'm.foldTo3Bet > 0.68': 0.68,
  'threeBetBluffBoost > 1.3': 1.3,
  'm.riverCall > 0.56': 0.56,
  'm.betSize > 0.98': 0.98,
  'warnings.length === 0': 0,
  '|bluffBoost-1| < 0.25': 0.25,
  '|stealBoost-1| < 0.30': 0.30,
};

console.log('\n' + '='.repeat(78));
console.log('每条断言的假失败率（' + T + ' 次采样；σ 余量 = |阈值−均值| / 标准差）');
console.log('='.repeat(78));
console.log(pad('场景', 5) + pad('断言', 40) + pad('失败率', 9) + pad('均值', 10) + pad('σ 余量', 9) + '判定');
console.log('-'.repeat(78));

let fragile = [];
for (const [g, name, get, test, dir] of CASES) {
  const rows = S[g];
  const vals = rows.map(get);
  const m = mean(vals);
  const s = sd(vals);
  const fails = rows.filter(r => !test(get(r))).length;
  const rate = fails / rows.length;

  /* 判据（两条都要满足才算稳健；任一不满足即列入需关注）：
   * Criteria (both must hold to count as robust; failing either one flags it as needing attention):
   *   a) 实测量失败率 ≤ 0.2%   —— 直接证据，但受采样数分辨率限制
   *   a) Measured failure rate ≤ 0.2%   —— direct evidence, but limited by the sample-size resolution
   *   b) 连续量的 σ 余量 ≥ 4   —— 结构性证据，不依赖本次采样是否恰好命中
   *   b) σ margin ≥ 4 for continuous quantities   —— structural evidence, independent of whether this run happened to hit it
   * 为什么两条都留：小样本下 a) 可能恰好为 0（漏报），而 σ 余量能提前预警；
   * Why keep both: with small samples a) may happen to be 0 (missed detection), while the σ margin warns in advance;
   * 反之 σ 余量算不准时（分布偏态、二值量），a) 是兜底。
   * conversely, when the σ margin is miscalculated (skewed distribution, binary quantity), a) is the fallback. */
  let marginTxt = '—', verdict = '✓ 稳健';
  let zMargin = null;
  if (dir !== 'bool' && s > 1e-12) {
    const thr = THRESHOLD[name];
    zMargin = Math.abs(thr - m) / s;
    marginTxt = zMargin.toFixed(1) + 'σ';
  } else if (dir === 'bool') {
    marginTxt = (rate * 100).toFixed(1) + '% 不出现';
  }
  const rateBad = rate > 0.002;
  const zBad = zMargin !== null && zMargin < 4;
  if (rateBad || zBad) {
    verdict = zBad && !rateBad ? (zMargin < 3 ? '⚠ 余量不足' : '△ 偏紧') : '⚠ 脆弱';
  }

  const line = pad(g, 5) + pad(name, 40) + pad((rate * 100).toFixed(2) + '%', 9)
    + pad(m.toFixed(4), 10) + pad(marginTxt, 9) + verdict;
  console.log(line);
  if (verdict.indexOf('✓') < 0) fragile.push({ g, name, rate, m, s, verdict });
}

/* 单调性单独判 */
/* Evaluate monotonicity separately */
{
  const bad = mono.filter(([a, b, c]) => !(a < b && b < c)).length;
  const rate = bad / mono.length;
  const minGap = Math.min.apply(null, mono.map(([a, b, c]) => Math.min(b - a, c - b)));
  console.log(pad('g9', 5) + pad('b20 < b45 < b70', 40) + pad((rate * 100).toFixed(2) + '%', 9)
    + pad('min间隙' + minGap.toFixed(3), 19) + (rate > 0.002 ? '⚠ 脆弱' : '✓ 稳健'));
  if (rate > 0.002) fragile.push({ g: 'g9', name: 'monotonic', rate, verdict: '⚠ 脆弱' });
}

console.log('-'.repeat(78));
/* 单次运行的整体报红概率：按"同一试验序号"聚合所有断言的成败，直接数有多少次采样
   Overall probability of any red on a single run: aggregate the pass/fail of all assertions by "the same trial index" and directly count
   会至少让一条断言失败。比 1−Π(1−p) 更准，因为同组内断言高度相关。
   how many samples make at least one assertion fail. More accurate than 1−Π(1−p), since assertions within a group are highly correlated. */
{
  let badTrials = 0;
  for (let i = 0; i < T; i++) {
    let anyFail = mono[i][0] >= mono[i][1] || mono[i][1] >= mono[i][2];
    if (!anyFail) {
      for (const [g, name, get, test] of CASES) {
        if (!test(get(S[g][i]))) { anyFail = true; break; }
      }
    }
    if (anyFail) badTrials++;
  }
  console.log('单次运行 check-profile.js 的假失败概率 ≈ ' + (badTrials / T * 100).toFixed(2) +
    '%（' + badTrials + ' / ' + T + '）');
}
console.log('\n需关注的脆弱断言：' + (fragile.length ? '' : '（无）'));
fragile.forEach(f => console.log('  · [' + f.g + '] ' + f.name + '  失败率 ' + (f.rate * 100).toFixed(2) + '%  ' + f.verdict));
if (fragile.length) process.exit(1);

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
