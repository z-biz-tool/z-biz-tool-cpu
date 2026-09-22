import type { JudgmentResult, RunContext } from "./judging.ts";

/* ------------------------------------------------------------------ *
 * doc 03 §9 三类勋章
 *
 * 通关：固定接口、递归元件约束、功能用例全部通过，无阻断诊断；Boss 含新变式
 * 工程：先通关，再达本关公开成本/结构规则
 * 理解：先有相关功能证据，再通过未展示答案的新预测/迁移任务
 *
 * 自由文本解释只保存展示，不做自动语义评分
 * 帮助不扣通关或工程资格；尝试记录自主/辅助/参考后完成
 * ------------------------------------------------------------------ */

export interface MedalAward {
  pass: boolean;
  engineering: boolean;
  mastery: boolean;
  details: {
    pass: { casesPassed: number; totalCases: number; requiredAllPassed: boolean };
    engineering?: { cost: number; rule?: string };
    mastery?: { variantCases: number };
  };
}

export function awardMedals(ctx: RunContext, result: JudgmentResult): MedalAward {
  const casesPassed = result.outcomes.filter((o) => o.pass).length;
  const totalCases = result.outcomes.length;
  const requiredAllPassed = result.passRequired;

  const pass = casesPassed === totalCases && requiredAllPassed;
  let engineering = false;
  let mastery = false;
  const details: MedalAward["details"] = { pass: { casesPassed, totalCases, requiredAllPassed } };

  if (pass && ctx.level.rubric.engineering) {
    const r = ctx.level.rubric.engineering;
    const cost = result.engineering?.cost ?? Infinity;
    engineering = !r.maxCost || cost <= r.maxCost;
    if (engineering) details.engineering = { cost, rule: r.structuralRule };
  }

  if (pass && ctx.level.rubric.mastery) {
    // 真实检查需调用 verify.ts；这里只暴露结构
    mastery = !!result.mastery?.passed;
    if (mastery) details.mastery = { variantCases: ctx.level.rubric.mastery.variantCaseIds.length };
  }

  return { pass, engineering, mastery, details };
}

/** 理解勋章需要独立迁移/预测证据；不使用自由文本自动评分 */
export interface MasteryEvidence {
  caseId: string;
  /** 学生预测值 */
  predicted: number | string;
  /** 实际值 */
  actual: number | string;
  /** 评估时间 */
  evaluatedAt: number;
}

export function masteryPass(evidence: MasteryEvidence[]): boolean {
  if (!evidence.length) return false;
  return evidence.every((e) => String(e.predicted).trim() === String(e.actual).trim());
}