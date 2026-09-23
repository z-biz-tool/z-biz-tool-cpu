import { boundaryOf, defOf, findDef } from "./custom.ts";
import type { Circuit, CompDef, CompInstance, Design, PinRef, PinSpec } from "./types.ts";
import { mask } from "./types.ts";

/* ------------------------------------------------------------------ *
 * 网表构建：展开子电路 → 引脚槽位 → 并查集合并网络 → 位宽推断
 * ------------------------------------------------------------------ */

export interface SimComp {
  /** 展开后的内部 id */
  id: string;
  inst: CompInstance;
  def: CompDef;
  /** 子电路边界的 io 元件：不参与求值，只作为对外引脚的载体 */
  boundary: boolean;
  bits: number;
  /** 与 def.pins 同序的网络下标 */
  pinNet: number[];
  pinIndex: Map<string, number>;
  state: Record<string, any>;
  /** 时钟引脚在 def.pins 中的下标，-1 表示无 */
  clkPin: number;
  seq: boolean;
}

export interface SimNet {
  width: number;
  value: number;
  drivers: number[];
  sinks: number[];
}

export interface SimError {
  level: "error" | "warn";
  msg: string;
  comps: string[];
}

/**
 * 诊断排序：面板一屏只放得下前几条，未驱动这类 warn 不能把阻断性错误挤掉。
 * 只有一处定义，Inspector 与判题结果共用，免得两个面板给出两套优先级。
 */
export function sortDiags<T extends { level: "error" | "warn" }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}

export interface Slot {
  comp: number;
  pin: number;
}

export interface Netlist {
  comps: SimComp[];
  nets: SimNet[];
  slots: Slot[];
  /** "内部id.引脚" → slot 下标 */
  slotOf: Map<string, number>;
  /** "外部id.引脚" → 网络下标（子电路实例的引脚透传） */
  extPin: Map<string, number>;
  errors: SimError[];
}

interface FlatEntry {
  id: string;
  inst: CompInstance;
  def: CompDef;
  boundary: boolean;
}

interface FlatWire {
  a: string;
  b: string;
}

interface Flat {
  comps: FlatEntry[];
  wires: FlatWire[];
  aliases: { from: string; to: string }[];
}

const MAX_DEPTH = 8;

function flatten(
  design: Design,
  circuit: Circuit,
  prefix: string,
  visiting: Set<string>,
  errors: SimError[],
  depth: number
): Flat {
  const out: Flat = { comps: [], wires: [], aliases: [] };
  if (depth > MAX_DEPTH) {
    errors.push({ level: "error", msg: "子电路嵌套过深（>" + MAX_DEPTH + "）", comps: [] });
    return out;
  }
  const remap = new Map<string, string>();
  for (const inst of circuit.comps) {
    const id = prefix + inst.id;
    if (inst.type.startsWith("custom:")) {
      const defId = inst.type.slice(7);
      if (visiting.has(defId)) {
        errors.push({ level: "error", msg: `子电路 "${defId}" 存在循环引用`, comps: [id] });
        continue;
      }
      const sub = findDef(design, defId);
      if (!sub) {
        errors.push({ level: "error", msg: `找不到子电路定义 ${defId}`, comps: [id] });
        continue;
      }
      visiting.add(defId);
      const inner = flatten(design, sub.circuit, id + "/", visiting, errors, depth + 1);
      visiting.delete(defId);
      out.comps.push(...inner.comps);
      out.wires.push(...inner.wires);
      out.aliases.push(...inner.aliases);
      const b = boundaryOf(design, defId);
      if (b) {
        for (const p of [...b.ins, ...b.outs]) {
          remap.set(id + "." + p.name, id + "/" + p.ioComp + "." + p.ioPin);
        }
      }
      continue;
    }
    const def = defOf(design, inst.type, inst.params);
    if (!def) {
      errors.push({ level: "error", msg: `未知元件类型 ${inst.type}`, comps: [id] });
      continue;
    }
    const isIo = inst.type === "input" || inst.type === "output";
    out.comps.push({ id, inst: { ...inst, id }, def, boundary: prefix !== "" && isIo });
  }
  const resolveRef = (ref: PinRef): string | undefined => {
    const key = prefix + ref.comp + "." + ref.pin;
    return remap.get(key) ?? key;
  };
  for (const w of circuit.wires) {
    const a = resolveRef(w.a);
    const b = resolveRef(w.b);
    if (!a || !b) continue;
    if (a === b) continue;
    out.wires.push({ a, b });
  }
  for (const [from, to] of remap) out.aliases.push({ from, to });
  return out;
}

