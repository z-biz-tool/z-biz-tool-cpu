import type { Progress } from "./progress.ts";
import type { LevelRecord } from "./progress.ts";
import { levelById } from "./levels.ts";

/* ------------------------------------------------------------------ *
 * 渐进式元件解锁
 *
 * 每通关一关，对应一组元件就解锁。新手第一次进编辑器只能看到最基本的
 * 门 + I/O + clock；通过 t1-gates 系列带出所有逻辑门，通过 t2-addsub
 * 带出 add/sub，依次把世界撑开。视觉上类似"打怪升级"。
 *
 * 已有的白名单（available）继续约束关卡内可用元件；本表约束 palette
 * 是否显示。两层不重叠：白名单是关卡契约，本表是学习节奏
 * ------------------------------------------------------------------ */

/** 永远解锁：I/O、时钟、注释、终端打印 —— 不算"打怪升级" */
export const ALWAYS_UNLOCKED = new Set([
  "input",
  "output",
  "clock",
  "const",
  "note",
  "print",
]);

/** 每关解锁的元件集合（关卡 id → 元件 type 列表） */
export const UNLOCKS: Record<string, string[]> = {
  /* CPU 书 */
  t1gates: ["nand", "not", "and", "or", "xor", "xnor"], // 统一所有第一层门解锁到第一关
  "t1-gates": ["nand", "not", "and", "or", "xor", "xnor"],
  "t1-mux2": ["mux", "demux"],
  "t2-addsub": ["add", "sub"],
  "t2-cmp4": ["cmp"],
  "t2-shift4": ["shift"],
  "t2-alu4": ["alu"],
  "t3-reg4": ["reg"],
  "t3-count": ["counter"],
  "t3-edge": ["dff"],
  "t3-ram": ["ram"],
  "t4-progmem": ["rom"],
  "t5-micro": ["tff"],
  /* 存储书 */
  "m2-1-leakycap": ["CAPCELL"],
  "m2-2-destructive": ["SENSEAMP"],
  "m2-3-refresh": ["REFCTRL"],
  "m3-1-slowprog": ["FGCELL"],
  "m5-1-seek": ["PLATTER"],
  /* 优化书 — 元件全部已在 CPU 书解锁过；这一行只放占位以便后续续作时定位 */
  "f1-1-onetick": [],
  "f2-4-btb": [],
};

/** 给定进度，返回已解锁的元件 type 集合 */
export function unlockedTypes(progress: Progress): Set<string> {
  return unlockedTypesFromDone(progress.done);
}

/** 仅依赖 done 记录 —— 用于 zustand 选择器避免每次返回新 Set */
export function unlockedTypesFromDone(done: Record<string, LevelRecord>): Set<string> {
  const out = new Set<string>(ALWAYS_UNLOCKED);
  for (const [lid, defs] of Object.entries(UNLOCKS)) {
    if (!levelById(lid)) continue;
    if (done[lid]?.pass) for (const t of defs) out.add(t);
  }
  return out;
}

/** 给定一个 type，返回最近解锁它的关卡（用于提示"通过 X 解锁"） */
export function unlockSource(type: string): string | undefined {
  for (const [lid, defs] of Object.entries(UNLOCKS)) {
    if (defs.includes(type)) return lid;
  }
  return undefined;
}