/**
 * headless 内核自检：node scripts/verify.ts
 * 覆盖组合逻辑、位宽推断、总线拆分/合并、时序元件、子电路、错误诊断。
 */
import { CircuitBuilder } from "../src/core/build.ts";
import { Simulator } from "../src/core/sim.ts";
import { totalCost } from "../src/core/custom.ts";
import { LEVELS, levelDesign, solutionDesign } from "../src/challenges/levels.ts";
import { runLevelTests } from "../src/challenges/verify.ts";
import { referenceCpu } from "../src/cpu/reference.ts";
import { runProgram } from "../src/cpu/run.ts";
import type { Circuit, Design } from "../src/core/types.ts";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log("  \x1b[32m✓\x1b[0m " + name);
  } else {
    failed++;
    console.log("  \x1b[31m✗\x1b[0m " + name + (detail ? "  → " + detail : ""));
  }
}

function mkSim(root: Circuit, defs: Design["defs"] = []): Simulator {
  const design: Design = { name: "test", root, defs };
  return new Simulator(design, root);
}

function out(sim: Simulator, comp: string, pin = "in") {
  return sim.valueOf({ comp, pin })?.value ?? -1;
}

/* 1. AND 真值表 */
{
  const b = new CircuitBuilder();
  const a = b.add("input", 0, 0, { bitWidth: 1 });
  const c = b.add("input", 0, 3, { bitWidth: 1 });
  const g = b.add("and", 5, 1);
  const o = b.add("output", 10, 2, { bitWidth: 1 });
  b.link([
    [a, "out", g, "i0"],
    [c, "out", g, "i1"],
    [g, "out", o, "in"],
  ]);
  const sim = mkSim(b.build());
  const rows: [number, number, number][] = [
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
  ];
  let ok = true;
  const got: string[] = [];
  for (const [x, y, z] of rows) {
    sim.setInput(a, x);
    sim.setInput(c, y);
    if (out(sim, o) !== z) {
      ok = false;
      got.push(`${x}&${y}=${out(sim, o)}≠${z}`);
    }
  }
  check("与门真值表", ok, got.join(" "));
  check("无网络错误", sim.errors.filter((e) => e.level === "error").length === 0, JSON.stringify(sim.errors));
}

/* 2. 4 位加法 + 分线器 */
{
  const b = new CircuitBuilder();
  const a = b.add("input", 0, 0, { bitWidth: 4, name: "A" });
  const c = b.add("input", 0, 6, { bitWidth: 4, name: "B" });
  const add = b.add("add", 6, 2);
  const sp = b.add("split", 12, 2, { bitWidth: 4 });
  const outs: string[] = [];
  for (let i = 0; i < 4; i++) outs.push(b.add("output", 18, i * 2, { bitWidth: 1 }));
  const cout = b.add("output", 18, 10, { bitWidth: 1 });
  b.link([
    [a, "out", add, "a"],
    [c, "out", add, "b"],
    [add, "sum", sp, "in"],
    [add, "cout", cout, "in"],
  ]);
  for (let i = 0; i < 4; i++) b.connect(sp, "b" + i, outs[i], "in");
  const sim = mkSim(b.build());
  const readSum = () => outs.reduce((acc, o, i) => acc + out(sim, o) * 2 ** i, 0);
  sim.setInput(a, 9);
  sim.setInput(c, 7);
  check("4 位加法 9+7 溢出", readSum() === 0 && out(sim, cout) === 1, `sum=${readSum()} cout=${out(sim, cout)}`);
  sim.setInput(a, 5);
  sim.setInput(c, 6);
  check("4 位加法 5+6=11", readSum() === 11 && out(sim, cout) === 0, `sum=${readSum()}`);
  check("总线位宽自动推断为 4", sim.valueOf({ comp: add, pin: "a" })?.width === 4);
}

/* 3. 多路选择器 + 位宽跟随 */
{
  const b = new CircuitBuilder();
  const s = b.add("input", 0, 0, { bitWidth: 1 });
  const x = b.add("input", 0, 4, { bitWidth: 8 });
  const y = b.add("input", 0, 10, { bitWidth: 8 });
  const m = b.add("mux", 6, 3);
  const o = b.add("output", 12, 4, { bitWidth: 8 });
  b.link([
    [s, "out", m, "sel"],
    [x, "out", m, "i0"],
    [y, "out", m, "i1"],
    [m, "out", o, "in"],
  ]);
  const sim = mkSim(b.build());
  sim.setInput(x, 61);
  sim.setInput(y, 200);
  sim.setInput(s, 0);
  const v0 = out(sim, o);
  sim.setInput(s, 1);
  const v1 = out(sim, o);
  check("MUX 选择通道", v0 === 61 && v1 === 200, `${v0}/${v1}`);
  check("MUX 输出位宽 8", sim.valueOf({ comp: o, pin: "in" })?.width === 8);
}