function pinWidth(comp: SimComp, def: CompDef, index: number): number {
  return pinSpecWidth(comp, def.pins[index]);
}

/** 引脚位宽：固定值 / 跟随元件位宽 / 按参数 / 按选择端参数 */
export function pinSpecWidth(comp: SimComp, spec: PinSpec): number {
  if (spec.widthParam) {
    const v = Number(comp.inst.params[spec.widthParam]) || 0;
    return Math.max(1, Math.min(32, v));
  }
  if (spec.selParam) {
    const n = Number(comp.inst.params[spec.selParam]) || 2;
    return Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
  }
  if (spec.width === "auto") return comp.bits;
  return Math.max(1, Math.min(32, spec.width));
}

/** 引脚位宽（依赖已推断出的元件位宽） */
export function pinWidthOf(comp: SimComp, index: number): number {
  return pinWidth(comp, comp.def, index);
}

export function buildNetlist(design: Design, circuit: Circuit): Netlist {
  const errors: SimError[] = [];
  const flat = flatten(design, circuit, "", new Set(), errors, 0);
  const slots: Slot[] = [];
  const slotOf = new Map<string, number>();
  const comps: SimComp[] = [];

  flat.comps.forEach((entry, ci) => {
    const widthMode = entry.def.widthMode ?? "auto";
    const comp: SimComp = {
      id: entry.id,
      inst: entry.inst,
      def: entry.def,
      boundary: entry.boundary,
      bits: widthMode === "param" ? Math.max(1, Number(entry.inst.params.bitWidth) || 1) : 1,
      pinNet: new Array(entry.def.pins.length).fill(-1),
      pinIndex: new Map(),
      state: {},
      clkPin: -1,
      seq: !!entry.def.onRise,
    };
    entry.def.pins.forEach((p, pi) => {
      comp.pinIndex.set(p.id, pi);
      if (p.clock) comp.clkPin = pi;
      slotOf.set(entry.id + "." + p.id, slots.length);
      slots.push({ comp: ci, pin: pi });
    });
    if (comp.clkPin < 0 && comp.seq) {
      errors.push({ level: "error", msg: `${entry.def.label} 需要时钟引脚`, comps: [entry.id] });
    }
    comps.push(comp);
  });

  // 并查集
  const parent = new Int32Array(slots.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const w of flat.wires) {
    const sa = slotOf.get(w.a);
    const sb = slotOf.get(w.b);
    if (sa === undefined || sb === undefined) continue;
    union(sa, sb);
  }

  // 归并网络
  const netIdOfSlot = new Int32Array(slots.length).fill(-1);
  const nets: SimNet[] = [];
  for (let s = 0; s < slots.length; s++) {
    const root = find(s);
    if (netIdOfSlot[root] === -1) {
      netIdOfSlot[root] = nets.length;
      nets.push({ width: 1, value: 0, drivers: [], sinks: [] });
    }
    netIdOfSlot[s] = netIdOfSlot[root];
  }
  // 建立 pinNet
  for (let s = 0; s < slots.length; s++) {
    const { comp, pin } = slots[s];
    comps[comp].pinNet[pin] = netIdOfSlot[s];
  }
  // 驱动 / 负载
  for (let s = 0; s < slots.length; s++) {
    const { comp, pin } = slots[s];
    const c = comps[comp];
    if (c.boundary) continue;
    const spec = c.def.pins[pin];
    const net = nets[c.pinNet[pin]];
    if (spec.kind === "out") net.drivers.push(s);
    else net.sinks.push(s);
  }

  // 位宽推断（单调递增，迭代到不动点；超过预算仅作为告警，不阻断网络构建）
  // FIX-02: 移除硬上限 24，改用真正的不动点 + 预算；区分预算用尽与振荡。
  // 由于宽度按 Math.min(32, w) 单调上升，循环必然在 O(总节点数 × 32) 步内到达不动点，
  // 预算 1024 用于捕获拓扑异常而非正常推断。预算用尽仅产生 warn 诊断。
  let rounds = 0;
  const WIDTH_BUDGET = 1024;
  for (;;) {
    if (++rounds > WIDTH_BUDGET) {
      errors.push({
        level: "warn",
        msg: `位宽推断达预算上限 ${WIDTH_BUDGET} 轮（仍按已收敛的位宽继续构建）`,
        comps: [],
      });
      break;
    }
    let changed = false;
    for (const c of comps) {
      if ((c.def.widthMode ?? "auto") !== "auto" || c.boundary) continue;
      let w = 1;
      c.def.pins.forEach((p, pi) => {
        if (p.kind !== "in" || p.clock || p.selParam) return;
        const nw = nets[c.pinNet[pi]].width;
        if (nw > w) w = nw;
      });
      w = Math.min(32, w);
      if (w !== c.bits) {
        c.bits = w;
        changed = true;
      }
    }
    for (let s = 0; s < slots.length; s++) {
      const { comp, pin } = slots[s];
      const c = comps[comp];
      const nw = pinWidth(c, c.def, pin);
      const net = nets[c.pinNet[pin]];
      if (nw > net.width) {
        net.width = Math.min(32, nw);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 诊断
  const seenConflict = new Set<string>();
  for (const net of nets) {
    if (net.drivers.length > 1) {
      const names = net.drivers.map((s) => comps[slots[s].comp].id + "." + comps[slots[s].comp].def.pins[slots[s].pin].id);
      const key = names.join("|");
      if (!seenConflict.has(key)) {
        seenConflict.add(key);
        errors.push({
          level: "error",
          msg: `多个输出接到同一根导线：${names.slice(0, 4).join("、")}${names.length > 4 ? " …" : ""}`,
          comps: net.drivers.map((s) => comps[slots[s].comp].id),
        });
      }
    }
  }
  const mismatch: string[] = [];
  for (let s = 0; s < slots.length; s++) {
    const { comp, pin } = slots[s];
    const c = comps[comp];
    if (c.boundary) continue;
    const spec = c.def.pins[pin];
    if (spec.width === "auto" || spec.widthParam || spec.selParam) continue;
    const net = nets[c.pinNet[pin]];
    const declared = pinWidthOf(c, pin);
    if (net.width > declared && mismatch.length < 8) {
      mismatch.push(`${c.id}.${spec.id}(${declared}位) ← ${net.width}位`);
    }
  }
  if (mismatch.length) {
    errors.push({
      level: "warn",
      msg: "定宽引脚接在更宽的总线上，将按低位截断：" + mismatch.join("，"),
      comps: [],
    });
  }

  /* doc 02 §5.2：未连接的输入仍然按 0 读取（仿真语义不变），但要把「没有驱动」讲出来，
   * 否则学生看到一串合法的 0 会以为电路在正常工作。是否阻断交给关卡契约判断，
   * 诊断本身一律 warn。时钟悬空单列一条：时序元件不动作时输出停在初值，比读 0 更难查。
   */
  const float = { names: [] as string[], comps: [] as string[] };
  const floatClk = { names: [] as string[], comps: [] as string[] };
  for (const net of nets) {
    if (net.drivers.length || !net.sinks.length) continue;
    for (const s of net.sinks) {
      const c = comps[slots[s].comp];
      const spec = c.def.pins[slots[s].pin];
      const bag = spec.clock ? floatClk : float;
      bag.names.push(`${c.inst.name || c.id}.${spec.label || spec.id}`);
      if (!bag.comps.includes(c.id)) bag.comps.push(c.id);
    }
  }
  const listFloating = (bag: { names: string[]; comps: string[] }) =>
    bag.names.slice(0, 4).join("、") + (bag.names.length > 4 ? ` …共 ${bag.names.length} 处` : "");
  if (float.names.length) {
    errors.push({
      level: "warn",
      msg: `输入未连接，按 0 读取（未驱动）：${listFloating(float)}。需要固定电平就放一个「常量」`,
      comps: float.comps,
    });
  }
  if (floatClk.names.length) {
    errors.push({
      level: "warn",
      msg: `时序元件没有时钟，不会动作：${listFloating(floatClk)}`,
      comps: floatClk.comps,
    });
  }

  const extPin = new Map<string, number>();
  for (const a of flat.aliases) {
    const slot = slotOf.get(a.to);
    if (slot === undefined) continue;
    extPin.set(a.from, netIdOfSlot[slot]);
  }

  for (const net of nets) net.value = 0;
  return { comps, nets, slots, slotOf, extPin, errors };
}

/** 读取网络上的当前值（按位宽掩码） */
export function netValue(net: SimNet): number {
  return mask(net.value, net.width);
}
