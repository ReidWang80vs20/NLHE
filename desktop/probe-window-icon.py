# -*- coding: utf-8 -*-
"""
读取顶层窗口的真实图标（WM_GETICON / GetClassLongPtr），并导出为 PNG。
Read a top-level window's real icon (WM_GETICON / GetClassLongPtr) and export it as a PNG.

为什么需要它：Windows 任务栏按钮画的是**窗口图标**，不是快捷方式 .lnk 里的图标。
Why it is needed: the Windows taskbar button draws the **window icon**, not the icon inside a shortcut .lnk.
所以"桌面图标好看"不代表"任务栏图标好看"。截屏判界面受遮挡、DPI、缩放干扰，
So "the desktop icon looks good" does not mean "the taskbar icon looks good". Screenshots are disturbed by occlusion, DPI, and scaling,
本探针直接问 Windows 要 HICON，是任务栏图标的唯一权威来源。
so this probe asks Windows directly for the HICON, the sole authoritative source of the taskbar icon.

取像素的两条路（按可信度排序）：
Two ways to read pixels (in order of trustworthiness):
  1) color-bitmap —— GetIconInfo 拿到 hbmColor，用 GetDIBits 直接读位图。
  1) color-bitmap —— GetIconInfo yields hbmColor, and GetDIBits reads the bitmap directly.
     像素**原样**、alpha 通道**真实**，不做任何二次绘制。首选。
     Pixels are **as-is** and the alpha channel is **real**, with no re-drawing. Preferred.
  2) draw-to-canvas —— 图标没有 color bitmap（纯 mask 图标）时，退回
  2) draw-to-canvas —— when the icon has no color bitmap (a pure-mask icon), fall back to
     DrawIconEx 画到品红底 DIB 上再读回来。此时没有 alpha，只能靠"和品红不同"
     drawing it with DrawIconEx onto a magenta-based DIB and reading it back. There is no alpha then, so "different from magenta"
     来判断哪些是图标像素，所以统计时要按容差剔除抗锯齿过渡色。
     is the only way to tell which pixels are the icon, so anti-aliased transition colors must be excluded by a tolerance when tallying.

用法：
Usage:
    python probe-window-icon.py <标题子串> <输出PNG>
    python probe-window-icon.py <title substring> <output PNG>

输出（key=value，一行一个）：
Output (key=value, one per line):
    found=1 / found=0
    hwnd=0x...
    source=wm_geticon_big | wm_geticon_small | wm_geticon_small2 | class_hicon | class_hiconsm | none
    pixels=color-bitmap | draw-to-canvas
    size=WxH
    coverage=0.4123            # 图标有效像素占画布比例
    coverage=0.4123            # ratio of valid icon pixels to the canvas
    bbox=x,y,w,h
    mean=r,g,b
    top=rrggbb:0.812           # 占比最高的颜色（按 4bit/通道量化）
    top=rrggbb:0.812           # the highest-ratio color (quantized to 4 bits/channel)
"""
import ctypes
import json
import os
import sys

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

WM_GETICON = 0x007F
ICON_SMALL, ICON_BIG, ICON_SMALL2 = 0, 1, 2
GCLP_HICON, GCLP_HICONSM = -14, -34
DI_NORMAL = 0x0003
DIB_RGB_COLORS = 0

CANVAS = 256
SENTINEL = (255, 0, 255)  # 品红：不可能出现在灰阶 Chrome 默认图标里 / magenta: cannot appear in the greyscale Chrome default icon
TOL = 24


