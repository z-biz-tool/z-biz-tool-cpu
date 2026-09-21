import { baseDef, defaultParams, resolveDef } from "./registry.ts";
import type { Circuit, CompInstance, Point, Rot, Wire } from "./types.ts";

/* ------------------------------------------------------------------ *
 * 程序化搭建电路：关卡骨架与参考 CPU 都用它生成
 * ------------------------------------------------------------------ */

export interface AddOptions {
  rot?: Rot;
  flip?: boolean;
  name?: string;
  /** 显式指定元件 id（子电路边界引脚需要可预测的 id） */
  id?: string;
}

const defaultsCache = new Map<string, Record<string, number | string | boolean>>();

function defaultParamsOf(type: string): Record<string, number | string | boolean> {
  let hit = defaultsCache.get(type);
  if (!hit) {
    const def = baseDef(type);
    hit = def ? defaultParams(def) : {};
    defaultsCache.set(type, hit);
  }
  return hit;
}

export function comp(
  id: string,
  type: string,
  x: number,
  y: number,
  params: Record<string, number | string | boolean> = {},
  opt: AddOptions = {}
): CompInstance {
  return {
    id,
    type,
    x,
    y,
    rot: opt.rot ?? 0,
    flip: opt.flip,
    name: opt.name,
    params: { ...defaultParamsOf(type), ...params },
  };
}

export function wire(id: string, a: [string, string], b: [string, string], via?: Point[]): Wire {
  return { id, a: { comp: a[0], pin: a[1] }, b: { comp: b[0], pin: b[1] }, via };
}

export function circuit(comps: CompInstance[], wires: Wire[] = []): Circuit {
  const c = { comps, wires };
  validatePins(c);
  return c;
}

/** 连线引用了不存在的引脚时直接报错，避免关卡/参考解答留下静默的断线 */
export function validatePins(c: Circuit) {
  const byId = new Map(c.comps.map((x) => [x.id, x]));
  for (const w of c.wires) {
    for (const end of [w.a, w.b]) {
      const inst = byId.get(end.comp);
      if (!inst) continue;
      const def = resolveDef(inst.type, inst.params) ?? baseDef(inst.type);
      if (!def) continue;
      if (!def.pins.some((p) => p.id === end.pin)) {
        throw new Error(`元件 ${inst.name || inst.id}(${inst.type}) 没有引脚 ${end.pin}`);
      }
    }
  }
}

export class CircuitBuilder {
  private comps: CompInstance[] = [];
  private wires: Wire[] = [];
  private seq = 0;
  private alias = new Map<string, string>();

  add(type: string, x: number, y: number, params: Record<string, number | string | boolean> = {}, opt: AddOptions = {}): string {
    const id = opt.id ?? "n" + ++this.seq;
    const inst: CompInstance = {
      id,
      type,
      x,
      y,
      rot: opt.rot ?? 0,
      flip: opt.flip,
      name: opt.name,
      params: { ...defaultParamsOf(type), ...params },
    };
    this.comps.push(inst);
    this.alias.set(id, id);
    if (opt.name) this.alias.set(opt.name, id);
    return id;
  }

  /** 把已有电路（关卡骨架）灌进构建器，便于在其上补参考解答 */
  seed(circuit: Circuit) {
    for (const c of circuit.comps) {
      this.comps.push({ ...c, params: { ...c.params } });
      this.alias.set(c.id, c.id);
      if (c.name) this.alias.set(c.name, c.id);
    }
    for (const w of circuit.wires) this.wires.push({ ...w, a: { ...w.a }, b: { ...w.b }, via: w.via?.map((p) => ({ ...p })) });
    this.seq += circuit.comps.length + circuit.wires.length;
  }

  id(key: string): string {
    const hit = this.alias.get(key);
    if (!hit) throw new Error("未知元件: " + key);
    return hit;
  }

  /** 给元件命名（同时登记别名），返回 id */
  label(key: string, name: string): string {
    const id = this.id(key);
    const target = this.comps.find((c) => c.id === id);
    if (target) target.name = name;
    this.alias.set(name, id);
    return id;
  }

  connect(a: string, aPin: string, b: string, bPin: string, via?: Point[]): string {
    const w: Wire = {
      id: "w" + ++this.seq,
      a: { comp: this.id(a), pin: aPin },
      b: { comp: this.id(b), pin: bPin },
      via,
    };
    this.wires.push(w);
    return w.id;
  }

  /** 批量连接：[a, aPin, b, bPin] */
  link(rows: [string, string, string, string][]) {
    for (const r of rows) this.connect(r[0], r[1], r[2], r[3]);
  }

  move(key: string, x: number, y: number) {
    const target = this.comps.find((c) => c.id === this.id(key));
    if (target) {
      target.x = x;
      target.y = y;
    }
  }

  get count() {
    return this.comps.length;
  }

  ids(): string[] {
    return this.comps.map((c) => c.id);
  }

  build(): Circuit {
    const c: Circuit = {
      comps: this.comps.map((x) => ({ ...x, params: { ...x.params } })),
      wires: this.wires.map((x) => ({ ...x })),
    };
    validatePins(c);
    return c;
  }
}