/* 4. D 触发器与计数器时序 */
{
  const b = new CircuitBuilder();
  const clk = b.add("clock", 0, 0, { divide: 2 });
  const d = b.add("input", 0, 4, { bitWidth: 1 });
  const ff = b.add("dff", 5, 1);
  const o = b.add("output", 10, 2, { bitWidth: 1 });
  b.link([
    [clk, "out", ff, "clk"],
    [d, "out", ff, "d"],
    [ff, "q", o, "in"],
  ]);
  const sim = mkSim(b.build());
  sim.setInput(d, 1);
  sim.step();
  check("D 触发器上升沿采样", out(sim, o) === 1, "q=" + out(sim, o));
  sim.setInput(d, 0);
  check("D 触发器保持", out(sim, o) === 1, "q=" + out(sim, o));
  // divide=2 的时钟隔拍才有一个上升沿
  sim.step();
  check("无脉冲周期保持不变", out(sim, o) === 1, "q=" + out(sim, o));
  sim.step();
  check("D 触发器更新", out(sim, o) === 0, "q=" + out(sim, o));

  const b2 = new CircuitBuilder();
  const clk2 = b2.add("clock", 0, 0, { divide: 1 });
  const one = b2.add("const", 0, 5, { bitWidth: 1, value: 1 });
  const cnt = b2.add("counter", 5, 1, { bitWidth: 4 });
  const o2 = b2.add("output", 12, 2, { bitWidth: 4 });
  b2.link([
    [clk2, "out", cnt, "clk"],
    [one, "out", cnt, "en"],
    [cnt, "out", o2, "in"],
  ]);
  const sim2 = mkSim(b2.build());
  const seq: number[] = [];
  for (let i = 0; i < 6; i++) {
    sim2.step();
    seq.push(out(sim2, o2));
  }
  check("计数器递增", seq.join(",") === "1,2,3,4,5,6", seq.join(","));
}

/* 5. RAM 读写 + 合线器 */
{
  const b = new CircuitBuilder();
  const clk = b.add("clock", 0, 0, { divide: 1 });
  const addr = b.add("input", 0, 4, { bitWidth: 3 });
  const din = b.add("input", 0, 9, { bitWidth: 8 });
  const wen = b.add("input", 0, 14, { bitWidth: 1 });
  const ram = b.add("ram", 6, 2, { bitWidth: 8, addrBits: 3 });
  const dout = b.add("output", 14, 4, { bitWidth: 8 });
  b.link([
    [clk, "out", ram, "clk"],
    [addr, "out", ram, "addr"],
    [din, "out", ram, "din"],
    [wen, "out", ram, "wen"],
    [ram, "dout", dout, "in"],
  ]);
  const sim = mkSim(b.build());
  sim.setInput(addr, 3);
  sim.setInput(din, 0xab);
  sim.setInput(wen, 1);
  sim.step();
  sim.setInput(wen, 0);
  sim.setInput(addr, 0);
  check("RAM 未写地址为 0", out(sim, dout) === 0, "v=" + out(sim, dout));
  sim.setInput(addr, 3);
  check("RAM 写入后读出", out(sim, dout) === 0xab, "v=0x" + out(sim, dout).toString(16));
  check("RAM 内容可读回", sim.readMemory(ram)[3] === 0xab);
  sim.writeMemory(ram, [1, 2, 3, 4]);
  sim.setInput(addr, 1);
  check("writeMemory 加载并随设计持久化", out(sim, dout) === 2 && String(sim.compById(ram)!.inst.params.data).includes("0x2"));
}

