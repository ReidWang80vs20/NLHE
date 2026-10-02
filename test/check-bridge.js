/* ============================================================
 * check-bridge.js — 与心算题库（同目录的 index.html）联动的自检
 * check-bridge.js — self-check of integration with the mental-math drill app (index.html in the same directory)
 *
 *   node test/check-bridge.js
 *
 * 分两部分：
 * Two parts:
 *
 *   A. **防漂移**：bridge.js 里那张 TOPICS 表是对题库源码的**有意复制**
 *   A. **Anti-drift**: the TOPICS table in bridge.js is a **deliberate copy** of the drill app source
 *      （两个页面互相读不到代码，只能复制）。测试直接解析
 *      (the two pages cannot read each other's code, so copying is the only option). The test directly parses
 *      index.html（本仓库根目录），逐键比对 stage / name / formula / 存档键 /
 *      index.html (in this repository's root) and compares stage / name / formula / save key /
 *      解锁阈值，以及今日键的**日期格式**。题库那边一改，这里就变红，
 *      unlock thresholds key by key, plus the **date format** of today's key. Change the drill app and this goes red,
 *      而不是静默失配。
 *      rather than silently mismatching.
 *
 *   B. **数据路径**：用一个可控的 localStorage 桩件喂各种存档（正常的、
 *   B. **Data paths**: feed various saves through a controllable localStorage stub (normal,
 *      缺字段的、字段类型错的、超界的、损坏的、以及"每一次读写都抛异常"
 *      missing-field, wrong-type, out-of-range, corrupted, and "throws on every read/write"):
 *      的），断言 bridge 只读不写、绝不抛异常、且降级结果可预期。
 *      assert that bridge is read-only, never throws, and degrades predictably.
 *
 *   断言里凡是"看数值"的地方，都先独立算一遍期望值（甚至把题库源码里
 *   Wherever an assertion "looks at a value", the expected value is computed independently first (even by extracting
 *   的表达式抠出来执行），不用被测对象担保被测对象。
 *   expressions from the drill source and running them), never letting the object under test vouch for itself.
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'src');

/* bridge.js 在**加载时**就按 global.location 推导题库地址，所以必须在 require 之前把浏览器环境模拟出来，
   bridge.js derives the drill URL from global.location **at load time**, so the browser environment must be
   simulated before requiring it;
   否则它只会拿到裸文件名 index.html，这条"打开的正是题库页面"的断言就失去判别力。
   otherwise it only sees the bare name index.html and the "the drill page is what gets opened" assertion
   loses its discriminating power. */
try {
  Object.defineProperty(globalThis, 'location', {
    value: { href: 'file:///' + path.join(__dirname, '..', 'poker-trainer.html').replace(/\\/g, '/') },
    configurable: true,
    writable: true,
  });
} catch (e) {
  /* 某些运行时里 location 不可覆盖：此时退化为相对文件名，其余断言照常
      In some runtimes location cannot be overridden; fall back to the relative file name, other assertions still run */
}

/* openDrill 应当打开的地址：由本脚本**独立**算出（模拟器页面同目录的 index.html），
   The address openDrill should open: computed **independently** by this script (index.html next to the
   simulator page),
   而不是拿 B.DRILL_PATH 去比 —— 那等于用被测对象担保被测对象。
   rather than comparing against B.DRILL_PATH, which would let the object under test vouch for itself.
   与 DRILL_HTML（用于防漂移比对的题库**源文件**，可能不存在）是两回事，别混用。
   This is a different thing from DRILL_HTML (the drill page **source file** used for the anti-drift
   comparison, which may not exist) — do not conflate the two. */
const EXPECTED_DRILL_PATH = path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');

/* 心算题库页面**不在本仓库内**：本仓库只有模拟器（index.html 是它的开发入口，会被 build.js
   打包成 poker-trainer.html），所以不能再把路径写死成 DOM 结构里的某个文件。
   The mental-math drill page is **not part of this repository**: this repo holds only the simulator
   (index.html is its development entry, bundled into poker-trainer.html by build.js), so the path can no
   longer be hard-coded to some file in that layout.
   定位顺序 / Location order:
     1. 环境变量 NLHE_DRILL_HTML（显式指定，最可靠）；
     1. the NLHE_DRILL_HTML environment variable (explicit, most reliable);
     2. 否则在本仓库根目录里按**内容**找一份题库；
     2. otherwise search this repository's root for a drill page **by content**;
     3. 都找不到 → 跳过 A 组比对，并打印明确指引。
     3. if neither is found, skip the group-A comparison with a clear notice.
   判别条件是"含 const STAGE_TOPICS + const UNLOCK_ATT，且**不含** PK.Bridge"：
   The predicate is "contains const STAGE_TOPICS + const UNLOCK_ATT and does **not** contain PK.Bridge":
   最后一条用于排除打包产物 poker-trainer.html —— 它内嵌了 bridge.js 的 TOPICS 副本，
   the last condition rules out the bundled poker-trainer.html, which embeds bridge.js's TOPICS copy;
   拿它比对就成了"自己跟自己比"，会静默通过，比找错文件更危险。
   comparing against it would be comparing the code to itself, which passes silently — more dangerous than
   simply pointing at the wrong file. */
function locateDrillHtml() {
  if (process.env.NLHE_DRILL_HTML) return process.env.NLHE_DRILL_HTML;
  const root = path.join(__dirname, '..');
  let names;
  try { names = fs.readdirSync(root); } catch { return null; }
  for (const n of names) {
    if (!/\.html?$/i.test(n)) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, n), 'utf8'); } catch { continue; }
    if (/const\s+STAGE_TOPICS\s*=/.test(text) &&
        /const\s+UNLOCK_ATT/.test(text) &&
        text.indexOf('PK.Bridge') < 0) {
      return path.join(root, n).replace(/\\/g, '/');
    }
  }
  return null;
}
const DRILL_HTML = locateDrillHtml();

