/**
 * 窗口几何判据 —— 「这扇窗口有没有被屏幕裁掉？」的唯一权威实现。
 * Window geometry predicate —— the single authoritative implementation of "is this window clipped by the screen?".
 *
 * 抽成独立模块是为了能被 `test-wingeom.mjs` 用**实测记录里的坏数据**钉住：
 * It was split into its own module so that `test-wingeom.mjs` can pin it down with **bad data from real test records**:
 * 这条规则踩过两次坑，一次是判据本身的假阳性（把最大化窗口的不可见边框当成越界），
 * This rule has been burned twice, once by a false positive in the predicate itself (treating a maximized window's invisible border as out-of-bounds),
 * 一次是判得太松（"能覆盖住工作区"就放过，被钳到比屏幕还大的窗口也能覆盖住）。
 * and once by judging too loosely (passing anything that "covers the work area", which a window clamped larger than the screen also does).
 *
 * ── 三个坐标系（务必分清，混用必然出错） 
 * ── Three coordinate systems (keep them straight; mixing them is guaranteed to fail) ─────────────────────────────
 *  1. CSS px（页面侧 CDP `window.outerWidth/Height`）：**不含**不可见调整边框。
 *  1. CSS px (page-side CDP `window.outerWidth/Height`): does **not** include the invisible resize border.
 *     最大化窗口在此口径下恰好等于工作区（本机 1440×912 @ 0,0）。
 *     Under this convention a maximized window is exactly the work area (this machine: 1440×912 @ 0,0).
 *  2. 物理 px（浏览器侧 CDP `Browser.getWindowForTarget` 的 bounds、Win32 GetWindowRect）：
 *  2. Physical px (browser-side CDP `Browser.getWindowForTarget` bounds, Win32 GetWindowRect):
 *     **含**那圈边框，最大化窗口会四边外溢各约 7~8px（本机 rect `-7,-7 1453x925`）。
 *     **includes** that border, so a maximized window overflows about 7~8px on each side (this machine's rect `-7,-7 1453x925`).
 *  3. 工作区（`screen.availWidth/Height` 与 Win32 `WorkingArea`）：两者在本机一致（1440×912）。
 *  3. Work area (`screen.availWidth/Height` and Win32 `WorkingArea`): the two agree on this machine (1440×912).
 *  判据 1 与 2 的差异**只出现在最大化时**；非最大化时两口径读数完全相同。
 *  The difference between conventions 1 and 2 appears **only when maximized**; when not maximized the two readings are identical.
 *
 * ── 判据 
 * ── Predicate ────────────────────────────────────────────────────────────
 *  要么「严格落在目标区」（普通窗口，四边都在里面，0 容差），
 *  Either 「strictly inside the target area」 (a normal window, all four edges inside, 0 tolerance),
 *  要么「贴合目标区」（最大化/全屏，允许一圈不可见边框的容差，且外框不得大于
 *  or 「flush with the target area」 (maximized/fullscreen, allowing the tolerance of one invisible border, with the frame no larger than
 *  「目标区 + 2×容差」—— 堵住"尺寸超屏但恰好覆盖住目标区"这个漏洞）。
 *  「target area + 2×tolerance」 —— closing the loophole of "bigger than the screen yet just covers the target area").
 *  **不允许"一半在里面一半在外面"** —— 这正是用户报的"右边和底部被遮住"。
 *  **"Half in, half out" is not allowed** —— this is exactly the user's report of "the right and bottom being covered".
 *
 *  目标区随窗口状态而变：**最大化比工作区**（不含任务栏），
 *  The target area changes with window state: **maximized compares against the work area** (excluding the taskbar),
 *  **全屏比整屏**（含任务栏）。搞反了就会把正常的全屏窗口判成越界
 *  **fullscreen compares against the whole screen** (including the taskbar). Reversing them marks a normal fullscreen window as out-of-bounds
 *  （本机工作区 912 高、整屏 960 高，差 48px 就是任务栏）。
 *  (this machine: work area 912 high, whole screen 960 high; the 48px difference is the taskbar).
 */

/**
 * 解析 `shot-window.ps1` 输出的 `rect=LEFT,TOP WxH`。
 * Parse the `rect=LEFT,TOP WxH` line output by `shot-window.ps1`.
 * @returns {{left:number,top:number,width:number,height:number}|null}
 */
export function parseRect(s) {
  const m = /^(-?\d+),(-?\d+) (\d+)x(\d+)$/.exec(s || "");
  return m ? { left: +m[1], top: +m[2], width: +m[3], height: +m[4] } : null;
}

/** 解析 `workarea=WxH`。 / Parse `workarea=WxH`. */
export function parseSize(s) {
  const m = /^(\d+)x(\d+)$/.exec(s || "");
  return m ? { w: +m[1], h: +m[2] } : null;
}

