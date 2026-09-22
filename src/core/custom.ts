import { baseDef, resolveDef } from "./registry.ts";
import type { CompDef, Circuit, CompInstance, CustomDef, Design, PinRef, PinSpec } from "./types.ts";

/* ------------------------------------------------------------------ *
 * 自定义子电路：把 def 的 INPUT/OUTPUT 元件映射成对外引脚
 * ------------------------------------------------------------------ */

export interface BoundaryPin {
  name: string;
  label: string;
  bits: number;
  /** def 内部承载该引脚的 io 元件 id */
  ioComp: string;
  /** io 元件上的引脚 id（input 元件用 out，output 元件用 in） */
  ioPin: string;
  kind: "in" | "out";
}

export interface Boundary {
  ins: BoundaryPin[];
  outs: BoundaryPin[];
}

const cache = new WeakMap<Design, Map<string, Boundary>>();

export function boundaryOf(design: Design, defId: string): Boundary | undefined {
  let m = cache.get(design);
  if (!m) {
    m = new Map();
    cache.set(design, m);
  }
  const hit = m.get(defId);
  if (hit) return hit;
  const def = design.defs.find((d) => d.id === defId);
  if (!def) return undefined;
  const b: Boundary = { ins: [], outs: [] };
  const sorted = def.circuit.comps
    .filter((c) => c.type === "input" || c.type === "output")
    .sort((a, c) => a.y - c.y || a.x - c.x);
  const inCount: Record<string, number> = {};
  const outCount: Record<string, number> = {};
  for (const c of sorted) {
    const bits = Number(c.params.bitWidth) || 1;
    const label = c.name || (c.type === "input" ? "IN" : "OUT");
    if (c.type === "input") {
      const n = (inCount[label] = (inCount[label] ?? 0) + 1);
      b.ins.push({
        name: c.id,
        label: n > 1 ? `${label}·${n}` : label,
        bits,
        ioComp: c.id,
        ioPin: "out",
        kind: "in",
      });
    } else {
      const n = (outCount[label] = (outCount[label] ?? 0) + 1);
      b.outs.push({
        name: c.id,
        label: n > 1 ? `${label}·${n}` : label,
        bits,
        ioComp: c.id,
        ioPin: "in",
        kind: "out",
      });
    }
  }
  m.set(defId, b);
  return b;
}

export function customDefOf(design: Design, defId: string): CompDef | undefined {
  const def = design.defs.find((d) => d.id === defId);
  const b = boundaryOf(design, defId);
  if (!def || !b) return undefined;
  const nIn = Math.max(1, b.ins.length);
  const nOut = Math.max(1, b.outs.length);
  const h = Math.max(2, nIn, nOut);
  const w = 4;
  const pins: PinSpec[] = [];
  b.ins.forEach((p, i) => {
    pins.push({
      id: p.name,
      label: p.label,
      x: 0,
      y: ((i + 0.5) * h) / nIn,
      dir: "l",
      kind: "in",
      width: p.bits,
    });
  });
  b.outs.forEach((p, i) => {
    pins.push({
      id: p.name,
      label: p.label,
      x: w,
      y: ((i + 0.5) * h) / nOut,
      dir: "r",
      kind: "out",
      width: p.bits,
    });
  });
  return {
    type: "custom:" + defId,
    label: def.name,
    category: "util",
    size: { w, h },
    pins,
    cost: customCost(design, defId),
    widthMode: "one",
    glyph: "box",
    symbol: def.name.slice(0, 6),
    description: "自定义子电路 " + def.name,
  };
}

export function customCost(design: Design, defId: string): number {
  const def = design.defs.find((d) => d.id === defId);
  if (!def) return 1;
  return 1 + totalCost(design, def.circuit);
}

export function totalCost(design: Design, circuit: Circuit): number {
  let sum = 0;
  for (const c of circuit.comps) {
    const d = defOf(design, c.type, c.params);
    if (!d || d.free) continue;
    if (c.type === "input" || c.type === "output") continue;
    sum += d.cost;
  }
  return sum;
}

/** 内置 + 自定义统一解析 */
export function defOf(design: Design, type: string, params: Record<string, number | string | boolean>): CompDef | undefined {
  if (type.startsWith("custom:")) return customDefOf(design, type.slice(7));
  return resolveDef(type, params) ?? baseDef(type);
}

/** 列出可作为元件库条目的自定义电路 */
export function customTypes(design: Design): string[] {
  return design.defs.map((d) => "custom:" + d.id);
}

/**
 * 校验导线端点能否落到真实引脚，返回问题描述（没问题返回 null）。
 * 未知元件类型不判定（FIX-05 已单独给警告），只拦确实对不上号的引用，
 * 因为悬空引脚会让打包子电路等下游流程直接抛错。
 */
export function pinProblem(design: Design, circuit: Circuit, ref: PinRef): string | null {
  const inst = circuit.comps.find((c) => c.id === ref.comp);
  if (!inst) return `元件 ${ref.comp} 不存在`;
  return pinProblemOf(design, inst, ref);
}

/** 已知元件实例时的快路径，供导入的引用校验批量扫描 */
export function pinProblemOf(design: Design, inst: CompInstance, ref: PinRef): string | null {
  const def = defOf(design, inst.type, inst.params ?? {});
  if (!def) return null;
  return def.pins.some((p) => p.id === ref.pin) ? null : `${inst.type} 没有引脚 ${ref.pin}`;
}

export function findDef(design: Design, defId: string): CustomDef | undefined {
  return design.defs.find((d) => d.id === defId);
}
