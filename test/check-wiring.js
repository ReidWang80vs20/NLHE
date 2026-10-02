/* ============================================================
 * check-wiring.js — 「B 组：会记住你漏洞的针对性 AI」端到端接线自检
 * check-wiring.js — end-to-end wiring self-check for "Group B: a targeted AI that remembers your leaks"
 *
 * 背景：range.js 与 profile.js 曾经既不在 index.html 的脚本列表里、
 * Background: range.js and profile.js were once neither in index.html's script list
 *       也不在 build.js 的 JS_ORDER 里 —— 于是应用运行时 PK.Range /
 *       nor in build.js's JS_ORDER — so at runtime PK.Range /
 *       PK.Profile 全是 undefined：极化 3-bet 从不触发，exploitEnv()
 *       PK.Profile were all undefined: the polarized 3-bet never fired and exploitEnv()
 *       永远返回中性值。功能"写好了"但整条链路是断的，而且不报错。
 *       always returned neutral values. The feature was "written" but the whole chain was broken, silently.
 *       本文件把这条链路钉死。
 *       This file pins that chain down.
 *
 *   node test/check-wiring.js
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? '  → ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');

/* ============================================================
 * A. 加载顺序（静态检查）
 * A. Load order (static check)
 *    这一节专门防"文件写好了却没被加载"这类静默失效。
 *    This section specifically guards against silent failures such as "the file was written but never loaded."
 * ============================================================ */
console.log('\n── A. 加载顺序（index.html / build.js）');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const tagIdx = {};
  for (const f of ['poker.js', 'equity.js', 'range.js', 'profile.js', 'ai.js']) {
    tagIdx[f] = html.indexOf('src/' + f);
    ok(tagIdx[f] >= 0, 'index.html 引入了 ' + f, '未找到 <script src="src/' + f + '">');
  }
  ok(tagIdx['range.js'] >= 0 && tagIdx['range.js'] < tagIdx['ai.js'],
    'index.html 中 range.js 排在 ai.js 之前（AI 的开池范围换算依赖它）');
  ok(tagIdx['profile.js'] >= 0 && tagIdx['profile.js'] < tagIdx['ai.js'],
    'index.html 中 profile.js 排在 ai.js 之前（AI 运行时读 PK.Profile）');
  ok(tagIdx['equity.js'] < tagIdx['range.js'],
    'index.html 中 equity.js 排在 range.js 之前（range 依赖 pct2/holeKey）');

  const build = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
  const m = /JS_ORDER\s*=\s*\[([\s\S]*?)\]/.exec(build);
  ok(!!m, 'build.js 中存在 JS_ORDER');
  if (m) {
    const order = m[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
    const at = f => order.indexOf(f);
    ok(at('range.js') >= 0, 'build.js JS_ORDER 含 range.js', order.join(','));
    ok(at('profile.js') >= 0, 'build.js JS_ORDER 含 profile.js', order.join(','));
    ok(at('range.js') >= 0 && at('range.js') < at('ai.js'),
      'build.js 中 range.js 排在 ai.js 之前');
    ok(at('profile.js') >= 0 && at('profile.js') < at('ai.js'),
      'build.js 中 profile.js 排在 ai.js 之前');
    ok(at('poker.js') < at('equity.js') && at('equity.js') < at('range.js'),
      'build.js 依赖顺序 poker → equity → range 成立');
  }
}

/* ============================================================
 * B. 按应用的顺序加载模块（与 index.html / build.js 一致）
 * B. Load modules in the application's order (matching index.html / build.js)
 * ============================================================ */
console.log('\n── B. 模块可用性');
[
  'poker.js', 'equity.js', 'range.js', 'profile.js', 'ai.js', 'engine.js',
].forEach(f => require(path.join(ROOT, 'src', f)));
const PK = globalThis.PK;

ok(!!PK.Range, 'PK.Range 可用');
ok(!!PK.Profile, 'PK.Profile 可用');
ok(PK.Range && typeof PK.Range.classPctForCombos === 'function',
  'PK.Range.classPctForCombos 可用（范围口径换算）');
ok(PK.Range && PK.Range.BLUFF_3BET instanceof Set,
  'PK.Range.BLUFF_3BET 可用（极化 3-bet 诈唬依赖它）');

