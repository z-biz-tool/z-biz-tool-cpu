import { defOf } from "../core/custom.ts";
import { bbox, distToPolyline, localToWorld, rotateDir, route } from "../core/geometry.ts";
import type { Simulator } from "../core/sim.ts";
import type { Circuit, CompDef, CompInstance, Design, Dir, PinRef, PinSpec, Point, Rot, Wire } from "../core/types.ts";
import { GRID, hex } from "../core/types.ts";
import type { Camera, Hover, Selection, Tool } from "./store.ts";

/* ------------------------------------------------------------------ *
 * Canvas 渲染：把电路画成一屏可交互的示意图
 * ------------------------------------------------------------------ */

export const THEME = {
  bg: "#0b0d14",
  gridMinor: "rgba(148,163,184,0.06)",
  gridMajor: "rgba(148,163,184,0.13)",
  axis: "rgba(167,139,250,0.35)",
  body: "#151a26",
  bodyEdge: "#3b4458",
  bodySel: "#a78bfa",
  bodyHover: "#6366f1",
  text: "#e5e7eb",
  dim: "#8b93a7",
  pin: "#94a3b8",
  pinOut: "#facc15",
  pinIn: "#38bdf8",
  wireLow: "#4b5566",
  wireHigh: "#22d3ee",
  wireSel: "#a78bfa",
  wireErr: "#f87171",
  accent: "#a78bfa",
};

export interface Scene {
  design: Design;
  circuit: Circuit;
  camera: Camera;
  viewport: { w: number; h: number };
  sim: Simulator;
  selection: Selection;
  hover: Hover;
  pendingWire: PinRef | null;
  cursor: Point | null;
  placing: { type: string; rot: Rot } | null;
  tool: Tool;
}

export interface Xform {
  s: number;
  toScreen(p: Point): Point;
  toGrid(p: Point): Point;
}

export function makeXform(camera: Camera): Xform {
  const s = GRID * camera.zoom;
  return {
    s,
    toScreen: (p) => ({ x: (p.x - camera.x) * s, y: (p.y - camera.y) * s }),
    toGrid: (p) => ({ x: p.x / s + camera.x, y: p.y / s + camera.y }),
  };
}

export interface PinGeom {
  spec: PinSpec;
  at: Point;
  dir: Dir;
}

/** 元件某引脚在世界坐标下的位置与朝向 */
export function pinGeom(comp: CompInstance, def: CompDef, spec: PinSpec): PinGeom {
  const at = localToWorld(comp, def.size, spec.x, spec.y);
  return { spec, at, dir: rotateDir(spec.dir, comp.rot, comp.flip) };
}

export function pinsOf(design: Design, comp: CompInstance): PinGeom[] {
  const def = defOf(design, comp.type, comp.params);
  if (!def) return [];
  return def.pins.map((spec) => pinGeom(comp, def, spec));
}

export function bodyOf(design: Design, comp: CompInstance): CompDef | undefined {
  return defOf(design, comp.type, comp.params);
}

/* ------------------------------ 入口 ------------------------------ */

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { viewport, camera } = scene;
  const xf = makeXform(camera);
  ctx.save();
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, viewport.w, viewport.h);
  drawGrid(ctx, scene, xf);

  const byId = new Map(scene.circuit.comps.map((c) => [c.id, c]));
  const errorComps = new Set<string>();
  for (const e of scene.sim.errors) if (e.level === "error") for (const id of e.comps) errorComps.add(id);

  for (const w of scene.circuit.wires) {
    const a = byId.get(w.a.comp);
    const b = byId.get(w.b.comp);
    if (!a || !b) continue;
    drawWire(ctx, scene, xf, w.id, a, w.a.pin, b, w.b.pin, w.via);
  }
  for (const comp of scene.circuit.comps) {
    const def = defOf(scene.design, comp.type, comp.params);
    if (!def) continue;
    drawComp(ctx, scene, xf, comp, def, errorComps.has(comp.id));
  }
  drawPendingWire(ctx, scene, xf, byId);
  drawPlacingGhost(ctx, scene, xf);
  ctx.restore();
}

/* ------------------------------ 网格 ------------------------------ */

