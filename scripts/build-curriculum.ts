/* ------------------------------------------------------------------ *
 * IMP-10 build-curriculum.ts — 一次性脚本，把现有 LEVELS 投影为 LevelManifest JSON。
 * 在 M1 工程流水线中由 `npm run build:curriculum` 调用；不进入浏览器 bundle。
 *
 * 读：
 *   - src/challenges/levels.ts（Level[] 数组）
 * 写：
 *   - dist-curriculum/manifest.json（LevelManifest）
 * ------------------------------------------------------------------ */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEVELS } from "../src/challenges/levels.ts";
import { buildCatalog, type LevelPublishMeta } from "../src/courses/buildCatalog.ts";
import { serializeManifest } from "../src/courses/manifest.ts";
import type { TestbenchCase } from "../src/courses/manifest.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../dist-curriculum/manifest.json");

function basicTestbenchForLevel(levelId: string): TestbenchCase[] {
  return [
    {
      id: `${levelId}-public-1`,
      name: "空用例（占位）",
      inputs: [],
      assertions: [{ kind: "noDiagnostic" }],
      maxTicks: 1,
    },
  ];
}

/** 默认元数据 — 实际课程发布时应由作者填写 */
function metaForLevel(displayOrder: number): LevelPublishMeta {
  return {
    displayOrder,
    prerequisites: [],
    objectives: [],
    interfaceContract: {
      pins: [{ id: "in", name: "IN", direction: "in", width: 1, required: true }],
      mutable: "all",
      requiredDefs: [],
    },
    publicTests: [],
    validationCases: [],
    hints: [{ level: 1, body: "提示待补" }],
  };
}

function main() {
  let displayOrder = 1;
  const meta = new Map<string, LevelPublishMeta>();
  // 五世界分布：7/7/8/5/4
  for (let t = 1; t <= 5; t++) {
    const tierLevels = LEVELS.filter((l) => l.tier === t);
    tierLevels.forEach((l) => {
      const m = metaForLevel(displayOrder++);
      meta.set(l.id, m);
    });
  }
  // 给每个关卡填充最小测试台：1 个 noDiagnostic 公共用例，1 个 validation 用例
  for (const [id, m] of meta) {
    m.publicTests = basicTestbenchForLevel(id);
    m.validationCases = basicTestbenchForLevel(id);
  }
  const manifest = buildCatalog(LEVELS, meta, {
    title: "z-biz-tool-cpu 从门到 CPU",
    description: "首发 31 关 + 5 世界；序章待补",
    authors: ["z-biz-tool"],
    license: "MIT",
    generator: "build-curriculum.ts@0.1.0",
  });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, serializeManifest(manifest));
  console.log("[build-curriculum] wrote", OUT);
}

main();