['poker.js', 'equity.js', 'range.js', 'profile.js', 'bridge.js'].forEach(f => require(path.join(SRC, f)));
const PK = globalThis.PK;
const B = PK.Bridge;

/* ---------- 断言骨架 ----------
 * ---------- Assertion skeleton ---------- */
let pass = 0, fail = 0, skip = 0;
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

/* ---------- localStorage 桩件 ----------
 * ---------- localStorage stub ---------- */
const REAL_LS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let lsWrites = 0;

/** 装一个假的 localStorage；text=null 表示"键不存在"，'THROW' 表示读就抛异常
 * Install a fake localStorage; text=null means "key absent", 'THROW' means reading throws */
function withStore(text, fn) {
  lsWrites = 0;
  const store = {
    getItem(k) {
      if (text === 'THROW') throw new Error('SecurityError: localStorage 被禁用');
      return k === B.DRILL_KEY && text !== null && text !== undefined ? text : null;
    },
    setItem() { lsWrites++; throw new Error('不应该写入'); },
    removeItem() { lsWrites++; },
    clear() { lsWrites++; },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: store, configurable: true, writable: true,
  });
  B.invalidate();
  try { return fn(); } finally {
    if (REAL_LS) Object.defineProperty(globalThis, 'localStorage', REAL_LS);
    else delete globalThis.localStorage;
    B.invalidate();
  }
}

const J = (o) => JSON.stringify(o);

/** 造一份"像真的"题库存档
 * Build a "realistic-looking" drill-app save */
function save(over) {
  const st = { 1: { att: 0, ok: 0 }, 2: { att: 0, ok: 0 }, 3: { att: 0, ok: 0 }, 4: { att: 0, ok: 0 }, 5: { att: 0, ok: 0 } };
  const base = {
    version: 1, createdAt: '2026-09-01T00:00:00.000Z',
    settings: { goalPerDay: 30, keypad: true, sessionSize: 10 },
    stages: st, forcedUnlock: false,
    topics: {}, daily: {}, streak: { last: null, days: 0, best: 0 },
    history: [], mistakes: [],
  };
  return Object.assign(base, over || {});
}

/* ============================================================
 * A. 防漂移
 * A. Anti-drift
 * ============================================================ */
const exists = !!DRILL_HTML && fs.existsSync(DRILL_HTML);
const src = exists ? fs.readFileSync(DRILL_HTML, 'utf8') : '';

/** 从题库源码里抠出常量
 * Extract constants from the drill-app source */
function parseDrill() {
  const out = { topics: {}, stageTopics: {}, lsKey: null, unlockAtt: null, unlockAcc: null, todayKey: null };

  const mTopics = src.match(/const TOPICS=\{([\s\S]*?)\n\};/);
  if (mTopics) {
    for (const line of mTopics[1].split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*\{stage\s*:\s*(\d+)\s*,\s*name\s*:\s*'([^']*)'\s*,\s*formula\s*:\s*'([^']*)'\s*\}\s*,?\s*$/);
      if (m) out.topics[m[1]] = { stage: +m[2], name: m[3], formula: m[4] };
    }
  }
  const mStage = src.match(/const STAGE_TOPICS=\{([\s\S]*?)\n\};/);
  if (mStage) {
    const re = /(\d+)\s*:\s*\[([^\]]*)\]/g;
    let m;
    while ((m = re.exec(mStage[1]))) {
      out.stageTopics[+m[1]] = m[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    }
  }
  const mKey = src.match(/const LS_KEY\s*=\s*'([^']+)'/);
  if (mKey) out.lsKey = mKey[1];
  const mUnlock = src.match(/const UNLOCK_ATT\s*=\s*(\d+)\s*,\s*UNLOCK_ACC\s*=\s*([\d.]+)/);
  if (mUnlock) { out.unlockAtt = +mUnlock[1]; out.unlockAcc = +mUnlock[2]; }
  /* 把题库的 todayKey 表达式原样取出来执行 —— 这是唯一能证明"键格式一致"的办法
   * Extract the drill app's todayKey expression verbatim and run it — the only way to prove the key format matches */
  const mToday = src.match(/const todayKey\s*=\s*(\(\)=>\{[^}]*\})\s*;/);
  if (mToday) {
    try { out.todayKey = new Function('return (' + mToday[1] + ')')(); } catch (e) { out.todayKey = null; }
  }
  return out;
}

const DRILL = exists ? parseDrill() : null;

group('A1. 能读到题库源码');
if (!exists) {
  console.log('   ⚠ 未找到心算题库文件，跳过 A 组的"与题库比对"部分（A2/A3 中不依赖题库的断言仍会执行）');
  console.log('     题库不在本仓库内，可用环境变量指定它的位置，例如：');
  console.log('       set NLHE_DRILL_HTML=D:\\path\\to\\drill\\index.html');
  skip++;
} else {
  ok(true, '题库文件存在', DRILL_HTML);
  ok(Object.keys(DRILL.topics).length > 0, '解析出 TOPICS 条目',
    Object.keys(DRILL.topics).length + ' 条');
}