function drawGrid(ctx: CanvasRenderingContext2D, scene: Scene, xf: Xform) {
  const { viewport, camera } = scene;
  const step = xf.s;
  if (step < 6) return;
  const x0 = Math.floor(camera.x);
  const y0 = Math.floor(camera.y);
  const cols = Math.ceil(viewport.w / step) + 2;
  const rows = Math.ceil(viewport.h / step) + 2;
  ctx.lineWidth = 1;
  for (let i = 0; i < cols; i++) {
    const gx = x0 + i;
    const sx = Math.round(xf.toScreen({ x: gx, y: 0 }).x) + 0.5;
    ctx.strokeStyle = gx % 5 === 0 ? THEME.gridMajor : THEME.gridMinor;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, viewport.h);
    ctx.stroke();
  }
  for (let j = 0; j < rows; j++) {
    const gy = y0 + j;
    const sy = Math.round(xf.toScreen({ x: 0, y: gy }).y) + 0.5;
    ctx.strokeStyle = gy % 5 === 0 ? THEME.gridMajor : THEME.gridMinor;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(viewport.w, sy);
    ctx.stroke();
  }
}

/* ------------------------------ 导线 ------------------------------ */

function drawWire(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  xf: Xform,
  id: string,
  a: CompInstance,
  aPin: string,
  b: CompInstance,
  bPin: string,
  via?: Point[]
) {
  const ga = pinRefGeom(scene, a, aPin);
  const gb = pinRefGeom(scene, b, bPin);
  if (!ga || !gb) return;
  const pts = route(ga.at, ga.dir, gb.at, gb.dir, via).map((p) => xf.toScreen(p));
  const val = scene.sim.valueOf({ comp: a.id, pin: aPin }) ?? scene.sim.valueOf({ comp: b.id, pin: bPin });
  const bits = val?.width ?? 1;
  const high = !!val?.value;
  const selected = scene.selection.wires.includes(id);
  const hovered = scene.hover.kind === "wire" && scene.hover.wire === id;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = selected ? THEME.wireSel : hovered ? THEME.accent : high ? THEME.wireHigh : THEME.wireLow;
  ctx.lineWidth = (bits > 1 ? 2.6 : 1.6) + (selected || hovered ? 1.2 : 0);
  ctx.shadowColor = high && bits > 1 ? "rgba(34,211,238,0.5)" : "transparent";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.shadowColor = "transparent";

  if (bits > 1 && xf.s > 11) {
    const mid = pts[Math.floor(pts.length / 2)] ?? pts[0];
    labelBox(ctx, mid.x, mid.y, bits > 4 ? hex(val?.value ?? 0, bits) : String(val?.value ?? 0), THEME.wireHigh);
  }
}

function pinRefGeom(scene: Scene, comp: CompInstance, pin: string): PinGeom | undefined {
  const def = defOf(scene.design, comp.type, comp.params);
  const spec = def?.pins.find((p) => p.id === pin);
  return def && spec ? pinGeom(comp, def, spec) : undefined;
}

