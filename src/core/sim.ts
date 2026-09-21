import { buildNetlist, pinWidthOf, type Netlist, type SimComp, type SimNet } from "./netlist.ts";
import { parseWordToken } from "./registry.ts";
import type { Circuit, Design, EvalCtx, PinRef } from "./types.ts";
import { mask } from "./types.ts";

export interface PinValue {
  value: number;
  width: number;
  driven: boolean;
}

export interface SimLog {
  time: number;
  comp: string;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface Probe {
  id: string;
  name: string;
  label: string;
  kind: "reg" | "mem" | "io" | "other";
  value: PinValue | undefined;
}

const MAX_PASSES = 4000;

export class Simulator {
  readonly design: Design;
  readonly circuit: Circuit;
  nl: Netlist;
  time = 0;
  unstable = false;
  logs: SimLog[] = [];
  private ctxs: (EvalCtx | undefined)[] = [];
  private queue: number[] = [];
  private head = 0;
  private inq: Uint8Array = new Uint8Array(0);
  private settling = false;
  private prevClk: number[] = [];
  private reported = new Set<string>();

  // FIX-03: 阻断性编译错误会让仿真无意义地继续推进；构造时若存在 level="error"
  // 的条目，则把 Simulator 置入 COMPILE_ERROR 态，step/run 全部无效并返回 false，
  // 同时把诊断注入 logs 便于 UI 显示。已存在的 reset/setInput 仍然可用以便校正。
  hasBlockingError = false;

  constructor(design: Design, circuit: Circuit) {
    this.design = design;
    this.circuit = circuit;
    this.nl = buildNetlist(design, circuit);
    this.inq = new Uint8Array(this.nl.comps.length);
    this.ctxs = new Array(this.nl.comps.length);
    this.prevClk = new Array(this.nl.comps.length).fill(0);
    this.hasBlockingError = this.nl.errors.some((e) => e.level === "error");
    if (this.hasBlockingError) {
      for (const e of this.nl.errors) {
        if (e.level === "error") this.logs.push({ time: 0, comp: e.comps[0] ?? "@compile", level: "error", msg: e.msg });
      }
    }
    this.reset();
  }

  /** FIX-03: 阻断性编译错误时 step 立即返回 false，避免假装仿真成功 */
  step(): boolean {
    if (this.hasBlockingError) return false;
    this.time++;
    this.setClockSources(true);
    this.settle();
    const fired: number[] = [];
    this.nl.comps.forEach((comp, ci) => {
      if (comp.boundary || !comp.seq || comp.clkPin < 0) return;
      const v = this.clkValue(ci);
      if (v && !this.prevClk[ci]) fired.push(ci);
    });
    for (const ci of fired) {
      const comp = this.nl.comps[ci];
      try {
        comp.def.onRise!(this.ctxOf(ci));
      } catch (e) {
        if (!this.reported.has(comp.id)) {
          this.reported.add(comp.id);
          this.log(comp.id, `${comp.def.label}: ${(e as Error).message}`, "error");
        }
      }
    }
    this.settle();
    this.setClockSources(false);
    this.settle();
    this.nl.comps.forEach((_, ci) => {
      this.prevClk[ci] = this.clkValue(ci);
    });
    return true;
  }

  run(steps: number): boolean {
    if (this.hasBlockingError) return false;
    for (let i = 0; i < steps; i++) this.step();
    return true;
  }

  get errors() {
    return this.nl.errors;
  }

  get compCount() {
    return this.nl.comps.filter((c) => !c.boundary).length;
  }

  /** 保留 RAM/ROM 内容与开关状态的快照 */
  dumpState(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const c of this.nl.comps) if (Object.keys(c.state).length) out[c.id] = { ...c.state };
    return out;
  }

  restoreState(map: Record<string, Record<string, unknown>>) {
    for (const c of this.nl.comps) {
      const s = map[c.id];
      if (s) Object.assign(c.state, s);
    }
    this.settle();
  }

  reset() {
    for (const c of this.nl.comps) {
      // 就地清空：EvalCtx.s 持有该对象引用，不能整体替换
      for (const k of Object.keys(c.state)) delete c.state[k];
      if (c.def.type === "input") c.state.v = parseWordToken(String(c.inst.params.init ?? "0"));
    }
    for (const n of this.nl.nets) n.value = 0;
    this.prevClk.fill(0);
    this.time = 0;
    this.unstable = false;
    this.logs = [];
    this.settle();
  }