group('A2. 复制过来的 TOPICS 必须与题库逐字一致');
{
  /* 先做**不依赖题库**的自洽性检查：题库不在本机时这几条仍然有效，
     First the self-consistency checks that do **not** depend on the drill page — they still hold when the
     drill page is absent,
     所以"跳过题库比对"不等于"放弃全部判别力"。
     so "skipping the drill comparison" does not mean "losing all discriminating power". */
  const mine = Object.keys(B.TOPICS).sort();
  ok(mine.length === 21, 'bridge 侧 21 个知识点', String(mine.length));

  /* 每条都必须带非空的 stage/name/formula，且 stage 在 1~5 之间
     Every entry must carry a non-empty stage/name/formula, with stage between 1 and 5 */
  const malformed = mine.filter(k => {
    const t = B.TOPICS[k];
    return !t || typeof t.stage !== 'number' || t.stage < 1 || t.stage > 5 || !t.name || !t.formula;
  });
  ok(malformed.length === 0, '每条知识点都有合法的 stage/name/formula', malformed.join(','));

  const stageDist = {};
  for (const k of mine) stageDist[B.TOPICS[k].stage] = (stageDist[B.TOPICS[k].stage] || 0) + 1;
  ok(JSON.stringify(stageDist) === J({ 1: 4, 2: 3, 3: 5, 4: 4, 5: 5 }),
    '各阶段题目数 4/3/5/4/5', J(stageDist));

  if (exists) {
    const theirs = Object.keys(DRILL.topics).sort();
    ok(JSON.stringify(mine) === JSON.stringify(theirs), '键集合完全一致',
      'bridge ' + mine.length + ' / 题库 ' + theirs.length);

    const missing = mine.filter(k => !DRILL.topics[k]);
    const extra = theirs.filter(k => !B.TOPICS[k]);
    ok(missing.length === 0, '没有题库侧不存在的键', missing.join(','));
    ok(extra.length === 0, '没有漏掉题库侧的键', extra.join(','));

    let stageBad = [], nameBad = [], formulaBad = [];
    for (const k of mine) {
      const t = DRILL.topics[k];
      if (!t) continue;
      if (B.TOPICS[k].stage !== t.stage) stageBad.push(k);
      if (B.TOPICS[k].name !== t.name) nameBad.push(k);
      if (B.TOPICS[k].formula !== t.formula) formulaBad.push(k);
    }
    ok(stageBad.length === 0, '每个知识点的阶段号一致', stageBad.join(','));
    ok(nameBad.length === 0, '每个知识点的名称一致', nameBad.join(','));
    ok(formulaBad.length === 0, '每个知识点的公式文案一致', formulaBad.join(','));

    /* 阶段分组：TOPICS[i].stage 应与 STAGE_TOPICS 的下标吻合
     * Stage grouping: TOPICS[i].stage should agree with the STAGE_TOPICS index */
    let groupBad = [];
    for (const s of Object.keys(DRILL.stageTopics)) {
      for (const k of DRILL.stageTopics[s]) {
        if (!B.TOPICS[k] || B.TOPICS[k].stage !== +s) groupBad.push(k + '→阶段' + s);
      }
    }
    ok(groupBad.length === 0, '阶段分组与 TOPICS 标注自洽', groupBad.join(','));
    ok(Object.keys(DRILL.stageTopics).length === 5, '题库分为 5 个阶段');
  }
}

group('A3. 存档键与解锁阈值必须一致');
{
  /* 不依赖题库的两条：跳转地址的拼法，以及"漏洞→题目"映射存在。
     Two assertions that do not depend on the drill page: how the jump URL is assembled, and that the
     leak→topic mapping exists.
     注意 DRILL_URL 现在由当前页面地址推导，所以这里验的是"两者一致"，
     Note DRILL_URL is now derived from the current page URL, so this checks that the two agree
     而不是某个写死的绝对路径。
     rather than checking some hard-coded absolute path. */
  ok(B.DRILL_URL === 'file:///' + B.DRILL_PATH, '跳转地址由路径拼出', B.DRILL_URL);
  ok(PK.Profile.TOPIC_FOR !== undefined, 'PK.Profile.TOPIC_FOR 存在（漏洞→题目映射）');

  if (exists) {
    ok(B.DRILL_KEY === DRILL.lsKey, '存档键与题库 LS_KEY 相同',
      B.DRILL_KEY + ' vs ' + DRILL.lsKey);
    ok(B.UNLOCK_ATT === DRILL.unlockAtt, '解锁所需题数一致',
      B.UNLOCK_ATT + ' vs ' + DRILL.unlockAtt);
    ok(B.UNLOCK_ACC === DRILL.unlockAcc, '解锁所需正确率一致',
      B.UNLOCK_ACC + ' vs ' + DRILL.unlockAcc);
  }
}

group('A4. 今日键的日期格式必须与题库相同');
{
  /* 用假 Date 驱动题库的原函数，逐日比对。这才是"格式一致"的硬证据 ——
   * Drive the drill app's original function with a fake Date and compare day by day. This is hard evidence of a "matching format" —
     只比对字符串模板会漏掉 padStart 之类的细节差异。
   * comparing only string templates would miss detail differences like padStart. */
  const makeFake = (iso) => {
    const Real = Date;
    function Fake() { return new Real(iso); }
    Fake.prototype = Real.prototype;
    return Fake;
  };
  const dates = [
    '2026-01-05T10:00:00', '2026-12-31T23:59:00', '2026-03-01T00:00:00',
    '2026-09-28T12:34:00', '2027-11-09T08:00:00',
  ];
  let badDays = [];
  for (const iso of dates) {
    const mine = B.todayKey(new Date(iso));
    let theirs;
    if (DRILL && DRILL.todayKey) {
      /* 题库的 todayKey 是 () => {...}，内部 new Date()；塞个假 Date 进去
       * The drill app's todayKey is () => {...} calling new Date() internally; inject a fake Date */
      theirs = new Function('Date', 'return (' + DRILL.todayKey.toString() + ')()')(makeFake(iso));
    } else {
      const d = new Date(iso);
      theirs = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    if (mine !== theirs) badDays.push(iso + ' → ' + mine + ' vs ' + theirs);
  }
  ok(badDays.length === 0, '5 个不同日期下 todayKey 与题库一致', badDays.join(' | '));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(B.todayKey(new Date('2026-01-05T00:00:00'))),
    '今日键形如 YYYY-MM-DD', B.todayKey(new Date('2026-01-05T00:00:00')));
  /* 月份/日期补零：1 月 5 日不能变成 1-5
   * Zero-padding of month/day: January 5th must not become 1-5 */
  ok(B.todayKey(new Date('2026-01-05T12:00:00')) === '2026-01-05', '单位数月日补零',
    B.todayKey(new Date('2026-01-05T12:00:00')));
}

