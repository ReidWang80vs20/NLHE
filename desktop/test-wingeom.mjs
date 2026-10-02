/**
 * 窗口几何判据的单元测试 —— **用实测记录里的真实数据**钉住规则。
 * Unit tests for the window geometry predicate —— **pinning the rule with real data from test records**.
 *
 * 为什么要单独有这个文件：这条判据前后被修过两次
 * Why this file exists separately: this predicate has been fixed twice
 *  ① 假阳性：把最大化窗口那圈「不可见边框」当成越界（工作区 1440x912 却报"右超6px 下超6px"）；
 *  ① False positive: treating the maximized window's 「invisible border」 as out-of-bounds (work area 1440x912 yet reporting "right over by 6px, bottom over by 6px");
 *  ② 判得太松：只判"覆盖住工作区"就放过 —— 而被钳到比屏幕还大的窗口同样能覆盖住。
 *  ② Judging too loosely: passing as long as it "covers the work area" —— yet a window clamped larger than the screen also covers it.
 * 光靠"verify-entry 现在通过了"证明不了这两点不会再回来，所以把边界情形固化成用例。
 * "verify-entry passes now" alone cannot prove these two will not return, so the boundary cases are frozen as test cases.
 *
 * 所有数字都来自 `desktop/probe-window.mjs` 与 `shot-window.ps1` 的实测输出
 * All numbers come from the real output of `desktop/probe-window.mjs` and `shot-window.ps1`
 * （本机：屏幕 1440×960、工作区 1440×912、不可见边框 8px、DPR 2）。
 * (this machine: screen 1440×960, work area 1440×912, invisible border 8px, DPR 2).
 *
 * 纯 Node，不需要 NODE_PATH：`node desktop/test-wingeom.mjs`
 * Pure Node, no NODE_PATH needed: `node desktop/test-wingeom.mjs`
 */
import { judgeWindow, parseRect, parseSize, describeWindowVerdict } from "./wingeom.mjs";

const WORKAREA = "1440x912";
const FRAME = 8;

let pass = 0, fail = 0;
const ok = (name, cond, info) => {
  if (cond) { pass++; console.log("  ✓ " + name + (info ? "  → " + info : "")); }
  else { fail++; console.log("  ✗ " + name + (info ? "  → " + info : "")); }
};
const group = (t) => console.log("\n" + t);

/* ---------------- 1. 解析 / 1. Parsing ---------------- */
group("1. 解析探针输出");
ok("rect 能解析（含负坐标）",
  JSON.stringify(parseRect("-7,-7 1453x925")) === JSON.stringify({ left: -7, top: -7, width: 1453, height: 925 }),
  JSON.stringify(parseRect("-7,-7 1453x925")));
ok("rect 能解析（正坐标）", !!parseRect("10,10 1455x975"));
ok("空/畸形 rect 返回 null", parseRect("") === null && parseRect("junk") === null && parseRect("10,10 1455") === null);
ok("workarea 能解析", JSON.stringify(parseSize("1440x912")) === JSON.stringify({ w: 1440, h: 912 }));

/* ---------------- 2. 应当拒绝（真实的坏窗口） / 2. Must reject (real bad windows) ---------------- */
group("2. 必须拒绝的形态（全部来自实测记录的坏窗口）");

const badReal = judgeWindow({
  rect: { left: 10, top: 10, width: 1455, height: 975 },   // 旧快捷方式 --window-size=1560,980 实测 / measured with the old shortcut's --window-size=1560,980
  workarea: WORKAREA, zoomed: false, frameborder: FRAME,
});
ok("旧参数实测 1455x975 @(10,10)、非最大化 → 拒绝", badReal.ok === false,
  "mode=" + badReal.mode + " 越界 右" + badReal.over.right + " 下" + badReal.over.bottom);
ok("  越界量与被裁量一致（右 25px / 下 73px）",
  badReal.over.right === 25 && badReal.over.bottom === 73,
  "右" + badReal.over.right + " 下" + badReal.over.bottom);
ok("  非最大化时容差为 0（判别力不被容差削弱）", badReal.tol === 0, "tol=" + badReal.tol);

/* 关键回归：即使把它**误当成最大化**，也必须被"尺寸上限"挡住 */
/* Key regression: even if it is **mistaken for maximized**, it must still be blocked by the "size upper bound" */
const badAsZoomed = judgeWindow({
  rect: { left: 10, top: 10, width: 1455, height: 975 },
  workarea: WORKAREA, zoomed: true, frameborder: FRAME,
});
ok("同一个坏窗口若被误判成最大化 → 仍拒绝（靠尺寸上限）",
  badAsZoomed.ok === false && badAsZoomed.sizeOk === false,
  "sizeOk=" + badAsZoomed.sizeOk + " mode=" + badAsZoomed.mode);

const badExact = judgeWindow({
  rect: { left: 10, top: 10, width: 1440, height: 912 },    // 尺寸正好等于工作区，仍从 (10,10) 起画 / size exactly equals the work area, yet still drawn from (10,10)
  workarea: WORKAREA, zoomed: false, frameborder: FRAME,
});
ok("1440x912 @(10,10)（尺寸等于工作区）→ 拒绝", badExact.ok === false,
  "越界 右" + badExact.over.right + " 下" + badExact.over.bottom);

