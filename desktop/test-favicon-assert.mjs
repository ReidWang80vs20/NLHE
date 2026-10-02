/**
 * 证明 verify-render.mjs 里"内嵌 favicon"这条断言**有判别力**。
 * Prove that the "embedded favicon" assertion in verify-render.mjs **has discriminating power**.
 *
 * 做法不是抄一遍判据（抄一遍只能证明抄对了），而是从 verify-render.mjs 源码里
 * Rather than copying the predicate (which would only prove the copy is right), we **extract verbatim**
 * **原样抽取**那段 evalIn 表达式，配一个最小 DOM 桩跑三种输入：
 * the evalIn expression from verify-render.mjs source and run it against a minimal DOM stub with three inputs:
 *   好数据（真实 poker-trainer.html 的 head）→ 必须通过
 *   Good data (the head of the real poker-trainer.html) → must pass
 *   坏数据 1（把 favicon 那行删掉）          → 必须拒绝
 *   Bad data 1 (favicon line removed)          → must reject
 *   坏数据 2（href 留空壳）                  → 必须拒绝
 *   Bad data 2 (href left as an empty shell)          → must reject
 * 三条都要符合预期，断言才算合格。
 * The assertion only qualifies if all three behave as expected.
 *
 * 用法：node test-favicon-assert.mjs
 * Usage: node test-favicon-assert.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const src = fs.readFileSync(path.join(root, "desktop", "verify-render.mjs"), "utf8");
const m = src.match(/const fav = await evalIn\(`([\s\S]*?)`\);/);
if (!m) {
  console.error("✗ 没能从 verify-render.mjs 抽出 favicon 断言表达式（改过结构？）");
  process.exit(2);
}
const expr = m[1];
console.log("已从源码抽取断言表达式，" + expr.split("\n").length + " 行\n");

/**
 * 最小 DOM 桩：只实现断言实际用到的那两个方法
 * Minimal DOM stub: implements only the two methods actually used by the assertion
 */
function makeDoc(html) {
  const found = /<link[^>]*rel="icon"[^>]*>/.exec(html);
  const tag = found ? found[0] : null;
  return {
    querySelector(sel) {
      if (sel !== 'link[rel="icon"]') throw new Error("断言用了未桩化的选择器：" + sel);
      if (!tag) return null;
      const hm = /href="([^"]*)"/.exec(tag);
      return { getAttribute: (n) => (n === "href" ? (hm ? hm[1] : "") : null) };
    },
  };
}

const realHtml = fs.readFileSync(path.join(root, "poker-trainer.html"), "utf8");
const noFavicon = realHtml.replace(/<link[^>]*rel="icon"[^>]*>\s*/g, "");
const emptyHref = realHtml.replace(/(<link[^>]*rel="icon"[^>]*href=")[^"]*(")/, "$1$2");

const cases = [
  ["好数据：真实单文件产物", realHtml, true],
  ["坏数据 1：favicon 那行被删掉", noFavicon, false],
  ["坏数据 2：href 是空壳", emptyHref, false],
];

let pass = 0;
for (const [name, html, want] of cases) {
  const doc = makeDoc(html);
  const run = new Function("document", "atob", "return (" + expr + ")");
  let got;
  try {
    got = run(doc, atob);
  } catch (e) {
    got = { ok: false, why: "抛异常：" + e.message };
  }
  const good = !!got.ok === want;
  if (good) pass++;
  console.log((good ? "  ✓ " : "  ✗ ") + name +
    "  → ok=" + got.ok + "（期望 " + want + "）  " + got.why);
}

console.log("\n" + (pass === cases.length
  ? "✅ 断言判别力成立：" + pass + "/" + cases.length + " 条符合预期"
  : "❌ 判别力不成立：" + pass + "/" + cases.length));
process.exit(pass === cases.length ? 0 : 1);
