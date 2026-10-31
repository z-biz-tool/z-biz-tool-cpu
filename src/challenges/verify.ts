import { totalCost } from "../core/custom.ts";
import { baseDef, parseWordToken } from "../core/registry.ts";
import { Simulator, worstSettle, type SettleOutcome } from "../core/sim.ts";
import type { SimError } from "../core/netlist.ts";
import type { CompInstance, Design } from "../core/types.ts";
import { mask } from "../core/types.ts";
import type { TestbenchCase } from "../courses/manifest.ts";
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
  /** doc 02 §5.2：unstable 的具体成因，UI 据此选文案 */
  settleOutcome: SettleOutcome;
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

/** FIX-08: 从骨架电路取出每个 I/O 的契约位宽，禁止学生缩小输出位宽后绕过。 */
function contractBitWidths(level: Level): Map<string, number> {
  const map = new Map<string, number>();
  if (typeof level.skeleton !== "function") return map;
  const sk = level.skeleton();
  for (const c of sk.comps) {
    if (!c.name) continue;
    const w = Number(c.params?.bitWidth) || 1;
    map.set(c.name, w);
    map.set("in-" + c.name, w);
    map.set("out-" + c.name, w);
  }
  return map;
}

/** FIX-08: 递归展开学生用到的所有基础元件，校验是否在关卡白名单内。 */
function collectTransitiveTypes(design: Design, maxDepth = 6, visited = new Set<string>(), acc = new Set<string>()): Set<string> {
  for (const c of design.root.comps) {
    acc.add(c.type);
    if (c.type.startsWith("custom:") && !visited.has(c.type)) {
      visited.add(c.type);
      const def = design.defs.find((d) => "custom:" + d.id === c.type);
      if (def) collectTransitiveTypes({ ...design, root: def.circuit }, maxDepth, visited, acc);
    }
  }
  for (const d of design.defs) {
    for (const c of d.circuit.comps) {
      acc.add(c.type);
    }
  }
  return acc;
}