  /** 外部（画布上）可见的元件 */
  rootComps(): SimComp[] {
    return this.nl.comps.filter((c) => !c.id.includes("/"));
  }

  compById(id: string): SimComp | undefined {
    return this.nl.comps.find((c) => c.id === id);
  }

  private indexOf(id: string): number {
    return this.nl.comps.findIndex((c) => c.id === id);
  }

  private netOfPin(ci: number, pi: number): SimNet | undefined {
    const comp = this.nl.comps[ci];
    const net = comp?.pinNet[pi];
    return net === undefined || net < 0 ? undefined : this.nl.nets[net];
  }

  /** 引脚 → 网络下标（子电路实例引脚会透传到内部） */
  netIndexOf(ref: PinRef): number | undefined {
    const key = ref.comp + "." + ref.pin;
    const ext = this.nl.extPin.get(key);
    if (ext !== undefined) return ext;
    const ci = this.indexOf(ref.comp);
    if (ci < 0) return undefined;
    const comp = this.nl.comps[ci];
    const pi = comp.pinIndex.get(ref.pin);
    return pi === undefined ? undefined : comp.pinNet[pi];
  }

  valueOf(ref: PinRef): PinValue | undefined {
    const ni = this.netIndexOf(ref);
    if (ni === undefined) return undefined;
    const net = this.nl.nets[ni];
    return { value: mask(net.value, net.width), width: net.width, driven: net.drivers.length > 0 };
  }

  /** 网络上的实际驱动者（用于探针命名） */
  driverOf(ref: PinRef): PinRef | undefined {
    const ni = this.netIndexOf(ref);
    if (ni === undefined) return undefined;
    const s = this.nl.nets[ni].drivers[0];
    if (s === undefined) return undefined;
    const slot = this.nl.slots[s];
    const comp = this.nl.comps[slot.comp];
    return { comp: comp.id, pin: comp.def.pins[slot.pin].id };
  }

  private notify(net: SimNet) {
    if (!this.settling) return;
    for (const s of net.sinks) {
      const ci = this.nl.slots[s].comp;
      const comp = this.nl.comps[ci];
      // 输出灯 / 子电路边界只被动观测，不参与求值
      if (comp.boundary || !comp.def.eval) continue;
      if (!this.inq[ci]) {
        this.inq[ci] = 1;
        this.queue.push(ci);
      }
    }
  }

  private ctxOf(ci: number): EvalCtx {
    const cached = this.ctxs[ci];
    if (cached) return cached;
    const sim = this;
    const comp = this.nl.comps[ci];
    const ins: string[] = [];
    const outs: string[] = [];
    comp.def.pins.forEach((p) => (p.kind === "in" ? ins : outs).push(p.id));
    const readSlot = (pin: string): { net: SimNet; width: number } | undefined => {
      const pi = comp.pinIndex.get(pin);
      if (pi === undefined) return undefined;
      const net = sim.netOfPin(ci, pi);
      if (!net) return undefined;
      return { net, width: pinWidthOf(comp, pi) };
    };
    const ctx: EvalCtx = {
      r(pin) {
        const t = readSlot(pin);
        return t ? mask(t.net.value, t.width) : 0;
      },
      rw(pin) {
        const t = readSlot(pin);
        return t ? mask(t.net.value, t.width) : 0;
      },
      w(pin, v) {
        const t = readSlot(pin);
        if (!t) return;
        const nv = mask(v, t.net.width);
        if (t.net.value !== nv) {
          t.net.value = nv;
          sim.notify(t.net);
        }
      },
      p<T extends number | string | boolean = number>(key: string): T {
        const raw = comp.inst.params[key];
        const spec = (comp.def.params ?? []).find((s) => s.key === key);
        if (raw === undefined) return (spec?.default ?? 0) as T;
        switch (spec?.kind) {
          case "bool":
            return (raw === true || raw === "true" || raw === 1 || raw === "1") as unknown as T;
          case "text":
          case "data":
            return String(raw) as unknown as T;
          case "choice":
            return (typeof spec.default === "string"
              ? String(raw)
              : parseWordToken(String(raw))) as unknown as T;
          default:
            return parseWordToken(String(raw)) as unknown as T;
        }
      },
      get bits() {
        return comp.bits;
      },
      ins,
      outs,
      s: comp.state,
      log(msg, level = "info") {
        sim.log(comp.id, msg, level);
      },
    };
    this.ctxs[ci] = ctx;
    return ctx;
  }

