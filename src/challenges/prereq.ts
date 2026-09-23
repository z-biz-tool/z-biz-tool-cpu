import { META_BY_ID, PROLOGUE_META } from "../courses/publishMetadata.ts";
import { LEVELS, levelById } from "./levels.ts";
import type { Progress } from "./progress.ts";
import { passed } from "./progress.ts";

/* ------------------------------------------------------------------ *
 * 先修图上的推进（doc 03 §8 EDU-02）
 *
 * 关卡数据在 courses/publishMetadata.ts 里已经逐关声明了直接先修（prerequisites），
 * 但编辑器过去只看 LEVELS 数组的前一项来解锁 —— 图是发布期的装饰，玩的时候用不上。
 * 这里把那本账接到进度上：
 *  - 判断还缺哪些直接先修（缺的是「通关证据」，理解勋章不是门槛）
 *  - 并列给出最短补充路径（缺口自己的缺口排在前面）
 *  - 发布门禁那套「无环 + 无悬空引用」运行时也再走一遍，别等构建脚本报
 * ------------------------------------------------------------------ */

/** 序章微实验教的概念：进度里没有对应的可通关关卡，不能拿它卡住第一关 */
const CONCEPT_ONLY = new Set(PROLOGUE_META.map((m) => m.objectives[0]?.knowledgeId ?? ""));

export function directPrereqs(levelId: string): string[] {
  return META_BY_ID[levelId]?.prerequisites ?? [];
}

/** 一条先修是否已有通关证据；序章概念按「教过了就算」处理，其余一律要证据 */
export function prereqSatisfied(p: Progress, pre: string): boolean {
  if (levelById(pre)) return passed(p, pre);
  return CONCEPT_ONLY.has(pre);
}

/** 这一关还缺的直接先修（保持声明顺序，便于和课文对上） */
export function missingPrereqs(p: Progress, levelId: string): string[] {
  return directPrereqs(levelId).filter((pre) => !prereqSatisfied(p, pre));
}

/**
 * 补先修的最短路径：把缺的那些关列出来，缺口的缺口排在前面。
 * 只走还没通关的分支，已经会了的不重复要求；环由 visited 兜住（数据层的环另有 issues 报）。
 */
export function catchupLevels(p: Progress, levelId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([levelId]);
  const visit = (id: string) => {
    for (const pre of missingPrereqs(p, id)) {
      if (seen.has(pre)) continue;
      seen.add(pre);
      visit(pre);
      if (levelById(pre)) out.push(pre);
    }
  };
  visit(levelId);
  return out;
}

/** 先修图自检：悬空引用与环。空数组代表这张图可以安全当作推进依据 */
export function prereqGraphIssues(): string[] {
  const issues: string[] = [];
  for (const l of LEVELS) {
    for (const pre of directPrereqs(l.id)) {
      if (!levelById(pre) && !CONCEPT_ONLY.has(pre)) {
        issues.push(`${l.id} 的先修 ${pre} 既不是关卡也不是序章概念`);
      }
      if (pre === l.id) issues.push(`${l.id} 把自己列为先修`);
    }
  }
  /* DFS 找环：只有指向真实关卡的先修才进图，序章概念是叶子 */
  const state = new Map<string, 0 | 1 | 2>();
  const walk = (id: string, path: string[]) => {
    state.set(id, 1);
    for (const pre of directPrereqs(id)) {
      if (!levelById(pre)) continue;
      const s = state.get(pre) ?? 0;
      if (s === 1) {
        issues.push(`先修成环：${[...path, id, pre].join(" → ")}`);
        state.set(id, 2);
        return;
      }
      if (s === 0) walk(pre, [...path, id]);
    }
    state.set(id, 2);
  };
  for (const l of LEVELS) if ((state.get(l.id) ?? 0) === 0) walk(l.id, []);
  return [...new Set(issues)];
}
