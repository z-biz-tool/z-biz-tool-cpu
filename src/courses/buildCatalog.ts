/* ------------------------------------------------------------------ *
 * IMP-10 buildCatalog — 把现有 LEVELS 投影为 LevelManifest JSON。
 *
 * 设计要点：
 *  - 函数骨架 / 参考解答在开发期由开发者提供；buildCatalog 只在开发流水线中运行。
 *  - 输出 LevelManifest 是纯 JSON — content 包中不含可执行 JavaScript / eval。
 *  - 与 05_§5.1 发布流水线对应：
 *      1. dev 阶段使用现有 build 工具生成骨架与参考解答
 *      2. validateCatalog 校验 ID 唯一 / 世界数量 / 序章独立 / 先修 DAG
 *      3. finalizeCatalog 计算 catalogVersion + 内容哈希
 *
 * 当前不与 builder.ts 强耦合 — 由调用方传入 LEVELS 与 SK/SOL，便于测试。
 * ------------------------------------------------------------------ */

import { KERNEL_VERSION, ISA_VERSION, CATALOG_VERSION } from "../project/types.ts";
import type { Level } from "../challenges/levels.ts";
import type { Design } from "../core/types.ts";
import {
  finalizeCatalog,
  starterFromDesign,
  starterFromCircuit,
  validateCatalog,
  type CatalogDraft,
  type HintStep,
  type LevelDefinition,
  type LevelManifest,
  type TaskInterface,
  type TestbenchCase,
} from "./manifest.ts";

/** 把单关 Level 投影为发布版 LevelDefinition */
export function projectLevel(
  level: Level,
  /** 关卡索引（用于 displayOrder） */
  displayOrder: number,
  /** 已知先修（由调用方按推荐顺序收集） */
  prerequisites: string[],
  /** 关卡目标 */
  objectives: { knowledgeId: string; description: string }[],
  /** 关卡的接口契约（必填） */
  iface: TaskInterface,
  /** 公共测试 */
  publicTests: TestbenchCase[],
  /** 验证用例 */
  validationCases: TestbenchCase[],
  /** 分级提示 */
  hints: HintStep[],
): LevelDefinition {
  const starter = starterFromCircuit(level.skeleton(), level.defs?.() ?? []);
  return {
    id: level.id,
    revision: "1",
    world: level.tier,
    displayOrder,
    prerequisites,
    objectives,
    starter,
    interfaceContract: iface,
    allowedComponents: level.available ?? [],
    publicTests,
    validationCases,
    hints,
    rubric: { pass: { requiredCases: validationCases.map((t) => t.id) } },
  };
}

/** 把 Reference Design 投影为 starter（实际工具：本项目把参考解答作不可变 component） */
export function projectSolutionToStarter(d: Design) {
  return starterFromDesign(d);
}

/** 把整个 Level[] 投影为草稿 catalog */
export function buildCatalog(
  levels: Level[],
  /** 关卡附加元数据：先修 + 接口 + 测试 + 提示；缺失则只生成最小可校验骨架 */
  metaByLevel: Map<string, LevelPublishMeta>,
  catalogMeta: { title: string; description: string; authors: string[]; license: string; generator: string },
): LevelManifest {
  const draft: CatalogDraft = {
    prologues: [],
    levels: [],
    knowledgeGraph: collectKnowledgeGraph(metaByLevel),
    meta: { ...catalogMeta, generatedAt: "" },
    catalogVersion: CATALOG_VERSION,
    kernelVersion: KERNEL_VERSION,
    isaVersion: ISA_VERSION,
  };

  for (const lvl of levels) {
    const m = metaByLevel.get(lvl.id);
    if (!m) {
      throw new Error("buildCatalog: 缺少关卡 " + lvl.id + " 的元数据");
    }
    draft.levels.push(
      projectLevel(
        lvl,
        m.displayOrder,
        m.prerequisites,
        m.objectives,
        m.interfaceContract,
        m.publicTests,
        m.validationCases,
        m.hints,
      ),
    );
  }

  const manifest = finalizeCatalog(draft);
  const v = validateCatalog(manifest);
  if (!v.ok) throw new Error("buildCatalog: 校验失败\n" + v.issues.map((i) => `  ${i.path}: ${i.msg}`).join("\n"));
  return manifest;
}

/** 关卡附加元数据（用户在使用 buildCatalog 前必须填齐） */
export interface LevelPublishMeta {
  displayOrder: number;
  prerequisites: string[];
  objectives: { knowledgeId: string; description: string }[];
  interfaceContract: TaskInterface;
  publicTests: TestbenchCase[];
  validationCases: TestbenchCase[];
  hints: HintStep[];
}

function collectKnowledgeGraph(metaByLevel: Map<string, LevelPublishMeta>) {
  const ids = new Set<string>();
  for (const m of metaByLevel.values()) {
    for (const o of m.objectives) ids.add(o.knowledgeId);
    for (const p of m.prerequisites) ids.add(p);
  }
  const graph: { id: string; description: string; dependsOn: string[] }[] = [];
  for (const id of ids) {
    const description = id.replace(/[-_]/g, " ");
    const dependsOn: string[] = [];
    for (const m of metaByLevel.values()) {
      if (m.prerequisites.includes(id)) {
        for (const o of m.objectives) {
          if (!dependsOn.includes(o.knowledgeId)) dependsOn.push(o.knowledgeId);
        }
      }
    }
    graph.push({ id, description, dependsOn: dependsOn.filter((d) => d !== id) });
  }
  return graph;
}