function drawPendingWire(ctx: CanvasRenderingContext2D, scene: Scene, xf: Xform, byId: Map<string, CompInstance>) {
  const from = scene.pendingWire;
  if (!from || !scene.cursor) return;
  const comp = byId.get(from.comp);
  const g = comp ? pinRefGeom(scene, comp, from.pin) : undefined;
  if (!g) return;
  const a = xf.toScreen(g.at);
  const b = xf.toScreen(scene.cursor);
  ctx.strokeStyle = THEME.accent;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  const elbow = g.dir === "l" || g.dir === "r" ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  ctx.lineTo(elbow.x, elbow.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/* ------------------------------ 元件 ------------------------------ */

function drawComp(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  xf: Xform,
  comp: CompInstance,
  def: CompDef,
  hasError: boolean
) {
  const size = bbox(def.size.w, def.size.h, comp.rot);
  const tl = xf.toScreen({ x: comp.x, y: comp.y });
  const w = size.w * xf.s;
  const h = size.h * xf.s;
  const selected = scene.selection.comps.includes(comp.id);
  const hovered = scene.hover.kind === "comp" && scene.hover.comp === comp.id;

  const io = def.category === "io";
  const mem = def.category === "mem";
  roundRect(ctx, tl.x, tl.y, w, h, Math.min(8, xf.s * 0.4), THEME.body, hasError ? THEME.wireErr : selected ? THEME.bodySel : hovered ? THEME.bodyHover : THEME.bodyEdge, selected || hovered ? 2 : 1.2);

  if (mem) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(tl.x, tl.y, w, Math.min(h, xf.s * 0.55));
    ctx.clip();
    ctx.fillStyle = "rgba(167,139,250,0.14)";
    ctx.fillRect(tl.x, tl.y, w, h);
    ctx.restore();
  }
  if (io) {
    roundRect(ctx, tl.x + 1.5, tl.y + 1.5, w - 3, h - 3, Math.min(6, xf.s * 0.3), "rgba(167,139,250,0.08)", "rgba(167,139,250,0.35)", 1);
  }

  drawSymbol(ctx, def, comp, scene, tl, w, h, xf.s);

  if (comp.name && xf.s > 9 && def.category !== "io") {
    ctx.fillStyle = THEME.accent;
    ctx.font = `600 ${Math.max(9, Math.min(13, xf.s * 0.62))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(comp.name, tl.x + 2, tl.y - 2);
  }

  for (const g of def.pins.map((spec) => pinGeom(comp, def, spec))) drawPin(ctx, scene, xf, comp, g);
}

function drawSymbol(
  ctx: CanvasRenderingContext2D,
  def: CompDef,
  comp: CompInstance,
  scene: Scene,
  tl: Point,
  w: number,
  h: number,
  s: number
) {
  const cx = tl.x + w / 2;
  const cy = tl.y + h / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (def.type === "input" || def.type === "button") {
    const v = scene.sim.valueOf({ comp: comp.id, pin: "out" });
    ctx.fillStyle = v?.value ? THEME.pinOut : THEME.dim;
    ctx.font = `700 ${Math.max(10, Math.min(20, s * 0.9))}px ui-monospace, monospace`;
    ctx.fillText(v?.value ? "1" : "0", tl.x + w - s * 0.7, cy);
    ctx.textAlign = "left";
    ctx.fillStyle = THEME.text;
    ctx.font = `600 ${Math.max(9, Math.min(13, s * 0.6))}px system-ui, sans-serif`;
    ctx.fillText(def.type === "button" ? "按钮" : (comp.name || "输入"), tl.x + s * 0.35, cy);
    return;
  }
  if (def.type === "output") {
    const v = scene.sim.valueOf({ comp: comp.id, pin: "in" });
    const on = !!v?.value;
    ctx.beginPath();
    ctx.arc(tl.x + w - s * 0.75, cy, Math.max(3, s * 0.35), 0, Math.PI * 2);
    ctx.fillStyle = on ? "#facc15" : "#2a3141";
    ctx.shadowColor = on ? "rgba(250,204,21,0.8)" : "transparent";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.textAlign = "left";
    ctx.fillStyle = THEME.text;
    ctx.font = `600 ${Math.max(9, Math.min(13, s * 0.6))}px system-ui, sans-serif`;
    ctx.fillText(comp.name || "输出", tl.x + s * 0.35, cy);
    return;
  }
  if (def.type === "clock") {
    ctx.strokeStyle = scene.sim.valueOf({ comp: comp.id, pin: "out" })?.value ? THEME.pinOut : THEME.dim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const y0 = cy + h * 0.18;
    const y1 = cy - h * 0.18;
    const px = tl.x + s * 0.4;
    const step = (w - s * 0.8) / 4;
    ctx.moveTo(px, y0);
    ctx.lineTo(px + step, y0);
    ctx.lineTo(px + step, y1);
    ctx.lineTo(px + step * 2, y1);
    ctx.lineTo(px + step * 2, y0);
    ctx.lineTo(px + step * 3, y0);
    ctx.lineTo(px + step * 3, y1);
    ctx.lineTo(px + step * 4, y1);
    ctx.stroke();
    return;
  }

  const symbol = def.symbol ?? def.label;
  ctx.fillStyle = THEME.text;
  const size = def.glyph === "gate" ? Math.min(20, s * 1.05) : Math.min(14, s * 0.68);
  ctx.font = `700 ${Math.max(9, size)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(symbol, cx, cy);
}

function drawPin(ctx: CanvasRenderingContext2D, scene: Scene, xf: Xform, comp: CompInstance, g: PinGeom) {
  const at = xf.toScreen(g.at);
  const dx = g.dir === "l" ? -1 : g.dir === "r" ? 1 : 0;
  const dy = g.dir === "u" ? -1 : g.dir === "d" ? 1 : 0;
  const stub = Math.max(3, xf.s * 0.28);
  const end = { x: at.x + dx * stub, y: at.y + dy * stub };
  const val = scene.sim.valueOf({ comp: comp.id, pin: g.spec.id });
  const hot =
    (scene.pendingWire?.comp === comp.id && scene.pendingWire?.pin === g.spec.id) ||
    (scene.hover.kind === "pin" && scene.hover.comp === comp.id && scene.hover.pin === g.spec.id);

  ctx.strokeStyle = hot ? THEME.accent : g.spec.kind === "out" ? THEME.pinOut : THEME.pinIn;
  ctx.lineWidth = hot ? 2.4 : 1.4;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(end.x, end.y, hot ? 4 : 2.6, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle as string;
  ctx.fill();

  if (xf.s < 12) return;
  const showLabel = g.spec.label || g.spec.id;
  const labelSide = dx !== 0 ? { x: end.x + dx * 3, y: end.y - xf.s * 0.34 } : { x: at.x, y: end.y + dy * (xf.s * 0.35 + 4) };
  const valueSide = dx !== 0 ? { x: end.x + dx * 3, y: end.y + xf.s * 0.36 } : { x: at.x, y: end.y + dy * (xf.s * 0.35 + 15) };
  ctx.textBaseline = "middle";
  ctx.textAlign = dx < 0 ? "right" : dx > 0 ? "left" : "center";
  if (showLabel) {
    ctx.font = `500 ${Math.max(8, Math.min(11, xf.s * 0.42))}px ui-monospace, monospace`;
    ctx.fillStyle = THEME.dim;
    ctx.fillText(String(showLabel), labelSide.x, labelSide.y);
  }
  if (val && (val.width > 1 || g.spec.kind === "in")) {
    ctx.font = `600 ${Math.max(8, Math.min(11, xf.s * 0.42))}px ui-monospace, monospace`;
    ctx.fillStyle = val.value ? THEME.wireHigh : "#5b6478";
    ctx.fillText(val.width > 4 ? hex(val.value, val.width) : String(val.value), valueSide.x, valueSide.y);
  }
}

function drawPlacingGhost(ctx: CanvasRenderingContext2D, scene: Scene, xf: Xform) {
  if (!scene.placing || !scene.cursor) return;
  const def = defOf(scene.design, scene.placing.type, {});
  if (!def) return;
  const at = { x: Math.round(scene.cursor.x), y: Math.round(scene.cursor.y) };
  const size = bbox(def.size.w, def.size.h, scene.placing.rot);
  const tl = xf.toScreen(at);
  ctx.save();
  ctx.globalAlpha = 0.55;
  roundRect(
    ctx,
    tl.x,
    tl.y,
    size.w * xf.s,
    size.h * xf.s,
    Math.min(8, xf.s * 0.4),
    "rgba(167,139,250,0.18)",
    THEME.accent,
    1.6
  );
  ctx.restore();
}

/* ------------------------------ 工具 ------------------------------ */

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke: string,
  lw: number
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function labelBox(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.font = "600 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 6;
  ctx.fillStyle = "rgba(11,13,20,0.85)";
  ctx.fillRect(x - w / 2, y - 7, w, 14);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/* --------------------------- 命中测试 --------------------------- */

/** 元件在世界坐标下的包围盒尺寸（已计入旋转） */
export function compSize(design: Design, comp: CompInstance): { w: number; h: number } {
  const def = defOf(design, comp.type, comp.params);
  if (!def) return { w: 2, h: 1 };
  return bbox(def.size.w, def.size.h, comp.rot);
}

/** 导线的实际折线（世界坐标），用于绘制与命中判定 */
export function wirePolyline(scene: Scene, w: Wire): Point[] | undefined {
  const byId = new Map(scene.circuit.comps.map((c) => [c.id, c]));
  const a = byId.get(w.a.comp);
  const b = byId.get(w.b.comp);
  if (!a || !b) return undefined;
  const ga = pinRefGeom(scene, a, w.a.pin);
  const gb = pinRefGeom(scene, b, w.b.pin);
  if (!ga || !gb) return undefined;
  return route(ga.at, ga.dir, gb.at, gb.dir, w.via);
}

export function hitWire(scene: Scene, grid: Point, tol = 0.35): string | undefined {
  for (const w of scene.circuit.wires) {
    const pts = wirePolyline(scene, w);
    if (pts && distToPolyline(grid, pts) <= tol) return w.id;
  }
  return undefined;
}

export function hitPin(scene: Scene, grid: Point, radius = 0.45): PinRef | undefined {
  let best: { ref: PinRef; d: number } | undefined;
  for (const comp of scene.circuit.comps) {
    for (const g of pinsOf(scene.design, comp)) {
      const d = Math.hypot(g.at.x - grid.x, g.at.y - grid.y);
      if (d <= radius && (!best || d < best.d)) best = { ref: { comp: comp.id, pin: g.spec.id }, d };
    }
  }
  return best?.ref;
}

export function hitComp(scene: Scene, grid: Point): CompInstance | undefined {
  const comps = scene.circuit.comps;
  for (let i = comps.length - 1; i >= 0; i--) {
    const comp = comps[i];
    const size = compSize(scene.design, comp);
    if (grid.x >= comp.x && grid.x <= comp.x + size.w && grid.y >= comp.y && grid.y <= comp.y + size.h) return comp;
  }
  return undefined;
}

export function compInRect(scene: Scene, comp: CompInstance, rect: Rect): boolean {
  const size = compSize(scene.design, comp);
  return comp.x + size.w >= rect.x && comp.x <= rect.x + rect.w && comp.y + size.h >= rect.y && comp.y <= rect.y + rect.h;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export { route, bbox };