export function runLevelTests(level: Level, design: Design): LevelResult {
  const outcomes: TestOutcome[] = [];
  const notes: string[] = [];
  let sim0: Simulator | undefined;
  let unstable = false;
  let settleOutcome: SettleOutcome = "converged";

  // FIX-08: 预先检查契约：白名单 + 骨架 I/O 位宽
  const contract = contractBitWidths(level);
  const allowed = new Set(level.available ?? []);
  const usedTypes = collectTransitiveTypes(design);
  const forbiddenUsed: string[] = [];
  for (const t of usedTypes) {
    if (t === "input" || t === "output" || t === "clock") continue;
    const base = baseDef(t);
    if (!base) continue; // 子电路或自定义允许，但需通过后续结构校验
    // 关卡白名单中显式列出的允许通过；allowIncludes 子电路
    if (allowed.has(t) || (level.available ?? []).includes("custom")) continue;
    if (allowed.size === 0) continue; // 空白名单视为不限制基础元件
    forbiddenUsed.push(t);
  }
  if (forbiddenUsed.length) {
    addOutcome(
      outcomes,
      "白名单",
      false,
      "以下元件不在关卡允许列表内：" + forbiddenUsed.join("、")
    );
  }

  for (let i = 0; i < level.tests.length; i++) {
    const test = level.tests[i];
    const checks: Check[] = [];
    const name = test.name ?? `用例 ${i + 1}`;
    const sim = new Simulator(design, design.root);
    sim0 = sim;
    settleOutcome = worstSettle(settleOutcome, sim.settleOutcome);
    unstable = unstable || settleOutcome !== "converged";

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
      settleOutcome = worstSettle(settleOutcome, sim.settleOutcome);
      unstable = unstable || settleOutcome !== "converged";
    }

    // FIX-08: 期望值的位宽以骨架为准；学生输出位宽不足必须报失败，不能被截断绕过。
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
      const contractW = contract.get(target) ?? contract.get(inst.name ?? "") ?? got.width;
      const w = num(want);
      const exp = mask(w, contractW);
      if (got.width < contractW) {
        checks.push({
          label: `${label} ${target}`,
          pass: false,
          detail: `输出位宽 ${got.width} 小于契约 ${contractW} 位，禁止缩小比较域`,
        });
        return;
      }
      checks.push({
        label: `${label} ${target}`,
        pass: mask(got.value, contractW) === exp,
        detail: `期望 ${fmt(exp, contractW)}，实际 ${fmt(got.value, got.width)}`,
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
      // FIX-08: 存储位宽以骨架契约为准，避免学生改小后通过截断期望值绕过。
      const contractBits = contract.get(m.name) ?? contract.get(inst.name ?? "");
      const bits = contractBits ?? (Number(inst.params.bitWidth) || 8);
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
    settleOutcome,
    notes,
  };
}

function addOutcome(outcomes: TestOutcome[], name: string, pass: boolean, detail: string) {
  outcomes.push({ name, pass, checks: [{ label: name, pass, detail }] });
}

/* ------------------------------------------------------------------ *
 * 发布态用例的执行（courses/manifest.ts 的 TestbenchCase）
 *
 * 发布内容包里的用例是纯 JSON，没有可执行骨架，只能落到同一个仿真器上判。
 * 此前 courses/judging.ts 的 runCase 只占结构、恒返回通过 —— 那种"判题"最坏：
 * 看着在判，其实什么都没跑，判出来的"全过"是假的。
 * ------------------------------------------------------------------ */

/** 发布态用例的一处判定，额外带上期望/实际，供上层归类失败原因 */
export interface PublishedCheck extends Check {
  expected?: unknown;
  actual?: unknown;
}

export interface TestbenchOutcome {
  caseId: string;
  pass: boolean;
  checks: PublishedCheck[];
  elapsedTicks: number;
  /** 组合逻辑未收敛 */
  unsettled: boolean;
}

/** 按名字定位元件：大小写不敏感，兼容 in-/out- 前缀（发布用例里写的是短名） */
function findTarget(design: Design, target: string): CompInstance | undefined {
  const t = target.toLowerCase();
  return design.root.comps.find(
    (c) =>
      c.id.toLowerCase() === t ||
      (c.name ?? "").toLowerCase() === t ||
      c.id.toLowerCase() === "in-" + t ||
      c.id.toLowerCase() === "out-" + t
  );
}

/** 终端（print）元件打印出去的值序列 */
function printedValues(sim: Simulator, compId: string): number[] {
  const out: number[] = [];
  for (const l of sim.logs) {
    if (l.comp !== compId || l.level !== "info") continue;
    const v = num(l.msg);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** 去掉连续重复的采样（元件保持旧值时不算新的一次输出） */
function compress(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  return out;
}

export function runTestbenchCase(design: Design, c: TestbenchCase): TestbenchOutcome {
  const checks: PublishedCheck[] = [];
  const sim = new Simulator(design, design.root);
  const byTick = new Map<number, TestbenchCase["inputs"]>();
  for (const ev of c.inputs ?? []) {
    const list = byTick.get(ev.tick) ?? [];
    list.push(ev);
    byTick.set(ev.tick, list);
  }
  const seqTargets = (c.assertions ?? [])
    .filter((a) => a.kind === "outputSequence")
    .map((a) => a.target);
  const samples = new Map<string, number[]>();

  const maxTicks = Math.max(1, c.maxTicks ?? 16);
  let ran = 0;
  for (let tick = 0; tick < maxTicks; tick++) {
    // 同一拍的输入要同时生效：先全部静默写入，再跑这一拍
    for (const ev of byTick.get(tick) ?? []) {
      const inst = findTarget(design, ev.target);
      if (!inst) {
        checks.push({ label: `输入 ${ev.target}`, pass: false, detail: `找不到名为 ${ev.target} 的输入元件` });
        continue;
      }
      sim.setInput(inst.id, num(ev.value), false);
    }
    if (!sim.run(1)) {
      checks.push({ label: "仿真", pass: false, detail: "仿真在阻断性错误下中止" });
      break;
    }
    ran = tick + 1;
    for (const t of seqTargets) {
      const inst = findTarget(design, t);
      if (!inst) continue;
      const got = readComp(sim, inst);
      if (!got) continue;
      const arr = samples.get(t) ?? [];
      arr.push(got.value);
      samples.set(t, arr);
    }
  }

  for (const a of c.assertions ?? []) {
    switch (a.kind) {
      case "signalEquals": {
        const inst = findTarget(design, a.target);
        if (!inst) {
          checks.push({ label: `输出 ${a.target}`, pass: false, detail: `找不到名为 ${a.target} 的元件` });
          break;
        }
        const got = readComp(sim, inst);
        if (!got) {
          checks.push({ label: `输出 ${a.target}`, pass: false, detail: `${a.target} 没有可观测的输出脚` });
          break;
        }
        const want = mask(num(a.equals), got.width);
        const actual = mask(got.value, got.width);
        checks.push({
          label: `输出 ${a.target}`,
          pass: actual === want,
          detail: `期望 ${fmt(want, got.width)}，实际 ${fmt(actual, got.width)}`,
          expected: want,
          actual,
        });
        break;
      }
      case "memoryEquals": {
        const inst = findTarget(design, a.target);
        if (!inst || (inst.type !== "ram" && inst.type !== "rom")) {
          checks.push({ label: `存储 ${a.target}[${a.at}]`, pass: false, detail: "找不到该存储元件" });
          break;
        }
        const mem = sim.readMemory(inst.id);
        const actual = mem[a.at] ?? 0;
        const want = num(a.equals);
        checks.push({
          label: `${a.target}[${a.at}]`,
          pass: actual === want,
          detail: `期望 ${want}，实际 ${actual}`,
          expected: want,
          actual,
        });
        break;
      }
      case "outputSequence": {
        const inst = findTarget(design, a.target);
        if (!inst) {
          checks.push({ label: `输出序列 ${a.target}`, pass: false, detail: `找不到名为 ${a.target} 的元件` });
          break;
        }
        const actual = inst.type === "print" ? printedValues(sim, inst.id) : compress(samples.get(a.target) ?? []);
        const want = a.equals.map(num);
        checks.push({
          label: `输出序列 ${a.target}`,
          pass: actual.length === want.length && actual.every((v, i) => v === want[i]),
          detail: `期望 [${want.join(", ")}]，实际 [${actual.join(", ")}]`,
          expected: want,
          actual,
        });
        break;
      }
      case "halted": {
        const inst =
          findTarget(design, "done") ?? findTarget(design, "halt") ?? findTarget(design, "halted");
        if (!inst) {
          checks.push({ label: "halted", pass: false, detail: "找不到 DONE / HALT 信号" });
          break;
        }
        const got = readComp(sim, inst);
        checks.push({
          label: "halted",
          pass: !!got && got.value !== 0,
          detail: got ? `${inst.name ?? inst.id} = ${got.value}` : `${inst.id} 没有可观测的输出脚`,
          expected: 1,
          actual: got?.value,
        });
        break;
      }
      case "noDiagnostic": {
        const errs = sim.errors.filter((e) => e.level === "error");
        checks.push({
          label: "无诊断",
          pass: errs.length === 0,
          detail: errs.length ? errs.map((e) => e.msg).join("；") : "没有错误诊断",
        });
        break;
      }
    }
  }

  if (!checks.length) {
    checks.push({ label: "用例", pass: false, detail: "用例没有任何断言，无法判定" });
  }
  return {
    caseId: c.id,
    pass: checks.every((k) => k.pass),
    checks,
    elapsedTicks: ran,
    unsettled: sim.settleOutcome !== "converged",
  };
}
