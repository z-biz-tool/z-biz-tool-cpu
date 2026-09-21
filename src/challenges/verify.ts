import { totalCost } from "../core/custom.ts";
import { parseWordToken } from "../core/registry.ts";
import { Simulator } from "../core/sim.ts";
import type { SimError } from "../core/netlist.ts";
import type { CompInstance, Design } from "../core/types.ts";
import { mask } from "../core/types.ts";
import type { Level, LevelTest, TestPhase, Value } from "./levels.ts";

/* ------------------------------------------------------------------ *
 * 关卡判题：用仿真器跑测试用例，逐条给出可读的通过/失败原因
 * ------------------------------------------------------------------ */

export interface Check {
  label: string;
  pass: boolean;
  detail: string;
}

export interface TestOutcome {
  name: string;
  pass: boolean;
  checks: Check[];
}

export interface LevelResult {
  levelId: string;
  pass: boolean;
  total: number;
  ok: number;
  outcomes: TestOutcome[];
  cost: number;
  comps: number;
  defs: number;
  /** 布线层面的诊断（多驱动、位宽截断等） */
  errors: SimError[];
  /** 组合逻辑未收敛（振荡） */
  unstable: boolean;
  /** 额外提示，如「时钟没接」 */
  notes: string[];
}

function num(v: Value): number {
  return typeof v === "number" ? v >>> 0 : parseWordToken(String(v));
}

function fmt(v: number, bits: number): string {
  const hexText = "0x" + (v >>> 0).toString(16).toUpperCase();
  return bits > 1 ? `${hexText} (${v >>> 0})` : String(v >>> 0);
}

/** 在根电路里按名字找元件：优先 name，其次 id，最后 in-/out- 前缀 */
function findComp(design: Design, name: string): CompInstance | undefined {
  const comps = design.root.comps;
  return (
    comps.find((c) => c.name === name) ??
    comps.find((c) => c.id === name) ??
    comps.find((c) => c.id === "in-" + name || c.id === "out-" + name)
  );
}

/** 读取元件当前值：输出灯看它的 in 脚，其余看第一个输出脚 */
function readComp(sim: Simulator, inst: CompInstance): { value: number; width: number } | undefined {
  const comp = sim.compById(inst.id);
  if (!comp) return undefined;
  const pinId =
    inst.type === "output"
      ? "in"
      : comp.def.pins.find((p) => p.kind === "out" && !p.clock)?.id ?? comp.def.pins.find((p) => p.kind === "out")?.id;
  if (!pinId) return undefined;
  const v = sim.valueOf({ comp: inst.id, pin: pinId });
  return v ? { value: v.value, width: v.width } : undefined;
}

function phasesOf(test: LevelTest): TestPhase[] {
  const out: TestPhase[] = [];
  if (test.inputs || test.steps) out.push({ inputs: test.inputs, steps: test.steps ?? 0 });
  if (test.phases) out.push(...test.phases);
  return out;
}

export function runLevelTests(level: Level, design: Design): LevelResult {
  const outcomes: TestOutcome[] = [];
  const notes: string[] = [];
  let sim0: Simulator | undefined;
  let unstable = false;

  for (let i = 0; i < level.tests.length; i++) {
    const test = level.tests[i];
    const checks: Check[] = [];
    const name = test.name ?? `用例 ${i + 1}`;
    const sim = new Simulator(design, design.root);
    sim0 = sim;
    if (sim.unstable) unstable = true;

    for (const phase of phasesOf(test)) {
      for (const [k, v] of Object.entries(phase.inputs ?? {})) {
        const inst = findComp(design, k);
        if (!inst) {
          checks.push({ label: `输入 ${k}`, pass: false, detail: `找不到名为 ${k} 的输入元件` });
          continue;
        }
        sim.setInput(inst.id, num(v));
      }
      if (phase.steps) sim.run(phase.steps);
      if (sim.unstable) unstable = true;
    }

    const expectValue = (label: string, target: string, want: Value) => {
      const inst = findComp(design, target);
      if (!inst) {
        checks.push({ label, pass: false, detail: `找不到名为 ${target} 的元件` });
        return;
      }
      const got = readComp(sim, inst);
      if (!got) {
        checks.push({ label, pass: false, detail: `${target} 没有可观测的输出脚` });
        return;
      }
      const w = num(want);
      const exp = mask(w, got.width);
      checks.push({
        label: `${label} ${target}`,
        pass: got.value === exp,
        detail: `期望 ${fmt(exp, got.width)}，实际 ${fmt(got.value, got.width)}`,
      });
    };

    for (const [k, v] of Object.entries(test.outputs ?? {})) expectValue("输出", k, v);
    for (const [k, v] of Object.entries(test.regs ?? {})) expectValue("状态", k, v);

    for (const m of test.mem ?? []) {
      const inst = findComp(design, m.name);
      if (!inst || (inst.type !== "ram" && inst.type !== "rom")) {
        checks.push({ label: `存储 ${m.name}[${m.at}]`, pass: false, detail: "找不到该存储元件" });
        continue;
      }
      const mem = sim.readMemory(inst.id);
      const bits = Number(inst.params.bitWidth) || 8;
      const got = mask(mem[m.at] ?? 0, bits);
      const exp = mask(num(m.expect), bits);
      checks.push({
        label: `${m.name}[${m.at}]`,
        pass: got === exp,
        detail: `期望 ${fmt(exp, bits)}，实际 ${fmt(got, bits)}`,
      });
    }

    if (test.log !== undefined) {
      const got = sim.logs.map((l) => l.msg).join(",");
      checks.push({
        label: "终端输出",
        pass: got === test.log,
        detail: `期望「${test.log}」，实际「${got || "（空）"}」`,
      });
    }

    outcomes.push({ name, pass: checks.every((c) => c.pass) && checks.length > 0, checks });
  }

  // 拓扑与需求检查
  if (level.requireDefs) {
    const used = design.root.comps.some((c) => c.type.startsWith("custom:"));
    const defs = design.defs.length;
    addOutcome(outcomes, "封装", defs >= level.requireDefs && used, `需要至少 ${level.requireDefs} 个子电路（当前 ${defs} 个，${used ? "已" : "未"}放入主电路）`);
  }
  if (!outcomes.length) outcomes.push({ name: "无用例", pass: false, checks: [] });

  const errors = sim0?.errors ?? [];
  if (sim0) {
    const silent: string[] = [];
    for (const c of sim0.nl.comps) {
      if (c.boundary || !c.seq || c.clkPin < 0) continue;
      const net = c.pinNet[c.clkPin];
      if (net >= 0 && sim0.nl.nets[net].drivers.length === 0) silent.push(c.inst.name || c.id);
    }
    if (silent.length) notes.push("这些时序元件的时钟脚没有连接，不会随节拍变化：" + silent.slice(0, 6).join("、"));
  }

  const pass = outcomes.every((o) => o.pass) && !errors.some((e) => e.level === "error") && !unstable;
  return {
    levelId: level.id,
    pass,
    total: outcomes.length,
    ok: outcomes.filter((o) => o.pass).length,
    outcomes,
    cost: totalCost(design, design.root),
    comps: design.root.comps.filter((c) => c.type !== "input" && c.type !== "output").length,
    defs: design.defs.length,
    errors,
    unstable,
    notes,
  };
}

function addOutcome(outcomes: TestOutcome[], name: string, pass: boolean, detail: string) {
  outcomes.push({ name, pass, checks: [{ label: name, pass, detail }] });
}