class ICONINFO(ctypes.Structure):
    _fields_ = [
        ("fIcon", ctypes.c_int),
        ("xHotspot", ctypes.c_uint32),
        ("yHotspot", ctypes.c_uint32),
        ("hbmMask", ctypes.c_void_p),
        ("hbmColor", ctypes.c_void_p),
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", ctypes.c_uint32),
        ("biWidth", ctypes.c_int32),
        ("biHeight", ctypes.c_int32),
        ("biPlanes", ctypes.c_uint16),
        ("biBitCount", ctypes.c_uint16),
        ("biCompression", ctypes.c_uint32),
        ("biSizeImage", ctypes.c_uint32),
        ("biXPelsPerMeter", ctypes.c_int32),
        ("biYPelsPerMeter", ctypes.c_int32),
        ("biClrUsed", ctypes.c_uint32),
        ("biClrImportant", ctypes.c_uint32),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", ctypes.c_uint32 * 3)]


class BITMAP(ctypes.Structure):
    _fields_ = [
        ("bmType", ctypes.c_int32), ("bmWidth", ctypes.c_int32),
        ("bmHeight", ctypes.c_int32), ("bmWidthBytes", ctypes.c_int32),
        ("bmPlanes", ctypes.c_uint16), ("bmBitsPixel", ctypes.c_uint16),
        ("bmBits", ctypes.c_void_p),
    ]


# ⚠️ 以下 restype/argtypes 不是可选项：ctypes 默认把返回值当 c_int，
# ⚠️ The following restype/argtypes are not optional: ctypes treats return values as c_int by default,
#    64 位下句柄（HICON/HDC/HBITMAP）会被截断成垃圾值，表现为"画布全品红"。
#    so on 64-bit, handles (HICON/HDC/HBITMAP) get truncated to garbage, showing up as "the whole canvas magenta".
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
user32.GetWindowTextLengthW.argtypes = [ctypes.c_void_p]
user32.IsWindowVisible.argtypes = [ctypes.c_void_p]
user32.GetIconInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(ICONINFO)]
user32.GetDC.restype = ctypes.c_void_p
user32.GetDC.argtypes = [ctypes.c_void_p]
user32.ReleaseDC.restype = ctypes.c_int
user32.ReleaseDC.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
user32.FillRect.restype = ctypes.c_int
user32.FillRect.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
user32.DrawIconEx.restype = ctypes.c_int
user32.DrawIconEx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                              ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                              ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
gdi32.CreateDIBSection.restype = ctypes.c_void_p
gdi32.CreateDIBSection.argtypes = [
    ctypes.c_void_p, ctypes.POINTER(BITMAPINFO), ctypes.c_uint,
    ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, ctypes.c_uint32,
]
gdi32.CreateCompatibleDC.restype = ctypes.c_void_p
gdi32.CreateCompatibleDC.argtypes = [ctypes.c_void_p]
gdi32.CreateSolidBrush.restype = ctypes.c_void_p
gdi32.CreateSolidBrush.argtypes = [ctypes.c_uint32]
gdi32.SelectObject.restype = ctypes.c_void_p
gdi32.SelectObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
gdi32.DeleteObject.argtypes = [ctypes.c_void_p]
gdi32.DeleteDC.argtypes = [ctypes.c_void_p]
gdi32.GetObjectW.restype = ctypes.c_int
gdi32.GetObjectW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
gdi32.GetDIBits.restype = ctypes.c_int
gdi32.GetDIBits.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint,
                            ctypes.c_void_p, ctypes.POINTER(BITMAPINFO), ctypes.c_uint]

if hasattr(user32, "GetClassLongPtrW"):
    user32.GetClassLongPtrW.restype = ctypes.c_void_p
    user32.GetClassLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int]

    def class_long(hwnd, idx):
        return user32.GetClassLongPtrW(hwnd, idx) or 0
else:  # 32 位解释器兜底 / fallback for a 32-bit interpreter
    user32.GetClassLongW.restype = ctypes.c_uint32
    user32.GetClassLongW.argtypes = [ctypes.c_void_p, ctypes.c_int]

    def class_long(hwnd, idx):
        return user32.GetClassLongW(hwnd, idx) or 0