/* 6. 子电路层次化 */
{
  const inner = new CircuitBuilder();
  const inA = inner.add("input", 0, 2, { bitWidth: 4, name: "X" });
  const notg = inner.add("not", 6, 2);
  const outA = inner.add("output", 12, 2, { bitWidth: 4, name: "NOTX" });
  inner.link([
    [inA, "out", notg, "i0"],
    [notg, "out", outA, "in"],
  ]);
  const defId = "def-not4";
  const defs = [{ id: defId, name: "四位取反", circuit: inner.build() }];

  const b = new CircuitBuilder();
  const src = b.add("input", 0, 2, { bitWidth: 4 });
  const sub = b.add("custom:" + defId, 6, 1);
  const o = b.add("output", 14, 2, { bitWidth: 4 });
  b.link([
    [src, "out", sub, inA],
    [sub, outA, o, "in"],
  ]);
  const sim = mkSim(b.build(), defs);
  sim.setInput(src, 5);
  check("子电路求值", out(sim, o) === (15 ^ 5), "v=" + out(sim, o));
  check("子电路无错误", sim.errors.filter((e) => e.level === "error").length === 0, JSON.stringify(sim.errors));
  check("子电路成本计入内部元件", totalCost({ name: "", root: b.build(), defs }, b.build()) === 2);
}

/* 7. 诊断：多驱动 */
{
  const b = new CircuitBuilder();
  const a = b.add("input", 0, 0, { bitWidth: 1 });
  const c = b.add("input", 0, 4, { bitWidth: 1 });
  const o = b.add("output", 8, 2, { bitWidth: 1 });
  b.link([
    [a, "out", o, "in"],
    [c, "out", o, "in"],
  ]);
  const sim = mkSim(b.build());
  check("检出多驱动冲突", sim.errors.some((e) => e.level === "error" && e.msg.includes("多个输出")));
}

/* 8. 交叉耦合 NOR 锁存器：验证反馈定点迭代与保持 */
{
  const b = new CircuitBuilder();
  const s = b.add("input", 0, 0, { bitWidth: 1, name: "S" });
  const r = b.add("input", 0, 8, { bitWidth: 1, name: "R" });
  const n1 = b.add("nor", 6, 0);
  const n2 = b.add("nor", 6, 6);
  const q = b.add("output", 12, 1, { bitWidth: 1, name: "Q" });
  const qb = b.add("output", 12, 7, { bitWidth: 1, name: "Q'" });
  b.link([
    [s, "out", n1, "i0"],
    [n2, "out", n1, "i1"],
    [r, "out", n2, "i0"],
    [n1, "out", n2, "i1"],
    [n1, "out", q, "in"],
    [n2, "out", qb, "in"],
  ]);
  const sim = mkSim(b.build());
  sim.setInput(s, 1);
  sim.setInput(r, 0);
  const setQ = out(sim, q);
  const setQb = out(sim, qb);
  check("NOR 锁存器置位", setQ !== setQb, `q=${setQ} qb=${setQb}`);
  sim.setInput(s, 0);
  sim.setInput(r, 0);
  check("NOR 锁存器保持（反馈收敛）", out(sim, q) === setQ && out(sim, qb) === setQb, `q=${out(sim, q)} qb=${out(sim, qb)}`);
  sim.setInput(r, 1);
  sim.setInput(s, 0);
  const flipped = out(sim, q) !== setQ;
  sim.setInput(r, 0);
  check("NOR 锁存器翻转并保持", flipped && out(sim, q) !== setQ && !sim.unstable);
}

/* 9. ROM 作指令译码 */
{
  const b = new CircuitBuilder();
  const addr = b.add("input", 0, 2, { bitWidth: 2 });
  const rom = b.add("rom", 5, 1, { bitWidth: 4, addrBits: 2, data: "0b0001,0b0010,0b0100,0b1000" });
  const sp = b.add("split", 12, 1, { bitWidth: 4 });
  const outs = [0, 1, 2, 3].map((i) => b.add("output", 18, i * 2, { bitWidth: 1 }));
  b.link([[addr, "out", rom, "addr"], [rom, "out", sp, "in"]]);
  for (let i = 0; i < 4; i++) b.connect(sp, "b" + i, outs[i], "in");
  const sim = mkSim(b.build());
  sim.setInput(addr, 2);
  const bits = outs.map((o) => out(sim, o));
  check("ROM 译码输出", bits.join("") === "0010", bits.join(""));
  sim.setInput(addr, 3);
  check("ROM 译码输出 3", outs.map((o) => out(sim, o)).join("") === "0001");
}

