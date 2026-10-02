# 桌面入口管线 / Desktop entry pipeline

把 `poker-trainer.html` 做成「双击桌面图标、以应用模式打开」的入口。

Turn `poker-trainer.html` into an entry that "double-clicks a desktop icon and opens in app mode".

**入口形态**：Chrome（或 Edge）`--app` 模式 —— 无地址栏、无标签栏的独立窗口，
任务栏独立显示，观感与原生应用一致。

**Entry form**: Chrome (or Edge) `--app` mode — a standalone window without an address bar or tab strip,
shown separately in the taskbar, with a native-app look and feel.

---

## 文件清单 / File list

| 文件 / File | 作用 / Purpose |
| --- | --- |
| `icon-source.html` | 图标源（常规版）：深翡翠圆角底 + 白色黑桃 + 右上红心 / Icon source (regular): deep-emerald rounded tile + white spade + red heart at top-right |
| `icon-source-compact.html` | 图标源（紧凑版）：标记占更大，供 ≤48px 使用 / Icon source (compact): larger mark, for ≤48px use |
| `render-icon.mjs` | 无头浏览器把图标源渲染成 1024px 透明 PNG / Headless browser renders the icon source into a 1024px transparent PNG |
| `make-icon.py` | 多尺寸 ICO 合成 + 版本化副本 / Multi-size ICO assembly + versioned copies |
| `make-favicon.py` | 把图标**内嵌**进 `index.html` 的 favicon（data URI）——**运行窗口图标的唯一来源**，理由见陷阱 11 / **Embeds** the icon into `index.html`'s favicon (data URI) — **the only source of the running-window icon**, see Pitfall 11 for why |
| `probe-window-icon.py` | 读窗口真实图标（`WM_GETICON`）并导出 PNG —— 任务栏按钮画的就是它 / Reads the window's real icon (`WM_GETICON`) and exports a PNG — that is exactly what the taskbar button draws |
| `probe-app-icon.mjs` | 用**快捷方式同一套命令行**开窗，跑上面的探针（`--real` 用真实档案） / Opens a window with **the same command line as the shortcut** and runs the probe above (`--real` uses the real profile) |
| `diag-cdp.mjs` | CDP 通道诊断：逐条表达式计时，区分"通道坏了"和"某条表达式坏了" / CDP channel diagnosis: times each expression, distinguishing "the channel is broken" from "one expression is broken" |
| `browser.mjs` | 浏览器探测（Chrome > Edge），被其它脚本共用 / Browser detection (Chrome > Edge), shared by other scripts |
| `proc.mjs` | 进程调用封装（**一律异步**，理由见陷阱 6） / Process-invocation wrapper (**always async**, see Pitfall 6 for why) |
| `create-shortcut.vbs` | 写 `.lnk`（由脚本宿主执行） / Writes `.lnk` (executed by the script host) |
| `vbs.mjs` | 由 node 调起脚本宿主并解析回传 / Node launches the script host and parses its output |
| `run-vbs.mjs` | `vbs.mjs` 的命令行包装 / Command-line wrapper for `vbs.mjs` |
| `lnk.mjs` | 直接解析 `.lnk` 二进制做校验（含 `--window-size` 提取） / Parses the `.lnk` binary directly for validation (including `--window-size` extraction) |
| `wingeom.mjs` | **窗口几何判据**：判定窗口是否被屏幕裁掉（容差推导、目标区选择都在这里） / **Window-geometry criterion**: decides whether a window is clipped off-screen (tolerance derivation and target-area selection live here) |
| `make-shortcut.mjs` | **一键**：探测浏览器 → 选图标 → 写快捷方式 → 校验 / **One-shot**: detect browser → pick icon → write shortcut → validate |
| `shot-window.ps1` | 按窗口标题定位 → 取窗口画面 → 关闭窗口（画面仅留档，不作判定依据） / Locate by window title → capture window image → close window (the image is archived only, not used as evidence) |
| `probe-window.mjs` | **窗口尺寸探针**：同一参数开窗，读出屏幕/工作区/窗口外框/`windowState`，判定是否被裁 / **Window-size probe**: opens a window with the same args and reads screen/work area/window frame/`windowState` to decide whether it is clipped |
| `probe-fullscreen.mjs` | **全屏状态流转探针**：装"黑匣子"记录 `requestFullscreen` 的 resolve/reject 与两种 `fullscreenchange`，定位"全屏进去了但事件没发"（理由见陷阱 10）。`node probe-fullscreen.mjs [focus]` / **Fullscreen state-transition probe**: installs a "black box" recording `requestFullscreen`'s resolve/reject and both `fullscreenchange` events, to locate "fullscreen entered but no event fired" (see Pitfall 10). `node probe-fullscreen.mjs [focus]` |
| `probe-window-icon.py` | **窗口图标探针**：读 `WM_GETICON` 导出 PNG，判定任务栏按钮实际画的是什么（陷阱 11） / **Window-icon probe**: reads `WM_GETICON`, exports a PNG, and decides what the taskbar button actually draws (Pitfall 11) |
| `test-shortcut-args.mjs` | 在项目内临时目录验证"新参数能否正确写入 .lnk"（不碰桌面） / Validates in a temp dir inside the project whether "new args can be written into the .lnk correctly" (does not touch the desktop) |
| `test-wingeom.mjs` | **窗口几何判据的单元测试**（20 项，用实测的坏/好窗口数据钉住规则） / **Unit tests for the window-geometry criterion** (20 cases, pinning the rules with measured bad/good window data) |
| `verify-render.mjs` | **渲染验收**：同一命令行启动 Chrome 应用模式 + CDP 读真实 DOM / **Render validation**: launches Chrome app mode with the same command line + reads the real DOM via CDP |
| `verify-entry.mjs` | **入口验收**：快捷方式内容 + 真实渲染 + 双击联动，三段独立成立 / **Entry validation**: shortcut contents + real rendering + double-click integration, three independently valid sections |

---

## 一键重建 / One-click rebuild

