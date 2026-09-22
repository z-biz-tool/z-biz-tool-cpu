import { defOf } from "../core/custom.ts";
import { localToWorld, rotateDir } from "../core/geometry.ts";
import type { Circuit, CompInstance, Design, Dir, PinRef, Point } from "../core/types.ts";
import { GRID } from "../core/types.ts";
import type { Camera } from "./store.ts";

/* ------------------------------------------------------------------ *
 * IMP-14: 画布空间索引 + 命中测试
 *
 * 设计要点：
 *  - 大图按网格桶索引（每 16×16 网格单位一格），查找候选元件 O(1)
 *  - 元件按包围盒做精确测试，避免误命中相邻元件
 *  - 引脚按统一象限，旋转后落到一根线段内测试
 *  - 返回最近的命中（pin → wire → comp 三级优先级）
 * ------------------------------------------------------------------ */

export interface HitIndex {
  buckets: Map<string, string[]>;
  comps: CompInstance[];
}

const BUCKET = 16;

export function buildHitIndex(c: Circuit): HitIndex {
  const buckets = new Map<string, string[]>();
  const dummy: Design = { root: c, defs: [], name: "" };
  for (const comp of c.comps) {
    const def = defOf(dummy, comp.type, comp.params);
    if (!def) continue;
    const tl = localToWorld(comp, def.size, 0, 0);
    const br = localToWorld(comp, def.size, def.size.w, def.size.h);
    const minX = Math.min(tl.x, br.x);
    const maxX = Math.max(tl.x, br.x);
    const minY = Math.min(tl.y, br.y);
    const maxY = Math.max(tl.y, br.y);
    for (let x = Math.floor(minX / BUCKET); x <= Math.floor(maxX / BUCKET); x++) {
      for (let y = Math.floor(minY / BUCKET); y <= Math.floor(maxY / BUCKET); y++) {
        const k = x + "," + y;
        let arr = buckets.get(k);
        if (!arr) {
          arr = [];
          buckets.set(k, arr);
        }
        arr.push(comp.id);
      }
    }
  }
  return { buckets, comps: c.comps.slice() };
}

export interface HitResult {
  type: "comp" | "pin" | "wire";
  comp?: CompInstance;
  pin?: PinRef;
  wire?: { id: string };
  dist: number;
}

const PIN_HIT_RADIUS = 0.4;
const WIRE_HIT_RADIUS = 0.4;

function dirVec(d: Dir): { dx: number; dy: number } {
  switch (d) {
    case "l": return { dx: -1, dy: 0 };
    case "r": return { dx: 1, dy: 0 };
    case "u": return { dx: 0, dy: -1 };
    case "d": return { dx: 0, dy: 1 };
  }
}

/** 在给定世界坐标点下返回最近命中 */
export function hitTest(idx: HitIndex, c: Circuit, design: Design, p: Point): HitResult | undefined {
  const candidates = new Set<string>();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const k = Math.floor(p.x / BUCKET) + dx + "," + (Math.floor(p.y / BUCKET) + dy);
      const arr = idx.buckets.get(k);
      if (arr) for (const id of arr) candidates.add(id);
    }
  }
  // 1) 引脚
  let best: HitResult | undefined;
  for (const id of candidates) {
    const comp = c.comps.find((x) => x.id === id);
    if (!comp) continue;
    const def = defOf(design, comp.type, comp.params);
    if (!def) continue;
    for (const ps of def.pins) {
      const at = localToWorld(comp, def.size, ps.x, ps.y);
      const v = dirVec(rotateDir(ps.dir, comp.rot, comp.flip));
      const tip = { x: at.x + v.dx * 1.2, y: at.y + v.dy * 1.2 };
      const d = pointToSegment(p, at, tip);
      if (d < PIN_HIT_RADIUS && (!best || d < best.dist)) {
        best = { type: "pin", comp, pin: { comp: comp.id, pin: ps.id }, dist: d };
      }
    }
  }
  if (best) return best;
  // 2) 元件体（包围盒）
  for (const id of candidates) {
    const comp = c.comps.find((x) => x.id === id);
    if (!comp) continue;
    const def = defOf(design, comp.type, comp.params);
    if (!def) continue;
    const tl = localToWorld(comp, def.size, 0, 0);
    const br = localToWorld(comp, def.size, def.size.w, def.size.h);
    const minX = Math.min(tl.x, br.x);
    const maxX = Math.max(tl.x, br.x);
    const minY = Math.min(tl.y, br.y);
    const maxY = Math.max(tl.y, br.y);
    if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (!best || d < best.dist) best = { type: "comp", comp, dist: d };
    }
  }
  if (best) return best;
  // 3) 连线
  for (const w of c.wires) {
    const ac = c.comps.find((x) => x.id === w.a.comp);
    const bc = c.comps.find((x) => x.id === w.b.comp);
    if (!ac || !bc) continue;
    const adef = defOf(design, ac.type, ac.params);
    const bdef = defOf(design, bc.type, bc.params);
    if (!adef || !bdef) continue;
    const ap = adef.pins.find((x) => x.id === w.a.pin);
    const bp = bdef.pins.find((x) => x.id === w.b.pin);
    if (!ap || !bp) continue;
    const aAt = localToWorld(ac, adef.size, ap.x, ap.y);
    const bAt = localToWorld(bc, bdef.size, bp.x, bp.y);
    const d = pointToSegment(p, aAt, bAt);
    if (d < WIRE_HIT_RADIUS && (!best || d < best.dist)) {
      best = { type: "wire", wire: { id: w.id }, dist: d };
    }
  }
  return best;
}

function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** 把屏幕坐标转换为 grid 坐标（与 camera 配合） */
export function screenToGrid(sx: number, sy: number, camera: Camera): Point {
  const s = GRID * camera.zoom;
  return { x: sx / s + camera.x, y: sy / s + camera.y };
}