group('A5. 漏洞词汇表两侧一致');
{
  const leakKeys = Object.keys(B.LEAK_CN).sort();
  const forKeys = Object.keys(PK.Profile.TOPIC_FOR).sort();
  ok(leakKeys.length >= 8, 'LEAK_CN 覆盖 8 个以上漏洞', String(leakKeys.length));
  ok(JSON.stringify(leakKeys) === JSON.stringify(forKeys),
    'LEAK_CN 与 TOPIC_FOR 的漏洞 id 完全对应',
    '漏掉 ' + leakKeys.filter(k => !PK.Profile.TOPIC_FOR[k]).join(',') +
    ' / 多出 ' + forKeys.filter(k => !B.LEAK_CN[k]).join(','));

  let badTopic = [];
  for (const id of forKeys) {
    const keys = PK.Profile.TOPIC_FOR[id];
    if (!Array.isArray(keys) || !keys.length) { badTopic.push(id + '(空)'); continue; }
    for (const k of keys) if (!B.TOPICS[k]) badTopic.push(id + '→' + k);
  }
  ok(badTopic.length === 0, 'TOPIC_FOR 里的题目 key 都真实存在', badTopic.join(','));

  const covered = {};
  for (const id of forKeys) for (const k of PK.Profile.TOPIC_FOR[id]) covered[k] = 1;
  ok(Object.keys(covered).length >= 10,
    '漏洞映射覆盖到足够多的知识点', Object.keys(covered).length + ' / 21 个');
}

/* ============================================================
 * B. 数据路径
 * B. Data paths
 * ============================================================ */

group('B1. 读不到 / 读坏了都不许抛异常');
{
  let threw = [];
  const probe = (label, text) => {
    try {
      const r = withStore(text, () => {
        const p = B.progress({ fresh: true });
        B.today(); B.topicStats(); B.practiceFor(['foldTooMuch']); B.stages(); B.available();
        return p;
      });
      return r;
    } catch (e) { threw.push(label + ': ' + e.message); return undefined; }
  };
  ok(probe('无键', null) === null, '存档不存在 → progress 返回 null');
  ok(probe('空串', '') === null, '空字符串 → null');
  ok(probe('非法 JSON', '{不是 JSON') === null, 'JSON 损坏 → null（不抛）');
  ok(probe('JSON 是数组', '[1,2,3]') === null, '顶层是数组 → 当无数据');
  ok(probe('JSON 是数字', '42') === null, '顶层是数字 → 当无数据');
  ok(probe('JSON 是 null', 'null') === null, '顶层是 null → 当无数据');
  ok(probe('localStorage 抛异常', 'THROW') === null, 'localStorage 被禁用 → null（不抛）');
  ok(threw.length === 0, '上面 7 种坏数据均未抛异常', threw.join(' | '));

  /* JSON 是字符串 '"x"' → 不是对象，也应当当作无数据
   * JSON is the string '"x"' → not an object, so it should also count as no data */
  ok(probe('JSON 是字符串', '"x"') === null, '顶层是字符串 → 当无数据');
}

group('B2. normalize 的补全与钳制');
{
  const p = withStore(J(save()), () => B.progress({ fresh: true }));
  ok(!!p, '正常存档能读出');
  ok(p.available === true, 'available 标记为真');
  ok(p.settings.goalPerDay === 30, '缺省每日目标 30', String(p.settings.goalPerDay));
  ok(p.settings.sessionSize === 10, '缺省每轮题数 10', String(p.settings.sessionSize));
  ok(p.stages[5] && p.stages[5].att === 0, '阶段 5 缺省补 0');
  ok(Object.keys(p.stages).length === 5, '阶段恒为 5 个', String(Object.keys(p.stages).length));
  ok(p.streak.days === 0 && p.streak.best === 0, '连胜缺省为 0');
  ok(p.attempts === 0 && p.correct === 0, '总题数为 0');
  ok(p.overallAcc === null, '无样本时总正确率为 null（不是 0）');
  ok(Array.isArray(p.recentMiss) && p.recentMiss.length === 0, 'recentMiss 为空数组');

  /* ok > att 必须钳到 att —— 否则会出现 120% 正确率
   * ok > att must be clamped to att — otherwise a 120% accuracy would appear */
  const bad2 = withStore(J(save({
    topics: { s1_r2p: { att: 5, ok: 99 }, s2_outs: { att: 0, ok: 7 } },
    daily: { '2026-09-28': { att: 3, ok: 99 } },
    stages: { 1: { att: 4, ok: 88 } },
  })), () => B.progress({ fresh: true }));
  ok(bad2.topics.s1_r2p.ok === 5, 'ok>att 被钳到 att', String(bad2.topics.s1_r2p.ok));
  ok(bad2.topics.s1_r2p.acc === 1, '钳制后正确率 = 100%', String(bad2.topics.s1_r2p.acc));
  ok(bad2.topics.s2_outs.acc === 0, 'att=0 时正确率记 0（不产生 NaN）', String(bad2.topics.s2_outs.acc));
  ok(bad2.stages[1].ok === 4, '阶段 ok 也被钳制', String(bad2.stages[1].ok));
  ok(bad2.attempts === 4 && bad2.correct === 4,
    '总计取自阶段累计且同样被钳制', bad2.correct + '/' + bad2.attempts);
  ok(bad2.daily['2026-09-28'].ok === 3, 'daily 里的 ok>att 也被钳制',
    String(bad2.daily['2026-09-28'].ok));

  /* 负数 / NaN / 非数字一律归零
   * Negative numbers / NaN / non-numbers are all zeroed */
  const bad3 = withStore(J(save({
    topics: { s1_r2p: { att: -9, ok: -3 }, s1_p2r: { att: 'abc', ok: null } },
    settings: { goalPerDay: -5, sessionSize: 'x' },
  })), () => B.progress({ fresh: true }));
  ok(bad3.topics.s1_r2p.att === 0, '负数题数归零', String(bad3.topics.s1_r2p.att));
  ok(bad3.topics.s1_p2r.att === 0, '非数字题数归零', String(bad3.topics.s1_p2r.att));
  ok(bad3.settings.goalPerDay === 30, '非法 goalPerDay 回落到 30', String(bad3.settings.goalPerDay));
  ok(bad3.settings.sessionSize === 10, '非法 sessionSize 回落到 10', String(bad3.settings.sessionSize));

  /* 题库里已删除的知识点，存档里残留 → 必须丢弃，不能出现在统计里
   * Topics deleted from the drill app but lingering in a save → must be dropped, never appear in stats */
  const bad4 = withStore(J(save({
    topics: { s1_r2p: { att: 3, ok: 3 }, s9_ghost: { att: 40, ok: 0 } },
  })), () => B.progress({ fresh: true }));
  ok(bad4.topics.s9_ghost === undefined, '题库已删除的知识点被丢弃');
  ok(Object.keys(bad4.topics).length === 1, '只保留仍然存在的知识点',
    String(Object.keys(bad4.topics).length));

  /* stages 的键写成字符串也要认
   * stages keys written as strings must also be recognized */
  const bad5 = withStore(J(save({ stages: { '3': { att: 12, ok: 9 } } })), () => B.progress({ fresh: true }));
  ok(bad5.stages[3].att === 12, '阶段号以字符串给出时也能读', String(bad5.stages[3].att));
}