```bash
# 只重建快捷方式（改路径 / 换浏览器 / 换图标后）
node make-shortcut.mjs

# 改自定义名字
node make-shortcut.mjs "我的扑克室"
```

图标内容改变后，需要先重新生成图标再重建快捷方式：

After the icon content changes, you must regenerate the icon first, then rebuild the shortcut:

```bash
node render-icon.mjs icon-source.html icon-1024.png
node render-icon.mjs icon-source-compact.html icon-compact-1024.png
python make-icon.py            # -> nlhe.ico + nlhe-<hash>.ico（桌面/固定项用）
python make-favicon.py         # -> 内嵌进 index.html 的 favicon（运行窗口用）
node build.js                  # 重新打包单文件产物
node make-shortcut.mjs "NLHE练习室"
```

> [!] `make-icon.py` 与 `make-favicon.py` **缺一不可**：前者管桌面图标，后者管
> 运行中窗口的任务栏按钮。只做前者，任务栏就是 Chrome 的灰色默认图标（见陷阱 11）。
>
> [!] `make-icon.py` and `make-favicon.py` are **both required**: the former handles the desktop icon, the latter the
> taskbar button of the running window. Doing only the former leaves the taskbar with Chrome's default gray icon (see Pitfall 11).
>
> [!] `make-shortcut.mjs` 最后一步通常会失败：桌面已有同名 `.lnk` 时**覆盖不了**
> （陷阱 7），需要先由用户删掉那个图标再跑。
>
> [!] The last step of `make-shortcut.mjs` usually fails: an existing same-named `.lnk` on the desktop **cannot be overwritten**
> (Pitfall 7); the user must delete that icon first and rerun.

`make-icon.py` 会额外输出一份文件名带内容哈希的副本（如 `nlhe-f75723da.ico`），
快捷方式引用的是**这份**。原因见下方陷阱 3。

`make-icon.py` additionally outputs a copy whose filename carries a content hash (e.g. `nlhe-f75723da.ico`),
and the shortcut references **this** copy. See Pitfall 3 below for why.

---

## 开窗方式：为什么**不能**写死 `--window-size` / Window opening: why you **must not** hard-code `--window-size`

快捷方式用的是 `--app=<URL> --start-maximized`。

The shortcut uses `--app=<URL> --start-maximized`.

曾经写死 `--window-size=1560,980`，在 1440×960（工作区 1440×912）的屏幕上实测：

A hard-coded `--window-size=1560,980` was once used; measured on a 1440×960 screen (work area 1440×912):

| 请求 / Request | 实际外框 / Actual frame | 位置 / Position | 后果 / Consequence |
| --- | --- | --- | --- |
| 1560,980 | 1455×975 | (10,10) | 右缘超出 **25px**、下缘超出 **73px** / right edge over by **25px**, bottom edge over by **73px** |
| 1920,1040 | 1455×975 | (10,10) | 同上（被钳到屏幕尺寸附近） / same as above (clamped near the screen size) |
| 1440,912（正好等于工作区） / 1440,912 (exactly the work area) | 1440×912 | (10,10) | 仍各超出 **10px** / still over by **10px** on each side |

表现为"右边和底部被遮住、看着像错位"——不是报错，只是内容跑到屏幕外了。

It shows up as "the right and bottom are covered, looking misaligned" — not an error, just content running off-screen.

两个必须记住的点：

Two points to remember:

1. **`--window-size` 与 `--start-maximized` 同传时，尺寸参数胜出**，最大化被忽略。
   所以"加了最大化参数"不等于修好，必须**同时去掉** `--window-size`。
2. **靠调数字治不好**：即使把尺寸改成恰好等于工作区，Chrome 仍从 (10,10) 起画，
   照样溢出 10px。只有让浏览器**自行按当前工作区适配**（`--start-maximized`）才与分辨率无关。

1. **When `--window-size` and `--start-maximized` are passed together, the size wins**, and maximization is ignored.
   So "adding the maximize flag" is not a fix; you must **remove `--window-size` at the same time**.
2. **Tweaking the numbers does not fix it**: even with the size set exactly to the work area, Chrome still draws from (10,10)
   and overflows by 10px. Only letting the browser **adapt to the current work area on its own** (`--start-maximized`) is resolution-independent.

想要"真全屏"（盖住任务栏、无窗口边框）：应用内 <kbd>F11</kbd> 或顶栏 **⛶** 按钮，
用的是 Fullscreen API，<kbd>Esc</kbd> 退出。启动参数 `--start-fullscreen` 也能做到，
但那样连任务栏都看不到，且退出方式不直观，故不作默认。

For "true fullscreen" (covering the taskbar, no window border): press <kbd>F11</kbd> in-app or the top-bar **⛶** button,
which uses the Fullscreen API; <kbd>Esc</kbd> exits. The `--start-fullscreen` launch flag also works,
but then even the taskbar is hidden and the exit method is unintuitive, so it is not the default.

**验收方式**：`node probe-window.mjs`（看窗口外框 vs 工作区），以及 `verify-entry.mjs` 的
C 段断言「窗口完整可见」——判据是**四边**与工作区比较，数字说话，不靠肉眼：

**How to validate**: `node probe-window.mjs` (compare the window frame vs the work area), plus `verify-entry.mjs`'s
section C assertion "window fully visible" — the criterion compares **all four edges** against the work area, and the numbers decide, not the eye:

- **贴合工作区**（最大化 / 全屏：窗口铺满可用区域并允许"不可见边框"级容差），或
- **严格落在工作区内**（普通窗口：四边都在里面，0 容差）。

- **Snug to the work area** (maximized / fullscreen: the window fills the usable area with a tolerance of the "invisible border" level), or
- **Strictly inside the work area** (normal window: all four edges inside, 0 tolerance).

**不允许"一半在里面一半在外面"** —— 当初那个 1455×975 @(10,10) 的坏窗口
两个条件都不满足，照样被抓住。容差的来历见陷阱 9。