def find_window(substr):
    """按标题子串找**最顶层**的可见窗口，返回 (hwnd, title)。
    Find the **topmost** visible window whose title contains the substring; returns (hwnd, title)."""
    hits = []
    low = substr.lower()

    @WNDENUMPROC
    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n <= 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        if low in buf.value.lower():
            hits.append((hwnd, buf.value))
        return True

    user32.EnumWindows(cb, 0)
    return hits[0] if hits else (None, "")


def get_hicon(hwnd):
    """优先取 WM_SETICON 显式设置的图标；都没有再退回窗口类的图标。
    Prefer the icon explicitly set via WM_SETICON; if none, fall back to the window-class icon."""
    for msg_id, name in ((ICON_BIG, "wm_geticon_big"),
                         (ICON_SMALL2, "wm_geticon_small2"),
                         (ICON_SMALL, "wm_geticon_small")):
        h = user32.SendMessageW(hwnd, WM_GETICON, msg_id, None)
        if h:
            return h, name
    h = class_long(hwnd, GCLP_HICON)
    if h:
        return h, "class_hicon"
    h = class_long(hwnd, GCLP_HICONSM)
    if h:
        return h, "class_hiconsm"
    return 0, "none"


def _bmi(w, h, bpp):
    b = BITMAPINFO()
    b.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    b.bmiHeader.biWidth = w
    b.bmiHeader.biHeight = -h          # 负值 = 自上而下，省得翻行 / negative = top-down, avoiding row flipping
    b.bmiHeader.biPlanes = 1
    b.bmiHeader.biBitCount = bpp
    b.bmiHeader.biCompression = 0      # BI_RGB
    return b


def render(hicon):
    """返回 (bgra_bytes, w, h, method)。method 见文件头。
    Returns (bgra_bytes, w, h, method). See the file header for method."""
    fi = ICONINFO()
    if not user32.GetIconInfo(hicon, ctypes.byref(fi)):
        raise OSError("GetIconInfo 失败")

    # --- 路径 1：直接读 color bitmap（原样像素 + 真实 alpha） ---
    # --- Path 1: read the color bitmap directly (as-is pixels + real alpha) ---
    if fi.hbmColor:
        bm = BITMAP()
        gdi32.GetObjectW(fi.hbmColor, ctypes.sizeof(BITMAP), ctypes.byref(bm))
        if bm.bmWidth > 0 and bm.bmHeight > 0 and bm.bmBitsPixel == 32:
            w, h = bm.bmWidth, bm.bmHeight
            bmi = _bmi(w, h, 32)
            buf = ctypes.create_string_buffer(w * h * 4)
            hdc = user32.GetDC(None)
            n = gdi32.GetDIBits(hdc, fi.hbmColor, 0, h, buf, ctypes.byref(bmi), DIB_RGB_COLORS)
            user32.ReleaseDC(None, hdc)
            if n == h:
                gdi32.DeleteObject(fi.hbmColor)
                if fi.hbmMask:
                    gdi32.DeleteObject(fi.hbmMask)
                return buf.raw, w, h, "color-bitmap"

    # --- 路径 2：没有 color bitmap，退回画到品红底 ---
    # --- Path 2: no color bitmap, fall back to drawing onto a magenta background ---
    hdc_screen = user32.GetDC(None)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)
    bmi = _bmi(CANVAS, CANVAS, 32)
    bits = ctypes.c_void_p()
    hbmp = gdi32.CreateDIBSection(hdc_screen, ctypes.byref(bmi), 0,
                                  ctypes.byref(bits), None, 0)
    if not hbmp:
        raise OSError("CreateDIBSection 失败")
    gdi32.SelectObject(hdc_mem, hbmp)

    # 品红填充（BRUSH 的 colorref 是 0x00BBGGRR）
    # Fill with magenta (a BRUSH colorref is 0x00BBGGRR)
    brush = gdi32.CreateSolidBrush(SENTINEL[2] << 16 | SENTINEL[1] << 8 | SENTINEL[0])
    rc = ctypes.c_int32 * 4
    r = rc(0, 0, CANVAS, CANVAS)
    user32.FillRect(hdc_mem, ctypes.byref(r), brush)
    gdi32.DeleteObject(brush)

    cx, cy = CANVAS, CANVAS
    if fi.hbmColor:
        bm = BITMAP()
        gdi32.GetObjectW(fi.hbmColor, ctypes.sizeof(BITMAP), ctypes.byref(bm))
        if bm.bmWidth > 0 and bm.bmHeight > 0:
            cx, cy = bm.bmWidth, bm.bmHeight
    user32.DrawIconEx(hdc_mem, 0, 0, hicon, cx, cy, 0, None, DI_NORMAL)

    buf = ctypes.string_at(bits, CANVAS * CANVAS * 4)
    gdi32.DeleteObject(hbmp)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(None, hdc_screen)
    if fi.hbmColor:
        gdi32.DeleteObject(fi.hbmColor)
    if fi.hbmMask:
        gdi32.DeleteObject(fi.hbmMask)
    return buf, CANVAS, CANVAS, "draw-to-canvas"