/* 范围表是"手牌组合占比"，必须换算成类别百分位；换算后实际覆盖的组合占比
 * The range table is given as "fraction of hand combos" and must be converted to a class percentile; the actually-covered combo fraction after conversion
   应当回到表里写的那个数（否则说明换算没生效，AI 会按偏紧的范围开池）。
 * should match the number written in the table (otherwise the conversion is not in effect and the AI opens too tight). */
{
  const tag = PK.STYLES.tag;
  const rUtg = PK.openRangeFor(5, tag);
  const rBtn = PK.openRangeFor(2, tag);
  const cUtg = PK.Range.combosForClassPct(rUtg);
  const cBtn = PK.Range.combosForClassPct(rBtn);
  ok(Math.abs(cUtg - 0.12) < 0.025, '枪口位换算后实际覆盖约 12% 的手牌',
    (cUtg * 100).toFixed(1) + '%');
  ok(Math.abs(cBtn - 0.42) < 0.05, '按钮位换算后实际覆盖约 42% 的手牌',
    (cBtn * 100).toFixed(1) + '%');
  ok(rBtn > rUtg * 2, '按钮位开池范围明显宽于枪口位（位置效应生效）',
    (cUtg * 100).toFixed(1) + '% vs ' + (cBtn * 100).toFixed(1) + '%');
}

/* ============================================================
 * C. 引擎接线：打一段真实牌局，看画像有没有被喂进数据
 * C. Engine wiring: play a run of real hands and see whether the profile is being fed data
 * ============================================================ */
const HANDS = parseInt(process.argv[2] || '320', 10);
const HERO_OPEN = 0.20;          // 英雄翻前入池门槛（明显偏紧：只用前 20% 的类别进池）
                                 // EN: Hero's preflop entry threshold (clearly tight: only the top 20% of classes enter the pot)
/* ⚠️ 门槛要留出余量。曾经是 0.32，实测同一份代码两次运行的 VPIP 分别是
 * ⚠️ The threshold needs margin. It used to be 0.32, and the same code measured VPIP of
   21.6% 与 29.4% —— 恰好横跨基准 28%，于是"英雄偏紧 → 多偷盲"这条断言
 * 21.6% and 29.4% across two runs — straddling the 28% baseline, so the assertion "hero is tight → steal more"
   时通时不通（AI 拿不到"你偏紧"的证据时 stealBoost≈1 是**正确**行为）。
 * passed only sometimes (with no evidence that "you are tight", stealBoost≈1 is **correct** behavior).
   脚本英雄的 VPIP 受牌运摆布，门槛必须选到让结论远离基准。
 * The scripted hero's VPIP is at the mercy of card luck, so the threshold must keep the conclusion away from the baseline. */
const HERO_POSTFOLDFOLD = true;  // 英雄翻后面对下注一律弃牌 → 制造 foldTooMuch
                                 // EN: Hero always folds to any postflop bet → manufactures foldTooMuch

/** 脚本化的英雄策略：紧、且翻后一被下注就弃牌
 * Scripted hero policy: tight, and folds to any postflop bet */
function heroPolicy(sim) {
  const hero = sim.players[0];
  const toCall = Math.max(0, sim.currentBet - hero.bet);
  if (sim.street === 'preflop') {
    if (toCall === 0) return { action: 'check' };
    const pct = PK.pct2(hero.hole[0], hero.hole[1]);
    if (pct < HERO_OPEN) return { action: 'call' };
    return { action: 'fold' };
  }
  if (toCall === 0) return { action: 'check' };
  return HERO_POSTFOLDFOLD ? { action: 'fold' } : { action: 'call' };
}