group('B3. 历史记录的口径');
{
  const hist = [];
  for (let i = 0; i < 30; i++) hist.push({ t: 1000 + i, stage: 1, topic: 's1_r2p', ok: i % 3 === 0 ? 0 : 1, ms: 500 });
  /* 最后 20 条（i=10..29）里，错的只有 i=12,15,18 —— 共 3 条
   * Among the last 20 entries (i=10..29), only i=12,15,18 are wrong — 3 in total */
  const p = withStore(J(save({ history: hist, mistakes: [{}, {}, {}] })), () => B.progress({ fresh: true }));
  ok(p.historyCount === 30, '历史条数正确', String(p.historyCount));
  ok(p.mistakes === 3, '错题本条数正确', String(p.mistakes));
  ok(p.lastAt === 1029, '最后一次作答时间取历史末条', String(p.lastAt));
  /* 最后 20 条 = i 从 10 到 29；ok=0 的 i 有 12、15、18、21、24、27 → 6 条
   * Last 20 entries = i from 10 to 29; the i with ok=0 are 12,15,18,21,24,27 → 6 in total */
  ok(p.recentAcc !== null && Math.abs(p.recentAcc - (14 / 20)) < 1e-9,
    '最近 20 题正确率按独立的 14/20 计算', String(p.recentAcc));
  ok(p.recentMiss.length === 1 && p.recentMiss[0].key === 's1_r2p' && p.recentMiss[0].n === 6,
    '最近错题按知识点聚合计数', J(p.recentMiss));

  const e = withStore(J(save()), () => B.progress({ fresh: true }));
  ok(e.recentAcc === null, '无历史时最近正确率为 null（不是 0）');

  /* 历史里出现题库已删除的知识点，不能污染 recentMiss
   * A deleted topic appearing in history must not pollute recentMiss */
  const g = withStore(J(save({ history: [{ t: 1, topic: 's9_ghost', ok: 0 }] })), () => B.progress({ fresh: true }));
  ok(g.recentMiss.length === 0, '已删除知识点的错题不计入聚合', J(g.recentMiss));
}

group('B4. today() 的达标判断');
{
  const k = B.todayKey();
  const t0 = withStore(J(save()), () => B.today());
  ok(t0.key === k, 'today 用的是今天', t0.key);
  ok(t0.att === 0 && t0.ok === 0, '今天还没刷题');
  ok(t0.goal === 30, '默认目标 30 题', String(t0.goal));
  ok(t0.acc === null, '没刷题时正确率 null');
  ok(t0.done === false && t0.remain === 30, '未达标且还差 30 题',
    String(t0.done) + ' / ' + String(t0.remain));

  const t1 = withStore(J(save({
    settings: { goalPerDay: 30, sessionSize: 10 },
    daily: (() => { const o = {}; o[k] = { att: 30, ok: 24 }; return o; })(),
  })), () => B.today());
  ok(t1.att === 30 && t1.ok === 24, '读到今天的题数', t1.att + '/' + t1.ok);
  ok(Math.abs(t1.acc - 0.8) < 1e-9, '今日正确率 80%', String(t1.acc));
  ok(t1.done === true && t1.remain === 0, '恰好达标', String(t1.done));

  const t2 = withStore(J(save({
    settings: { goalPerDay: 50, sessionSize: 10 },
    daily: (() => { const o = {}; o[k] = { att: 30, ok: 24 }; return o; })(),
  })), () => B.today());
  ok(t2.done === false && t2.remain === 20, '目标 50 时还差 20 题',
    String(t2.done) + ' / ' + String(t2.remain));

  /* 昨天的数据不能算进今天
   * Yesterday's data must not count toward today */
  const t3 = withStore(J(save({
    daily: { '1999-01-01': { att: 99, ok: 99 } },
  })), () => B.today());
  ok(t3.att === 0, '昨天的成绩不算今天', String(t3.att));
}

