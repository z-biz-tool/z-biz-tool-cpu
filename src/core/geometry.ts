import type { Circuit, CompInstance, Dir, PinRef, Point, Rot, Wire } from "./types.ts";

/** 元件体在指定旋转下的包围盒尺寸 */
export function bbox(w: number, h: number, rot: Rot): { w: number; h: number } {
  return rot % 2 === 1 ? { w: h, h: w } : { w, h };
}

/** 本地坐标（未翻转未旋转）→ 世界坐标 */
export function localToWorld(
  comp: CompInstance,
  body: { w: number; h: number },
  px: number,
  py: number
): Point {
  let x = px;
  let y = py;
  if (comp.flip) y = body.h - y;
  const rot = comp.rot;
  let ox = x;
  let oy = y;
  if (rot === 1) {
    ox = body.h - y;
    oy = x;
  } else if (rot === 2) {
    ox = body.w - x;
    oy = body.h - y;
  } else if (rot === 3) {
    ox = y;
    oy = body.w - x;
  }
  return { x: comp.x + ox, y: comp.y + oy };
}

export function rotateDir(dir: Dir, rot: Rot, flip?: boolean): Dir {
  const order: Dir[] = ["r", "d", "l", "u"];
  let i = order.indexOf(dir);
  if (flip) {
    // 水平镜像：上下翻转
    if (dir === "u") i = order.indexOf("d");
    else if (dir === "d") i = order.indexOf("u");
    else i = order.indexOf(dir);
  }
  i = (i + rot) % 4;
  return order[i];
}

/** 元件在世界坐标下的包围盒（网格单位） */
export function compBounds(
  comp: CompInstance,
  body: { w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  const size = bbox(body.w, body.h, comp.rot);
  return { x: comp.x, y: comp.y, w: size.w, h: size.h };
}

export function pinWorld(
  comp: CompInstance,
  body: { w: number; h: number },
  pin: { x: number; y: number }
): Point {
  return localToWorld(comp, body, pin.x, pin.y);
}

/** 正交折线：从 a 出发（朝 dirA），到 b（从 dirB 方向进入），可选途经点 */
export function route(a: Point, dirA: Dir, b: Point, dirB: Dir, via?: Point[]): Point[] {
  const stub = 0.6;
  const sa = extend(a, dirA, stub);
  const sb = extend(b, dirB, stub);
  const mid: Point[] = [];
  const pts: Point[] = [a, sa];
  if (via && via.length) {
    for (const v of via) {
      mid.push({ x: v.x, y: pts[pts.length - 1].y });
      mid.push({ x: v.x, y: v.y });
    }
    pts.push(...mid);
  }
  pts.push(...bridge(pts[pts.length - 1], sa, dirA, dirB));
  pts.push(sb, b);
  return dedupe(pts);
}

/** 生成两点之间的正交连接（最多两个拐点） */
function bridge(from: Point, to: Point, dirA: Dir, dirB: Dir): Point[] {
  if (Math.abs(from.x - to.x) < 1e-6 || Math.abs(from.y - to.y) < 1e-6) return [to];
  const aHorizontal = dirA === "l" || dirA === "r";
  const bHorizontal = dirB === "l" || dirB === "r";
  if (aHorizontal && bHorizontal) {
    const mx = (from.x + to.x) / 2;
    return [{ x: mx, y: from.y }, { x: mx, y: to.y }, to];
  }
  if (!aHorizontal && !bHorizontal) {
    const my = (from.y + to.y) / 2;
    return [{ x: from.x, y: my }, { x: to.x, y: my }, to];
  }
  if (aHorizontal) return [{ x: to.x, y: from.y }, to];
  return [{ x: from.x, y: to.y }, to];
}

function extend(p: Point, dir: Dir, d: number): Point {
  switch (dir) {
    case "l":
      return { x: p.x - d, y: p.y };
    case "r":
      return { x: p.x + d, y: p.y };
    case "u":
      return { x: p.x, y: p.y - d };
    case "d":
      return { x: p.x, y: p.y + d };
  }
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    // 去掉共线中间点
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const collinear =
        (Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - p.x) < 1e-6) ||
        (Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.y - p.y) < 1e-6);
      if (collinear) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** 点到折线的距离（网格单位） */
export function distToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  return best;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 元件（含包围盒）是否与矩形相交 */
export function compInRect(
  comp: CompInstance,
  body: { w: number; h: number },
  rect: { x: number; y: number; w: number; h: number }
): boolean {
  const b = compBounds(comp, body);
  return !(b.x + b.w < rect.x || b.x > rect.x + rect.w || b.y + b.h < rect.y || b.y > rect.y + rect.h);
}

export function findWire(circuit: Circuit, id: string): Wire | undefined {
  return circuit.wires.find((w) => w.id === id);
}

export function pinKey(ref: PinRef): string {
  return ref.comp + "." + ref.pin;
}

/** 统计某引脚上已连接的导线数（用于引脚占用提示） */
export function pinFanout(circuit: Circuit, ref: PinRef): number {
  return circuit.wires.filter(
    (w) => (w.a.comp === ref.comp && w.a.pin === ref.pin) || (w.b.comp === ref.comp && w.b.pin === ref.pin)
  ).length;
}

export function snap(v: number): number {
  return Math.round(v);
}