function playHands(n, styleKeys) {
  return new Promise(resolve => {
    PK.Profile.reset();
    const sim = new PK.Game({ seats: 6, bb: 2, sb: 1, startStack: 200, aiSpeed: 0, dealDelay: 0 });
    sim._delay = () => Promise.resolve();
    sim.players.forEach((p, i) => {
      p.isHero = (i === 0);
      p.style = PK.STYLES[styleKeys[i % styleKeys.length]];
    });

    let done = 0;
    sim.on('hero-turn', () => {
      /* 必须延到下一轮事件循环：emit 之后 _loop 才会调用 _waitHero 设置
       * Must be deferred to the next event-loop tick: only after emit does _loop call _waitHero to set
         this._heroResolve，同步调用 heroAct 会因为 resolve 还没挂上而卡死。
       * this._heroResolve; calling heroAct synchronously would hang because the resolve handler is not attached yet. */
      setTimeout(() => {
        if (!sim.canHeroAct()) return;
        const d = heroPolicy(sim);
        if (!sim.heroAct(d.action, d.amount)) {
          /* 兜底：动作非法就选一个合法的，避免整局卡住
           * Fallback: if the action is illegal pick a legal one, to avoid stalling the whole match */
          const toCall = Math.max(0, sim.currentBet - sim.players[0].bet);
          sim.heroAct(toCall > 0 ? 'call' : 'check');
        }
      }, 0);
    });
    sim.on('hand-end', () => {
      done++;
      if (done < n) sim.newHand(); else resolve(sim);
    });
    sim.newHand();
  });
}