group('B5. topicStats 的排序与弱项判定');
{
  /* 故意构造：两种已评分（一个 40%、一个 90%）、一种样本不足、其余没练过
   * Deliberately constructed: two graded (one 40%, one 90%), one with insufficient sample, the rest never practiced */
  const p = withStore(J(save({
    topics: {
      s1_r2p: { att: 10, ok: 4 },     // 40% → 弱项（att≥5） / 40% → weak (att≥5)
      s2_outs: { att: 20, ok: 18 },   // 90% → 不弱 / 90% → not weak
      s3_req: { att: 3, ok: 0 },      // 样本不足，不参与排序也不判弱项 / Insufficient sample: unranked, not weak
      s5_compare: { att: 8, ok: 8 },  // 100%
    },
  })), () => B.topicStats());

  ok(p.length === 21, '列出全部 21 个知识点', String(p.length));
  /* 排序规则：已评分的（att≥5）在前，按正确率升序 → 0.4 → 0.9 → 1.0
   * Sort rule: graded ones (att≥5) first, by ascending accuracy → 0.4 → 0.9 → 1.0 */
  ok(p[0].key === 's1_r2p', '最低正确率排最前', p[0].key + ' @ ' + p[0].acc);
  ok(p[1].key === 's2_outs', '其次 90%', p[1].key + ' @ ' + p[1].acc);
  ok(p[2].key === 's5_compare', '再次 100%', p[2].key + ' @ ' + p[2].acc);
  let asc = true;
  for (let i = 1; i < 3; i++) if (p[i - 1].acc > p[i].acc) asc = false;
  ok(asc, '已评分的确实按正确率升序');
  ok(p[0].weak === true, '40% 被判为弱项');
  ok(p[1].weak === false && p[2].weak === false, '90%/100% 不是弱项');
  const s3 = p.find(x => x.key === 's3_req');
  ok(s3.graded === false, '样本 3 题未达评分线', String(s3.att));
  ok(s3.weak === false, '样本不足不判弱项（避免手气当结论）');
  ok(p.slice(3).every(x => !x.graded), '未评分的都排在已评分之后');
  ok(p[0].name === '赔率→胜率' && p[0].formula.indexOf('风险') >= 0 &&
    p[0].stage === 1, '条目带上名称/公式/阶段', p[0].name);

  /* 未评分的部分按"练得少的排前面"
   * Among the ungraded, "least practiced comes first" */
  const un = p.slice(3);
  let mono = true;
  for (let i = 1; i < un.length; i++) if (un[i - 1].att > un[i].att) mono = false;
  ok(mono, '未评分的按题数升序（越没练越靠前）');

  /* 准确率正好 60% 不算弱项（阈值是"低于"）
   * An accuracy of exactly 60% is not a weak spot (the threshold is "below") */
  const edge = withStore(J(save({ topics: { s1_r2p: { att: 10, ok: 6 } } })), () => B.topicStats());
  ok(edge[0].weak === false, '恰好 60% 不算弱项', String(edge[0].acc));
  const edge2 = withStore(J(save({ topics: { s1_r2p: { att: 10, ok: 5 } } })), () => B.topicStats());
  ok(edge2[0].weak === true, '50% 算弱项', String(edge2[0].acc));
}

group('B6. practiceFor 的映射、去重与排序');
{
  const p = withStore(J(save({
    topics: { s3_req: { att: 10, ok: 9 }, s3_decide: { att: 10, ok: 1 } },
  })), () => B.practiceFor(['foldTooMuch', 'callTooMuch']));

  const keys = p.map(x => x.key);
  ok(keys.indexOf('s3_req') >= 0 && keys.indexOf('s3_decide') >= 0,
    'foldTooMuch 映射出的题目都在', keys.join(','));
  ok(keys.indexOf('s5_callev') >= 0, 'callTooMuch 额外带出 s5_callev', keys.join(','));
  ok(new Set(keys).size === keys.length, '没有重复条目', keys.join(','));
  /* 排序规则：没练过的（acc=null）排最前（最该补），其余按正确率升序。
   * Sort rule: never-practiced (acc=null) come first (most in need), the rest by ascending accuracy.
     s3_decide = 10%、s3_req = 90%、s5_callev 没练过 → s5_callev, s3_decide, s3_req
   * s3_decide = 10%, s3_req = 90%, s5_callev never practiced → s5_callev, s3_decide, s3_req */
  ok(keys[0] === 's5_callev' && p[0].acc === null,
    '没练过的排最前', keys.join(','));
  ok(keys[1] === 's3_decide', '其余按正确率升序（10% 在前）', keys[1] + ' @ ' + p[1].acc);
  ok(keys[2] === 's3_req', '90% 的排最后', keys[2] + ' @ ' + p[2].acc);
  const eReq = p.find(x => x.key === 's3_req');
  const eCal = p.find(x => x.key === 's5_callev');
  ok(eReq.reason === '面对下注弃牌过多',
    'reason 用人话说明为什么练它', eReq.reason);
  ok(eCal.reason === '跟注过多、弃不掉牌', '不同漏洞给出不同理由', eCal.reason);
  ok(p[0].formula.length > 0 && p[0].stage >= 1 && p[0].stage <= 5, '条目信息完整');

  /* 没练过的（acc=null）应排在最前
   * Never-practiced (acc=null) should come first */
  const q = withStore(J(save({ topics: { s3_req: { att: 10, ok: 10 } } })),
    () => B.practiceFor(['foldTooMuch']));
  ok(q[0].acc === null, '没练过的排最前', J(q.map(x => x.key + ':' + x.acc)));

  /* 未知漏洞 id 不能崩，也不能凭空产出条目
   * An unknown leak id must neither crash nor conjure up entries out of nothing */
  let t = null;
  try { t = withStore(J(save()), () => B.practiceFor(['nope', undefined, null, 'sticky'])); }
  catch (e) { t = 'THREW:' + e.message; }
  ok(Array.isArray(t), '未知漏洞 id 不抛异常', String(t).slice(0, 40));
  ok(t.length === PK.Profile.TOPIC_FOR.sticky.length, '只产出 sticky 对应的题目',
    t.length + ' 条');

  ok(withStore(J(save()), () => B.practiceFor([])).length === 0, '空数组 → 空清单');
  ok(withStore(J(save()), () => B.practiceFor()).length === 0, '不传参数 → 空清单（不抛）');
  ok(withStore(J(save()), () => B.practiceFor(['foldTooMuch'])).length === 2,
    '单个漏洞映射出 2 道题');

  /* weak 标记：映射到的题里，样本够且正确率低的那道要标出来
   * weak flag: among the mapped topics, the one with enough sample and low accuracy must be flagged */
  const w = withStore(J(save({ topics: { s3_req: { att: 10, ok: 2 }, s3_decide: { att: 10, ok: 10 } } })),
    () => B.practiceFor(['foldTooMuch']));
  const r = w.find(x => x.key === 's3_req'), d = w.find(x => x.key === 's3_decide');
  ok(r.weak === true, '映射到的弱题被标出', String(r.acc));
  ok(d.weak === false, '映射到的强题不被标出', String(d.acc));
}

