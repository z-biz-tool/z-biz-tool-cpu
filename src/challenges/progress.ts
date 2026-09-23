import type { Level } from "./levels.ts";
import { LEVELS, levelById, parCost } from "./levels.ts";
import type { LevelResult } from "./verify.ts";

/* ------------------------------------------------------------------ *
 * 进度与成就：存 localStorage。
 * 推进条件不在这里 —— 关卡面板按先修图（challenges/prereq.ts）判断缺口，
 * 这里只记「哪一关拿到了通关证据」。
 * ------------------------------------------------------------------ */

export interface LevelRecord {
  pass: boolean;
  /** 通过时的成本（越小越好） */
  cost: number;
  ok: number;
  total: number;
  at?: number;
}

export interface Progress {
  active: string;
  done: Record<string, LevelRecord>;
  badges: string[];
  /** 仿真速度：每秒节拍数 */
  speed: number;
}

export interface Badge {
  id: string;
  name: string;
  desc: string;
}

export const BADGES: Badge[] = [
  { id: "first", name: "点亮第一盏灯", desc: "通过任意一个关卡" },
  { id: "gate", name: "门匠", desc: "通关第一层全部关卡" },
  { id: "combo", name: "组合大师", desc: "通关第二层全部关卡" },
  { id: "seq", name: "时钟之心", desc: "通关第三层全部关卡" },
  { id: "cpu", name: "总设计师", desc: "通关第四层全部关卡" },
  { id: "mem", name: "记忆宫殿", desc: "通关第五层全部关卡" },
  { id: "all", name: "图灵完备", desc: "通关全部关卡" },
  { id: "cheap", name: "节俭主义者", desc: "用不到基准成本一半的花费通过某一关" },
  { id: "wrap", name: "封装艺术", desc: "用子电路通过某一关" },
  { id: "run", name: "它真的在跑", desc: "让自研 CPU 运行出正确输出" },
];

export const BADGE_MAP = new Map(BADGES.map((b) => [b.id, b]));

const KEY = "z-biz-tool-cpu:progress";

export function emptyProgress(): Progress {
  return { active: LEVELS[0].id, done: {}, badges: [], speed: 8 };
}

export function loadProgress(): Progress {
  const base = emptyProgress();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const obj = JSON.parse(raw) as Partial<Progress>;
    const done: Record<string, LevelRecord> = {};
    for (const [k, v] of Object.entries(obj.done ?? {})) {
      if (!levelById(k) || typeof v?.pass !== "boolean") continue;
      done[k] = { pass: v.pass, cost: Number(v.cost) || 0, ok: Number(v.ok) || 0, total: Number(v.total) || 0, at: v.at };
    }
    return {
      active: levelById(String(obj.active)) ? String(obj.active) : base.active,
      done,
      badges: Array.isArray(obj.badges) ? obj.badges.filter((b) => BADGE_MAP.has(String(b))).map(String) : [],
      speed: Math.min(240, Math.max(1, Number(obj.speed) || base.speed)),
    };
  } catch {
    return base;
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function passed(p: Progress, id: string): boolean {
  return !!p.done[id]?.pass;
}

export function nextOpenLevel(p: Progress): string {
  const hit = LEVELS.find((l) => !passed(p, l.id));
  return (hit ?? LEVELS[LEVELS.length - 1]).id;
}

export function tierDone(p: Progress, tier: number): { ok: number; total: number } {
  const list = LEVELS.filter((l) => l.tier === tier);
  return { ok: list.filter((l) => passed(p, l.id)).length, total: list.length };
}

function tierAll(p: Progress, tier: number): boolean {
  return LEVELS.filter((l) => l.tier === tier).every((l) => passed(p, l.id));
}

/** 记录判题结果并计算新获得的徽章 */
export function applyResult(
  p: Progress,
  level: Level,
  result: LevelResult
): { progress: Progress; earned: Badge[] } {
  const prev = p.done[level.id];
  const rec: LevelRecord = result.pass
    ? {
        pass: true,
        cost: prev?.pass ? Math.min(prev.cost || result.cost, result.cost) : result.cost,
        ok: result.total,
        total: result.total,
        at: prev?.at ?? Date.now(),
      }
    : prev?.pass
      ? prev
      : { pass: false, cost: result.cost, ok: result.ok, total: result.total, at: prev?.at };
  const done = { ...p.done, [level.id]: rec };
  const next: Progress = { ...p, done };
  const earned: Badge[] = [];
  const grant = (id: string) => {
    if (next.badges.includes(id)) return;
    next.badges = [...next.badges, id];
    const b = BADGE_MAP.get(id);
    if (b) earned.push(b);
  };
  const par = parCost(level);
  if (result.pass) {
    grant("first");
    if (par && result.cost * 2 <= par) grant("cheap");
    if (result.defs > 0) grant("wrap");
    if (level.id === "t4-machine") grant("run");
    if (tierAll(next, 1)) grant("gate");
    if (tierAll(next, 2)) grant("combo");
    if (tierAll(next, 3)) grant("seq");
    if (tierAll(next, 4)) grant("cpu");
    if (tierAll(next, 5)) grant("mem");
    if (LEVELS.every((l) => passed(next, l.id))) grant("all");
  }
  return { progress: next, earned };
}

export function scoreOf(p: Progress): { levels: number; badges: number; costSum: number } {
  let costSum = 0;
  let levels = 0;
  for (const l of LEVELS) {
    const r = p.done[l.id];
    if (r?.pass) {
      levels++;
      costSum += r.cost;
    }
  }
  return { levels, badges: p.badges.length, costSum };
}