/* ---------------- 3. 应当接受（真实的窗口） / 3. Must accept (real windows) ---------------- */
group("3. 必须接受的形态（全部来自实测记录的好窗口）");

const goodMax = judgeWindow({
  rect: { left: -7, top: -7, width: 1453, height: 925 },   // --start-maximized 实测（Win32 口径） / --start-maximized measured (Win32 convention)
  workarea: WORKAREA, zoomed: true, frameborder: FRAME,
});
ok("新参数实测 -7,-7 1453x925、已最大化 → 接受", goodMax.ok === true,
  "mode=" + goodMax.mode + " tol=" + goodMax.tol + " 越界 左" + goodMax.over.left + " 右" + goodMax.over.right);
ok("  容差由边框推导（8 + 2 = 10），四边越界都不超过它",
  goodMax.tol === 10 && goodMax.over.left <= goodMax.tol && goodMax.over.right <= goodMax.tol &&
  goodMax.over.top <= goodMax.tol && goodMax.over.bottom <= goodMax.tol,
  "越界 左" + goodMax.over.left + " 上" + goodMax.over.top + " 右" + goodMax.over.right + " 下" + goodMax.over.bottom);

/* 不传边框宽时不能白送容差 —— 否则等于把判据放宽 */
/* When the border width is not passed, tolerance must not be granted for free —— otherwise it amounts to loosening the predicate */
const zoomedNoFrame = judgeWindow({
  rect: { left: -7, top: -7, width: 1453, height: 925 },
  workarea: WORKAREA, zoomed: true, frameborder: 0,
});
ok("最大化但探针没报边框宽 → 不白送容差，仍拒绝",
  zoomedNoFrame.ok === false, "tol=" + zoomedNoFrame.tol + " mode=" + zoomedNoFrame.mode);

const goodNormal = judgeWindow({
  rect: { left: 100, top: 50, width: 1000, height: 700 },   // 普通窗口，四边都在里面 / a normal window, all four edges inside
  workarea: WORKAREA, zoomed: false, frameborder: FRAME,
});
ok("普通窗口 1000x700 @(100,50)、四边都在里面 → 接受", goodNormal.ok === true, "mode=" + goodNormal.mode);

/* 全屏（盖住任务栏）比的是**整屏**，不是工作区 —— 搞反会把任务栏那 48px 判成越界 */
/* Fullscreen (covering the taskbar) compares against the **whole screen**, not the work area —— reversing it flags the taskbar's 48px as out-of-bounds */
const SCREEN = "1440x960";
const fullscreen = judgeWindow({
  rect: { left: 0, top: 0, width: 1440, height: 960 },      // 高 960 = 整屏（含任务栏） / height 960 = whole screen (including the taskbar)
  workarea: WORKAREA, screen: SCREEN, fullscreen: true, frameborder: FRAME,
});
ok("全屏 1440x960（比整屏）→ 接受",
  fullscreen.ok === true && fullscreen.target === "screen",
  "mode=" + fullscreen.mode + " target=" + fullscreen.target + " 越界 下" + fullscreen.over.bottom);

const fullscreenWs = judgeWindow({
  rect: { left: -7, top: -7, width: 1454, height: 974 },     // 全屏 + 不可见边框（Win32 口径） / fullscreen + invisible border (Win32 convention)
  workarea: WORKAREA, screen: SCREEN, fullscreen: true, frameborder: FRAME,
});
ok("全屏含不可见边框（-7,-7 1454x974）→ 接受", fullscreenWs.ok === true, "mode=" + fullscreenWs.mode);

const fsAgainstWa = judgeWindow({
  rect: { left: 0, top: 0, width: 1440, height: 960 },
  workarea: WORKAREA, fullscreen: true, frameborder: FRAME,   // 没给 screen / no screen given
});
ok("全屏但拿不到整屏尺寸 → 退回工作区比对，判失败（不静默通过）",
  fsAgainstWa.ok === false && fsAgainstWa.target === "workarea",
  "target=" + fsAgainstWa.target + " 越界 下" + fsAgainstWa.over.bottom);

/* ---------------- 4. 边界：缺数据不能静默通过 / 4. Boundary: missing data must not pass silently ---------------- */
group("4. 数据不全时必须判失败（不能默认通过）");
ok("无 rect → 失败", judgeWindow({ rect: null, workarea: WORKAREA }).ok === false);
ok("无 workarea → 失败", judgeWindow({ rect: { left: 0, top: 0, width: 100, height: 100 }, workarea: "" }).ok === false);
ok("workarea 畸形 → 失败", judgeWindow({ rect: { left: 0, top: 0, width: 100, height: 100 }, workarea: "abc" }).ok === false);

/* ---------------- 5. 说明文案包含四边越界数 / 5. The description text includes the out-of-bounds counts on all four sides ---------------- */
group("5. 判据说明");
const desc = describeWindowVerdict(badReal, {
  rect: { left: 10, top: 10, width: 1455, height: 975 }, workarea: WORKAREA, zoomed: false, frameborder: FRAME,
});
ok("说明里带四边越界与容差", /左0 上0 右25 下73px/.test(desc) && /容差 0px/.test(desc), desc);

console.log("\n" + (fail === 0
  ? "✅ 窗口几何判据：" + pass + " 项断言全部满足"
  : "❌ 窗口几何判据：失败 " + fail + " 项，通过 " + pass + " 项"));
process.exit(fail === 0 ? 0 : 1);