**"Half in, half out" is not allowed** — the original bad window of 1455×975 @(10,10)
satisfies neither condition and is still caught. See Pitfall 9 for where the tolerance comes from.

---

## 验收 / Validation

```bash
node verify-entry.mjs          # 入口验收，窗口自动关闭
node verify-entry.mjs --keep   # 保留窗口
node verify-render.mjs         # 只跑渲染验收（21 项断言）
node test-wingeom.mjs          # 窗口几何判据单元测试（20 项，纯 Node）
node probe-window.mjs          # 开窗尺寸探针（不碰桌面，可随时跑）
node probe-app-icon.mjs        # 应用窗口图标探针（陷阱 11；默认临时档案，加 --real 用真实档案）
node diag-cdp.mjs              # CDP 通道诊断（陷阱 12）
node test-shortcut-args.mjs    # 验证参数能否正确写入 .lnk（写临时目录）
```

`verify-entry.mjs` 的 A 段按**内容**在桌面上找 `.lnk`（扫目标里含 `poker-trainer.html`
的那个），不写死文件名 —— 桌面图标被用户改名后，写死名字会让验收去验一个不存在的入口，
而失败信息看起来像"你没建快捷方式"，很能骗人。

Section A of `verify-entry.mjs` finds the `.lnk` on the desktop by **content** (scanning for the one whose target contains
`poker-trainer.html`), not by a hard-coded filename — once the user renames the desktop icon, a hard-coded name would make the validation check a nonexistent entry,
and the failure message would look like "you didn't create a shortcut", which is very misleading.

`verify-entry.mjs` 分三段，逐段独立成立，任何一段的假阳性都不会掩盖整体结论：

`verify-entry.mjs` has three sections, each independently valid, so a false positive in any one cannot mask the overall conclusion:

| 段 / Section | 内容 / Content | 依据 / Basis |
| --- | --- | --- |
| A | 快捷方式内容 / Shortcut contents | 直接解析 `.lnk` 二进制：目标浏览器、`--app=` 参数、页面文件名、图标位置、**开窗方式** / Parse the `.lnk` binary directly: target browser, `--app=` arg, page filename, icon location, **window-opening mode** |
| B | 真实渲染 / Real rendering | 用同一套命令行启动 Chrome，CDP 连进页面断言 DOM（见下） / Launch Chrome with the same command line and assert the DOM via CDP (see below) |
| C | 双击联动 / Double-click integration | 实际打开 `.lnk`，确认出现标题与 `document.title` 一致的窗口，**且窗口完整在屏幕内** / Actually open the `.lnk` and confirm a window appears whose title matches `document.title`, **and the window is fully on-screen** |

B 段是本项目**唯一可信的"画面确实渲染出来了"的证据**。它会额外加
`--remote-debugging-port=0`（系统分配空闲端口）与独立 `--user-data-dir`
（不加会复用你手上已开的 Chrome，拿不到 target），并断言：

Section B is this project's **only trustworthy evidence that "the screen really rendered"**. It additionally adds
`--remote-debugging-port=0` (an OS-assigned free port) and a separate `--user-data-dir`
(without it, your already-open Chrome is reused and no target is obtained), and asserts:

- 页面地址确实是打包产物、`document.title` 正确
- 牌桌元素有尺寸、`--ui-scale` 已写入、座位数与位置标签数量一致且不重复
- 牌已发出（张数 ≥ 人数 × 2）、`Game` 实例存在且 `players` 与座位数相同
- 引擎/界面/持久化/复盘/训练/题库/胜率模块全部装载
- **全屏开关**：点击后 `document.fullscreenElement` 真的非空、按钮状态同步、
  全屏下牌桌比例仍为 16:9.4、退出后回到未全屏
- `localStorage` 可用（持久化的前提，`file://` 下尤为关键）
- 无未捕获异常、无控制台错误

- The page URL is indeed the bundled artifact and `document.title` is correct
- The poker-table element has a size, `--ui-scale` has been written, and the seat count and position-label count match and are not duplicated
- Cards have been dealt (count ≥ players × 2), the `Game` instance exists, and `players` equals the seat count
- The engine/UI/persistence/replay/training/question-bank/equity modules are all loaded
- **Fullscreen toggle**: after clicking, `document.fullscreenElement` is truly non-null, the button state stays in sync,
  the table ratio under fullscreen is still 16:9.4, and it returns to non-fullscreen after exiting
- `localStorage` is available (a prerequisite for persistence, especially critical under `file://`)
- No uncaught exceptions and no console errors

C 段仍会留一张截图到 `test/shots/20-桌面入口打开.png`，但**只作留档**；
若本次是屏幕抓图且窗口不在前台，输出会明确标注"拍到的是桌面，不作判定依据"。

Section C still leaves a screenshot at `test/shots/20-桌面入口打开.png`, but **for archival only**;
if this run is a screen capture and the window is not in the foreground, the output explicitly notes "what was captured is the desktop, not used as evidence".

失败则给出非零退出码。

On failure it returns a non-zero exit code.

---

## 十二个已踩过的陷阱 / Twelve pitfalls already hit

改这套脚本前务必先读，全部是实测结论。

Read this before modifying these scripts; everything here is a measured conclusion.

### 1. 脚本宿主：必须用控制台宿主，且**不要加 `//B`** / Script host: use the console host and **do not add `//B`**

- GUI 宿主（`wscript`）的 `WScript.Echo` 会变成**消息框**，拿不到 stdout；
- `//B`（批处理模式）**会连 `Echo` 的输出一并吞掉**，父进程收到空 stdout。
  它抑制的不只是错误弹窗。

- A GUI host (`wscript`) turns `WScript.Echo` into a **message box**, so stdout is unavailable;
- `//B` (batch mode) **swallows the `Echo` output too**, and the parent process receives empty stdout.
  It suppresses more than just error dialogs.

正确组合：控制台宿主 + `//Nologo` + `//T:20`（超时兜底，防模态框无限阻塞）。