group('B7. stages 的解锁语义必须与题库一致');
{
  /* 用解析出的阈值，在测试里独立复现题库的 isStageOpen。
   * Using the parsed thresholds, independently reproduce the drill app's isStageOpen in the test.
     题库：i===1 || forcedUnlock || stagePassed(i-1)；只看紧邻前一阶段。
   * Drill app: i===1 || forcedUnlock || stagePassed(i-1); only the immediately preceding stage counts. */
  const att = B.UNLOCK_ATT, acc = B.UNLOCK_ACC;
  const expectUnlock = (stages, force) => {
    const passed = (i) => {
      const s = stages[i] || { att: 0, ok: 0 };
      return s.att >= att && (s.att > 0 ? s.ok / s.att : 0) >= acc;
    };
    const out = [];
    for (let i = 1; i <= 5; i++) out.push(!!(i === 1 || force || passed(i - 1)));
    return out;
  };

  const cases = [
    { name: '全空', stages: {}, force: false },
    { name: '阶段1已通过', stages: { 1: { att: 20, ok: 18 } }, force: false },
    { name: '阶段1题够但正确率不够', stages: { 1: { att: 20, ok: 10 } }, force: false },
    { name: '阶段1题不够但全对', stages: { 1: { att: 19, ok: 19 } }, force: false },
    { name: '恰好 20 题 75%', stages: { 1: { att: 20, ok: 15 } }, force: false },
    { name: '只有阶段3有数据（导入存档的场景）', stages: { 3: { att: 40, ok: 40 } }, force: false },
    { name: '强制解锁', stages: {}, force: true },
    { name: '阶段1、2 都通过', stages: { 1: { att: 25, ok: 25 }, 2: { att: 25, ok: 20 } }, force: false },
  ];
  let mismatch = [];
  for (const c of cases) {
    const mine = withStore(J(save({ stages: c.stages, forcedUnlock: c.force })), () => B.stages());
    const want = expectUnlock(c.stages, c.force);
    for (let i = 1; i <= 5; i++) {
      if (mine[i - 1].unlocked !== want[i - 1]) {
        mismatch.push(c.name + ' 阶段' + i + ' 期望' + want[i - 1] + ' 实得' + mine[i - 1].unlocked);
      }
    }
  }
  ok(mismatch.length === 0, '8 种存档下解锁状态与题库算法逐项一致', mismatch.join(' | '));

  /* 单独把"只有阶段3有数据"这一例拎出来 —— 这正是链式写法会算错的地方
   * Call out the "only stage 3 has data" case on its own — exactly where a chained formulation would go wrong */
  const s3only = withStore(J(save({ stages: { 3: { att: 40, ok: 40 } } })), () => B.stages());
  ok(s3only[2].unlocked === false, '阶段3 在阶段2未通过时仍锁定（只看紧邻前一阶段）');
  ok(s3only[3].unlocked === true, '阶段4 因阶段3已通过而解锁');
  ok(s3only[0].unlocked === true, '阶段1 永远解锁');

  const f = withStore(J(save({ forcedUnlock: true })), () => B.stages());
  ok(f.every(x => x.unlocked === true), '强制解锁时 5 个阶段全部解锁');

  const p = withStore(J(save({ stages: { 1: { att: 7, ok: 5 } } })), () => B.stages());
  ok(p[0].needAtt === 13, '还差 13 题才够解锁门槛', String(p[0].needAtt));
  ok(p[0].acc !== null && Math.abs(p[0].acc - 5 / 7) < 1e-9, '阶段正确率按 ok/att 算');
  ok(p[4].acc === null, '没练过的阶段正确率为 null（不显示成 0%）');
  ok(p[4].needAtt === 20, '没练过的阶段还差 20 题');
  ok(p[0].passed === false, '阶段1 未通过');
}

group('B8. available 的判定');
{
  ok(withStore(null, () => B.available()) === false, '无存档 → 不可用');
  ok(withStore(J(save()), () => B.available()) === false, '有存档但零记录 → 不可用');
  ok(withStore(J(save({ history: [{ t: 1, topic: 's1_r2p', ok: 1 }] })), () => B.available()) === true,
    '有历史 → 可用');
  ok(withStore(J(save({ topics: { s1_r2p: { att: 2, ok: 1 } } })), () => B.available()) === true,
    '有知识点记录 → 可用');
  ok(withStore(J(save({ stages: { 1: { att: 5, ok: 5 } } })), () => B.available()) === true,
    '有阶段计数 → 可用');
  ok(withStore(J(save({ daily: { '2026-09-28': { att: 5, ok: 5 } } })), () => B.available()) === false,
    '只有 daily、三个阶段/知识点/历史全空 → 视为不可用');
}

group('B9. 只读：不得写回题库的存档');
{
  const all = (text) => withStore(text, () => {
    B.progress({ fresh: true });
    B.today(); B.topicStats(); B.stages(); B.available();
    B.practiceFor(['foldTooMuch', 'callTooMuch', 'sticky']);
    return lsWrites;
  });
  ok(all(null) === 0, '无存档时零写入', String(all(null)));
  ok(all(J(save())) === 0, '有存档时零写入', String(all(J(save()))));
  ok(all(J(save({ topics: { s1_r2p: { att: 9, ok: 9 } } }))) === 0, '有统计时零写入');
  /* 项目里另外一个应用（本训练器）用 nlhe-trainer-v1，键不能撞车
   * The project's other app (this trainer) uses nlhe-trainer-v1; the keys must not collide */
  ok(B.DRILL_KEY !== 'nlhe-trainer-v1',
    '题库键与本训练器键不同（否则两边会互相覆盖）', B.DRILL_KEY);
}

