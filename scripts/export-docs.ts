/**
 * 生成两份「能查的」文档：node --experimental-strip-types scripts/export-docs.ts
 *
 *  - doc/上手/03-通关答案索引.md   ：57 关的参考解规模与构成，配「一键载入」
 *  - doc/工坊/100案例目录.md       ：100 个案例的清单（分 8 包）
 *
 * 为什么由脚本生成：关卡和案例都在代码里，手写文档一定会漂。生成的文件头写明
 * 「勿手改」，改了下次就被覆盖 —— 这比口头约定可靠。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { LEVELS, STORAGE_LEVELS, FAST_LEVELS, solutionDesign, levelDesign } from "../src/challenges/levels.ts";
import { totalCost } from "../src/core/custom.ts";
import { GALLERY } from "../src/workshop/gallery/index.ts";
import { PACKS } from "../src/workshop/gallery/spec.ts";
import { buildNetlist } from "../src/workshop/dsl.ts";

const HEAD = (title: string, src: string) =>
  `# ${title}\n\n> 本文件由 \`scripts/export-docs.ts\` 生成（数据源：${src}），请勿手改。\n\n`;

function compSummary(design: ReturnType<typeof solutionDesign>): { text: string; cost: number; wires: number; comps: number } {
  if (!design) return { text: "—", cost: 0, wires: 0, comps: 0 };
  const counts = new Map<string, number>();
  for (const c of design.root.comps) {
    if (c.type === "input" || c.type === "output") continue;
    counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  }
  const text = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}×${n}`)
    .join(" · ");
  return {
    text: text || "（本关不需要加元件）",
    cost: totalCost(design, design.root),
    wires: design.root.wires.length,
    comps: [...counts.values()].reduce((a, b) => a + b, 0),
  };
}

/* ---------------- 通关答案索引 ---------------- */

{
  const parts: string[] = [HEAD("通关答案索引（57 关）", "src/challenges/levels.ts + solutions.ts")];
  parts.push(
    "答案就在应用里：打开任意关卡，点「看参考解」即可把官方解答载进画布（`⌘Z` 可退回）。\n" +
      "这份索引给的是**规模与构成**，用来判断「我的解法是不是绕远了」，而不是抄接线。\n\n" +
      "> 载入参考解之后，关卡列表会标「看过答案」。判题照旧、勋章照拿——不假装是自己做出来的就行。\n\n"
  );

  const books: { name: string; list: typeof LEVELS }[] = [
    { name: "CPU 书《从门到一台 Z16》", list: LEVELS },
    { name: "存储书《囚禁电荷》", list: STORAGE_LEVELS },
    { name: "优化书《流水线与之后的一切》", list: FAST_LEVELS },
  ];

  for (const book of books) {
    parts.push(`## ${book.name}（${book.list.length} 关）\n\n`);
    for (const lv of book.list) {
      const sol = solutionDesign(lv);
      const s = compSummary(sol);
      const skeleton = levelDesign(lv);
      const skComps = skeleton.root.comps.filter((c) => c.type !== "input" && c.type !== "output").length;
      parts.push(`### ${lv.name}\n\n`);
      parts.push(`- \`${lv.id}\` · 第 ${lv.tier} 层 · 基准花费 ${lv.par ?? "—"}\n`);
      parts.push(`- 任务：${lv.brief}\n`);
      parts.push(`- 考点：${lv.teach}\n`);
      if (lv.hint) parts.push(`- 提示：${lv.hint}\n`);
      parts.push(`- 骨架已有 ${skComps} 个元件；参考解 ${s.comps} 个元件 / ${s.wires} 根线 / 花费 ${s.cost}\n`);
      parts.push(`- 参考解构成：${s.text}\n\n`);
    }
  }

  mkdirSync("doc/上手", { recursive: true });
  writeFileSync("doc/上手/03-通关答案索引.md", parts.join(""), "utf8");
  console.log("写出 doc/上手/03-通关答案索引.md");
}

/* ---------------- 案例目录 ---------------- */

{
  const parts: string[] = [HEAD("工坊案例目录（100 个）", "src/workshop/gallery/")];
  parts.push(
    "全部案例：功能元件合计 " +
      GALLERY.reduce((n, ex) => {
        const b = buildNetlist(ex.src);
        return n + b.circuit.comps.filter((c) => c.type !== "input" && c.type !== "output").length;
      }, 0) +
      " 个，逐个经过结构检查、仿真与模型对拍（`npm run verify:gallery`）。\n\n" +
      "在应用里：右侧「工坊」→「打开案例库」→ 搜索 / 按包筛选 → 「放入画布」。\n\n"
  );

  for (const pack of PACKS) {
    const items = GALLERY.filter((e) => e.pack === pack.key);
    if (!items.length) continue;
    parts.push(`## ${pack.title}（${items.length} 个）\n\n${pack.blurb}\n\n`);
    parts.push("| 案例 | id | 层 | 端口 | 元件 | 一句话 |\n|---|---|---|---|---|---|\n");
    for (const ex of items) {
      const b = buildNetlist(ex.src);
      const comps = b.circuit.comps.filter((c) => c.type !== "input" && c.type !== "output").length;
      parts.push(`| **${ex.name}** | \`${ex.id}\` | T${ex.tier} | ${b.ports.length} | ${comps} | ${ex.blurb} |\n`);
    }
    parts.push("\n");
    for (const ex of items) {
      parts.push(`### ${ex.name}\n\n${ex.why}\n\n`);
      parts.push(`端口：${Object.entries(ex.ports).map(([k, v]) => `\`${k}\` ${v}`).join("；")}\n\n`);
      parts.push("```\n" + ex.src.trim() + "\n```\n\n");
    }
  }

  mkdirSync("doc/工坊", { recursive: true });
  writeFileSync("doc/工坊/100案例目录.md", parts.join(""), "utf8");
  console.log("写出 doc/工坊/100案例目录.md");
}
