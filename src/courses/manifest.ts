/* ------------------------------------------------------------------ *
 * IMP-10 / 05_§5 课程内容契约 — LevelDefinition 与 LevelManifest 类型。
 *
 * 与现有 Level（src/challenges/levels.ts）区分：
 *  - Level（开发态）：保留函数骨架、可执行构造；仅在编辑器内可用
 *  - LevelDefinition（发布态）：纯 JSON 声明；不携带可执行 JS
 *
 * 发布器 buildCatalog(LEVELS, SOLUTIONS) → LevelManifest
 *  - 校验：31 ID 唯一、五世界数量固定、3 序章独立计数、先修 DAG 无环
 *  - 不通过的门禁返回 ValidationResult，不输出半残 catalog
 * ------------------------------------------------------------------ */

import type { Circuit, Design } from "../core/types.ts";

/** 资源指针（指向仓库内固定 id） */
export interface RefPointer {
  resourceId: string;
}

/** 关卡骨架 — 直接序列化的 Circuit JSON */
export interface LevelStarter {
  /** 关卡根电路 */
  circuit: Circuit;
  /** 预置子电路（已发布版本号嵌入组件锁） */
  defs: { id: string; name: string; circuit: Circuit }[];
}

/** 课程契约：固定端口、位宽、必需骨架 */
export interface TaskInterface {
  /** 端口稳定标识 */
  pins: { id: string; name: string; direction: "in" | "out"; width: number; required: boolean }[];
  /** 关卡修改范围（默认 "none" 表示关卡不允许改端口） */
  mutable: "none" | "init" | "all";
  /** 必需骨架（启用的子电路定义 id） */
  requiredDefs: string[];
  /** 固定初始化内容（ROM/RAM data） */
  initData?: Record<string, string>;
  /** CPU 观察契约（仅 CPU 关卡） */
  cpuObservation?: {
    pcRef: string;
    irRef: string;
    memInstancePath: string[];
  };
}

/** 测试断言（不执行任意 JS） */
export type Assertion =
  | { kind: "signalEquals"; target: string; equals: number | string }
  | { kind: "memoryEquals"; target: string; at: number; equals: number | string }
  | { kind: "outputSequence"; target: string; equals: (number | string)[] }
  | { kind: "halted" }
  | { kind: "noDiagnostic" };

/** 测试用例 */
export interface TestbenchCase {
  id: string;
  name: string;
  /** 输入事件列表：tick + value */
  inputs: { target: string; tick: number; value: number | string }[];
  /** 推进到目标 tick 后断言 */
  assertions: Assertion[];
  maxTicks: number;
  seed?: number;
}

/** 提示等级 */
export type HintStep = {
  level: 1 | 2 | 3 | 4;
  body: string;
};

/** 评分规则 */
export interface Rubric {
  /** 通关：固定接口 + 全部用例通过 + 无阻断诊断 */
  pass: { requiredCases: string[] };
  /** 工程勋章：结构/成本要求 */
  engineering?: { maxCost?: number; requiredDefs?: number; structuralRule?: string };
  /** 理解勋章：迁移 / 预测独立证据 */
  mastery?: { variantCaseIds: string[] };
}

/** 关卡发布版本（不可变） */
export interface LevelDefinition {
  id: string;
  revision: string;
  world: number;
  displayOrder: number;
  /** 直接先修知识点 id */
  prerequisites: string[];
  /** 关卡教学目标（关联知识图） */
  objectives: { knowledgeId: string; description: string }[];
  starter: LevelStarter;
  interfaceContract: TaskInterface;
  allowedComponents: string[];
  publicTests: TestbenchCase[];
  validationCases: TestbenchCase[];
  hints: HintStep[];
  rubric: Rubric;
  /** 奖励组件 ID（可空） */
  reward?: { componentId: string };
}

/** 课程 manifest — 全包入口 */
export interface LevelManifest {
  schemaVersion: 1;
  catalogId: string;
  /** 元数据：内容来源、作者、许可 */
  meta: {
    title: string;
    description: string;
    authors: string[];
    license: string;
    generator: string;
    generatedAt: string;
  };
  /** 知识节点（id + 描述 + DAG 依赖） */
  knowledgeGraph: { id: string; description: string; dependsOn: string[] }[];
  /** 序章微实验（独立计数） */
  prologues: LevelDefinition[];
  /** 31 关正式发布 */
  levels: LevelDefinition[];
  /** 元件/接口目录版本 */
  catalogVersion: string;
  kernelVersion: string;
  isaVersion: string;
  /** 资源哈希 — 不等同可信签名 */
  hash: string;
}

/** 校验结果 */
export interface CatalogValidation {
  ok: boolean;
  issues: { path: string; msg: string }[];
}

