/**
 * 案例工坊自检：npm run verify:gallery
 *
 * 100 个案例不是文案，是 100 份可仿真、可对拍的电路。
 * 这个脚本把它们逐个搭起来、跑输入向量、和独立模型比结果；
 * 任何一个不对就红着退出，不允许「看起来差不多」。
 */
import { checkExample } from "../src/workshop/gallery/check.ts";
import { GALLERY } from "../src/workshop/gallery/index.ts";
import { PACKS } from "../src/workshop/gallery/spec.ts";

let pass = 0;
let totalComps = 0;
const failed: string[] = [];

const byPack = new Map<string, { total: number; ok: number; comps: number }>();
for (const ex of GALLERY) {
  const r = checkExample(ex);
  const agg = byPack.get(ex.pack) ?? { total: 0, ok: 0, comps: 0 };
  agg.total++;
  agg.comps += r.stats.comps;
  totalComps += r.stats.comps;
  if (r.ok) {
    pass++;
    agg.ok++;
  } else {
    failed.push(`${r.id}（${r.name}）\n    ` + r.problems.join("\n    "));
  }
  byPack.set(ex.pack, agg);
}

console.log("\n案例工坊自检\n" + "─".repeat(64));
for (const pack of PACKS) {
  const a = byPack.get(pack.key);
  if (!a) continue;
  const flag = a.ok === a.total ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${flag} ${pack.title.padEnd(16, " ")} ${a.ok}/${a.total}  · ${a.comps} 个元件`);
}
console.log("─".repeat(64));
console.log(`  合计 ${pass}/${GALLERY.length} 个案例通过`);
if (!failed.length) console.log(`  全部案例共 ${totalComps} 个功能元件`);
console.log("");

if (failed.length) {
  console.log("失败明细：");
  for (const f of failed) console.log("  ✗ " + f);
  console.log("");
  process.exit(1);
}