(async function () {
  console.log('\n── C. 引擎接线（脚本化英雄：紧 + 翻后见注就弃，' + HANDS + ' 手）');
  const MIX = ['tag', 'lag', 'calling', 'tag', 'rock'];
  await playHands(HANDS, MIX);

  const S = PK.Profile.stats;
  const m = PK.Profile.metrics();

  ok(S.hands === HANDS, '画像手数与实际手数一致（' + HANDS + '）', String(S.hands));
  ok(S.vpip > 0, 'VPIP 分母/分子有被记录', 'vpip=' + S.vpip);
  ok(S.vpip <= S.hands, 'VPIP 不会超过总手数', S.vpip + '/' + S.hands);
  ok(S.hands > 0 && S.vpip / S.hands > 0.10 && S.vpip / S.hands < 0.50,
    '入池率落在脚本策略的合理范围内（10%~50%）',
    (S.vpip / S.hands * 100).toFixed(1) + '%');

  ok(S.sawFlop > 0, '看到了翻牌的牌局被记录', 'sawFlop=' + S.sawFlop);
  ok(S.sawShowdown > 0, '英雄摊牌的牌局被记录', 'sawShowdown=' + S.sawShowdown);
  /* ★ 这条是最关键的口径断言：曾被 diag-style.js 写反，导致 WTSD 能超过 100%
   * ★ This is the most critical metric-definition assertion: it was once inverted in diag-style.js, letting WTSD exceed 100% */
  ok(S.sawShowdown <= S.sawFlop,
    '【口径】英雄摊牌数 ≤ 看翻牌数（比值不可能 >100%）',
    S.sawShowdown + ' vs ' + S.sawFlop);
  ok(m.wtsd >= 0 && m.wtsd <= 1, 'WTSD 落在 0~100%', (m.wtsd * 100).toFixed(1) + '%');

  const faced = S.faced.flop.opp + S.faced.turn.opp + S.faced.river.opp;
  ok(faced > 0, '翻后"面对下注"的机会被记录', 'faced=' + faced);
  console.log('     诊断：各街面对下注 ' +
    [S.faced.flop.opp, S.faced.turn.opp, S.faced.river.opp].join('/') +
    '（翻牌/转牌/河牌），看翻牌 ' + S.sawFlop + ' 手');
  /* ⚠️ 这里**不**断言"翻牌 ≥ 转牌 ≥ 河牌"。那条看着顺理成章，其实不成立：
   * ⚠️ We deliberately do **not** assert "flop ≥ turn ≥ river". It looks obvious but does not hold:
     某一街可以全体过牌（面对下注 0 次），下一街有人下注，次数反而上升 ——
   * a whole street can be checked through (0 bets faced), then the next street has a bet, so the count rises —
     实测出现过 44/4/5。要断言逐街递减，得先逐街记录"到达该街"的次数，
   * 44/4/5 was observed in practice. To assert a street-by-street decrease one must first record "reached that street" per street,
     画像目前没有这个计数。下面只断言真正能推出的事实。
   * and the profile currently has no such counter. Below we only assert what truly follows. */
  ok(S.faced.flop.opp <= S.sawFlop,
    '【口径】翻牌面对下注次数 ≤ 看翻牌手数（没看翻牌不可能在翻牌面对下注）',
    S.faced.flop.opp + ' ≤ ' + S.sawFlop);
  ok(S.faced.turn.opp <= S.sawFlop && S.faced.river.opp <= S.sawFlop,
    '【口径】转牌/河牌面对下注次数同样不超过看翻牌手数',
    [S.faced.flop.opp, S.faced.turn.opp, S.faced.river.opp].join('/') + ' ≤ ' + S.sawFlop);
  /* 河牌的两个计数器用同一个条件（street==='river' && toCall>0）递增，
   * The two river counters are incremented under the same condition (street==='river' && toCall>0),
     所以必须完全相等 —— 这条把"同一件事只有一个定义"钉在测试里。
   * so they must be exactly equal — this pins "one and only one definition per thing" into the test. */
  ok(S.faced.river.opp === S.riverCallOpp,
    '【口径】河牌"面对下注"次数 = 河牌跟注机会数（同一定义，必须相等）',
    S.faced.river.opp + ' vs ' + S.riverCallOpp);
  ok(S.riverCall <= S.riverCallOpp,
    '【口径】河牌跟注数 ≤ 河牌跟注机会数', S.riverCall + '/' + S.riverCallOpp);

  /* ============================================================
   * D. 剥削权重真的被推导出来，且方向正确
   * D. The exploitation weights are really derived, and in the right direction
   * ============================================================ */
  console.log('\n── D. 剥削权重（英雄爱弃牌 → AI 应当更爱诈唬）');
  const ex = PK.Profile.exploit();
  ok(ex.confidence > 0, '样本足够，剥削置信度 > 0（未退化成中性）',
    'confidence=' + ex.confidence.toFixed(2));
  ok(m.foldToBet > PK.Profile.BASE.foldToBet,
    '英雄的"面对下注弃牌率"确实高于基准（脚本策略生效）',
    (m.foldToBet * 100).toFixed(1) + '% vs 基准 ' + (PK.Profile.BASE.foldToBet * 100) + '%');
  ok(ex.bluffBoost > 1, 'AI 提高了诈唬频率（bluffBoost > 1）', ex.bluffBoost.toFixed(2));
  /* 先验前提：脚本英雄必须**确实**偏紧，否则下面那条断言是空转的 ——
   * Precondition: the scripted hero must **actually** be tight, or the assertion below runs in a vacuum —
     VPIP 正好落在基准附近时 stealBoost≈1 才是正确行为，不是 bug。
   * when VPIP sits right around the baseline, stealBoost≈1 is correct behavior, not a bug. */
  console.log('     诊断：英雄 VPIP ' + (m.raw.vpip * 100).toFixed(1) + '% vs 基准 ' +
    (PK.Profile.BASE.vpip * 100) + '%，证据 ' +
    PK.Profile.evidence(S.vpip, S.hands, PK.Profile.BASE.vpip).toFixed(3) +
    '（脚本门槛 pct2<' + HERO_OPEN + '）');
  ok(m.raw.vpip < PK.Profile.BASE.vpip - 0.02,
    '【前提】脚本英雄的 VPIP 明显低于基准（保证偷盲断言非空洞）',
    (m.raw.vpip * 100).toFixed(1) + '% vs ' + (PK.Profile.BASE.vpip * 100) + '%');
  ok(ex.stealBoost > 1, '英雄偏紧 → AI 加大了后位偷盲（stealBoost > 1）',
    ex.stealBoost.toFixed(2));
  ok(ex.sizeBoost >= 1, '爱弃牌的对手面前下注尺度不缩小', ex.sizeBoost.toFixed(2));

  const leaks = PK.Profile.leaks();
  ok(leaks.length > 0, '漏洞列表非空', leaks.length + ' 条');
  ok(leaks.some(l => l.id === 'foldTooMuch'), '识别出 foldTooMuch 漏洞',
    leaks.map(l => l.id).join(','));
  ok(leaks.every(l => l.z === null || Math.abs(l.z) >= PK.Profile.Z_REPORT),
    '所有带 z 的漏洞都达到了显著性门槛 |z| >= ' + PK.Profile.Z_REPORT);

  /* ============================================================
   * E. AI 决策层真的吃到了这份权重（行为差异，而不只是字段存在）
   * E. The AI decision layer really consumes this weight (a behavioral difference, not just a field existing)
   * ============================================================ */
  console.log('\n── E. 决策行为差异（中性 vs 剥削）');
  ok(PK.exploitEnv().bluffBoost === ex.bluffBoost,
    'ai.js 的 exploitEnv() 读到的就是画像算出的权重');

  /* 造一个"AI 拿着空气牌、翻牌圈无人下注"的局面，采样看它下注（诈唬）的频率
   * Construct a situation where "the AI holds air and nobody bet on the flop", then sample how often it bets (bluffs) */
  function bluffRate(exWeights, samples) {
    const c1 = PK.parseCard('Ts'), c2 = PK.parseCard('9s');
    const ctx = {
      G: {
        cfg: { bb: 2, sb: 1 }, street: 'flop', pot: 20, currentBet: 0,
        raiseCount: 0, lastRaiseSize: 2, players: [],
        board: [PK.parseCard('Ah'), PK.parseCard('7d'), PK.parseCard('2c')],
      },
      me: { seat: 0, hole: [c1, c2], bet: 0, stack: 180 },
      style: PK.STYLES.tag, street: 'flop', nOpp: 1, toCall: 0, pot: 20,
      equity: 0.22, pct: 0.5, key: 'T9s', posFrac: 0.5,
      raiseCount: 0, behind: 0, isPair: false, isSuited: true, tier: 0, ex: exWeights,
    };
    let bets = 0;
    for (let i = 0; i < samples; i++) {
      const d = PK.coreDecide(ctx);
      if (d.action === 'raise' || d.action === 'allin') bets++;
    }
    return bets / samples;
  }

  const rNeutral = bluffRate(PK.NEUTRAL_EX, 6000);
  const rExploit = bluffRate(ex, 6000);
  ok(rExploit > rNeutral * 1.4,
    '同样的空气牌，开启剥削后的下注频率显著更高（AI 真的在针对你）',
    (rNeutral * 100).toFixed(1) + '% → ' + (rExploit * 100).toFixed(1) + '%');

  /* 反向验证：面对"从不弃牌"的跟注站，AI 应当减少诈唬
   * Reverse check: against a calling station that "never folds", the AI should bluff less */
  {
    const callStation = {
      bluffBoost: 0.55, sizeBoost: 0.9, thinValue: 0.18, stealBoost: 0.8,
      threeBetBluffBoost: 0.6, callDownBoost: 1.2, confidence: 0.9,
    };
    const rStation = bluffRate(callStation, 6000);
    ok(rStation < rNeutral,
      '面对跟注站时下注（诈唬）频率低于中性（方向正确）',
      (rStation * 100).toFixed(1) + '% < ' + (rNeutral * 100).toFixed(1) + '%');
  }

  /* ============================================================
   * F. 存档往返（画像要能跨会话累积）
   * F. Save/load round-trip (the profile must accumulate across sessions)
   * ============================================================ */
  console.log('\n── F. 画像存档');
  {
    const before = JSON.parse(JSON.stringify(PK.Profile.stats));
    const snap = JSON.stringify(before);
    PK.Profile.reset();
    ok(PK.Profile.stats.hands === 0, 'reset() 能清空画像（配合"清空统计"）');
    PK.Profile.stats = JSON.parse(snap);
    ok(PK.Profile.stats.hands === before.hands, '画像可由 JSON 完整恢复');
    ok(PK.Profile.stats.faced.flop.opp === before.faced.flop.opp,
      '嵌套的 faced 结构往返后保持完整');

    /* 存档被写坏（缺一街）时不能抛异常
     * A corrupted save (missing one street) must not throw */
    const broken = JSON.parse(snap);
    delete broken.faced.turn;
    PK.Profile.stats = broken;
    let threw = false;
    try { PK.Profile.metrics(); PK.Profile.leaks(); } catch (e) { threw = true; }
    ok(!threw, 'faced 缺一街时 metrics()/leaks() 不抛异常（不会白屏）');
  }

  console.log('\n' + '─'.repeat(56));
  if (fail) {
    console.log('❌ 失败 ' + fail + ' 项：');
    failures.forEach(f => console.log('   · ' + f));
    console.log('✅ 通过 ' + pass + ' 项');
    process.exit(1);
  }
  console.log('✅ 全部通过：' + pass + ' 项断言');
  process.exit(0);
})();
