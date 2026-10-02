/* ============================================================
 * electron/main.js — Electron 主进程入口
 *                    Electron main-process entry point
 *
 * 职责 / Responsibilities:
 *   1. 创建唯一的应用窗口，加载单文件版 poker-trainer.html
 *      Create the single application window and load the
 *      self-contained build (poker-trainer.html).
 *   2. 锁定单实例：重复双击时聚焦已有窗口，而不是再开一个进程
 *      Enforce a single instance: a second launch focuses the
 *      existing window instead of spawning another process.
 *   3. 安全默认值：关闭 Node 集成、开启上下文隔离与沙箱，
 *      并拒绝任何外部跳转 / 新窗口（纯本地应用，不需要联网）
 *      Secure defaults: no Node integration, context isolation
 *      and sandbox on, and all external navigation or pop-ups
 *      are denied — this is an offline, local-only app.
 *   4. 记住窗口大小与位置，下次启动恢复
 *      Remember window bounds and restore them next launch.
 *   5. `--smoke` 冒烟自检：无人值守启动 → 校验页面与运行时
 *      环境 → 输出 JSON 结果 → 退出码即结论
 *      `--smoke` self-check: launch headless-ish, verify the
 *      page and runtime, print a JSON report, exit by status.
 *
 * 用法 / Usage:
 *   npm start            # 打开应用       / open the app
 *   npm run smoke        # 冒烟自检       / run the smoke check
 * ============================================================ */
'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

/* 必须在 app 就绪前关闭硬件加速，否则 GPU 进程已经崩过一轮
   Hardware acceleration must be turned off before the app is ready,
   otherwise the GPU process has already crashed once. */
/* 项目根目录（electron/ 的上一级）/ Project root (parent of electron/) */
const APP_ROOT = path.join(__dirname, '..');
/* 单文件版入口：构建产物，零依赖、离线可运行
   Self-contained entry: the build artifact, zero-dependency, offline-ready */
const ENTRY_FILE = path.join(APP_ROOT, 'poker-trainer.html');
/* 冒烟模式开关 / Smoke-mode flag */
const SMOKE = process.argv.includes('--smoke');
/* 无 GPU 模式：虚拟机、远程桌面或驱动异常时，Chromium 的 GPU 进程会反复崩溃
   ("GPU process isn't usable. Goodbye.")。--no-gpu 让用户有一条自救路径，
   冒烟自检则无条件使用它，保证在无头/受限环境里也能跑完。
   No-GPU mode: on VMs, RDP sessions or broken drivers the Chromium GPU
   process crashes in a loop ("GPU process isn't usable. Goodbye.").
   --no-gpu gives users a rescue switch; the smoke check always uses it so
   that it also works in headless / restricted environments. */
const NO_GPU = SMOKE || process.argv.includes('--no-gpu');
if (NO_GPU) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

/* productName 由 package.json 提供；此处仅作窗口标题兜底
   productName comes from package.json; this is only a window-title fallback */
const APP_TITLE = '德州扑克练习室 · NLHE Trainer';

/* ------------------------------------------------------------
 * 窗口几何持久化 / Window geometry persistence
 * 存于 userData 目录，与存档（localStorage）同处一个应用数据区
 * Stored under userData, the same app-data area as the localStorage saves.
 * ---------------------------------------------------------- */
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  const fallback = { width: 1280, height: 860, x: undefined, y: undefined, maximized: false };
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    /* 只接受有限数值，脏数据一律回退默认值
       Accept finite numbers only; anything else falls back to defaults */
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : undefined);
    return {
      width: Math.max(900, num(raw.width) || fallback.width),
      height: Math.max(640, num(raw.height) || fallback.height),
      x: num(raw.x),
      y: num(raw.y),
      maximized: !!raw.maximized,
    };
  } catch (e) {
    /* 首次启动、文件损坏或不可读：用默认几何
       First launch, corrupt or unreadable file: use defaults */
    return fallback;
  }
}

function saveWindowState(win) {
  try {
    const st = {
      ...win.getNormalBounds(),
      maximized: win.isMaximized(),
    };
    fs.writeFileSync(STATE_FILE(), JSON.stringify(st), 'utf8');
  } catch (e) {
    /* 写盘失败不应影响使用 / A failed write must never break the app */
  }
}

/* ------------------------------------------------------------
 * 冒烟自检 / Smoke self-check
 * 在渲染进程里跑一段断言脚本，把结果打回标准输出。
 * Runs an assertion script inside the renderer and prints the
 * result to stdout, so CI or a human can verify the package.
 * ---------------------------------------------------------- */