/**
 * 判定窗口是否完整可见。
 * Decide whether the window is fully visible.
 * @param {object} o
 * @param {{left:number,top:number,width:number,height:number}} o.rect 物理外框 / physical frame
 * @param {string|{w:number,h:number}} o.workarea 工作区（`WxH` 或已解析） / work area (`WxH` or already parsed)
 * @param {string|{w:number,h:number}} [o.screen] 整屏（全屏模式下的比对基准） / whole screen (fullscreen baseline)
 * @param {boolean} [o.zoomed]     Win32 `IsZoomed`（= 浏览器侧 `windowState==="maximized"`）
 *     Win32 `IsZoomed` (= browser-side `windowState==="maximized"`)
 * @param {boolean} [o.fullscreen] 浏览器处于全屏（`windowState==="fullscreen"` 或 display-mode）
 *     the browser is in fullscreen (`windowState==="fullscreen"` or display-mode)
 * @param {number}  [o.frameborder] `SM_CXSIZEFRAME + SM_CXPADDEDBORDER`
 * @returns {{ok:boolean, mode:'inside'|'covers'|'straddle'|'unparsed', tol:number,
 *            sizeOk:boolean, target:'screen'|'workarea', targetSize:{w:number,h:number}|null,
 *            over:{left:number,top:number,right:number,bottom:number}}}
 */
export function judgeWindow({ rect, workarea, screen, zoomed = false, fullscreen = false, frameborder = 0 }) {
  const sc = typeof screen === "string" ? parseSize(screen) : screen;
  const wa = typeof workarea === "string" ? parseSize(workarea) : workarea;
  /* 全屏要比整屏；拿工作区比会把任务栏那 48px 判成越界（真实误报）。 */
  /* Fullscreen must compare against the whole screen; comparing against the work area flags the taskbar's 48px as out-of-bounds (a real false positive). */
  const useScreen = fullscreen && !!sc;
  const target = useScreen ? sc : wa;
  if (!rect || !target) {
    return { ok: false, mode: "unparsed", tol: 0, sizeOk: false,
      target: "workarea", targetSize: null, over: { left: 0, top: 0, right: 0, bottom: 0 } };
  }
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  /* 容差**只对最大化/全屏生效**，且由探针报出的边框宽推导，不是拍脑袋的魔数。
     Tolerance **applies only to maximized/fullscreen** and is derived from the border width the probe reports, not a magic number pulled from thin air.
     非最大化窗口 0 容差 —— 当初那个 1455×975 @(10,10) 的坏窗口因此照样被抓住。
     Non-maximized windows get 0 tolerance —— which is why that bad 1455×975 @(10,10) window was still caught. */
  const tol = (zoomed || fullscreen) ? Number(frameborder || 0) + 2 : 0;

  const inside = rect.left >= 0 && rect.top >= 0 && right <= target.w && bottom <= target.h;
  /* 尺寸上限：外框最多比目标区大「两圈边框」。
     Size upper bound: the frame may be at most 「two borders」 larger than the target area.
     少了这条，一个被钳到比屏幕还大的窗口会因为"覆盖住目标区"而被放过。
     Without this, a window clamped larger than the screen would slip through because it "covers the target area". */
  const sizeOk = rect.width <= target.w + 2 * tol && rect.height <= target.h + 2 * tol;
  const covers = sizeOk &&
    rect.left <= tol && rect.top <= tol &&
    right >= target.w - tol && bottom >= target.h - tol;

  return {
    ok: inside || covers,
    mode: inside ? "inside" : covers ? "covers" : "straddle",
    tol, sizeOk,
    target: useScreen ? "screen" : "workarea",
    targetSize: target,
    over: {
      left: Math.max(0, -rect.left),
      top: Math.max(0, -rect.top),
      right: Math.max(0, right - target.w),
      bottom: Math.max(0, bottom - target.h),
    },
  };
}

export const WINDOW_OK_LABEL =
  "窗口完整可见（要么贴合工作区、要么严格落在其内，不存在一部分在屏幕外）";

/**
 * 生成给人看的判据说明（含四个方向的越界 px 与容差来历）。
 * Generate a human-readable verdict description (including the out-of-bounds px in all four directions and the origin of the tolerance).
 */
export function describeWindowVerdict(v, { rect, workarea, screen, zoomed, fullscreen, frameborder }) {
  const target = v.targetSize || parseSize(workarea);
  const mode = { inside: "严格落在其内", covers: "贴合" + (v.target === "screen" ? "整屏（全屏）" : "工作区（最大化）"), straddle: "两部分都在外面" }[v.mode] || "无法判定";
  const avail = target ? target.w + "x" + target.h : "(缺)";
  const box = rect ? rect.left + "," + rect.top + " " + rect.width + "x" + rect.height : "(缺)";
  return (v.target === "screen" ? "整屏 " : "工作区 ") + avail + "，窗口 " + box + "  → " + mode +
    "（越界 左" + v.over.left + " 上" + v.over.top + " 右" + v.over.right + " 下" + v.over.bottom + "px；" +
    "容差 " + v.tol + "px" +
    ((zoomed || fullscreen) ? "，含 " + frameborder + "px 不可见边框" : "") +
    (v.sizeOk ? "" : "，尺寸超出上限") + "）";
}
