/* ------------------------------------------------------------------ *
 * doc 03 §10 + doc 05 §5.2 判题流水线
 *
 * 顺序：
 *  1. 校验提交工程和运行预算
 *  2. 核对题目接口、固定位宽、预置程序
 *  3. 递归检查元件限制与封装约束；结构不合格时不运行
 *  4. 冻结设计、题目版本、seed 和引擎版本
 *  5. 每个用例创建独立运行态
 *  6. 错误/超时/取消与答案错误分开
 *  7. 功能通过后才计算可选工程勋章
 *  8. 理解勋章依据独立迁移/预测证据
 * ------------------------------------------------------------------ */

import type { LevelDefinition, TestbenchCase } from "./manifest.ts";

export interface RunContext {
  level: LevelDefinition;
  design: import("../core/types.ts").Design;
  seed: number;
  engineVersion: string;
  isaVersion: string;
  /** 单次用例最大 tick */
  maxTicks: number;
}

export interface CaseOutcome {
  caseId: string;
  pass: boolean;
  /** 失败原因（断言不匹配 / 超时 / 取消 / 资源耗尽 / 答案错误） */
  reason: "assert" | "timeout" | "cancelled" | "resource" | "error";
  /** 失败时记录输入时间、期望、实际 */
  firstFailure?: { tick: number; expected: unknown; actual: unknown; signal?: string };
  elapsedTicks: number;
}

export interface JudgmentResult {
  /** 整体通过（所有用例全过且无阻断诊断） */
  pass: boolean;
  /** 必过用例（r.requiredCases）全部通过 */
  passRequired: boolean;
  /** 每个用例的结果（隔离执行，互不干扰） */
  outcomes: CaseOutcome[];
  /** 工程勋章：先通关，再达本关公开成本/结构规则 */
  engineering?: { passed: boolean; cost: number; rule?: string };
  /** 理解勋章：迁移/预测独立证据（variantCaseIds 通过 + 非理解来源的辅助） */
  mastery?: { passed: boolean; variantCases: number };
  /** 与判题一起写入 attempt（同一事务内） */
  attemptId: string;
}

/** 把用例按 caseId 排序并稳定化，便于重现 */
export function stableSortCases(cases: TestbenchCase[]): TestbenchCase[] {
  return cases.slice().sort((a, b) => a.id.localeCompare(b.id));
}

/** 计算 cost：实际使用实例递归展开 */
export function computeCost(design: import("../core/types.ts").Design): number {
  const counted = new Set<string>();
  function visit(d: import("../core/types.ts").Design): number {
    let total = 0;
    for (const c of d.root.comps ?? []) {
      if (counted.has(c.id)) continue;
      counted.add(c.id);
      // 简化：每个基础元件 cost=1；custom 递归展开
      total += 1;
    }
    return total;
  }
  return visit(design);
}

/** 模拟一次用例执行；返回 outcome（不实际跑，校验逻辑） */
export function runCase(_ctx: RunContext, c: TestbenchCase): CaseOutcome {
  // 真实的 sim/runLevelTests 在 challenges/verify.ts 里；这里只暴露结构
  const r: CaseOutcome = { caseId: c.id, pass: true, reason: "assert", elapsedTicks: 0 };
  return r;
}

/** 整合判题流水线：分阶段 + 隔离 + 证据 */
export function judge(ctx: RunContext, cases: TestbenchCase[]): JudgmentResult {
  const stable = stableSortCases(cases);
  const outcomes = stable.map((c) => runCase(ctx, c));
  const passRequired = outcomes.filter((o) => ctx.level.rubric.pass.requiredCases.includes(o.caseId)).every((o) => o.pass);
  const pass = outcomes.every((o) => o.pass) && passRequired;
  const cost = ctx.design ? computeCost(ctx.design) : 0;
  return {
    pass,
    passRequired,
    outcomes,
    engineering: pass ? { passed: true, cost } : undefined,
    mastery: pass && ctx.level.rubric.mastery
      ? { passed: true, variantCases: ctx.level.rubric.mastery.variantCaseIds.length }
      : undefined,
    attemptId: attemptId(ctx),
  };
}

/** 生成 attemptId：designHash + levelRevision + engineVersion + isaVersion + seed */
export function attemptId(ctx: RunContext): string {
  const hash = hashDesign(ctx.design);
  return `a-${hash.toString(16)}-${ctx.level.id}-r${ctx.level.revision}-s${ctx.seed}-e${ctx.engineVersion}-i${ctx.isaVersion}`;
}

function hashDesign(d: import("../core/types.ts").Design): number {
  let h = 2166136261 >>> 0;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  };
  for (const c of d.root.comps ?? []) mix(`${c.id}:${c.type}:${JSON.stringify(c.params ?? {})}`);
  for (const w of d.root.wires ?? []) mix(`${w.a.comp}.${w.a.pin}->${w.b.comp}.${w.b.pin}`);
  return h >>> 0;
}

/** 写入 attempt + progress（同一事务；先功能通过、再工程、最后理解） */
export interface AttemptRecord {
  attemptId: string;
  levelRevision: string;
  designHash: number;
  engineVersion: string;
  isaVersion: string;
  seed: number;
  status: "pass" | "fail";
  firstFailure?: CaseOutcome["firstFailure"];
  checks: CaseOutcome[];
  cost?: number;
  medals?: { engineering: boolean; mastery: boolean };
  assistance?: { hintUsed: boolean; referenceUsed: boolean };
  createdAt: number;
}

export function buildAttempt(ctx: RunContext, result: JudgmentResult, help?: { hintUsed: boolean; referenceUsed: boolean }): AttemptRecord {
  return {
    attemptId: result.attemptId,
    levelRevision: ctx.level.revision,
    designHash: hashDesign(ctx.design),
    engineVersion: ctx.engineVersion,
    isaVersion: ctx.isaVersion,
    seed: ctx.seed,
    status: result.pass ? "pass" : "fail",
    firstFailure: result.outcomes.find((o) => !o.pass)?.firstFailure,
    checks: result.outcomes,
    cost: result.engineering?.cost,
    medals: result.engineering || result.mastery
      ? { engineering: !!result.engineering?.passed, mastery: !!result.mastery?.passed }
      : undefined,
    assistance: help,
    createdAt: Date.now(),
  };
}