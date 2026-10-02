# 德州扑克练习室 · NLHE Trainer

[中文](#德州扑克练习室--nlhe-trainer) · [English](#nlhe-trainer--texas-holdem-practice-room)

## NLHE Trainer — Texas Hold'em Practice Room

单机无限注德州扑克（NLHE）对局模拟器，用于**实战练习 + 决策复盘**。浏览器打开即玩，零依赖、离线可用。<br>
A standalone No-Limit Texas Hold'em (NLHE) game simulator for **real-play practice + decision review**. Open it in a browser and play — zero dependencies, works offline.

对手是 5 种不同风格的 AI，带实时胜率、底池赔率、教练建议、逐手复盘与情境训练。<br>
You face five AI personalities with distinct styles, plus live equity, pot odds, coach advice, hand-by-hand replay and situational drills.

> 与 `D:\todo\NLHE`（**心算训练场**：赔率/补牌/EV/范围组合数题库）的定位区分：
> 那个练**数学**，这个练**实战对局**。两者互补 —— 而且两个应用会在浏览器里
> **互相读取对方的进度**：漏洞画像面板会把「你打牌时的漏洞」翻译成「该去刷哪几道心算题」。
>
> Positioned differently from `D:\todo\NLHE` (the sibling **mental-math trainer**: a bank of odds / outs / EV / range-combinatorics drills):
> that one drills **math**, this one drills **real play**. They complement each other — and the two apps
> **read each other's progress** in the browser: the leak-profile panel translates "the leaks in your play"
> into "which mental-math drills you should go grind".
>
> _路径说明：`D:\todo\NLHE` 是作者机器上那个姊妹「心算训练场」的位置；你若克隆到别处，请自行调整路径。_<br>
> _(Path note: `D:\todo\NLHE` is where that sibling mental-math trainer lives on the author's machine; adjust the path if you clone elsewhere.)_

## 三项进阶能力 / Three Advanced Features

| 能力 / Capability | 入口 / Entry | 说明 / Notes |
| --- | --- | --- |
| **会记住你漏洞的 AI**<br>**An AI that remembers your leaks** | 自动生效<br>Automatic | 观测你的 VPIP / 面对下注的弃牌率 / 3-bet 弃牌率等，用 z 检验确认「不是手气」后才调整：你爱弃牌它就多诈唬，你太紧它就多偷盲，你爱跟它就砍诈唬做薄价值。样本不足 20 次机会时**完全不做调整**<br>Observes your VPIP / fold-to-bet / fold-to-3-bet, and only adjusts after a z-test confirms it is "not variance": fold too much and it bluffs more, play too tight and it steals more blinds, call too much and it cuts bluffs for thin value. With fewer than 20 relevant opportunities it **makes no adjustment at all** |
| **对手范围热力图 + EV 损失复盘**<br>**Opponent-range heatmap + EV-loss review** | `H` 打开复盘 → 右侧分析栏<br>`H` to open replay → right-hand analysis column | 13×13 的 169 类范围格，随回放步进实时重算；被你的底牌挡掉的组合会标出来。下方列出每一步的 EV 损失、分级（轻微偏差 / 失误 / 严重失误）与可信度，点一行直接跳到那一步<br>A 13×13 grid of the 169 hand classes, recomputed live as you step through the replay; combinations blocked by your hole cards are marked. Below it, every step lists its EV loss, a grade (minor deviation / mistake / blunder) and a confidence level — click a row to jump straight to that step |
| **与心算题库联动**<br>**Linked to the mental-math drill bank** | `P` 打开漏洞画像 → 底部<br>`P` to open the leak profile → bottom | 读 `D:\todo\NLHE` 的存档（同源 `localStorage`），显示今日刷题 / 连续打卡 / 累计正确率，并把你的漏洞映射成具体题目清单<br>Reads the save of `D:\todo\NLHE` (same-origin `localStorage`), shows today's drills / current streak / all-time accuracy, and maps your leaks into a concrete list of drills to work on |

---

## 快速开始 / Quick Start

| 入口 / Entry | 说明 / Notes |
| --- | --- |
| 桌面「德州扑克练习室」图标<br>The desktop "德州扑克练习室" shortcut | **推荐**。以 Chrome 应用模式打开，无地址栏，观感与原生应用一致<br>**Recommended.** Opens in Chrome app mode — no address bar, feels like a native app |
| **Electron 桌面版**<br>**Electron desktop build** | `npm install` 后 `npm start`，或直接双击 `dist/NLHE-Trainer-1.0.0-portable.exe`（约 75 MB，免安装）<br>Run `npm install` then `npm start`, or just double-click `dist/NLHE-Trainer-1.0.0-portable.exe` (~75 MB, install-free) |
| `poker-trainer.html` | 单文件版（约 315 KB），双击用默认浏览器打开即可<br>Single-file build (~315 KB); double-click to open it in your default browser |
| `index.html` | 开发版，按模块加载 `src/` 下的源码<br>Development build; loads the sources under `src/` module by module |

界面与数据都在本机，不上传任何内容。建议用 Chrome / Edge。<br>
Everything runs and stays on your machine — nothing is uploaded. Chrome / Edge recommended.

---

## 桌面版（Electron）/ Desktop Build (Electron)

把同一份 `poker-trainer.html` 装进 Electron，得到一个双击即开、免安装的 exe。<br>
The same `poker-trainer.html` is wrapped in Electron to produce a double-clickable, install-free exe.

| 命令 / Command | 作用 / What it does |
| --- | --- |
| `npm install` | 安装 Electron 与打包工具（开发期依赖）<br>Install Electron and the packaging toolchain (dev dependencies) |
| `npm start` | 开发运行：直接启动应用窗口<br>Dev run: launch the app window directly |
| `npm run smoke` | 冒烟自检：加载页面并执行 5 项检查（模块挂载 / 牌型评估器 / `localStorage` 可用 / 能真正发一手牌 / 界面骨架），把每项 PASS/FAIL 打到标准输出，**退出码 = 检查结果**（全通过为 0）；冒烟模式自动关闭硬件加速<br>Smoke self-check: loads the page and runs 5 checks (modules mounted / evaluator / `localStorage` availability / a hand can really be dealt / UI skeleton), prints PASS/FAIL for each to stdout, and **the exit code is the verdict** (0 when all pass); smoke mode disables hardware acceleration automatically |
| `npm run dist` | 打包成免安装便携 exe：`electron-builder --win portable`，产物 `dist/NLHE-Trainer-1.0.0-portable.exe`（约 75 MB，双击即用，自带 Chromium 运行时）<br>Packages an install-free portable exe via `electron-builder --win portable`, producing `dist/NLHE-Trainer-1.0.0-portable.exe` (~75 MB, double-click to run, bundles its own Chromium runtime) |

打好的便携 exe **已正确写入应用图标与版本信息**：ProductName = `NLHE Trainer`、FileDescription = `package.json` 的 `description`、Version = `1.0.0`、LegalCopyright = `MIT Licensed`（右键 → 属性 → 详细信息 可核对）。<br>
The packaged portable exe **already carries the app icon and version metadata**: ProductName = `NLHE Trainer`, FileDescription = the `description` from `package.json`, Version = `1.0.0`, LegalCopyright = `MIT Licensed` (verify via right-click → Properties → Details).

`dist/win-unpacked/` 是未压缩的目录版（调试用），其中的 `NLHE Trainer.exe` **不含**自定义图标与版本信息 —— 这是有意为之，原因见下。<br>
`dist/win-unpacked/` is the uncompressed directory build (for debugging); its internal `NLHE Trainer.exe` does **not** carry the custom icon or version metadata — that is deliberate, see below.

### 为什么关掉 `signAndEditExecutable` / Why `signAndEditExecutable` is off

`package.json` 里设了 `"signAndEditExecutable": false`。electron-builder 的默认流程会去解压 `winCodeSign` 包，而该包里含 macOS 符号链接（`darwin/10.12/lib/libcrypto.dylib` 等）；在**未开启 Windows 开发者模式**的机器上，7za 创建符号链接会失败（"客户端没有所需的特权"），导致 portable / zip 目标整体构建失败（实测报 `exit status 2`）。<br>
`package.json` sets `"signAndEditExecutable": false`. By default electron-builder unpacks the `winCodeSign` package, which contains macOS symlinks (`darwin/10.12/lib/libcrypto.dylib` and friends); on a machine **without Windows Developer Mode enabled**, 7za fails to create them ("the client does not hold the required privilege"), which makes the whole portable / zip build fail (measured: `exit status 2`).

关闭该项后，构建不再依赖该解压步骤，在普通权限的 Windows 上也能一次成功；代价仅是 `dist/win-unpacked` 里的内部 exe 不做图标/版本改写。portable 成品的外观与元信息不受影响（图标由 NSIS 包装阶段写入，实测已验证包含 256px 图标载荷）。<br>
With that flag off, the build no longer depends on that unpack step and succeeds first time on a normal-privilege Windows; the only cost is that the internal exe under `dist/win-unpacked` gets no icon/version rewrite. The portable artifact's appearance and metadata are unaffected (the icon is written by the NSIS wrapping stage, verified to contain a 256px icon payload).

若某台机器已开启开发者模式、且希望连 `win-unpacked` 内部 exe 也带上图标与版本信息，可临时去掉该行再构建。<br>
If a machine already has Developer Mode on and you want the internal exe under `win-unpacked` to carry the icon and version too, temporarily remove that line and rebuild.

现场开关 / Runtime switches：

- `--no-gpu`：用于虚拟机 / 远程桌面 / 显卡驱动异常导致 Chromium GPU 进程反复崩溃（日志形如 `GPU process isn't usable. Goodbye.`）的场景；加上它即可绕开 GPU。**冒烟模式无条件启用它。**<br>
  `--no-gpu`: for VMs / RDP sessions / broken drivers where the Chromium GPU process crashes in a loop (log: `GPU process isn't usable. Goodbye.`); pass it to bypass the GPU. **Smoke mode always enables it.**
- `--no-sandbox`：受限环境补充 —— 在受限沙箱（无 GPU 且进程沙箱受限）里运行时可追加它，例如 `npm run smoke -- --no-sandbox`。这是环境相关的自救开关，不是默认行为。<br>
  `--no-sandbox`: a restricted-environment addition — append it when running inside a locked-down sandbox (no GPU and a restricted process sandbox), e.g. `npm run smoke -- --no-sandbox`. This is an environment-specific rescue switch, not a default.

```bash
npm start -- --no-gpu             # 开发运行并绕开 GPU / dev run with the GPU bypassed
npm run smoke                     # 冒烟自检 / smoke self-check
npm run dist                      # 打包便携版 exe（约 75 MB） / build the portable exe (~75 MB)
```

**存档位置 / Save location**：Electron 版把 `localStorage` 存在应用 userData 目录（Windows 下实测为 `%APPDATA%\nlhe-trainer`），与浏览器版的存档**不互通**，首次使用战绩与漏洞画像从零开始。冒烟自检会把结果同时写到该目录下的 `smoke-report.json`。<br>
The Electron build stores `localStorage` in the app's userData directory (measured on Windows: `%APPDATA%\nlhe-trainer`), and it does **not** share data with the browser build — stats and the leak profile start from scratch on first run. The smoke check also writes its result to `smoke-report.json` in that directory.

---

## 玩法与快捷键 / Gameplay & Shortcuts

| 键 / Key | 动作 / Action |
| --- | --- |
| `N` | 开始下一手<br>Start the next hand |
| `F` | 弃牌<br>Fold |
| `C` | 跟注 / 过牌（无下注时自动过牌）<br>Call / check (auto-checks when there is no bet) |
| `A` | 全下（All-in）<br>All-in |
| `R` | 按滑杆金额加注<br>Raise by the slider amount |
| `↑` `↓` | 微调加注额（步长 = 1 个大盲）<br>Fine-tune the raise (step = 1 big blind) |
| `D` | 打开情境训练<br>Open situational drills |
| `H` | 打开手牌复盘<br>Open hand replay |
| `P` | 打开漏洞画像（含题库联动）<br>Open the leak profile (with drill linking) |
| `F11` | 全屏 / 退出全屏（顶栏 **⛶** 按钮同效）<br>Fullscreen / exit fullscreen (same as the **⛶** button in the top bar) |
| `Esc` | 关闭弹窗（全屏时退出全屏）<br>Close the dialog (exits fullscreen while fullscreen) |

复盘弹窗内：`←` `→` 逐步前后，`空格` 播放 / 暂停。训练弹窗内：`1` `2` `3` 选答案，`⏎` 下一题。<br>
In the replay dialog: `←` `→` step back/forward, `Space` play / pause. In the drill dialog: `1` `2` `3` pick an answer, `⏎` next question.

---

## 牌局设置 / Table Settings

| 项 / Setting | 可选值 / Options |
| --- | --- |
| 人数<br>Players | 2 / 3 / 4 / 6 / 9 人<br>2 / 3 / 4 / 6 / 9 |
| 盲注<br>Blinds | 1/2 · 2/5 · 5/10 |
| 带入筹码<br>Buy-in | 50 / 100 / 200 大盲<br>50 / 100 / 200 big blinds |
| AI 速度<br>AI speed | 极快 / 快 / 正常 / 慢（便于思考）<br>Instant / Fast / Normal / Slow (for thinking) |
| 辅助开关<br>Assist toggles | 教练建议面板 · 实时胜率显示 · 底池赔率提示<br>Coach-advice panel · live equity · pot-odds hints |

设置与战绩都会自动保存，下次打开沿用。<br>
Settings and stats are saved automatically and restored next time.

---

## 四种练法 / Four Ways to Practice

### 1. 随机对局（主牌桌）/ 1. Random Play (Main Table)

- **实时胜率**：蒙特卡洛模拟，对手范围受其下注行为约束（对手主动下注 = 范围更强）<br>
  **Live equity**: Monte-Carlo simulation, with opponent ranges constrained by their betting (a voluntary bet = a stronger range)
- **教练建议**：结合牌力、位置、底池赔率给出行动建议与理由<br>
  **Coach advice**: recommends an action with its reasoning, based on hand strength, position and pot odds
- **底池赔率提示**：需要多少胜率才值得跟注<br>
  **Pot-odds hint**: how much equity you need for a call to be worth it
- **透视看牌**：可查看 AI 底牌，用于复盘判断（默认关闭）<br>
  **X-ray**: reveal the AI hole cards to help you review (off by default)
- **数据面板**：手数、VPIP、PFR、净盈亏、盈亏曲线（跨会话累计）<br>
  **Stats panel**: hands, VPIP, PFR, net profit/loss and the bankroll curve (accumulated across sessions)

### 2. 手牌复盘（侧栏「复盘」/ `H`）/ 2. Hand Replay (sidebar "复盘" / `H`)

把打完的每一手逐步重放：<br>
Replays every completed hand step by step:

- 公共牌随进度逐张翻开，底池与各对手状态同步变化<br>
  The board is revealed one card at a time, with the pot and each opponent's state updating in sync
- 时间线按街分组，**你的每次行动旁标出当时的真实胜率**（含弃牌时——"我扔掉的牌当时有多少胜率"正是复盘要回答的）<br>
  The timeline is grouped by street, and **every one of your actions is annotated with the true equity at that moment** (including folds — "how much equity did the hand I threw away have?" is exactly what review is for)
- **右侧分析栏随回放步进实时重算**：<br>
  **The right-hand analysis column recomputes live as you step through the replay**:
  - **对手范围热力图**：13×13 共 169 类，按权重着色；上三角同花、下三角不同花、对角对子；<br>
    被你的底牌/公共牌挡住的组合会打上虚线框（部分阻断）或 ×（完全阻断）<br>
    **Opponent-range heatmap**: a 13×13 grid of 169 classes, shaded by weight; the upper triangle is suited, the lower triangle offsuit, the diagonal pairs;<br>
    combinations blocked by your hole cards / the board get a dashed box (partially blocked) or a × (fully blocked)
  - **EV 损失列表**：每一步"你做了什么 vs 最优是什么"的 BB 差额，带分级<br>
    （最佳 / 可以接受 / 轻微偏差 / 失误 / 严重失误）与可信度（可信 / 中等 / 仅方向）<br>
    **EV-loss list**: the BB gap between "what you did" and "what was optimal" for each step, with a grade<br>
    (best / acceptable / minor deviation / mistake / blunder) and a confidence level (trustworthy / medium / direction only)
  - 点任意一行 → 直接跳到那一步<br>
    Click any row → jump straight to that step
- 最新 60 手保存在本机，关掉浏览器再开仍可复盘<br>
  The latest 60 hands are stored locally, so you can still review them after closing and reopening the browser

### 3. 情境训练（顶栏「🎯 训练」/ `D`）/ 3. Situational Drills (top bar "🎯 训练" / `D`)

13 个固定牌局的决策点，选完立刻给出「✅ 最优 / 🟡 可接受 / ❌ 失误」与理由，并附本题要点。<br>
Thirteen decision points from fixed hands; after you choose, it immediately returns "✅ optimal / 🟡 acceptable / ❌ mistake" with the reasoning and the key takeaway for that spot.

| 分类 / Category | 覆盖场景 / Scenarios covered |
| --- | --- |
| 翻牌前（4 题）<br>Preflop (4 spots) | 按钮位开池、大盲防守赔率、枪口位范围、小盲面对加注<br>Button open, big-blind defence odds, UTG range, small blind facing a raise |
| 翻牌（6 题）<br>Flop (6 spots) | 3-bet 底池持 KK 遇 A 高面、翻牌三条湿润面、同花听牌、错过翻牌的持续下注、超对被加注、三人池诈唬<br>KK in a 3-bet pot on an ace-high board, flopped trips on a wet board, flush draw, c-bet after missing the flop, overpair facing a raise, three-way bluff |
| 转牌 / 河牌（3 题）<br>Turn / River (3 spots) | 顶对顶踢遇大注、超池全下弃牌、河牌薄价值<br>Top pair top kicker facing a big bet, folding to an overbet shove, thin value on the river |

题库数据在 `src/scenarios.js`，每个场景的筹码、底池、下注额都按真实牌局推演过，<br>
并由 `test/check-scenarios.js` 校验自洽性（街道与公共牌张数匹配、无重复牌、恰好一个最优解等）。<br>
The drill bank lives in `src/scenarios.js`; each scenario's stacks, pot and bet sizes were derived from real play,<br>
and `test/check-scenarios.js` verifies self-consistency (street matches board-card count, no duplicate cards, exactly one optimal answer, etc.).

### 4. 漏洞画像（侧栏「📊 画像」/ `P`）/ 4. Leak Profile (sidebar "📊 画像" / `P`)

把前面三块的数据汇到一处：AI **正在拿什么对付你**、你的统计指标、以及被统计学认可的漏洞。<br>
Brings the data from the previous three parts together: **what the AI is doing against you**, your own stats, and the leaks that survive statistical scrutiny.

- **AI 正在用来对付你的权重**：把剥削权重翻译成人话（"后位偷盲更凶"、"更多地诈唬你"）<br>
  **The weights the AI is using against you**: exploitation weights translated into plain language ("steals more aggressively from late position", "bluffs you more often")
- **统计指标**：VPIP / PFR / 面对下注弃牌率 / WTSD 等，每项标注样本量与参考区间；<br>
  样本不足的会置灰，避免"3 手牌看出漏洞"<br>
  **Stats**: VPIP / PFR / fold-to-bet / WTSD and more, each labelled with its sample size and reference range;<br>
  under-sampled ones are greyed out, so "3 hands is not a leak"
- **EV 损失汇总**：每手平均损失、失误次数、最贵的几手（点一下直接跳进复盘的那一步）<br>
  **EV-loss summary**: average loss per hand, number of mistakes, and the costliest hands (click one to jump straight to that replay step)
- **心算题库联动**：读另一个应用的存档，给出今日刷题 / 连续打卡 / 累计正确率，<br>
  并按你的漏洞列出**该去刷哪几道题**（`Tab` 切过去练，回来再到这儿看变化）<br>
  **Mental-math drill linking**: reads the other app's save, reports today's drills / current streak / all-time accuracy,<br>
  and lists **which specific drills you should go grind** for your leaks (`Tab` over to practice, then come back here to watch the change)

---

## AI 对手 / The AI Opponents

5 种人格，参数化区分，打法风格各异：<br>
Five personalities, differentiated by parameters, each with its own style of play:

| 人格 / Personality | 特征 / Traits |
| --- | --- |
| 🪨 岩石<br>🪨 Rock | 极紧，很少诈唬<br>Very tight, rarely bluffs |
| 🎯 紧凶<br>🎯 TAG | 教科书式打法（TAG）<br>Textbook play (TAG) |
| 🔥 松凶<br>🔥 LAG | 范围宽，进攻性强（LAG）<br>Wide range, highly aggressive (LAG) |
| 🐟 跟注站<br>🐟 Calling station | 爱跟注，极少加注<br>Calls a lot, almost never raises |
| 🎲 疯子<br>🎲 Maniac | 高频加注，重度诈唬<br>Raises constantly, bluffs heavily |

**决策模型**：翻前用 169 类起手牌**百分位排名** + 按身后未行动人数的**开池范围表**；<br>
翻后用**对手范围约束的蒙特卡洛胜率**对比底池赔率，并识别听牌（同花/顺子）与空气牌。<br>
**Decision model**: preflop it uses a **percentile ranking** of the 169 starting-hand classes plus **open-raise range tables** keyed on the number of players still to act behind;<br>
postflop it compares **Monte-Carlo equity constrained by the opponent's range** against the pot odds, and identifies draws (flush/straight) and air.

**这层 AI 会反过来针对你**：`profile.js` 观测你的漏洞并给出剥削权重（诈唬频率、下注尺度、<br>
偷盲强度、薄价值、3-bet 诈唬），`ai.js` 的 `exploitEnv()` 读取后调整行为。三条设计红线：<br>
**This layer of the AI turns against you**: `profile.js` observes your leaks and produces exploitation weights (bluff frequency, bet sizing,<br>
steal intensity, thin value, 3-bet bluffs), which `ai.js`'s `exploitEnv()` reads and acts on. Three design red lines:

1. 没有 20 次以上的对应机会 → 不产生任何调整；<br>
   No adjustment is produced without 20+ relevant opportunities;
2. 偏离必须通过 z 检验（|z| ≥ 2）→ 手气不会被当成漏洞；<br>
   A deviation must pass a z-test (|z| ≥ 2) — variance is never mistaken for a leak;
3. 一个行为只对应一项调整（`foldToBet` 与 `riverCall` 互补，同时算等于计两遍）。<br>
   One behaviour maps to exactly one adjustment (`foldToBet` and `riverCall` are complementary; counting both would double-count).

剥削权重**只作用于 AI 对手**；「教练建议」显式传 `false` —— 拿"针对你自己的漏洞"来建议<br>
你自己打牌是荒诞的。各人格详细指标见下方「已知限制」。<br>
The exploitation weights **apply to AI opponents only**; "coach advice" explicitly passes `false` — using "exploits aimed at your own leaks"<br>
to advise you on your own play would be absurd. See "Known Limitations" below for each personality's detailed metrics.

---

## 数据存储 / Data Storage

战绩、盈亏曲线、复盘记录、训练进度、**漏洞画像**、牌局设置都写在浏览器 `localStorage`（键名 `nlhe-trainer-v1`）。<br>
Results, bankroll curve, replay history, drill progress, the **leak profile** and table settings are all written to browser `localStorage` (key `nlhe-trainer-v1`).

- 存储不可用（无痕模式）时自动降级为内存模式，只是不持久化，**不影响游玩**<br>
  When storage is unavailable (incognito mode) it degrades to in-memory mode, which simply is not persisted — **play is unaffected**
- 存档损坏会自动丢弃并回到默认值，不会卡住启动<br>
  A corrupt save is discarded automatically and defaults are restored; startup never hangs
- 侧栏「你的数据 → 清零」会**连同本地存档一起抹掉**<br>
  The sidebar's "你的数据 → 清零" (Your data → Reset) **wipes the local save as well**
- 写盘前会剥掉 `_` 开头的运行期缓存字段（复盘的胜率/EV 缓存是 `Float64Array`，<br>
  直接序列化会变成 `{"0":…}`，几十手就能撑爆 5 MB 配额并让**整个持久化静默失效**）<br>
  Before writing, runtime cache fields starting with `_` are stripped (the replay equity/EV cache is a `Float64Array`,<br>
  which would serialize to `{"0":…}`, blow the 5 MB quota within a few dozen hands and make **the whole persistence layer silently fail**)

---

## 目录结构 / Project Layout

```
NLHE/
├─ poker-trainer.html     单文件成品（build.js 生成，可直接分享） / self-contained build (generated by build.js, share as-is)
├─ index.html             开发版入口 / development entry point
├─ build.js               打包脚本：内联 CSS/JS -> poker-trainer.html / bundler: inline CSS/JS -> poker-trainer.html
├─ package.json           Electron 与 electron-builder 配置 / Electron & electron-builder configuration
├─ .gitignore             构建产物与本地存档的忽略规则 / ignore rules for build artifacts and local saves
├─ LICENSE                MIT 许可证 / MIT license
├─ assets/
│  └─ icon.ico            应用图标 / application icon
├─ electron/
│  └─ main.js             Electron 主进程：单实例、窗口几何持久化、安全默认值、冒烟自检
│                         Electron main process: single instance, window-geometry persistence, secure defaults, smoke self-check
├─ tools/
│  ├─ check-code-unchanged.mjs   用 acorn 比对 token 流，证明"只改注释没动代码"
│  │                             compares acorn token streams to prove "comments only — no code change"
│  ├─ check-bundle-fresh.cjs     重算打包结果与产物逐字节比对，防"改了 src/ 忘了 build"
│  │                             recomputes the bundle and diffs it byte-for-byte against the artifact, catching "edited src/ but forgot to build"
│  ├─ find-browser.cjs           浏览器自动探测：NLHE_CHROME → playwright 自报 → 缓存扫描 → 标准安装 → PATH
│  │                             browser auto-detection: NLHE_CHROME → playwright-reported → cache scan → standard install → PATH
│  └─ find-python.cjs            Python 解释器自动探测（环境变量 → 缓存 → PATH）
│                                Python interpreter auto-detection (env var → cache → PATH)
├─ src/
│  ├─ poker.js            牌型评估器（位运算 + 复用缓冲区）、起手牌排名表 / hand evaluator (bitwise + reused buffers), starting-hand ranking table
│  ├─ equity.js           蒙特卡洛胜率（含对手范围约束） / Monte-Carlo equity (with opponent-range constraints)
│  ├─ range.js            169 类对手范围模型：权重向量、行动线→范围、加权胜率 / 169-class opponent-range model: weight vectors, action-line -> range, weighted equity
│  ├─ profile.js          玩家漏洞画像：观测、显著性检验、剥削权重 / player leak profile: observation, significance testing, exploitation weights
│  ├─ evloss.js           EV 损失复盘：复现行动前状态、比较各候选动作的 EV / EV-loss review: reproduce the pre-action state, compare the EV of each candidate action
│  ├─ ai.js               5 种人格的决策模型（读取 profile 的剥削权重） / decision models for the 5 personalities (read profile's exploitation weights)
│  ├─ engine.js           状态机：盲注轮转、下注轮、多层边池、摊牌结算、行动记录 / state machine: blind rotation, betting rounds, multi-layer side pots, showdown settlement, action log
│  ├─ storage.js          localStorage 持久化（含容错与降级） / localStorage persistence (with fault tolerance and degradation)
│  ├─ ui.js               主牌桌渲染、牌桌尺寸计算、座位定位 / main table rendering, table sizing, seat positioning
│  ├─ replay.js           手牌复盘回放 + 范围热力图 + EV 损失列表 / hand replay + range heatmap + EV-loss list
│  ├─ scenarios.js        情境训练题库 / situational-drill bank
│  ├─ drill.js            情境训练逻辑 / situational-drill logic
│  ├─ bridge.js           与 D:\todo\NLHE 心算题库联动（读存档、漏洞→题目映射） / link with the D:\todo\NLHE mental-math bank (read save, map leaks -> drills)
│  ├─ leaks.js            漏洞画像面板（含题库联动区块） / leak-profile panel (with the drill-linking block)
│  └─ main.js             启动、设置、快捷键、持久化接线 / startup, settings, shortcuts, persistence wiring
├─ desktop/               桌面入口管线（图标、快捷方式、渲染验收、入口验收） / desktop-entry pipeline (icons, shortcuts, render verification, entry verification)
└─ test/
   ├─ test.js             单元测试（牌型、边池守恒、整局模拟，58 项） / unit tests (hand classes, side-pot conservation, full-hand simulation; 58 assertions)
   ├─ check-range.js      169 类范围模型（组合数口径、加权胜率、还原行动线，59 项） / 169-class range model (combinatorics convention, weighted equity, action-line reconstruction; 59)
   ├─ check-profile.js    漏洞画像（平滑、显著性、剥削权重方向，50 项） / leak profile (smoothing, significance, exploitation-weight direction; 50)
   ├─ check-wiring.js     B 组端到端接线（加载顺序、观测、剥削权重、存档，50 项） / group-B end-to-end wiring (load order, observation, exploitation weights, saves; 50)
   ├─ check-ev.js         EV 损失复盘（复现引擎、EV 恒等式、可信度，105 项） / EV-loss review (replay engine, EV identities, confidence; 105)
   ├─ check-analysis.js   C/D 组界面验收（热力图、EV 列表、漏洞面板、题库联动，70 项） / group-C/D UI verification (heatmap, EV list, leak panel, drill linking; 70)
   ├─ check-bridge.js     题库联动（与 D:\todo\NLHE 源码防漂移比对，145 项） / drill linking (anti-drift comparison against the D:\todo\NLHE sources; 145)
   ├─ features.js         新功能验收（复盘/持久化/训练，37 项） / new-feature verification (replay / persistence / drills; 37)
   ├─ measure-layout.js   多分辨率布局体检（比例、越界、跳动） / multi-resolution layout check (ratios, overflow, jitter)
   ├─ check-positions.js  各人数桌的位置标签唯一性 / position-label uniqueness for every table size
   ├─ check-scenarios.js  题库自洽性校验 / drill-bank self-consistency check
   ├─ shot-panels.js      多分辨率下面板截图与溢出检查 / panel screenshots and overflow checks across resolutions
   ├─ symmetry.js         座位对称性 / 行为指标 / seat symmetry / behavioural metrics
   ├─ diag-*.js           发牌公平性、座位偏差、人格指标诊断 / diagnostics for deal fairness, seat bias, personality metrics
   ├─ gen-rank.js         生成 169 起手牌排名表 / generates the 169 starting-hand ranking table
   └─ smoke.js            Playwright 浏览器冒烟测试 / Playwright browser smoke test
```

> `JS_ORDER`（`build.js`）与 `index.html` 的 `<script>` 顺序必须一致，且就是依赖顺序：<br>
> `poker → equity → range → profile → ai → evloss → engine → storage → ui → replay
> → scenarios → drill → bridge → leaks → main`。<br>
> 新增模块**两个文件都要加**；只写文件不加进去，功能会静默失效（不报错）。<br>
> `desktop/verify-render.mjs` 会逐个断言这些模块是否真的挂到了 `window.PK` 上。<br>
> `JS_ORDER` (in `build.js`) and the `<script>` order in `index.html` must match, and they are the dependency order:<br>
> `poker → equity → range → profile → ai → evloss → engine → storage → ui → replay
> → scenarios → drill → bridge → leaks → main`.<br>
> When adding a module you **must add it to both files**; just creating the file without registering it makes the feature fail silently (with no error).<br>
> `desktop/verify-render.mjs` asserts, one by one, whether these modules are really attached to `window.PK`.

---

## 开发与测试 / Development & Testing

```bash
node build.js                    # 重新打包单文件版 / rebuild the single-file build

# 逻辑层（纯 Node，不需要 NODE_PATH） / logic layer (pure Node, no NODE_PATH needed)
node test/test.js                # 单元测试（58 项断言） / unit tests (58 assertions)
node test/check-range.js         # 169 类范围模型（59 项） / 169-class range model (59)
node test/check-profile.js       # 漏洞画像与剥削权重（50 项） / leak profile & exploitation weights (50)
node test/check-wiring.js        # B 组端到端接线（50 项） / group-B end-to-end wiring (50)
node test/check-ev.js            # EV 损失复盘（105 项） / EV-loss review (105)
node test/check-bridge.js        # 题库联动（133 项 + 防漂移组：识别到题库文件时逐键比对，识别不到则跳过并报明） / drill linking (133, plus an anti-drift group that compares key-by-key when the drill file is found, and says so when skipped)
node test/check-scenarios.js     # 题库自洽性 / drill-bank self-consistency
node test/symmetry.js 1500       # 1500 手行为统计 / behavioural stats over 1500 hands
node test/diag-style.js 1500     # 各人格 VPIP/PFR/WTSD（软报告，退出码恒为 0；无种子，建议跑两遍）
                                 # per-personality VPIP/PFR/WTSD (soft report, exit code always 0; unseeded, run twice)

# 浏览器层（需要 NODE_PATH 指向 playwright-core） / browser layer (NODE_PATH must point at playwright-core)
export NODE_PATH=<playwright路径>   # <path to playwright>
node test/smoke.js               # 冒烟：无报错、能打完、无溢出 / smoke: no errors, plays through, no overflow
node test/features.js            # 复盘/持久化/训练全链路（38 项） / replay/persistence/drills end-to-end (38)
node test/check-analysis.js      # C/D 组界面验收（70 项） / group-C/D UI verification (70)
node test/measure-layout.js index.html    # 布局体检（8 种分辨率） / layout check (8 resolutions)
node test/check-positions.js index.html   # 位置标签 / position labels
node test/shot-panels.js index.html       # 面板截图 / panel screenshots

# 桌面入口（node 直接运行，不需要 NODE_PATH） / desktop entry (run with node, no NODE_PATH needed)
node desktop/verify-render.mjs   # 渲染验收：真实 Chrome 应用模式 + CDP 读 DOM（20 项，含全屏开关） / render verification: real Chrome app mode + DOM via CDP (20, incl. fullscreen toggle)
node desktop/verify-entry.mjs    # 入口验收：快捷方式内容 + 渲染 + 双击联动 + 窗口完整可见（31 项） / entry verification: shortcut contents + render + double-click chain + fully visible window (31)
node desktop/probe-window.mjs    # 窗口尺寸探针：屏幕/工作区/窗口外框/windowState，判定是否被裁 / window-size probe: screen/work area/window frame/windowState, decides if clipped
node desktop/test-wingeom.mjs    # 窗口几何判据单元测试（20 项，用实测的坏/好窗口数据钉住规则） / unit tests for the window-geometry predicate (20, pinning the rules with real bad/good window data)
node desktop/test-shortcut-args.mjs  # 验证新参数能否写入 .lnk（写项目内临时目录） / verifies new args can be written into a .lnk (writes to a temp dir inside the project)

# Electron 桌面版（先 npm install） / Electron desktop build (run npm install first)
npm run build                    # 重新打包单文件产物 / rebuild the single-file artifact
npm run fresh                    # 校验产物没有过期（见下） / verify the artifact is not stale (see below)
node tools/check-code-unchanged.mjs .workbuddy/baseline   # 注释改造的零改动校验（acorn 比对 token 流） / zero-change check for the comment pass (acorn token-stream comparison)
npm run smoke                    # 冒烟自检（5 项检查，退出码即结论） / smoke self-check (5 checks, exit code is the verdict)
npm run dist                     # 打包免安装便携 exe（产物在 dist/） / package the install-free portable exe (output in dist/)
```

### 改了 `src/` 要不要重新打包？ / Do I need to rebuild after editing `src/`?

要。Electron 成品里只有 4 个文件，游戏逻辑全部来自 `poker-trainer.html`（`src/*` 经 `build.js` 内联进去）。<br>
Yes. The Electron artifact contains only four files, and all game logic comes from `poker-trainer.html` (`src/*` inlined by `build.js`).

| 改动位置 / Where you edited | 是否进入成品 / Reaches the artifact | 是否需 `npm run build` / Needs `npm run build` |
| --- | --- | --- |
| `src/**`、`src/style.css`、`index.html`、`build.js` | 是 / yes | **必须 / required** |
| `electron/main.js`、`assets/`、`package.json` | 是 / yes | 需 `npm run dist` 重打 exe / re-run `npm run dist` |
| `test/`、`desktop/`、`tools/` | 否 / no | 不需要 / not needed |

`npm run dist` 已串好 `build → fresh → electron-builder`，不会漏；单独跑 `npm run fresh` 可以在提交前自查。<br>
`npm run dist` chains `build → fresh → electron-builder` so nothing is skipped; run `npm run fresh` on its own as a pre-commit self-check.

`fresh` 的判据**不是时间戳**（`git checkout`、复制、解包都会让 mtime 失真），而是**重新算一遍打包结果、跟磁盘产物逐字节比对**，并逐模块报出脱节位置。<br>
`fresh` does **not** compare timestamps (git checkout, copying, and unpacking all distort mtime); it **recomputes the bundle and compares it byte-for-byte with the artifact on disk**, then reports which module drifted.

```
$ node tools/check-bundle-fresh.cjs
✅ 产物是最新的 / artifact is up to date
   D:\repo\poker-trainer.html
   426.7 KB，15 个模块已内联 / modules inlined

$ node tools/check-bundle-fresh.cjs .workbuddy/freshness/stale1.html   # 坏样本：改了 engine.js 没重打包 / bad sample: engine.js changed without rebuild
❌ 产物已过期 / artifact is stale
     ✓ engine.js 之外的 15 项  一致 / identical
     ✗ engine.js               不一致 / differs (源码第 ~145 行 / src line ~145)
判别力已实测：仅删掉产物里 engine.js 的一处标识符（8 字符），检查即报 exit 1 并准确定位到 engine.js，其余 15 项仍判"一致"。
Discriminating power measured: deleting a single identifier (8 chars) from engine.js in the artifact makes the check exit 1 and pinpoint engine.js, while the other 15 still report "identical".
```

> `test/*.js` 里凡是 require('playwright-core') 的，都要先把 `NODE_PATH` 指到装了它的目录；<br>
> `desktop/verify-*.mjs` 走 Node 自带的 fetch/WebSocket 与真实 Chrome，不需要额外依赖。<br>
> Any `test/*.js` that does require('playwright-core') needs `NODE_PATH` pointed at the directory where it is installed first;<br>
> `desktop/verify-*.mjs` use Node's built-in fetch/WebSocket with real Chrome and need no extra dependencies.

改完 `src/` 下的代码后**必须重新执行 `node build.js`**，否则桌面入口打开的仍是旧版本。<br>
After changing code under `src/` you **must re-run `node build.js`**, otherwise the desktop entry still opens the old version.

### 环境变量 / Environment variables

所有外部资源的位置都按「环境变量 → 自动探测」解析，不写死任何机器路径；<br>
Every external resource is resolved as "environment variable → auto-detection", with no machine-specific path hard-coded:

| 变量 / Variable | 作用 / Purpose | 缺省行为 / Default when unset |
| --- | --- | --- |
| `NLHE_CHROME` | 指定浏览器 exe / browser executable | 依次尝试：playwright 自报 → `ms-playwright` 缓存扫描 → Chrome/Edge 标准安装目录 → `PATH`<br>tries, in order: playwright-reported → `ms-playwright` cache scan → standard Chrome/Edge install dirs → `PATH` |
| `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH` | 同上的兼容别名 / compatibility aliases for the above | 同上 / as above |
| `NLHE_PYTHON` | 指定 Python 解释器（desktop 的 .py 探针用） / Python interpreter (for the .py probes under desktop/) | 环境变量 → 缓存扫描 → `PATH` / env var → cache scan → `PATH` |
| `NLHE_DRILL_HTML` | 题库页面位置（check-bridge 的防漂移比对用） / drill page location (for check-bridge anti-drift) | 在本仓库内按内容识别（找含 `TOPICS` 的 HTML）；识别不到就跳过该组并报明<br>content-based discovery inside the repo (looks for an HTML containing `TOPICS`); the group is skipped with a notice if not found |
| `NLHE_PEER_ROOT` | probe-origin 的"对照副本"目录 / the "peer copy" directory for probe-origin | `../../temp/AI/NLHE`（相对仓库推导 / derived relative to the repo） |
| `NLHE_EXTRA_FLAGS` | 给 probe-fullscreen 追加 Chromium 启动参数 / extra Chromium flags for probe-fullscreen | 空 / empty |

---

## 布局约定（改样式前请先读）/ Layout Rules (read before touching styles)

牌桌的宽高由 `ui.js` 的 `measureFelt()` 精确写入，严格保持 **16 : 9.4**。这有三条硬约束：<br>
The table's width and height are written precisely by `measureFelt()` in `ui.js`, strictly holding **16 : 9.4**. This imposes three hard constraints:

1. **`.felt` 上不能再写 `width:100%` + `height:100%`** —— 两者同时存在会让 `aspect-ratio` 失效，<br>
   牌桌被拉成任意比例，所有按百分比定位的座位随之整体错位（这曾是真实缺陷）。<br>
   **Never add `width:100%` + `height:100%` to `.felt`** — together they break `aspect-ratio`,<br>
   stretch the table to an arbitrary ratio, and shift every percentage-positioned seat out of place (this was a real defect).
2. **牌桌上的元素尺寸必须走 `--ui-scale`**。它由 JS 按牌桌宽度写入（基准 1100px = 1.0），<br>
   牌、座位、字号都乘它，才能保证任意分辨率下"牌与牌桌的相对关系"完全一致。<br>
   **Element sizes on the table must go through `--ui-scale`**, which JS writes from the table width (baseline 1100px = 1.0).<br>
   Cards, seats and font sizes all multiply by it, which is the only way to keep "the cards' relation to the table" identical at any resolution.
3. **操作栏高度必须固定**（`height`，不能用 `min-height`）。用 `min-height` 时轮到你行动<br>
   （两行控件）会把栏撑高 20px，牌桌被压矮、座位整体位移，画面每轮到自己就"跳"一下。<br>
   **The action bar's height must be fixed** (`height`, never `min-height`). With `min-height`, when it is your turn<br>
   (two rows of controls) the bar grows 20px taller, pressing the table shorter, shifting every seat, and the view "jumps" on each of your turns.

`test/measure-layout.js` 会逐条检查以上三项，改动布局后请务必跑一遍。<br>
`test/measure-layout.js` checks all three of the above, one by one; always run it after changing the layout.

---

## 验收方法：什么才算"证明" / Verification: What Counts as "Proof"

界面类问题不能靠"看起来对"来判定，本项目踩过的坑如下，改动验收脚本时请沿用结论：<br>
UI problems cannot be judged by "it looks right". Here are the pitfalls this project has hit — keep these conclusions when changing the verification scripts:

1. **不要用屏幕截图当判定依据。** 窗口被遮挡或未取得前台时，`CopyFromScreen` 拍到的是压在<br>
   下面的桌面壁纸——文件照样"保存成功"，却什么都没证明（本项目确实产出过一张纯壁纸的<br>
   "通过"截图）。Windows 的前台锁定会拒绝后台进程的 `SetForegroundWindow`，而 `PrintWindow`<br>
   对 Chrome 的 GPU 合成窗口返回空白图，两条路都不可靠。<br>
   **Do not use screenshots as evidence.** When the window is occluded or cannot take the foreground, `CopyFromScreen` captures<br>
   the desktop wallpaper underneath — the file still "saves successfully" while proving nothing (this project really did produce a pure-wallpaper<br>
   "passing" screenshot). Windows' foreground lock rejects a background process's `SetForegroundWindow`, and `PrintWindow`<br>
   returns a blank image for Chrome's GPU-composited window; both roads are unreliable.
2. **改用 CDP 读真实 DOM。** `desktop/verify-render.mjs` 用与快捷方式相同的命令行启动 Chrome<br>
   应用模式（另加 `--remote-debugging-port=0` 与独立 `--user-data-dir`，保证新起实例且不污染<br>
   用户配置），再连进页面断言：地址、`document.title`、牌桌尺寸、座位数与位置标签唯一性、<br>
   发牌张数、模块装载、`localStorage` 可用性、有无未捕获异常。这些断言**可以被证伪**。<br>
   **Read the real DOM over CDP instead.** `desktop/verify-render.mjs` launches Chrome in app mode with the same<br>
   command line as the shortcut (plus `--remote-debugging-port=0` and an isolated `--user-data-dir`, guaranteeing a fresh instance that does not pollute<br>
   the user profile), then connects to the page and asserts: URL, `document.title`, table size, seat count and position-label uniqueness,<br>
   number of cards dealt, module loading, `localStorage` availability, and the absence of uncaught exceptions. These assertions **can be falsified**.
3. **取快照要等状态到达。** `Game` 实例在构造阶段就已存在（`players` 已就位）但尚未发牌，<br>
   若此时取快照会让"牌面已发出"假失败。判定条件必须等到"进入某条街且有牌"。<br>
   **Wait for the state to arrive before snapshotting.** A `Game` instance exists from the construction stage (`players` are in place) but the cards are not yet dealt;<br>
   snapshotting then makes "the board is out" falsely fail. The condition must wait for "a street has been entered and cards are dealt".
4. **规格类断言要独立成立。** 入口验收拆成 A 快捷方式内容 / B 真实渲染 / C 双击联动三段，<br>
   任何一段的假阳性都不会掩盖整体结论；截图降级为留档证据。<br>
   **Spec-like assertions must stand on their own.** Entry verification is split into three parts — A shortcut contents / B real render / C double-click chain —<br>
   so a false positive in any one part cannot mask the overall conclusion; screenshots are demoted to archival evidence.

---

## 范围胜率的发牌顺序（改 range.js 前请先读）/ Deal Order for Range Equity (read before touching range.js)

`equityVsWeights()` 是热力图、EV 复盘、以及 AI 翻后决策的共同地基，它的**抽样顺序**必须保持<br>
「先发对手的牌，再从剩下的牌里发公共牌」。<br>
`equityVsWeights()` is the common foundation of the heatmap, the EV review and the AI's postflop decisions, and its **sampling order** must stay<br>
"deal the opponents' cards first, then deal the board from the remaining cards".

反过来的写法（先把公共牌发完，再让对手在范围里挑两张避开公共牌）看着更自然，但得到的<br>
(牌面, 对手底牌) 联合分布**不是真实发牌**：公共牌是从一副**还含着对手底牌**的牌堆里发出来的，<br>
于是"能挡住对手范围的牌面"被系统性放大。<br>
The reverse (deal the board first, then have the opponent pick two cards from its range avoiding the board) looks more natural, but the resulting<br>
joint distribution of (board, opponent hole cards) **is not a real deal**: the board is drawn from a deck that **still contains the opponents' hole cards**,<br>
so "boards that block the opponent's range" are systematically over-represented.

实测量级（AA 对纯 KK 单挑）：<br>
Measured magnitude (AA vs a pure-KK heads-up range):

| | 公共牌出现 K 的概率 / P(K on board) | AA 胜率 / AA win rate |
| --- | --- | --- |
| 正确（先发对手）<br>Correct (opponent first) | 20.0% | **81.95%**（公开值 81.9%）<br>**81.95%** (published 81.9%) |
| 旧写法（先发公共牌）<br>Old order (board first) | 35.3% | 69.55% |

范围越窄、阻断越强，偏差越大；对"随机牌"几乎无影响（85.2% 一直是对的），<br>
所以只测随机范围**发现不了**这个问题。`check-range.js` 因此专门用窄范围单类对照锚定：<br>
AA 对 KK / QQ / 22 / AKo / 76s 都必须落在公开值 ±1.2pp 内。<br>
The narrower the range and the stronger the blockers, the larger the deviation; for "random cards" it is almost negligible (85.2% is always right),<br>
so testing only random ranges **cannot catch** this problem. `check-range.js` therefore anchors it with single-class narrow-range comparisons:<br>
AA vs KK / QQ / 22 / AKo / 76s must all land within ±1.2pp of the published values.

---

## 已知限制 / Known Limitations

- **人格标定仍有偏差**（`node test/diag-style.js 1500`，标准混合桌；该脚本是软报告，退出码恒为 0）：<br>
  **Personality calibration still drifts** (`node test/diag-style.js 1500`, standard mixed table; the script is a soft report whose exit code is always 0):

  | 人格 / Personality | VPIP | PFR | WTSD | 参考区间 / Reference range |
  | --- | --- | --- | --- | --- |
  | 岩石 rock | 15.3 ✓ | 12.8 ✓ | 35.6 **✗ 偏高 / high** | VPIP 10~17 / PFR 7~14 / WTSD 16~26 |
  | 紧凶 tag | 23.3 ✓ | 20.3 ✓ | 25.6 ✓（临界 / borderline） | VPIP 20~28 / PFR 15~23 / WTSD 18~28 |
  | 松凶 lag | 32.9 ✓ | 30.1 ✓ | 30.4 ✓ | VPIP 28~40 / PFR 22~33 / WTSD 20~32 |
  | 跟注站 calling | 20.6 **✗ 偏低 / low** | 7.5 ✓ | 40.7 ✓ | VPIP 30~48 / PFR 3~10 / WTSD 28~42 |
  | 疯子 maniac | 39.8 **✗ 偏低 / low** | 39.2 ✓ | 45.8 ✗ 略高 / slightly high | VPIP 48~75 / PFR 35~60 / WTSD 26~44 |

  > ⚠️ **上面是某一次 1500 手运行的结果，不是稳定基线。** 该脚本不设随机种子。<br>
  > 三次同样 1500 手的实测：<br>
  > ⚠️ **The table above is one 1500-hand run, not a stable baseline.** The script sets no random seed.<br>
  > Three separate 1500-hand runs:
  >
  > | 人格 / Personality | VPIP（3 次 / runs） | WTSD（3 次 / runs） |
  > | --- | --- | --- |
  > | 岩石 rock | 17.0 / 15.3 / 14.5 | 35 / 35.6 / **26.1** |
  > | 紧凶 tag | 25 / 23.3 / 24.4 | **40 / 25.6 / 29.6** |
  > | 松凶 lag | — / 32.9 / 33.5 | — / 30.4 / 31.8 |
  > | 跟注站 calling | 21 / 20.6 / 21.1 | 39 / 40.7 / 39.3 |
  > | 疯子 maniac | 40 / 39.8 / 42.9 | 47 / 45.8 / 47.9 |
  >
  > **抖动集中在 WTSD，VPIP/PFR 反而很稳**：紧凶 WTSD 极差 14.4pp（一次 ⚠️ 一次 ✅），<br>
  > 而 VPIP 极差只有 1.5~3pp。原因是 WTSD 的分母只有"看过翻牌"那 90~240 手，<br>
  > VPIP 的分母是全 1500 手。所以：**判读要看多项指标的方向，不要看单项是否压线，<br>
  > 也不要为一次运行的临界值调参**；临界项要跑 2~3 次取多数，或直接加手数。<br>
  > **The jitter is concentrated in WTSD, while VPIP/PFR are actually very stable**: TAG's WTSD spread is 14.4pp (⚠️ once, ✅ once),<br>
  > whereas VPIP's spread is only 1.5~3pp. The reason is that WTSD's denominator is only the 90~240 hands that "saw the flop",<br>
  > while VPIP's denominator is all 1500 hands. So: **judge by the direction of multiple metrics, not by whether a single one touches the line,<br>
  > and do not tune parameters for one run's borderline value**; re-run borderline items 2~3 times and take the majority, or just add hands.

  过滤掉噪声后，**跨运行稳定出现**的真实缺口有四条：<br>
  **岩石 WTSD 偏高**（三次 26~36，区间 16~26，跟注偏多）、<br>
  **跟注站 VPIP ≈21 明显偏低**（三次 20.6~21.1，区间 30~48；幅度也稳定，最该先修）、<br>
  **疯子 VPIP 40~43 低于区间 48~75 且 WTSD 46~48 略高于 44**、<br>
  进翻牌率整体偏低 5~7pp（`flopSeen` 仅 6~16%，翻前加注过频）。<br>
  紧凶压在 WTSD 边界（2/3 次超出），松凶三次全达标 —— **这两个不要动**。<br>
  用旧采样器做 A/B 得到同样的格局（rock 26.7 / tag 39.7 / lag 39.6 / calling 41.7 / maniac 47.0），<br>
  说明这是**既有标定缺口**，不是发牌顺序修复引入的。<br>
  调参入口：`src/ai.js` 的 `callRange` / `cheapCall` / `OPEN_BY_BEHIND`；<br>
  参考区间写在 `test/diag-style.js` 的 `REF`，改阈值改那里，别在文档里另写一套。<br>
  After filtering out the noise, four real gaps **appear consistently across runs**:<br>
  **rock WTSD too high** (26~36 across three runs vs. a 16~26 range — it calls too much),<br>
  **calling station VPIP ≈21 clearly too low** (20.6~21.1 across three runs vs. a 30~48 range; the magnitude is stable too, so fix this first),<br>
  **maniac VPIP 40~43 below the 48~75 range, with WTSD 46~48 slightly above 44**,<br>
  an overall flop-seen rate 5~7pp too low (`flopSeen` only 6~16%; preflop raising is too frequent).<br>
  TAG sits on the WTSD boundary (out of range on 2 of 3 runs) and LAG is in range on all three — **leave these two alone**.<br>
  An A/B with the old sampler produced the same picture (rock 26.7 / tag 39.7 / lag 39.6 / calling 41.7 / maniac 47.0),<br>
  which shows these are **pre-existing calibration gaps**, not something introduced by the deal-order fix.<br>
  Tuning entry points: `callRange` / `cheapCall` / `OPEN_BY_BEHIND` in `src/ai.js`;<br>
  the reference ranges live in `REF` in `test/diag-style.js` — change thresholds there, not in a second copy in the docs.

- 翻前的 EV 是**静态估算**：没有公共牌时 169 类都算作"高牌"，模型只能看方向，<br>
  不能看幅度。`PK.EVLoss` 会给翻前决策自动加上这条说明（`caveat`）。<br>
  Preflop EV is a **static estimate**: with no board, all 169 classes are treated as "high card", so the model can only tell you the direction,<br>
  not the magnitude. `PK.EVLoss` automatically attaches this note (`caveat`) to preflop decisions.
- 翻牌/转牌的 EV 可信度标为"仅方向"，河牌在单挑下接近精确 —— 面板上每一步都会标注。<br>
  Flop/turn EV is labelled "direction only", and the river is nearly exact heads-up — every step is annotated on the panel.
- 题库联动只读不写：两个页面是独立窗口，无法直接传参，所以清单里列出题目名让用户自己点，<br>
  跳转只能"打开题库"，定位不到具体题目。<br>
  Drill linking is read-only: the two pages are separate windows and cannot pass parameters directly, so the list shows drill names for the user to click;<br>
  the jump can only "open the drill bank", not land on a specific drill.
- 桌面快捷方式的渲染验收依赖本机 Chrome 路径，换机器需要改 `desktop/` 下的常量。<br>
  The shortcut render verification depends on the local Chrome path; on another machine you must change the constants under `desktop/`.

---

## 窗口与全屏 / Window & Fullscreen

**开窗方式**：快捷方式用 Chrome 应用模式 `--app=<URL> --start-maximized`。<br>
**How the window opens**: the shortcut uses Chrome app mode `--app=<URL> --start-maximized`.

不要改回 `--window-size=W,H`。曾写死 `1560,980`，在 1440×960（工作区 1440×912）的屏幕上<br>
实测窗口被开成 **1455×975 @ (10,10)** —— 右缘超出屏幕 25px、下缘超出 73px，<br>
表现为"右边和底部被遮住、像错位"。两个坑：<br>
Do not switch back to `--window-size=W,H`. It was once hard-coded to `1560,980`, and on a 1440×960 screen (work area 1440×912)<br>
the window was measured opening at **1455×975 @ (10,10)** — 25px past the right edge and 73px past the bottom,<br>
showing up as "the right and bottom are covered, looks misaligned". Two traps:

1. `--window-size` 与 `--start-maximized` 同传时**尺寸参数胜出**，最大化被忽略，<br>
   所以必须**同时去掉**尺寸参数；<br>
   When `--window-size` and `--start-maximized` are passed together, **the size argument wins** and maximizing is ignored,<br>
   so the size argument must be **removed as well**;
2. 即使把尺寸改成恰好等于工作区，Chrome 仍从 (10,10) 起画，照样溢出 10px ——<br>
   **靠调数字治不好**，只有让浏览器按当前工作区自适应才与分辨率无关。<br>
   Even if the size is set to exactly the work area, Chrome still draws from (10,10) and overflows by 10px —<br>
   **tweaking the numbers cannot fix it**; only letting the browser adapt to the current work area makes it resolution-independent.

**真全屏**（盖住任务栏、无窗口边框）：按 <kbd>F11</kbd>，或点顶栏右上角的 **⛶** 按钮。<br>
它走 Fullscreen API（`requestFullscreen`），<kbd>Esc</kbd> 退出；全屏下牌桌比例仍严格<br>
保持 16:9.4 不被拉伸。<br>
**True fullscreen** (covers the taskbar, no window border): press <kbd>F11</kbd>, or click the **⛶** button at the top-right of the top bar.<br>
It uses the Fullscreen API (`requestFullscreen`), and <kbd>Esc</kbd> exits; in fullscreen the table ratio still strictly<br>
holds 16:9.4 and is not stretched.

**验收**：`desktop/verify-entry.mjs` 的 C 段会直接比对窗口外框边缘与屏幕工作区尺寸，<br>
数字说话 —— 窗口越界时给出 `超出 右25px 下73px` 这样的具体差值，而不是靠肉眼。<br>
**Verification**: section C of `desktop/verify-entry.mjs` compares the window-frame edges against the screen work-area size directly;<br>
the numbers do the talking — when the window overflows it reports a concrete difference like `超出 右25px 下73px`, rather than relying on the eye.

---

## 桌面入口 / Desktop Entry

见 [`desktop/README.md`](desktop/README.md)：图标生成、快捷方式重建与验收流程，<br>
以及八个已踩过的陷阱（脚本宿主、`.ps1` 编码、图标缓存、截图不可判定、<br>
`spawnSync` 一律 EBUSY、桌面既有文件不可改写、"文件存在"≠"写入成功"）。<br>
See [`desktop/README.md`](desktop/README.md): icon generation, shortcut rebuilding and the verification flow,<br>
plus eight pitfalls already hit (script host, `.ps1` encoding, icon cache, screenshots being unusable as evidence,<br>
`spawnSync` always returning EBUSY, existing desktop files being non-overwritable, and "the file exists" ≠ "the write succeeded").
