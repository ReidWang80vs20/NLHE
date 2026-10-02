#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 1024px PNG 合成为多尺寸 .ico。
Compose 1024px PNGs into a multi-size .ico.

两点关键做法：
Two key techniques:
1) 小尺寸（<=48px）换用"标记占比更大"的紧凑版源图 —— 强行缩放常规版会让 16px 糊成一团；
1) For small sizes (<=48px) switch to the "larger mark ratio" compact source image —— force-scaling the regular version makes 16px a blurry mess;
2) 额外输出一份"文件名带内容哈希"的版本化副本 —— Windows 图标缓存以图标**路径**为键，
2) Additionally output a versioned copy with a "content hash in the filename" —— the Windows icon cache is keyed by icon **path**,
   同名替换 .ico 内容不会刷新缓存，换名必然未命中。
   so replacing the .ico contents under the same name does not refresh the cache, while renaming is guaranteed to miss the old entry.
用法：python make-icon.py
Usage: python make-icon.py
"""
import glob
import hashlib
import os
import shutil
import struct
import sys
import io

try:
    from PIL import Image
except ImportError:
    print("缺少 Pillow：pip install Pillow")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
BIG = os.path.join(HERE, "icon-1024.png")            # 常规版：细节完整 / regular version: full detail
SMALL = os.path.join(HERE, "icon-compact-1024.png")  # 紧凑版：标记更大 / compact version: larger mark
ICO = os.path.join(HERE, "nlhe.ico")
PREFIX = "nlhe"

for p in (BIG, SMALL):
    if not os.path.exists(p):
        print("缺少源图：" + p + "（先运行 node render-icon.mjs）")
        sys.exit(1)

# (尺寸, 使用的源图) / (size, source image used)
PLAN = [
    (256, BIG), (128, BIG), (64, BIG),
    (48, SMALL), (32, SMALL), (24, SMALL), (20, SMALL), (16, SMALL),
]

entries = []
for size, src in PLAN:
    im = Image.open(src).convert("RGBA")
    buf = io.BytesIO()
    im.resize((size, size), Image.Resampling.LANCZOS).save(buf, "PNG", optimize=True)
    entries.append((size, buf.getvalue()))

# 手写 ICO 容器（PNG 压缩条目，Vista+ 支持） / hand-written ICO container (PNG-compressed entries, supported by Vista+)
header = struct.pack("<HHH", 0, 1, len(entries))
offset = 6 + 16 * len(entries)
directory = b""
body = b""
for size, blob in entries:
    dim = 0 if size >= 256 else size          # ICO 里 0 表示 256 / in ICO, 0 means 256
    directory += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(blob), offset)
    offset += len(blob)
    body += blob

with open(ICO, "wb") as f:
    f.write(header + directory + body)

# 校验：回读尺寸清单必须与计划一致
# Verification: the read-back size list must match the plan
# 注意 PIL 的 info["sizes"] 是 (w, h) 元组集合，不能拿整数直接比
# Note that PIL's info["sizes"] is a set of (w, h) tuples, so integers cannot be compared against it directly
with Image.open(ICO) as im:
    got = sorted(im.info.get("sizes", []))
want = sorted({(s, s) for s, _ in PLAN})
ok = got == want
print("生成 nlhe.ico  " + str(len(entries)) + " 个尺寸  " +
      str(round(os.path.getsize(ICO) / 1024, 1)) + " KB")
print("  尺寸校验：" + ("通过 " if ok else "失败 ") +
      str([s[0] for s in got]))
if not ok:
    sys.exit(1)

# 版本化副本：文件名随内容变化，绕开图标缓存
# Versioned copy: the filename changes with the content, bypassing the icon cache
digest = hashlib.md5(entries[0][1]).hexdigest()[:8]
versioned = os.path.join(HERE, "%s-%s.ico" % (PREFIX, digest))
shutil.copyfile(ICO, versioned)

# 清理历史版本，只留当前这份
# Clean up historical versions, keeping only the current one
for f in glob.glob(os.path.join(HERE, PREFIX + "-*.ico")):
    if os.path.abspath(f) != os.path.abspath(versioned):
        os.remove(f)

print("版本化图标：" + os.path.basename(versioned))
