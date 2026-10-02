/**
 * 验证"新参数能否正确写入 .lnk"。
 * Verify that "new arguments can be written into the .lnk correctly".
 *
 * 为什么先验：桌面目录不允许改写既有文件，更新真实快捷方式需要用户先删掉旧图标。
 * Why test first: the desktop directory does not allow overwriting existing files; updating the real shortcut requires the user to delete the old icon first.
 * 在麻烦用户之前，先用**项目内的临时目录**跑一遍完整链路
 * Before bothering the user, run the full pipeline once in a **temp directory inside the project**
 * （VBS + 含中文的 .lnk 路径 + 新命令行参数），确认机制本身没问题。
 * (VBS + a .lnk path containing Chinese + the new command-line arguments) to confirm the mechanism itself is sound.
 *
 * 用法：node test-shortcut-args.mjs
 * Usage: node test-shortcut-args.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVbs } from "./vbs.mjs";
import { inspectLnk } from "./lnk.mjs";
import { requireBrowser } from "./browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const VBS = path.join(here, "create-shortcut.vbs");
const TMP = path.join(ROOT, "_shortcut_probe");
const PAGE = path.join(ROOT, "poker-trainer.html");

fs.mkdirSync(TMP, { recursive: true });
const lnk = path.join(TMP, "\u6d4b\u8bd5\u5165\u53e3.lnk");   // 中文名，验证中文路径链路 / Chinese name, to verify the Chinese-path pipeline

const browser = requireBrowser();
const icon = fs.readdirSync(here).filter((f) => /^nlhe-[0-9a-f]{8}\.ico$/.test(f))
  .map((f) => path.join(here, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";

const url = "file:///" + PAGE.split(path.sep).join("/");
const cmdArgs = ["--app=" + url, "--start-maximized"].join(" ");

console.log("临时目录 : " + TMP);
console.log("目标 .lnk: " + lnk);
console.log("命令行   : " + cmdArgs);
console.log("");

const r = await runVbs(VBS, [lnk, browser.exe, cmdArgs, icon, ROOT, "Texas Hold'em No-Limit Trainer"]);
console.log("宿主回传 : exit=" + r.status + "  " + String(r.stdout || "").replace(/\s+/g, " ").trim());
if (r.error) console.log("错误     : " + r.error.message);

let failed = 0;
const check = (name, ok, val) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (val ? "  → " + val : ""));
  if (!ok) failed++;
};

console.log("\n校验：");
check("快捷方式已生成", fs.existsSync(lnk), lnk);
if (fs.existsSync(lnk)) {
  const info = inspectLnk(lnk);
  check("含 --app= 与页面地址", info.has("--app=") && info.has("poker-trainer.html"), "--app=file:///...");
  check("含 --start-maximized", info.has("--start-maximized"), "--start-maximized");
  check("不含写死的 --window-size", !info.windowSize,
    info.windowSize ? "竟然还有 " + info.windowSize.raw : "无");
  check("图标指向版本化 .ico", !!icon && info.has(path.basename(icon)), icon ? path.basename(icon) : "(无图标)");
  /* 不要用"内部字符串含中文"判断中文路径链路 —— CreateShortcut 保存时并不一定写
     Do not judge the Chinese-path pipeline by "the internal string contains Chinese" —— CreateShortcut does not always write
     NAME_STRING，那一项失败说明的是断言写错了，不是链路有问题。
     NAME_STRING when saving; a failure there means the assertion was wrong, not that the pipeline is broken.
     真正的证据是：文件**确实位于中文路径**上且被解析成功（上面两行已覆盖）。
     The real evidence is that the file **really sits on a Chinese path** and was parsed successfully (the two lines above already cover this). */
  check("中文路径下可正常创建并被解析", lnk.includes("\u6d4b\u8bd5\u5165\u53e3") && info.size > 0,
    path.basename(lnk) + "，" + info.size + " 字节");
  check("目标为浏览器", info.hasAny(browser.exe), path.basename(browser.exe));
}

console.log(failed ? "\n❌ 有 " + failed + " 项不合格" : "\n✅ 全部通过：新参数可以正确写入 .lnk");

/* 清掉临时目录（项目内，可删） / Clean up the temp directory (inside the project, safe to delete) */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 / Ignore */ }
process.exit(failed ? 1 : 0);
