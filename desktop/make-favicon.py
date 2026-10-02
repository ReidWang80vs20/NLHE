#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把图标渲染结果作为 favicon **内嵌**进 index.html（data URI）。
Embed the icon render result into index.html as a favicon (data URI).

为什么必须做这一步（本文件存在的唯一理由）：
Why this step is mandatory (the sole reason this file exists):
    Windows 任务栏按钮画的是**窗口图标**，不是 .lnk 里的 .ico。
    The Windows taskbar button draws the **window icon**, not the .ico inside the .lnk.
    Chrome 用 `--app=<URL>` 开应用模式窗口时，窗口图标取自**页面 favicon**；
    When Chrome opens an app-mode window with `--app=<URL>`, the window icon comes from the **page favicon**;
    页面没声明 favicon 时 Chrome 回退到自带的灰色默认应用图标 ——
    if the page declares no favicon, Chrome falls back to its bundled grey default app icon ——
    桌面/任务栏那个灰方块就是这么来的，跟图标文件做得多漂亮毫无关系。
    that is where the grey square on the desktop/taskbar comes from, with no relation to how nice the icon file is.
    实测：同一命令行、同一档案，只把 favicon 从"无"换成纯品红，
    Measured: with the same command line and same profile, changing only the favicon from "none" to pure magenta
          窗口图标（WM_GETICON）就从灰 #666666 变成整块品红。
          turned the window icon (WM_GETICON) from grey #666666 into solid magenta.

为什么内嵌而不是放个同级的 favicon.png：
Why embed it instead of placing a sibling favicon.png:
    poker-trainer.html 的定位是"单个 HTML 拷到哪都能跑"，
    poker-trainer.html is meant to be "a single HTML that runs wherever you copy it",
    外链 png 会跟主文件分家，一旦分家又退回灰色图标，且没有任何报错。
    an external png would become separated from the main file; once separated it reverts to the grey icon, with no error at all.

用法：python make-favicon.py
Usage: python make-favicon.py
     （前置：node render-icon.mjs icon-source-compact.html icon-compact-1024.png）
     (prerequisite: node render-icon.mjs icon-source-compact.html icon-compact-1024.png)
"""
import base64
import io
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    print("缺少 Pillow：pip install Pillow")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "icon-compact-1024.png")   # 紧凑版：小尺寸下标记更清楚 / compact version: the mark is clearer at small sizes
HTML = os.path.join(ROOT, "index.html")
SIZE = 128

BEGIN = "<!-- favicon:BEGIN 由 desktop/make-favicon.py 生成，请勿手改 -->"
END = "<!-- favicon:END -->"
BLOCK = re.compile(
    re.escape(BEGIN) + r".*?" + re.escape(END), re.DOTALL)

if not os.path.exists(SRC):
    print("缺少源图：" + SRC + "（先运行 node render-icon.mjs）")
    sys.exit(1)
if not os.path.exists(HTML):
    print("找不到 " + HTML)
    sys.exit(1)

im = Image.open(SRC).convert("RGBA").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
buf = io.BytesIO()
im.save(buf, "PNG", optimize=True)
blob = buf.getvalue()
uri = "data:image/png;base64," + base64.b64encode(blob).decode("ascii")

# 自校验：data URI 必须能还原成同样是 SIZE×SIZE 的 PNG，否则说明编码环节坏了
# Self-check: the data URI must decode back to a PNG of the same SIZE×SIZE, otherwise the encoding step is broken
back = Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1])))
if back.size != (SIZE, SIZE) or back.mode != "RGBA":
    print("自校验失败：data URI 回读为 %s %s" % (back.size, back.mode))
    sys.exit(1)

new_block = (
    BEGIN + "\n"
    "<!-- 内嵌 favicon = Chrome 应用模式窗口/任务栏图标的唯一来源；删掉这行图标就变灰 -->\n"
    '<link rel="icon" type="image/png" href="' + uri + '">\n'
    + END
)

html = open(HTML, "r", encoding="utf-8").read()

if BLOCK.search(html):
    old_len = len(BLOCK.search(html).group(0))
    html = BLOCK.sub(lambda m: new_block, html, count=1)
    action = "已替换"
else:
    m = re.search(r"^<title>.*?</title>\s*$", html, re.MULTILINE)
    if not m:
        print("在 index.html 里找不到 <title> 行，无法确定插入位置")
        sys.exit(1)
    html = html[:m.end()] + "\n" + new_block + html[m.end():]
    old_len = 0
    action = "已插入"

open(HTML, "w", encoding="utf-8", newline="").write(html)

# 落盘校验：文件里必须真的能搜到 data URI，且长度对得上
# On-disk check: the newly generated data URI must really be findable in the file, and the length must match
check = open(HTML, "r", encoding="utf-8").read()
if uri not in check:
    print("写入失败：index.html 中找不到刚生成的 data URI")
    sys.exit(1)
if check.count(BEGIN) != 1 or check.count(END) != 1:
    print("写入异常：标记出现次数不为 1（BEGIN=%d / END=%d）"
          % (check.count(BEGIN), check.count(END)))
    sys.exit(1)

print("%s favicon 块：%d → %d 字符" % (action, old_len, len(new_block)))
print("  PNG %d×%d  %.2f KB  →  base64 %.2f KB"
      % (SIZE, SIZE, len(blob) / 1024, len(uri) / 1024))
print("  目标文件 " + HTML)
print("  下一步：node build.js（把 favicon 一起带进 poker-trainer.html）")
