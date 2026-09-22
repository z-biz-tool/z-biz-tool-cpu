/* ------------------------------------------------------------------ *
 * IMP-10 build-curriculum.ts — 一次性脚本，把现有 LEVELS 投影为 LevelManifest JSON。
 * 在 M1 工程流水线中由 `npm run build:curriculum` 调用；不进入浏览器 bundle。
 *
 * 读：
 *   - src/challenges/levels.ts（Level[] 数组）
 *   - src/courses/publishMetadata.ts（每关接口契约 / 验证用例 / 分级提示）
 * 写：
 *   - dist-curriculum/manifest.json（LevelManifest）
 * ------------------------------------------------------------------ */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEVELS } from "../src/challenges/levels.ts";
import { PROLOGUE_LEVELS } from "../src/challenges/prologue.ts";
import { buildCatalog, type LevelPublishMeta } from "../src/courses/buildCatalog.ts";
import { serializeManifest } from "../src/courses/manifest.ts";
import { PROLOGUE_META, LEVEL_META } from "../src/courses/publishMetadata.ts";
import type { LevelDefinition, TestbenchCase } from "../src/courses/manifest.ts";

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

const PROLOGUE_META_BY_ID: Record<string, LevelPublishMeta> = {};
for (const m of PROLOGUE_META) {
  // 用 ID 后缀（light/wire/clock）作为查找键，与 PROLOGUE_LEVELS.id 末尾对齐
  const kid = m.objectives[0]?.knowledgeId ?? "";
  const key = kid === "signal-direct" ? "light" : kid === "wire-connect" ? "wire" : kid === "edge-sample" ? "clock" : "";
  if (key) PROLOGUE_META_BY_ID[key] = m;
}

const LEVEL_META_BY_ID: Record<string, LevelPublishMeta> = {};
for (const m of LEVEL_META) {
  const kid = m.objectives[0]?.knowledgeId ?? "";
  if (kid) LEVEL_META_BY_ID[kid] = m;
}

/** 已知 ID 直接命中，否则退回默认最小元数据 */
function metaForLevel(id: string, displayOrder: number): LevelPublishMeta {
  // 序章 ID 形如 prologue-light / prologue-wire / prologue-clock
  if (id.startsWith("prologue-")) {
    const suffix = id.slice("prologue-".length);
    const hit = PROLOGUE_META_BY_ID[suffix];
    if (hit) return { ...hit, displayOrder };
  }
  // 关卡 ID 即 knowledgeId
  const hit = LEVEL_META_BY_ID[id];
  if (hit) return { ...hit, displayOrder };
  return {
    displayOrder,
    prerequisites: [],
    objectives: [{ knowledgeId: id, description: id }],
    interfaceContract: {
      pins: [{ id: "in", name: "IN", direction: "in", width: 1, required: true }],
      mutable: "all",
      requiredDefs: [],
    },
    publicTests: basicTestbenchForLevel(id),
    validationCases: basicTestbenchForLevel(id),
    hints: [{ level: 1, body: "提示待补" }],
  };
}

function main() {
  const meta = new Map<string, LevelPublishMeta>();

  // 序章：单独计数（1..3）
  let order = 1;
  for (const p of PROLOGUE_LEVELS) {
    const id = "prologue-" + p.id.replace("prologue-", "");
    const m = metaForLevel(id, order++);
    meta.set(p.id, m);
  }

  // 31 关：先按 publishMetadata 里的 displayOrder 排（doc 03 §3 教学展示顺序），
  // 没有 meta 的关卡用 LEVELS 顺序兜底；不能用纯递增 order 否则会覆盖 ALU 移到末尾等展示规则
  const knownMeta: { id: string; meta: LevelPublishMeta }[] = [];
  const fallback: string[] = [];
  for (const l of LEVELS) {
    const hit = LEVEL_META_BY_ID[l.id];
    if (hit) knownMeta.push({ id: l.id, meta: hit });
    else fallback.push(l.id);
  }
  // 先按 (tier from LEVELS, displayOrder) 排已知
  const tierOf: Record<string, number> = {};
  for (const l of LEVELS) tierOf[l.id] = l.tier;
  knownMeta.sort((a, b) => (tierOf[a.id] ?? 99) - (tierOf[b.id] ?? 99) || a.meta.displayOrder - b.meta.displayOrder);
  let n = 0;
  for (const { id, meta: km } of knownMeta) {
    const m = metaForLevel(id, km.displayOrder);
    meta.set(id, m);
    n++;
  }
  // fallback 按 LEVELS 顺序接着排
  for (const id of fallback) {
    meta.set(id, metaForLevel(id, ++n));
  }

  // 给没有真实用例的关卡填充最小测试台
  for (const [id, m] of meta) {
    if (!m.publicTests.length) m.publicTests = basicTestbenchForLevel(id);
    if (!m.validationCases.length) m.validationCases = basicTestbenchForLevel(id);
  }

  // 正式关卡走 buildCatalog；序章单独附加到 manifest.prologues
  const manifest = buildCatalog(LEVELS, meta, {
    title: "z-biz-tool-cpu 从门到 CPU",
    description: "首发 31 关 + 5 世界 + 3 序章",
    authors: ["z-biz-tool"],
    license: "MIT",
    generator: "build-curriculum.ts@0.1.0",
  });

  // 把 3 个序章注入 manifest.prologues
  const prologues: LevelDefinition[] = PROLOGUE_LEVELS.map((p, idx) => {
    const m = meta.get(p.id);
    return {
      id: "prologue-" + p.id.replace("prologue-", ""),
      revision: "1",
      world: 0,
      displayOrder: idx + 1,
      prerequisites: m?.prerequisites ?? [],
      objectives: m?.objectives ?? [],
      starter: { circuit: p.skeleton(), defs: [] },
      interfaceContract: m?.interfaceContract ?? {
        pins: [],
        mutable: "none",
        requiredDefs: [],
      },
      allowedComponents: p.available ?? [],
      publicTests: m?.publicTests ?? [],
      validationCases: m?.validationCases ?? [],
      hints: m?.hints ?? [],
      rubric: { pass: { requiredCases: (m?.validationCases ?? []).map((t) => t.id) } },
    };
  });
  manifest.prologues = prologues;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, serializeManifest(manifest));
  console.log("[build-curriculum] wrote", OUT);
}

main();