/* 10. 汇编器 */
{
  const { assemble, disassemble } = await import("../src/asm/assembler.ts");
  const { SAMPLES } = await import("../src/asm/samples.ts");
  const r = assemble(`
      ldi  r0, 1
      ldi  r1, 10
loop: out  r0
      add  r0, r3
      cmp  r0, r1
      jne  loop
      hlt
`);
  check("汇编无错误", r.errors.length === 0, r.errors.join("；"));
  check("LDI 占两字", r.words[0] === 0x2000 && r.words[1] === 1, "0x" + r.words[0].toString(16));
  check("标签解析为地址", r.symbols.loop === 4, String(r.symbols.loop));
  check("JNE 编码条件码", ((r.words[7] >>> 4) & 15) === 2 && r.words[8] === 4, "0x" + r.words[7].toString(16));
  const back = disassemble(r.words, 0).map((l) => l.text);
  check("反汇编可回读", back.some((t) => t.startsWith("ldi R0")) && back.includes("hlt"), back.join(" | "));

  let allOk = true;
  const bad: string[] = [];
  for (const s of SAMPLES) {
    const res = assemble(s.source);
    if (res.errors.length) {
      allOk = false;
      bad.push(`${s.name}: ${res.errors[0]}`);
    }
  }
  check(`${SAMPLES.length} 个示例程序全部通过汇编`, allOk, bad.join(" / "));

  const e1 = assemble("      foo r0, r1\n");
  check("未知指令报错", e1.errors.length > 0 && /未知指令/.test(e1.errors[0]), e1.errors[0]);
  const e2 = assemble("      ldi r0, nowhere\n");
  check("未定义符号报错", e2.errors.some((x) => /未定义/.test(x)), e2.errors.join());
  const dir = assemble(".equ N, 5\n      ldi r0, N*2+1\n");
  check(".equ 与表达式", dir.words[1] === 11, "0x" + dir.words[1].toString(16));
  const str = assemble("      .org 0x20\n      .str \"ab\"\n");
  check(".str 打包双字符", str.words[0] === 0x6261 && str.base === 0x20, JSON.stringify(str.words));
}

/* 参考 CPU 端到端：示例程序必须真的跑出来 */
{
  const { SAMPLES } = await import("../src/asm/samples.ts");
  const bad: string[] = [];
  let ok = 0;
  for (const s of SAMPLES) {
    const r = runProgram(s.source, { maxSteps: 60000 });
    const got = r.values.join(",");
    const want = s.expect.join(",");
    if (!r.errors.length && r.done && got === want) {
      ok++;
    } else {
      bad.push(
        `${s.key}: 停机=${r.done} 拍数=${r.steps} 期望[${want}] 实际[${got}]${r.errors.length ? " 错误:" + r.errors[0] : ""}`
      );
    }
  }
  check(`参考 CPU 跑通全部示例 ${ok}/${SAMPLES.length}`, ok === SAMPLES.length, "\n     " + bad.join("\n     "));
  const ref = referenceCpu([]);
  const wires = ref.design.root.wires.length;
  check(
    `参考 CPU 全由库内元件搭成（${ref.design.root.comps.length} 元件 / ${wires} 连线）`,
    ref.design.root.comps.length > 60 && wires > 150 && ref.handles.regs.length === 8
  );
}

/* 关卡判题自检：参考解答必须通过本关全部用例 */
{
  const bad: string[] = [];
  let ok = 0;
  let has = 0;
  for (const level of LEVELS) {
    has++;
    let r;
    try {
      const sol = solutionDesign(level);
      if (!sol) {
        has--;
        continue;
      }
      r = runLevelTests(level, sol);
    } catch (e) {
      bad.push(`${level.id} · 构建异常 → ${(e as Error).message}`);
      continue;
    }
    if (r.pass) {
      ok++;
      continue;
    }
    for (const o of r.outcomes.filter((x) => !x.pass)) {
      const cs = o.checks.filter((x) => !x.pass).map((x) => `${x.label} ${x.detail}`);
      bad.push(`${level.id} · ${o.name} → ${cs.join(" | ") || "无详细原因"}`);
    }
    if (r.errors.some((e) => e.level === "error")) bad.push(`${level.id} · 拓扑 → ${r.errors[0].msg}`);
    if (r.notes.length) bad.push(`${level.id} · 提示 → ${r.notes[0]}`);
  }
  check(`参考解答通过判题 ${ok}/${has}`, ok === has, "\n     " + bad.slice(0, 20).join("\n     "));
  check(`关卡数量 ${LEVELS.length} ≥ 25`, LEVELS.length >= 25, String(LEVELS.length));
  check("每关都有用例与讲解", LEVELS.every((l) => l.tests.length > 0 && l.teach.length > 8));
  check("骨架可仿真且无拓扑错误", LEVELS.every((l) => runLevelTests(l, levelDesign(l)).errors.every((e) => e.level !== "error")));
}

console.log(`\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}内核自检：${passed} 通过 / ${failed} 失败\x1b[0m`);
process.exit(failed === 0 ? 0 : 1);
