import type { Circuit, Design } from "../core/types.ts";
import { defOf } from "../core/custom.ts";
import { buildHitIndex, hitTest } from "./hitIndex.ts";

/* ------------------------------------------------------------------ *
 * IMP-14: 无障碍替代品 — Canvas 配套的 a11y 模型
 *
 * 设计要点：
 *  - 元件列表 (非画布替代)：按 id 顺序列出全部元件及其引脚状态
 *  - 连线表：按 id 列起点/终点，便于读屏
 *  - 键盘选择：方向键在元件间移动焦点
 *  - 当前焦点元件的引脚数值播报（不打断读屏）
 * ------------------------------------------------------------------ */

export interface CompSummary {
  id: string;
  name?: string;
  type: string;
  pins: { id: string; dir: "in" | "out"; width: number }[];
}

export interface WireSummary {
  id: string;
  from: string;
  to: string;
}

export interface A11yModel {
  comps: CompSummary[];
  wires: WireSummary[];
}

export function buildA11y(c: Circuit, design: Design): A11yModel {
  const comps: CompSummary[] = [];
  for (const inst of c.comps) {
    const def = defOf(design, inst.type, inst.params);
    comps.push({
      id: inst.id,
      name: inst.name,
      type: inst.type,
      pins: def ? def.pins.map((p) => ({ id: p.id, dir: p.kind, width: p.width === "auto" ? 1 : Number(p.width) })) : [],
    });
  }
  const wires: WireSummary[] = c.wires.map((w) => ({ id: w.id, from: `${w.a.comp}.${w.a.pin}`, to: `${w.b.comp}.${w.b.pin}` }));
  return { comps, wires };
}

/** 在 a11y 模型里查找下一个/上一个元件 id，用于键盘导航 */
export function neighbour(model: A11yModel, current: string | null, dir: "next" | "prev"): string | null {
  if (!model.comps.length) return null;
  if (!current) return model.comps[0].id;
  const i = model.comps.findIndex((c) => c.id === current);
  if (i < 0) return model.comps[0].id;
  const j = dir === "next" ? Math.min(model.comps.length - 1, i + 1) : Math.max(0, i - 1);
  return model.comps[j].id;
}

/** 命中测试 + a11y 模型：返回焦点元件的引脚状态文本 */
export function describeFocus(model: A11yModel, hit: ReturnType<typeof hitTest>): string {
  if (!hit) return "当前画布没有命中元件";
  if (hit.type === "comp" && hit.comp) {
    const meta = model.comps.find((c) => c.id === hit.comp!.id);
    if (!meta) return hit.comp.id;
    return `${meta.name ?? meta.id} 类型 ${meta.type} 引脚 ${meta.pins.length} 个`;
  }
  if (hit.type === "pin" && hit.pin) {
    const meta = model.comps.find((c) => c.id === hit.pin!.comp);
    const ps = meta?.pins.find((p) => p.id === hit.pin!.pin);
    return `${meta?.name ?? hit.pin.comp} 引脚 ${ps?.id ?? hit.pin.pin} 方向 ${ps?.dir ?? "?"} 位宽 ${ps?.width ?? "?"}`;
  }
  if (hit.type === "wire" && hit.wire) {
    const w = model.wires.find((x) => x.id === hit.wire!.id);
    return `连线 ${w?.from ?? hit.wire.id} → ${w?.to ?? "?"}`;
  }
  return "";
}

/** 把键盘焦点与画布命中连接：每帧基于 hitIndex 把焦点元件推到 a11y 状态 */
export function updateFocus(model: A11yModel, idx: ReturnType<typeof buildHitIndex>, c: Circuit, design: Design, world: { x: number; y: number }) {
  const hit = hitTest(idx, c, design, world);
  return describeFocus(model, hit);
}