const SMOKE_SCRIPT = `(() => {
  const out = { ok: true, checks: [] };
  const check = (name, pass, detail) => {
    out.checks.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
    if (!pass) out.ok = false;
  };
  const PK = window.PK || {};
  /* 1. 模块挂载 / modules mounted */
  const required = ['Game', 'Range', 'Profile', 'EVLoss', 'Bridge', 'Leaks', 'Store', 'evaluate'];
  check('modules', required.every(k => PK[k]), required.filter(k => !PK[k]).join(',') || 'ok');
  /* 2. 牌型评估器可算且顺序正确 / evaluator works and orders correctly */
  try {
    const quads = PK.evaluate([12*4+0, 12*4+1, 11*4+0, 0*4+0, 1*4+0, 2*4+0, 3*4+0]);
    const high = PK.evaluate([0*4+0, 3*4+1, 5*4+2, 7*4+3, 9*4+0]);
    check('evaluate', quads > high, 'quads>high');
  } catch (e) { check('evaluate', false, String(e)); }
  /* 3. localStorage 可用（Electron + file:// 的关键前提）
        localStorage availability — the key premise on file:// */
  const storeOk = !!(PK.Store && PK.Store.isAvailable());
  check('localStorage', storeOk, storeOk ? 'available' : 'unavailable');
  /* 4. 能真正开一手牌 / a hand can actually be dealt */
  try {
    const g = new PK.Game({ seats: 6, aiSpeed: 0, dealDelay: 0 });
    g.newHand();
    check('newHand', g.players.length === 6 && g.players[0].hole.length === 2,
      'seats=' + g.players.length + ' hole=' + g.players[0].hole.length);
    g.resetAll();
  } catch (e) { check('newHand', false, String(e)); }
  /* 5. 界面骨架 / UI skeleton */
  check('dom', !!document.querySelector('.felt'), 'felt');
  return out;
})()`;

async function runSmoke(win) {
  let report;
  try {
    report = await win.webContents.executeJavaScript(SMOKE_SCRIPT, true);
  } catch (e) {
    report = { ok: false, checks: [], error: String(e) };
  }
  const line = (c) => '  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + c.name +
    (c.detail ? '  (' + c.detail + ')' : '');
  console.log('\n=== Electron smoke check ===');
  (report.checks || []).forEach(c => console.log(line(c)));
  if (report.error) console.log('  ERROR ' + report.error);
  console.log('=== ' + (report.ok ? 'OK — ' + (report.checks || []).length + ' checks passed'
    : 'FAILED') + ' ===\n');

  /* 打包成 GUI 应用后标准输出常常接不到管道，所以同时把报告落盘，
     便于人肉核对与 CI 取用（退出码仍是权威结论）。
     A packaged GUI app usually has no attached stdout, so the report is
     also written to disk for humans and CI (the exit code stays authoritative). */
  try {
    const outFile = path.join(app.getPath('userData'), 'smoke-report.json');
    fs.writeFileSync(outFile, JSON.stringify(Object.assign({
      app: APP_TITLE,
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      packaged: app.isPackaged,
      entry: ENTRY_FILE,
      time: new Date().toISOString(),
    }, report), null, 2), 'utf8');
    console.log('smoke report → ' + outFile);
  } catch (e) {
    console.log('smoke report write failed: ' + e.message);
  }

  app.exit(report.ok ? 0 : 1);
}

/* ------------------------------------------------------------
 * 窗口创建 / Window creation
 * ---------------------------------------------------------- */
function createWindow() {
  const st = loadWindowState();

  const win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: 900,
    minHeight: 640,
    title: APP_TITLE,
    /* 先用与界面背景一致的深色，避免启动瞬间的白闪
       Start with the app's dark background to avoid a white flash */
    backgroundColor: '#0b1220',
    show: false,
    autoHideMenuBar: true,
    /* 窗口图标：随应用一起打包，开发与安装后都能取到
       Window icon: shipped inside the package, valid in both dev and installed builds */
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      /* 本地单文件应用不需要任何 Node 能力 / no Node capability is needed */
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      /* 关闭拼写检查等无关特性 / disable unrelated features */
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  /* 首帧就绪后再显示，避免看到半渲染的界面
     Show only after the first paint to avoid a half-rendered view */
  win.once('ready-to-show', () => {
    if (st.maximized) win.maximize();
    win.show();
  });

  if (SMOKE) {
    /* 冒烟模式：界面可隐藏，但仍需完成加载
       Smoke mode: the window may be hidden but must finish loading */
    win.webContents.once('did-finish-load', () => runSmoke(win));
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      console.log('=== Electron smoke check ===');
      console.log('  FAIL  load  (' + code + ' ' + desc + ')');
      console.log('=== FAILED ===\n');
      app.exit(1);
    });
  }

  /* 外部链接一律交给系统浏览器，绝不在应用窗口里打开
     External links always go to the system browser, never in-app */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  /* 只允许停留在本地单文件页面上 / stay on the local page only */
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  const persist = () => saveWindowState(win);
  win.on('resize', persist);
  win.on('move', persist);
  win.on('maximize', persist);
  win.on('unmaximize', persist);

  win.loadFile(ENTRY_FILE);
  return win;
}

/* ------------------------------------------------------------
 * 应用生命周期 / App lifecycle
 * ---------------------------------------------------------- */
/* 单实例锁：第二个进程立刻退出，并把已有窗口带到前台
   Single-instance lock: a second process exits at once and the
   existing window is brought to the front instead. */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    /* Windows 任务栏分组与通知标识 / taskbar grouping & notification id */
    app.setAppUserModelId('com.nlhe.trainer');
    /* 纯本地应用：不要默认菜单（保留 F12 开发者工具便于自查）
       Local-only app: drop the default menu but keep F12 devtools */
    Menu.setApplicationMenu(null);
    const win = createWindow();
    win.webContents.on('before-input-event', (e, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') {
        win.webContents.toggleDevTools();
        e.preventDefault();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  /* 关闭全部窗口即退出（Windows 习惯）
     Quit when all windows are closed (Windows convention) */
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