  log(comp: string, msg: string, level: "info" | "warn" | "error" = "info") {
    this.logs.push({ time: this.time, comp, level, msg });
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
  }

  /** 组合逻辑收敛 */
  settle() {
    this.settling = true;
    this.unstable = false;
    this.queue.length = 0;
    this.head = 0;
    this.inq.fill(0);
    const comps = this.nl.comps;
    for (let i = 0; i < comps.length; i++) {
      if (comps[i].boundary || !comps[i].def.eval) continue;
      this.queue.push(i);
      this.inq[i] = 1;
    }
    let passes = 0;
    while (this.head < this.queue.length) {
      if (++passes > MAX_PASSES) {
        this.unstable = true;
        break;
      }
      const ci = this.queue[this.head++];
      this.inq[ci] = 0;
      if (this.head > 8192) {
        this.queue = this.queue.slice(this.head);
        this.head = 0;
      }
      const comp = comps[ci];
      try {
        comp.def.eval!(this.ctxOf(ci));
      } catch (e) {
        if (!this.reported.has(comp.id)) {
          this.reported.add(comp.id);
          this.log(comp.id, `${comp.def.label}: ${(e as Error).message}`, "error");
        }
      }
    }
    this.settling = false;
  }

  private clkValue(ci: number): number {
    const comp = this.nl.comps[ci];
    if (comp.clkPin < 0) return 0;
    const net = this.netOfPin(ci, comp.clkPin);
    return net && net.value ? 1 : 0;
  }

  private setClockSources(highPhase: boolean) {
    this.nl.comps.forEach((comp) => {
      if (comp.boundary) return;
      if (comp.def.type !== "clock") return;
      const auto = comp.inst.params.auto;
      if (auto === false || auto === "false") return;
      const divide = Math.max(1, Number(comp.inst.params.divide) || 1);
      // 每 divide 拍给出一个高电平脉冲，即每 divide 拍产生一次上升沿
      const groupHigh = (this.time - 1) % divide === 0;
      comp.state.hi = highPhase && groupHigh ? 1 : 0;
    });
  }

  /** 手动设置输入开关 / 按钮 / 手动时钟源 */
  setInput(compId: string, value: number) {
    const ci = this.indexOf(compId);
    if (ci < 0) return;
    const comp = this.nl.comps[ci];
    if (comp.def.type === "clock") comp.state.hi = value ? 1 : 0;
    else comp.state.v = mask(value, Math.max(1, comp.bits));
    this.settle();
  }

  /** 写入 RAM/ROM 内容：同时落到 params.data，使程序随设计一起保存 */
  writeMemory(compId: string, words: number[]) {
    const ci = this.indexOf(compId);
    if (ci < 0) return;
    const comp = this.nl.comps[ci];
    const bits = Math.max(1, Number(comp.inst.params.bitWidth) || 16);
    const m = mask(-1, bits);
    // 去掉尾部 0，避免 16 位地址的 RAM 序列化出几万项
    let end = words.length;
    while (end > 0 && (words[end - 1] & m) === 0) end--;
    const out: string[] = [];
    for (let i = 0; i < end; i++) out.push("0x" + (words[i] & m).toString(16));
    comp.inst.params.data = out.join(",");
    delete comp.state._mem;
    delete comp.state._memKey;
    this.settle();
  }

  readMemory(compId: string): number[] {
    const ci = this.indexOf(compId);
    if (ci < 0) return [];
    const comp = this.nl.comps[ci];
    if (!comp.state._mem) comp.def.eval?.(this.ctxOf(ci));
    return (comp.state._mem as number[]) ?? [];
  }

  /** 探针：收集所有被命名的元件 */
  probes(): Probe[] {
    const out: Probe[] = [];
    for (const comp of this.nl.comps) {
      if (comp.boundary || !comp.inst.name) continue;
      const kind: Probe["kind"] =
        comp.def.type === "ram" || comp.def.type === "rom"
          ? "mem"
          : comp.def.type === "reg" || comp.def.type === "dff" || comp.def.type === "counter"
            ? "reg"
            : comp.def.category === "io"
              ? "io"
              : "other";
      const pin = comp.def.pins.find((p) => p.kind === "out");
      out.push({
        id: comp.id,
        name: comp.inst.name,
        label: comp.def.label,
        kind,
        value: pin ? this.valueOf({ comp: comp.id, pin: pin.id }) : undefined,
      });
    }
    return out;
  }
}