def is_bg(p):
    """判定"背景像素"：与哨兵色的切比雪夫距离 <= TOL（仅 draw-to-canvas 路径需要）。
    Decide "background pixels": Chebyshev distance to the sentinel color <= TOL (needed only on the draw-to-canvas path).

    不能只比对精确相等 —— DrawIconEx 的边缘抗锯齿会把品红和图标色混出
    Exact equality is not enough —— DrawIconEx's edge anti-aliasing blends magenta and icon colors into
    一堆接近品红的过渡色（实测 bucket ff00ff 占到 15.6%），把它们当"图标像素"
    a pile of magenta-like transition colors (bucket ff00ff measured at 15.6%); counting them as "icon pixels"
    统计会让占比最高的颜色变成品红，掩盖真正的图标主色。
    would make the highest-ratio color magenta, masking the icon's true dominant color.
    """
    return max(abs(p[0] - SENTINEL[0]), abs(p[1] - SENTINEL[1]), abs(p[2] - SENTINEL[2])) <= TOL


def analyse(buf, w, h, method):
    px = []
    for i in range(0, len(buf), 4):
        px.append((buf[i + 2], buf[i + 1], buf[i]))   # BGRA -> RGB

    if method == "color-bitmap":
        # alpha 是真的，直接用它划"有效像素"
        # alpha is real, so use it directly to mark "valid pixels"
        alphas = [buf[i + 3] for i in range(0, len(buf), 4)]
        mask = [a > 8 for a in alphas]
    else:
        mask = [not is_bg(p) for p in px]

    n = sum(mask)
    if not n:
        return {"solid_sentinel": True, "coverage": 0.0, "bbox": [0, 0, 0, 0],
                "mean": list(SENTINEL), "top": [], "alpha": 0.0}
    xs = [i % w for i, m in enumerate(mask) if m]
    ys = [i // w for i, m in enumerate(mask) if m]
    sel = [p for p, m in zip(px, mask) if m]
    mean = tuple(sum(c[k] for c in sel) // n for k in range(3))

    from collections import Counter
    cnt = Counter(((c[0] >> 4) << 8 | (c[1] >> 4) << 4 | (c[2] >> 4)) for c in sel)
    top = [("%02x%02x%02x" % (((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17), round(k / n, 3))
           for v, k in cnt.most_common(4)]
    return {
        "solid_sentinel": False,
        "coverage": round(n / len(px), 4),
        "bbox": [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1],
        "mean": list(mean),
        "top": top,
        "alpha": round(sum(1 for a in [buf[i + 3] for i in range(0, len(buf), 4)] if a > 8) / len(px), 4),
    }


def color_stats(px_hits):
    """红/白/中性灰计数 —— 判读"是不是我们的图标"用。
    Red/white/neutral-grey counts —— used to judge "is it our icon"."""
    red = white = grey = 0
    for r, g, b in px_hits:
        if r > 140 and g < 110 and b < 120:
            red += 1
        elif min(r, g, b) > 200:
            white += 1
        elif abs(r - g) < 14 and abs(g - b) < 14 and 70 < r < 180:
            grey += 1
    return red, white, grey


def save_png(buf, w, h, method, out):
    """写出 PNG。
    Write out a PNG.

    注意：`buf` 是 BGRA 裸像素，不是 PNG 文件 —— 不能先落盘再用 `Image.open` 打开
    Note: `buf` is raw BGRA pixels, not a PNG file —— it cannot be written to disk and then opened with `Image.open`
    （会 UnidentifiedImageError）。要用 `Image.frombytes` 从内存构造。
    (that raises UnidentifiedImageError). Use `Image.frombytes` to construct it from memory.
    """
    b = bytearray(buf)
    if method != "color-bitmap":
        for i in range(0, len(b), 4):
            b[i + 3] = 0 if is_bg((b[i + 2], b[i + 1], b[i])) else 255
    try:
        from PIL import Image
        raw = Image.frombytes("RGBA", (w, h), bytes(b))
        b0, b1, b2, b3 = raw.split()                 # 落盘顺序 B,G,R,A -> b0=B b1=G b2=R b3=A / on-write order B,G,R,A -> b0=B b1=G b2=R b3=A
        Image.merge("RGBA", (b2, b1, b0, b3)).save(out, "PNG")
    except Exception as e:
        with open(out, "wb") as f:
            f.write(b"BGRA%dx%d\n" % (w, h) + bytes(b))
        print("warn=Pillow 不可用，已回退裸 BGRA（%s）" % e)


def main():
    if len(sys.argv) < 3:
        print("用法: python probe-window-icon.py <标题子串> <输出PNG>")
        return 2
    substr, out = sys.argv[1], sys.argv[2]
    hwnd, title = find_window(substr)
    if not hwnd:
        print("found=0")
        print("title_match=" + substr)
        return 1

    hicon, source = get_hicon(hwnd)
    print("found=1")
    print("hwnd=0x%x" % hwnd)
    print("title=" + title)
    print("source=" + source)
    if not hicon:
        print("error=窗口未提供任何图标")
        return 1

    buf, w, h, method = render(hicon)
    print("pixels=%s" % method)
    print("size=%dx%d" % (w, h))
    print("sentinel=%d,%d,%d" % SENTINEL)

    st = analyse(buf, w, h, method)
    if st.get("solid_sentinel"):
        print("coverage=0.0")
        print("bbox=0,0,0,0")
        print("mean=%d,%d,%d" % SENTINEL)
        print("note=图标整块等于哨兵色，即 favicon 颜色（强证据：窗口图标取自 favicon）")
    else:
        print("coverage=%s" % st["coverage"])
        print("alpha_coverage=%s" % st["alpha"])
        print("bbox=%s" % ",".join(map(str, st["bbox"])))
        print("mean=%s" % ",".join(map(str, st["mean"])))
        for k, v in st["top"]:
            print("top=%s:%s" % (k, v))
        hits = []
        for i in range(0, len(buf), 4):
            p = (buf[i + 2], buf[i + 1], buf[i])          # BGRA -> RGB
            # 与 analyse 用**同一条**取像素规则，否则两条路（真 alpha / 品红底）
            # Use the **same** pixel-selection rule as analyse, otherwise the two paths (real alpha / magenta background)
            # 会算出互相矛盾的红白灰计数
            # would produce mutually contradictory red/white/grey counts
            keep = buf[i + 3] > 8 if method == "color-bitmap" else (not is_bg(p))
            if keep:
                hits.append(p)
        red, white, grey = color_stats(hits)
        print("rgb_red=%d" % red)
        print("rgb_white=%d" % white)
        print("rgb_neutralgrey=%d" % grey)

    save_png(buf, w, h, method, out)
    print("saved=" + os.path.abspath(out))
    print(json.dumps(st, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
