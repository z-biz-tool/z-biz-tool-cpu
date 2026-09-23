import type { Design } from "./types.ts";
import { cloneDesign, parse, STORAGE_PREFIX } from "./serialize.ts";

/* ------------------------------------------------------------------ *
 * 项目历史（恢复点）
 *
 * doc 02 §6.1：「新建／切关／查看参考」这类整盘替换 **不靠跨项目撤销保命**，
 * 而是先立一个恢复点，之后从项目历史回去。换设计时清空撤销栈是刻意的 ——
 * 把上一个项目的快照混进本项目的撤销历史，只会让人一撤销翻出半份别人的电路。
 *
 * 恢复点写 localStorage，但配额是整个源共享的：条数和总字节都设上限，
 * 超了先丢最旧的。写不进去（配额满 / 隐私模式）时退化成「本次会话内可回」，
 * 由界面如实说明，不能假装已经保住。
 * ------------------------------------------------------------------ */

export const RECOVERY_STORE_KEY = STORAGE_PREFIX + "recovery-v1";
/** 最多留几份 */
export const MAX_POINTS = 10;
/** 所有恢复点合计的原文上限。这里数的是 UTF-16 长度，而浏览器配额按 UTF-8
 *  字节算（中文 3 字节 / 字符），所以预算本身要留余量：约 1.5 MiB，给同一份
 *  草稿的自动存档和冲突副本留出空间。 */
export const MAX_BYTES = 1.5 * 1024 * 1024;

export interface RecoveryPoint {
  id: string;
  /** 离开时那份设计的名字，列表里靠它认 */
  name: string;
  /** 离开它是因为哪个动作，例如「新建空白设计」 */
  reason: string;
  at: number;
  /** 当时在哪一关；沙盒为 null。回来时要连关卡一起回，否则判题对不上 */
  levelId: string | null;
  comps: number;
  wires: number;
  /** 原文长度，压栈时算一次，之后裁剪预算不必反复序列化 */
  bytes: number;
  design: Design;
}

/** 画布上（含每个子电路内部）有没有值得保住的东西 */
export function designHasWork(design: Design): boolean {
  if (!design?.root) return false;
  if (design.root.comps.length || design.root.wires.length) return true;
  return design.defs.some((d) => d.circuit.comps.length > 0 || d.circuit.wires.length > 0);
}

function countComps(design: Design) {
  return design.root.comps.length + design.defs.reduce((n, d) => n + d.circuit.comps.length, 0);
}

function countWires(design: Design) {
  return design.root.wires.length + design.defs.reduce((n, d) => n + d.circuit.wires.length, 0);
}

/**
 * 两份设计是否同一份。**不能用 serialize() 比**：它写进 savedAt 时间戳，
 * 同一份设计两次序列化必然不同，「重复不留底」和「没动过的关卡骨架不留底」都会失效。
 */
export function sameDesign(a: Design, b: Design): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 压一个新恢复点。三种情况直接原样返回（调用方据此跳过写入）：
 *  - 当前是空设计：没什么可留，留了只会挤掉有用的
 *  - 与栈顶是同一份：来回切同一批关卡不该堆出十条一样的
 * 超预算的旧点在这里被淘汰 —— 先保证新的那份进得去。
 */
export function pushPoint(
  points: RecoveryPoint[],
  design: Design,
  reason: string,
  levelId: string | null = null
): RecoveryPoint[] {
  if (!designHasWork(design)) return points;
  const text = JSON.stringify(design);
  const head = points[0];
  if (head && JSON.stringify(head.design) === text) return points;
  const point: RecoveryPoint = {
    id: "rp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
    name: design.name || "未命名设计",
    reason,
    at: Date.now(),
    levelId,
    comps: countComps(design),
    wires: countWires(design),
    bytes: text.length,
    design: cloneDesign(design),
  };
  let bytes = 0;
  const kept: RecoveryPoint[] = [];
  for (const p of [point, ...points]) {
    if (kept.length >= MAX_POINTS) break;
    /* 至少留最新那一份，哪怕它本身就超预算：只留一条总比把用户的电路丢掉强 */
    if (kept.length && bytes + p.bytes > MAX_BYTES) break;
    bytes += p.bytes;
    kept.push(p);
  }
  return kept;
}

/** 载入历史：坏点丢掉，其余照原样信任（设计本身过一遍导入校验） */
export function loadPoints(): RecoveryPoint[] {
  let raw: string | null = null;
  try {
    raw = typeof window !== "undefined" ? window.localStorage.getItem(RECOVERY_STORE_KEY) : null;
  } catch {
    return [];
  }
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: RecoveryPoint[] = [];
  for (const item of list) {
    const p = item as Partial<RecoveryPoint>;
    if (!p || typeof p.id !== "string" || typeof p.reason !== "string" || !p.design) continue;
    /* 恢复点当作一次导入来对待：结构、引用、预算都过，修不上的就整条丢掉 */
    const parsed = parse(JSON.stringify(p.design));
    if (!parsed.design || parsed.errors.length) continue;
    out.push({
      id: p.id,
      name: parsed.design.name || p.name || "未命名设计",
      reason: p.reason,
      at: Number(p.at) || 0,
      levelId: typeof p.levelId === "string" ? p.levelId : null,
      comps: countComps(parsed.design),
      wires: countWires(parsed.design),
      bytes: JSON.stringify(p.design).length,
      design: parsed.design,
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_POINTS);
}

/** 写回本地；false 表示没落盘（配额满或存储被禁用），界面要改口 */
export function savePoints(points: RecoveryPoint[]): boolean {
  try {
    window.localStorage.setItem(RECOVERY_STORE_KEY, JSON.stringify(points));
    return true;
  } catch {
    return false;
  }
}

export function clearPoints() {
  try {
    window.localStorage.removeItem(RECOVERY_STORE_KEY);
  } catch {
    /* 没有本地存储就没什么可清 */
  }
}