/** 校验：ID 唯一、五世界数量、序章独立、先修无环、必需接口与公共测试非空 */
export function validateCatalog(m: LevelManifest): CatalogValidation {
  const issues: { path: string; msg: string }[] = [];

  // ID 唯一
  const ids = new Set<string>();
  const dup = (id: string, where: string) => {
    if (ids.has(id)) issues.push({ path: where + ".id", msg: `重复 ID: ${id}` });
    else ids.add(id);
  };
  for (const p of m.prologues) dup(p.id, "prologues");
  for (const l of m.levels) dup(l.id, "levels");

  // 五世界：7/7/8/5/4
  const tierCount = new Map<number, number>();
  for (const l of m.levels) tierCount.set(l.world, (tierCount.get(l.world) ?? 0) + 1);
  const expected = [7, 7, 8, 5, 4];
  for (let i = 1; i <= 5; i++) {
    if ((tierCount.get(i) ?? 0) !== expected[i - 1]) {
      issues.push({ path: `levels.world${i}`, msg: `第 ${i} 世界关卡数 ${tierCount.get(i) ?? 0} ≠ ${expected[i - 1]}` });
    }
  }

  // 序章独立计数（最多 3）
  if (m.prologues.length > 3) {
    issues.push({ path: "prologues", msg: `序章数 ${m.prologues.length} > 3` });
  }

  // 先修 DAG 无环 + 仅引用存在的知识点
  const kg = new Map(m.knowledgeGraph.map((k) => [k.id, k]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const dfs = (id: string, stack: string[]): boolean => {
    if (done.has(id)) return true;
    if (visiting.has(id)) {
      issues.push({ path: "knowledgeGraph", msg: `知识图有环: ${stack.concat(id).join(" → ")}` });
      return false;
    }
    visiting.add(id);
    const node = kg.get(id);
    if (!node) {
      issues.push({ path: "knowledgeGraph", msg: `未声明的知识节点: ${id}` });
      return false;
    }
    for (const dep of node.dependsOn) {
      if (!dfs(dep, stack.concat(id))) return false;
    }
    visiting.delete(id);
    done.add(id);
    return true;
  };
  for (const k of kg.keys()) dfs(k, []);

  // 每个关卡 prerequisites 仅引用存在的知识节点
  for (const l of m.levels) {
    for (const p of l.prerequisites) {
      if (!kg.has(p)) issues.push({ path: `levels[${l.id}].prerequisites`, msg: `未知知识点: ${p}` });
    }
    if (l.publicTests.length === 0) {
      issues.push({ path: `levels[${l.id}].publicTests`, msg: "公共测试不能为空" });
    }
    if (l.validationCases.length === 0) {
      issues.push({ path: `levels[${l.id}].validationCases`, msg: "验证用例不能为空" });
    }
    if (l.interfaceContract.pins.length === 0) {
      issues.push({ path: `levels[${l.id}].interfaceContract.pins`, msg: "接口契约必须声明至少一个引脚" });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** 简易内容哈希（FNV-1a 32-bit）；用作一致性校验，不等同可信签名 */
export function catalogHash(m: LevelManifest): string {
  const text = JSON.stringify({ id: m.catalogId, levels: m.levels.map((l) => l.id), prologues: m.prologues.map((p) => p.id) });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** 草稿类型：buildCatalog 在内部把现有 LEVELS 投影为 LevelDefinition */
export interface CatalogDraft {
  prologues: LevelDefinition[];
  levels: LevelDefinition[];
  knowledgeGraph: { id: string; description: string; dependsOn: string[] }[];
  meta: LevelManifest["meta"];
  catalogVersion: string;
  kernelVersion: string;
  isaVersion: string;
}

/** 序列化 */
export function serializeManifest(m: LevelManifest): string {
  return JSON.stringify(m, null, 1);
}

/** 反序列化 + 校验 */
export function parseManifest(raw: string): { ok: true; manifest: LevelManifest } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: ["JSON 解析失败：" + (e as Error).message] };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, errors: ["manifest 顶层不是对象"] };
  }
  const m = parsed as LevelManifest;
  if (m.schemaVersion !== 1) {
    return { ok: false, errors: ["schemaVersion 必须是 1"] };
  }
  const v = validateCatalog(m);
  if (!v.ok) {
    return { ok: false, errors: v.issues.map((i) => i.path + " " + i.msg) };
  }
  return { ok: true, manifest: m };
}

/** 草稿 → manifest；如 hash 不匹配仍以原样返回（不强行重算） */
export function finalizeCatalog(draft: CatalogDraft): LevelManifest {
  const m: LevelManifest = {
    schemaVersion: 1,
    catalogId: "main-" + draft.meta.title,
    meta: { ...draft.meta, generatedAt: new Date().toISOString() },
    knowledgeGraph: draft.knowledgeGraph,
    prologues: draft.prologues,
    levels: draft.levels,
    catalogVersion: draft.catalogVersion,
    kernelVersion: draft.kernelVersion,
    isaVersion: draft.isaVersion,
    hash: "",
  };
  m.hash = catalogHash(m);
  return m;
}

/** 暴露给 build-curriculum 脚本使用的小工具 */
export function emptyStarter(): LevelStarter {
  return { circuit: { comps: [], wires: [] }, defs: [] };
}

/** 把已有的 Circuit 转成 LevelStarter（不导出函数源码） */
export function starterFromCircuit(c: Circuit, defs: LevelStarter["defs"] = []): LevelStarter {
  return { circuit: c, defs };
}

/** 从现有 Design 提取 Starter */
export function starterFromDesign(d: Design): LevelStarter {
  return {
    circuit: d.root,
    defs: (d.defs ?? []).map((df) => ({ id: df.id, name: df.name, circuit: df.circuit })),
  };
}