Correct combination: console host + `//Nologo` + `//T:20` (a timeout fallback to prevent a modal box from blocking forever).

### 2. `.ps1` 必须纯 ASCII / `.ps1` must be pure ASCII

PowerShell 5.1 按 ANSI 读取**无 BOM** 的 `.ps1`。文件里写中文注释会让后续字节被错解，
症状是**报错位置指向毫不相干的 `param()` 块**（如 "意外的标记 )"），排查方向被严重误导。

PowerShell 5.1 reads a **BOM-less** `.ps1` as ANSI. Chinese comments in the file cause subsequent bytes to be misdecoded,
and the symptom is that **the error location points at an unrelated `param()` block** (e.g. "unexpected token )"), badly misleading your debugging.

### 3. Windows 图标缓存以**图标路径**为键 / The Windows icon cache is keyed by **icon path**

同名替换 `.ico` 文件内容**不会**刷新桌面图标。删除重建 `.lnk` 也无效。
正解是让图标**文件名随内容变化**（哈希后缀），路径一变必然缓存未命中。
`make-icon.py` 已内置：自动生成版本化副本并清理历史版本。

Replacing the contents of a same-named `.ico` file **does not** refresh the desktop icon. Deleting and recreating the `.lnk` does not help either.
The right fix is to make the icon **filename change with the content** (hash suffix), so any path change is necessarily a cache miss.
`make-icon.py` builds this in: it auto-generates versioned copies and cleans up old versions.

> ⚠️ 这条只管**桌面图标和任务栏固定项**。应用**运行中**的任务栏按钮是另一套来源，
> 见陷阱 11 —— 两件事必须分别做，只做这条会得到"桌面好看、任务栏是灰的"。
>
> ⚠️ This only covers the **desktop icon and the taskbar pinned item**. The taskbar button of a **running** app comes from a different source,
> see Pitfall 11 — the two things must be done separately; doing only this yields "nice desktop, gray taskbar".

### 4. `powershell.exe -File` 传非 ASCII 参数不可靠 / `powershell.exe -File` is unreliable for non-ASCII arguments

实测把中文路径当参数传给 `.ps1`，脚本内收到的是**空值**（快捷方式名恰好是中文）。
`verify-shortcut.ps1` 因此被废弃，改为 `lnk.mjs` 直接**解析 .lnk 二进制**做校验 ——
不涉及参数传递，不依赖 COM，也不启动额外进程。

Measured: passing a Chinese path as an argument to a `.ps1` makes the script receive an **empty value** (the shortcut name happens to be Chinese).
`verify-shortcut.ps1` was therefore abandoned and replaced with `lnk.mjs`, which **parses the .lnk binary** directly for validation —
no argument passing, no COM dependency, and no extra process spawned.

同一坑的另一面：`shot-window.ps1` 的匹配串特意选 **ASCII 子串**（`NLHE Trainer`），
而不是中文标题，正是为了绕开参数编码问题。

The other side of the same pitfall: `shot-window.ps1` deliberately chooses an **ASCII substring** (`NLHE Trainer`) as its match string,
rather than the Chinese title, precisely to sidestep the argument-encoding problem.

### 5. 屏幕截图不能当判定依据（**最危险的一个**） / A screenshot cannot serve as evidence (**the most dangerous one**)

`verify-entry.mjs` 最初判定"入口正常"的依据是"存在标题匹配的窗口 + 截图已保存"。
实测发现这是**假阳性**：窗口虽然存在，但被压在其它窗口之下（Windows 前台锁定会拒绝
后台进程的 `SetForegroundWindow`，即使调用 `AttachThreadInput` 也未必成功），
此时 `CopyFromScreen` 拍到的是桌面壁纸 —— 1.89 MB 的照片，文件"保存成功"，
却完全没证明游戏渲染出来了。