group('B10. progress 的缓存行为');
{
  const t = J(save({ topics: { s1_r2p: { att: 4, ok: 4 } } }));
  const r = withStore(t, () => {
    const a = B.progress({ fresh: true });
    const b = B.progress();
    const c = B.progress();
    const sameIdentity = a === b && b === c;
    const d = B.progress({ fresh: true });
    B.invalidate();
    const e = B.progress();
    return { sameIdentity, freshNew: a !== d, afterInvalidateNew: d !== e };
  });
  ok(r.sameIdentity === true, '1.5 秒内重复调用返回同一对象（省去反复 JSON.parse）');
  ok(r.freshNew === true, 'fresh:true 强制重读');
  ok(r.afterInvalidateNew === true, 'invalidate() 之后重读');
}

group('B11. openDrill 的降级');
{
  const old = globalThis.open;
  let called = [];
  globalThis.open = (url, tgt) => { called.push(url + '|' + tgt); return { closed: false }; };
  ok(B.openDrill() === true, '能发起打开时返回 true');
  ok(called[0] && called[0].indexOf(EXPECTED_DRILL_PATH) >= 0,
    '打开的正是题库页面', called[0]);
  ok(called[0].indexOf('file:///') === 0, '用的是 file:// 地址', called[0]);

  globalThis.open = () => null;
  ok(B.openDrill() === false, 'open 返回 null 时报 false');

  globalThis.open = () => { throw new Error('popup blocked'); };
  let threw = false;
  let r;
  try { r = B.openDrill(); } catch (e) { threw = true; }
  ok(threw === false && r === false, 'open 抛异常时也不抛，返回 false');

  if (old === undefined) delete globalThis.open; else globalThis.open = old;
}

group('B12. 端到端：一份完整存档跑通全链路');
{
  const k = B.todayKey();
  const full = save({
    settings: { goalPerDay: 40, sessionSize: 12 },
    stages: { 1: { att: 34, ok: 27 }, 2: { att: 21, ok: 16 }, 3: { att: 6, ok: 4 } },
    topics: {
      s1_r2p: { att: 12, ok: 11 }, s1_p2r: { att: 13, ok: 5 },
      s2_outs: { att: 21, ok: 16 }, s3_req: { att: 10, ok: 3 },
    },
    daily: (() => { const o = {}; o[k] = { att: 8, ok: 6 }; return o; })(),
    streak: { last: k, days: 5, best: 12 },
    history: [
      { t: 1, stage: 1, topic: 's1_p2r', ok: 0, ms: 900 },
      { t: 2, stage: 1, topic: 's1_r2p', ok: 1, ms: 700 },
      { t: 3, stage: 2, topic: 's2_outs', ok: 1, ms: 1100 },
    ],
    mistakes: [{}],
  });
  const out = withStore(J(full), () => ({
    p: B.progress({ fresh: true }),
    t: B.today(),
    st: B.topicStats(),
    sg: B.stages(),
    plan: B.practiceFor(['foldTooMuch', 'callTooMuch']),
    avail: B.available(),
  }));

  ok(out.avail === true, '整体判定为可用');
  ok(out.p.streak.days === 5 && out.p.streak.best === 12, '连胜读出', out.p.streak.days + '/' + out.p.streak.best);
  ok(out.t.att === 8 && out.t.goal === 40 && out.t.remain === 32, '今日进度读出',
    out.t.att + '/' + out.t.goal);
  ok(out.t.done === false, '今日未达标');
  ok(out.p.attempts === 34 + 21 + 6, '总题数 = 各阶段之和（与 daily 无关）',
    String(out.p.attempts));
  ok(out.p.correct === 27 + 16 + 4, '总正确数 = 各阶段之和', String(out.p.correct));
  ok(out.p.attempts !== out.t.att, '总题数不等于今日题数（口径不同，不能混用）');
  const weak = out.st.filter(x => x.weak).map(x => x.key);
  ok(weak.indexOf('s1_p2r') >= 0, '38% 的知识点被识别为弱项', weak.join(','));
  ok(out.sg[0].unlocked === true && out.sg[1].unlocked === true, '阶段 1、2 解锁（阶段1已通过）');
  ok(out.sg[3].unlocked === false, '阶段 4 锁定（阶段3 只有 6 题）');
  ok(out.plan.length > 0 && out.plan.every(x => x.name && x.formula),
    '练习清单可直接渲染', out.plan.map(x => x.name).join(' / '));
  /* 非空洞前提：清单里确实有一道"该重点补"的题 —— 30% 正确率的 s3_req
   * Non-vacuous precondition: the list really contains a "needs priority catching up" item — the 30%-accuracy s3_req */
  const flagged = out.plan.filter(x => x.weak === true).map(x => x.key);
  ok(flagged.length > 0, '清单里存在被标为弱项的题（保证下一条非空洞）', flagged.join(','));
  ok(flagged.indexOf('s3_req') >= 0, '30% 的 s3_req 在清单里被标为弱项');
}

/* ---------- 汇总 ----------
 * ---------- Summary ---------- */
if (gName) console.log('   ' + (gFail ? '✗ ' + gFail + ' 项失败' : '✓ ' + gPass + ' 项通过'));
console.log('\n════════════════════════════════');
console.log('题库联动自检：' + pass + ' 项通过，' + fail + ' 项失败' +
  (skip ? '（' + skip + ' 组跳过）' : ''));
if (fail) {
  console.log('\n失败明细：');
  for (const b of bad) console.log('  ✗ ' + b);
  process.exit(1);
}
console.log('✅ 全部通过');