`verify-entry.mjs` initially judged "the entry is fine" by "a title-matching window exists + the screenshot was saved".
Measurement showed this is a **false positive**: the window exists but is buried under other windows (Windows foreground lock rejects
a background process's `SetForegroundWindow`, and even calling `AttachThreadInput` may not succeed),
so `CopyFromScreen` captures the desktop wallpaper — a 1.89 MB photo, the file "saved successfully",
yet it proves nothing about the game having rendered.

两条抓图路线都不可靠：

Both capture routes are unreliable:

- `CopyFromScreen`：依赖窗口真的在最前，被遮挡就拍到别的东西；
- `PrintWindow(h, hdc, PW_RENDERFULLCONTENT)`：不依赖遮挡，但 Chrome 的
  GPU 合成窗口会返回**空白图**（本项目实测采样色数远低于有效阈值）。

- `CopyFromScreen`: depends on the window really being on top; if occluded it captures something else;
- `PrintWindow(h, hdc, PW_RENDERFULLCONTENT)`: does not depend on occlusion, but Chrome's
  GPU-composited window returns a **blank image** (in this project the sampled color count measured far below the effective threshold).

正解是**别用像素判定**：改用 CDP 读页面真实 DOM（`verify-render.mjs`）。
截图降级为留档证据，并且在不可信时于输出中明确标注。

The right fix is to **not judge by pixels**: read the page's real DOM via CDP instead (`verify-render.mjs`).
The screenshot is demoted to archival evidence and is explicitly flagged in the output when untrustworthy.

附带教训：**取快照必须等状态到达**。`Game` 实例在构造阶段就已存在（`players` 已就位）
但尚未发牌，若此时取快照，"牌面已发出"会假失败；判定条件必须等到"进入某条街且有牌"。

Side lesson: **a snapshot must wait for the state to arrive**. The `Game` instance already exists at construction time (`players` in place)
but no cards have been dealt yet; taking a snapshot then makes "cards dealt" falsely fail; the condition must wait for "a street has started and cards are present".

同一条教训在**全屏断言**上又栽了一次：全屏切换是有动画的异步过程，用固定 `sleep 800`
等状态，同一份代码单独跑 5 项全过、被 `verify-entry` 嵌套调用时挂了 2 项。
改成**轮询到状态改变**（每 150ms 一次，5s 上限）后 3/3 稳定。

The same lesson bit again on the **fullscreen assertion**: fullscreen toggling is an animated async process, and using a fixed `sleep 800`
to wait for the state made the same code pass all 5 items when run alone but fail 2 items when nested inside `verify-entry`.
Changing to **polling until the state changes** (every 150ms, 5s cap) made it 3/3 stable.

### 6. `spawnSync` 创建子进程一律 EBUSY —— **必须改异步 `spawn`** / `spawnSync` always returns EBUSY for child processes — **you must switch to async `spawn`**

本环境实测：`spawnSync` 起任何进程都失败 —— node 自身、`cmd`、`powershell`、
脚本宿主、Chrome 全部是 `EBUSY`；**把同一目标换成异步 `spawn` 则全部正常**。
所以这不是"某个可执行被拉黑"，而是**同步创建子进程被挡**。

Measured in this environment: `spawnSync` fails to start any process — node itself, `cmd`, `powershell`,
the script host, Chrome are all `EBUSY`; **switching the same target to async `spawn` works fine**.
So this is not "some executable is blacklisted" but rather **synchronous child-process creation being blocked**.

这个失败特别有欺骗性：

This failure is especially deceptive:

- 不抛异常；
- `status` 是 `null`，不是非零退出码；
- 只在返回值上挂一个 `.error.code = "EBUSY"`。

- It does not throw;
- `status` is `null`, not a non-zero exit code;
- It only attaches a `.error.code = "EBUSY"` to the return value.

老代码 `spawnSync(...)` 后面若只看 `r.status`，会把失败当成"没输出"继续往下跑，
最终表现为"脚本没生效"而不是"报错"——本项目就是这么被瞒了几轮。
所有进程调用现已收口到 `proc.mjs`（`runCapture` / `spawnDetached` / `killTree`），
**新代码不要再直接用 `spawnSync`**。

If old code after `spawnSync(...)` looks only at `r.status`, it treats the failure as "no output" and keeps going,
ending up as "the script didn't take effect" rather than "an error" — this project was fooled this way for several rounds.
All process invocations are now funneled into `proc.mjs` (`runCapture` / `spawnDetached` / `killTree`),
**new code must not use `spawnSync` directly**.

排查用：`node desktop/diag-spawn.mjs`（同步 vs 异步的对照矩阵）。

For troubleshooting: `node desktop/diag-spawn.mjs` (a sync-vs-async comparison matrix).

### 7. 桌面目录受保护：既有文件**既不能改也不能删** / The desktop directory is protected: existing files **can neither be modified nor deleted**

在桌面（工作目录之外的个人目录）上：

On the desktop (a personal directory outside the working directory):

| 操作 / Operation | 结果 / Result |
| --- | --- |
| 新建一个**不存在**的文件 / Create a file that **does not exist** | ✅ 可以 / ✅ allowed |
| 覆盖/追加打开**已存在**的文件 / Overwrite/append-open an **existing** file | ❌ `EPERM` |
| 重命名已存在的文件 / Rename an existing file | ❌ `EPERM` |
| 删除文件（含刚自己新建的 `.lnk`） / Delete a file (including a `.lnk` just created) | ❌ 走 `[safe-delete]`→回收站，报 "Some operations were aborted" / ❌ goes through `[safe-delete]`→recycle bin, reporting "Some operations were aborted" |

后果：`make-shortcut.mjs` 里 `lnk.Save` 覆盖旧 `.lnk` 会失败（"无法保存快捷方式到…"），
**而这台机器上没有任何脚本手段能绕过**（沙箱外执行同样失败）。
更新桌面快捷方式的唯一办法是**先由用户删掉旧图标**，再重新创建。

Consequence: in `make-shortcut.mjs`, `lnk.Save` overwriting the old `.lnk` fails ("cannot save shortcut to…"),
**and no scripting means on this machine can bypass it** (running outside the sandbox fails too).
The only way to update the desktop shortcut is for **the user to delete the old icon first**, then recreate it.

`test-shortcut-args.mjs` 因此把验证写在项目内的临时目录里 —— 那是可自由读写的，
能在麻烦用户之前先证明"参数写对了"。

`test-shortcut-args.mjs` therefore writes its validation to a temp dir inside the project — which is freely readable/writable —
so it can prove "the args are written correctly" before troubling the user.

### 8. 「文件存在」**不等于**「写入成功」 / "The file exists" **does not equal** "the write succeeded"

`make-shortcut.mjs` 原来判定成功的依据是 `fs.existsSync(lnkPath)`。
旧 `.lnk` 一直躺在桌面上，于是**即使 VBS 完全失败，校验也照样通过**，
检查项显示 ✓ 而参数其实是旧的 —— 实测就这么被瞒过去一次
（`--start-maximized` 没写进去，却报"成功"）。

`make-shortcut.mjs` originally judged success by `fs.existsSync(lnkPath)`.
The old `.lnk` was always sitting on the desktop, so **even if the VBS failed completely, the check still passed**,
showing ✓ while the args were actually old — this fooled it once in a real run
(`--start-maximized` was not written in, yet it reported "success").

正解是记录操作前后的 `mtime`，**要求它必须变化**；同时把脚本宿主的回传
（`result=` / `reason=`）打到控制台，失败时能直接看到原因。

The right fix is to record the `mtime` before and after and **require it to change**; also print the script host's return
(`result=` / `reason=`) to the console so the reason is directly visible on failure.

### 9. 最大化窗口的 `GetWindowRect` 会**超出屏幕** —— 别把它判成"被裁" / A maximized window's `GetWindowRect` **extends beyond the screen** — don't judge it as "clipped"

修好开窗方式后，`verify-entry` 的 C 段仍报红：

After fixing the window-opening mode, `verify-entry`'s section C still reported red:

```
工作区 1440x912，窗口右缘 1446 / 下缘 918  ← 超出 右6px 下6px
```

这是**断言自己的假阳性**。`GetWindowRect` 对**最大化**窗口会多算一圈
「不可见调整边框」（`SM_CXSIZEFRAME + SM_CXPADDEDBORDER`，本机 8px），
实测 rect 是 `-7,-7 1453x925` —— 左/上各 7px、右/下各 6px，**四边对称**，
而那段像素不遮挡任何内容（Windows 用它做边缘吸附预览）。

This is **the assertion's own false positive**. `GetWindowRect` over-counts an extra
"invisible sizing border" for a **maximized** window (`SM_CXSIZEFRAME + SM_CXPADDEDBORDER`, 8px on this machine),
and the measured rect is `-7,-7 1453x925` — 7px on the left/top and 6px on the right/bottom, **symmetric on all four edges**,
while that band of pixels occludes nothing (Windows uses it for edge-snap preview).

**三个测量通道已实测对齐**（同一台机、同一份代码、全新 profile）：

**Three measurement channels measured and aligned** (same machine, same code, fresh profile):

| 通道 / Channel | 旧参数 `--window-size=1560,980` / Old arg `--window-size=1560,980` | 新参数 `--start-maximized` / New arg `--start-maximized` |
| --- | --- | --- |
| 页面侧 CDP `outerWidth/Height`（CSS px） / Page-side CDP `outerWidth/Height` (CSS px) | 1455×975 @ (10,10) | 1440×912 @ (0,0) |
| 浏览器侧 CDP `Browser.getWindowForTarget` / Browser-side CDP `Browser.getWindowForTarget` | `state=normal` | `state=maximized` |
| Win32 `GetWindowRect` / `IsZoomed` | `zoomed=0`，`10,10 1455x975` | `zoomed=1`，`-7,-7 1453x925` |

- CDP 页面侧与 Win32 **只在最大化时**有差异，差的正是那圈边框（CSS 口径不含、Win32 含）；
  非最大化时两者读数完全一致 —— 所以旧缺陷三个通道都指向同一个 1455×975。
- **`windowState` 是最权威的判别**，`IsZoomed` 与它语义一致（0↔normal、1↔maximized）。
  `probe-window.mjs` 已把这一栏打出来，遇到窗口尺寸问题先看它，不用再从 `outerWidth` 反推。

- The page-side CDP and Win32 differ **only when maximized**, and the difference is exactly that border band (CSS excludes it, Win32 includes it);
  when not maximized the two readings are identical — so the old defect points all three channels at the same 1455×975.
- **`windowState` is the most authoritative discriminator**, and `IsZoomed` agrees in semantics (0↔normal, 1↔maximized).
  `probe-window.mjs` already prints this field; for window-size problems look at it first instead of reverse-engineering from `outerWidth`.

正解不是把容差拍成一个魔数，而是**让探针报出 `zoomed` 与 `frameborder`，由调用方推导**：

The right fix is not to hard-code the tolerance as a magic number, but to **have the probe report `zoomed` and `frameborder` and let the caller derive it**:

```
shot-window.ps1 → zoomed=1  frameborder=8   （IsZoomed + GetSystemMetrics(32)+GetSystemMetrics(92)）
wingeom.mjs     → tol = (zoomed || fullscreen) ? frameborder + 2 : 0
```

容差**只作用于"贴合"这一支**，非最大化窗口始终 0 容差 —— 判别力没有被削弱。
另外「贴合」这一支还加了一条**尺寸上限**（外框不得大于「工作区 + 2×容差」）：
光判"覆盖住工作区"不够，一个被钳到比屏幕还大的窗口同样能覆盖住，
而那正是需要拒绝的形态。

The tolerance **applies only to the "snug" branch**; a non-maximized window always has 0 tolerance — discriminating power is not weakened.
In addition, the "snug" branch enforces a **size cap** (the frame must not exceed "work area + 2×tolerance"):
just checking "covers the work area" is not enough — a window clamped larger than the screen can also cover it,
and that is exactly the form to reject.

**附带教训：测量前必须先断言「目标唯一」。**
写证伪脚本时我拿旧参数开窗，结果两轮读数一模一样、都"通过"，一度以为断言没有判别力。
真相是**测量被污染**：探针按窗口标题取第一个，抓到了残留窗口；而我漏传
`--no-first-run --no-default-browser-check`，全新 profile 走进 Chrome 首次运行流程，
自己开的窗口压根没在等待时间内出现（枚举实测 **0 个**窗口）。
所以脚本里现在写成硬前置断言：**开窗前同类窗口必须为 0，开窗后必须恰好为 1**，
否则该轮作废而不是给出结论。这和陷阱 5 的"等状态到达"是同一类错误 ——
**读数不可信时，"通过"和"失败"同样没有意义**。

**Side lesson: before measuring, you must first assert the "target is unique".**
While writing the falsification script I opened a window with the old args, and both rounds gave identical readings and "passed", so I briefly thought the assertion had no discriminating power.
The truth is that **the measurement was polluted**: the probe took the first window by title and caught a leftover window; and I had omitted
`--no-first-run --no-default-browser-check`, so a fresh profile walked into Chrome's first-run flow,
and the window I opened never appeared within the wait time (enumeration measured **0** windows).
So the script now writes a hard precondition: **before opening, there must be 0 windows of the same kind; after opening, exactly 1**,
otherwise that round is discarded instead of producing a conclusion. This is the same class of error as "wait for the state to arrive" in Pitfall 5 —
**when a reading is untrustworthy, "pass" and "fail" are equally meaningless**.

**目标区要选对：最大化比工作区，全屏比整屏。**
全屏窗口本就该盖住任务栏，本机工作区 912 高、整屏 960 高，拿工作区去比会把那 **48px**
判成越界（`probe-window.mjs` 早期就误报过一次）。搞反了就是纯假警报。

**Pick the right target area: maximized compares to the work area, fullscreen compares to the whole screen.**
A fullscreen window is supposed to cover the taskbar; on this machine the work area is 912 high and the full screen 960 high, so comparing against the work area would judge those **48px**
as out of bounds (`probe-window.mjs` falsely reported this once early on). Getting it backwards is a pure false alarm.

**规则抽在 `wingeom.mjs`，由 `test-wingeom.mjs`（20 项）用实测数据钉住。**
光靠"verify-entry 现在通过"证明不了这条规则以后不会再坏 —— 它前后已经坏过两次
（先假阳性、后判得太松）。所以把边界情形固化成用例：真实的坏窗口必须被拒、
真实的好窗口必须被收，连"探针没报边框宽就不能白送容差"都单独有一条。

**The rules are extracted into `wingeom.mjs` and pinned by `test-wingeom.mjs` (20 cases) using measured data.**
"verify-entry passes now" alone cannot prove the rule won't break again — it has already broken twice
(first a false positive, then too lax). So the boundary cases are frozen into test cases: a real bad window must be rejected,
a real good window must be accepted, and even "the tolerance must not be given away for free when the probe didn't report a border width" has its own case.

### 10. 窗口被系统判为「不可见」时，**全屏状态机会被整体挂起** / When the window is judged "invisible" by the system, **the whole fullscreen state machine is suspended**

`verify-render.mjs` 里 5 项全屏断言曾**确定性**红掉 2 项，而"全屏真的进去了"
（`document.fullscreenElement` 已非空）。这不是产品缺陷，是环境使然。

In `verify-render.mjs`, 2 of the 5 fullscreen assertions **deterministically** went red while "fullscreen really did enter"
(`document.fullscreenElement` was already non-null). This is not a product defect; it is caused by the environment.

**机理**：Chrome 在 Windows 上默认开启原生窗口遮挡判定
（`CalculateNativeWinOcclusion`）。窗口被系统判为不可见时，页面
`document.visibilityState` 变成 `'hidden'`，Chrome 会**挂起整个全屏状态机**：

**Mechanism**: On Windows, Chrome enables native window-occlusion detection by default
(`CalculateNativeWinOcclusion`). When the window is judged invisible by the system, the page's
`document.visibilityState` becomes `'hidden'`, and Chrome **suspends the entire fullscreen state machine**:

- `document.fullscreenElement` 乐观置真，`(display-mode: fullscreen)` 也匹配；
- 但 `fullscreenchange` / `webkitfullscreenchange` **永不触发** → 按钮状态不更新；
- `exitFullscreen()` 同样不生效，窗口一直卡在全屏（实测 3.5s 内毫无变化）。

- `document.fullscreenElement` is optimistically set true, and `(display-mode: fullscreen)` also matches;
- but `fullscreenchange` / `webkitfullscreenchange` **never fire** → the button state does not update;
- `exitFullscreen()` likewise has no effect, and the window stays stuck in fullscreen (measured: no change within 3.5s).

**实测对照**（`desktop/probe-fullscreen.mjs`，同一份源码）：

**Measured comparison** (`desktop/probe-fullscreen.mjs`, same source):

| 启动参数 / Launch arg | `visibilityState` | 事件轴 / Event timeline | 按钮 `aria-pressed` / Button `aria-pressed` | 退出 / Exit |
| --- | --- | --- | --- | --- |
| 不加 / not added | `hidden` | 只有 `requestFullscreen → resolve`，**无 change** / only `requestFullscreen → resolve`, **no change** | 始终 `false` / always `false` | 无效 / no effect |
| `--disable-features=CalculateNativeWinOcclusion` | `visible` | `requestFullscreen → resolve → fullscreenchange(true)` | `true` | 生效并再触发 change / effective and fires change again |

`Page.bringToFront` **治不了** —— 实测加上它 `visibilityState` 仍是 `hidden`。

`Page.bringToFront` **does not cure it** — measured: with it added, `visibilityState` is still `hidden`.

**处理（两件都要做）**：

**Handling (both are required)**:

1. 启动参数加 `--disable-features=CalculateNativeWinOcclusion`（已写进 `verify-render.mjs` 的 spawn）；
2. 仍然**显式断言前置** `document.visibilityState === 'visible'`；不满足时把这 5 项标成
   **`⊘ 作废`** 而不是 ✗。判红会让人以为是产品坏了（本项目已被误导过一次），
   算通过则等于把"没测"伪装成"测过了" —— 两者都不可接受，只能单列并让整轮作废。

1. Add the launch arg `--disable-features=CalculateNativeWinOcclusion` (already written into `verify-render.mjs`'s spawn);
2. Still **explicitly assert the precondition** `document.visibilityState === 'visible'`; when unmet, mark these 5 items
   as **`⊘ invalidated`** rather than ✗. Marking red would make people think the product is broken (this project was misled once),
   and counting as pass would disguise "not tested" as "tested" — both are unacceptable, so they can only be listed separately and the whole round invalidated.

**附带一条检测手段的教训**：做反向对照时，只摘掉 `fullscreenchange` 一条监听，
断言**照样绿** —— 因为按钮同步有三条冗余路径（`fullscreenchange`、
`webkitfullscreenchange`、`display-mode` 媒体查询的 `change`）。
对照实验必须把**所有**能产生该效果的路径都摘掉，否则"没变红"只能说明对照无效，
不能说明断言没有判别力。

**A side lesson about detection technique**: when doing the reverse control, removing only the `fullscreenchange` listener
left the assertion **still green** — because button sync has three redundant paths (`fullscreenchange`,
`webkitfullscreenchange`, and the `change` of the `display-mode` media query).
A control experiment must remove **all** paths that can produce the effect; otherwise "it didn't turn red" only means the control is invalid,
not that the assertion lacks discriminating power.

### 11. 桌面图标 ≠ 任务栏图标：**运行窗口的图标只认页面 favicon** / Desktop icon ≠ taskbar icon: **a running window's icon only honors the page favicon**

现象：桌面快捷方式的图标是好的，但应用一运行，任务栏那个按钮是**灰色**的。

Symptom: the desktop shortcut's icon is fine, but as soon as the app runs, that taskbar button is **gray**.

原因：任务栏按钮画的是**窗口图标**（`WM_GETICON`），不是 `.lnk` 里记的 `.ico`。
Chrome 用 `--app=<URL>` 开应用模式窗口时，窗口图标取自**页面的 favicon**；
页面没声明 favicon，Chrome 就回退到自带的灰色默认应用图标。
所以 `.ico` 做得再漂亮、`.lnk` 指得再准，都影响不到运行中的那个窗口。

Cause: the taskbar button draws the **window icon** (`WM_GETICON`), not the `.ico` recorded in the `.lnk`.
When Chrome opens an app-mode window with `--app=<URL>`, the window icon comes from the **page's favicon**;
if the page declares no favicon, Chrome falls back to its built-in gray default app icon.
So no matter how pretty the `.ico` is or how accurately the `.lnk` points, neither affects that running window.

实测（单变量对照，用 `desktop/probe-window-icon.py` 读 `WM_GETICON`）：
同一 Chrome、同一档案、同一 `--app=` 参数，两页只差一行 `<link rel="icon">`：

Measured (single-variable control, reading `WM_GETICON` with `desktop/probe-window-icon.py`):
same Chrome, same profile, same `--app=` arg, and the two pages differ by only one line `<link rel="icon">`:

| 页面 / Page | 窗口图标主色 / Window-icon dominant color |
| --- | --- |
| 无 favicon / no favicon | 灰 `#666666`（Chrome 默认应用图标） / gray `#666666` (Chrome's default app icon) |
| favicon = 纯品红 / favicon = pure magenta | 整块品红 / a solid magenta block |

正解：`make-favicon.py` 把图标以 **data URI** 内嵌进 `index.html`，打包时一起进
`poker-trainer.html`。用 data URI 而不用同级 `favicon.png`，是因为单文件产物必须能
单独拷走运行 —— 外链 png 一旦分家，图标又变灰，而且**不会报任何错**。

The right fix: `make-favicon.py` embeds the icon as a **data URI** into `index.html`, and it goes into
`poker-trainer.html` during bundling. A data URI is used instead of a sibling `favicon.png` because the single-file artifact must be
copyable and runnable on its own — once the external png is separated, the icon turns gray again, and **no error is reported at all**.

`verify-render.mjs` 有一条断言盯着它：把 data URI **解码出来**校验 PNG 魔数与尺寸，
不只看"有没有这行"（空 `href` 同样要被拒）。

`verify-render.mjs` has an assertion watching it: **decode** the data URI and check the PNG magic number and dimensions,
not just "whether the line exists" (an empty `href` must be rejected too).

### 12. `cdp.close()` 之后再发 CDP 请求 = **静默等满 20 秒** / Sending a CDP request after `cdp.close()` = **silently waiting the full 20 seconds**

`ws.send()` 在连接已关闭时**既不报错也不回包**，请求就这么消失；调用方只能等自己设的
20s 超时，且异常里只有方法名（`Runtime.evaluate`）—— 可这个流程里 `Runtime.evaluate`
被调用几十次，光看方法名定位不到卡在哪一步。

`ws.send()` **neither errors nor replies** when the connection is closed, and the request just vanishes; the caller can only wait for its own
20s timeout, and the exception carries only the method name (`Runtime.evaluate`) — yet in this flow `Runtime.evaluate`
is called dozens of times, so the method name alone cannot locate the step where it is stuck.

实测就是这么被坑的：favicon 断言写在了 `cdp.close()` **之后**，验收每次都"卡 20 秒然后崩栈"，
现象看起来像 Chrome 没响应。定位靠 `desktop/diag-cdp.mjs`：它把同一条表达式单独跑一遍，
**1ms 就返回**，于是问题只能出在"位置"而不在"表达式"。

This is exactly how it got burned: the favicon assertion was written **after** `cdp.close()`, and the validation every time "hung for 20 seconds then crashed the stack",
looking as if Chrome was unresponsive. Localization came from `desktop/diag-cdp.mjs`: it runs the same expression on its own and
**returns in 1ms**, so the problem can only be "position", not "expression".

两处改进已落进代码：

Two improvements have landed in the code:

1. CDP 客户端 `send()` 里先判 `ws.readyState`，连接已关就**立刻**抛出带阶段名的错误；
2. 全局 `PHASE` 变量在任何会发 CDP 请求的位置之前更新，超时信息带上阶段名；
3. 顶层 `verifyRender()` 调用加了 `try/catch`，把"未处理的 Promise 拒绝崩栈"
   换成"明确报出卡在哪一阶段 + 非零退出码"（仍然是硬失败，只是可定位）。

1. In the CDP client `send()`, check `ws.readyState` first; if the connection is closed, **immediately** throw an error carrying a phase name;
2. The global `PHASE` variable is updated before any place that sends a CDP request, so timeout messages carry the phase name;
3. The top-level `verifyRender()` call got a `try/catch`, replacing "an unhandled Promise rejection crashing the stack"
   with "explicitly report which phase is stuck + a non-zero exit code" (still a hard failure, just localizable).

---

## 备注 / Notes

- `.lnk` 的 `LinkInfo` 段在存在 `IDList` 时，逐字段解析偏移容易因对齐规则出错；
  校验改用**按字节搜索已知字符串**（目标完整路径一定以 ANSI 或 UTF-16LE 形式存在），
  命中即可确认，无需关心内部布局。
- 换浏览器/换机器后，重新运行 `node make-shortcut.mjs` 即可（浏览器路径每次重新探测）。

- In the `.lnk` `LinkInfo` section, when an `IDList` is present, field-by-field offset parsing easily goes wrong due to alignment rules;
  validation switched to **byte-wise search for a known string** (the full target path always exists as ANSI or UTF-16LE),
  and a hit confirms it without caring about the internal layout.
- After switching browsers/machines, just rerun `node make-shortcut.mjs` (the browser path is re-detected each time).
