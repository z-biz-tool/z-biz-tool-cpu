// 门级电路 CPU（src/cpu/reference.ts + src/core/sim.ts）与参考解释器
// （src/cpu/interpreter.ts）的一致性回归。
// 跑法：node --experimental-strip-types --test tests/cpu-consistency.test.ts
//
// 这是优化方案 00 的 **P0-2**，也是本仓**价值最高的一条测试**：
//   · `sim.ts` 27KB + `netlist.ts` 12KB + `reference.ts` 22KB 此前零测试；
//   · 两边是「实现 vs 参考」的关系（一个用门搭、一个用 TS 写），
//     **一致性本身就是最值钱的断言** —— 它能同时钉住两个最大的文件，
//     而且天然抓得住"两边同时跑偏"：单侧断言抓不到那种，因为两边会一起错。
//
// 为什么要对照解释器而不是对着手算值写期望：
//   本仓的解释器是**独立实现**（单独维护 PC/寄存器/标志/内存），
//   电路是门级 netlist 逐拍推进。两者共享的只有 `src/asm/isa.ts` 里的
//   ISA 常量与 `decodeOp`，而**电路那一侧另有自己硬编码的译码位**。
//   所以「两边算出同一个结果」很难由同一个错误同时污染。
//
//   ⚠️ 这一点我**原先写反了**：初版注释断言「共享的 ISA 常量被改时
//   一致性测试抓不到，因为两边会一起错」。变异验证推翻了这个说法 ——
//   把 `OP.NOT` 从 0x8 改成 0x9 后，汇编器与解释器一起变、而电路的硬编码
//   译码不变，于是**一致性测试报了 4 条红**。
//   即：这条断言比我想的更能用。**写「这条测试抓不到什么」时，
//   同样要拿变异验证，不能靠推理。**
//
// ⚠️ 一条读法上的坑：`cargo`-式"全绿就提交"在这里不成立。
// 本文件第一版就因为**读错了引脚名**而三条断言全拿 undefined 静默通过；
// 见文件末"测试自己也会骗人"那节。
import { test } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../src/asm/assembler.ts";
import { newInterpreter, loadProgram, runToHalt } from "../src/cpu/interpreter.ts";
import { referenceCpu } from "../src/cpu/reference.ts";
import { Simulator } from "../src/core/sim.ts";

/** 汇编 → 机器码；零错误才继续。 */
function prog(src: string): number[] {
  const r = assemble(src.endsWith("\n") ? src : src + "\n");
  assert.deepEqual(r.errors, [], `程序不该有汇编错误：\n${src}\n${JSON.stringify(r.errors)}`);
  return r.words;
}

interface CircuitRun {
  regs: (number | undefined)[];
  mem: number[];
  settle: string;
  ticks: number;
  compCount: number;
  blockingError: boolean;
}

/**
 * 跑门级电路，取回八个寄存器与内存。
 *
 * 读值走 `sim.probes()` 而不是 `sim.valueOf({comp,pin})`：
 * 后者需要正确的引脚名，传错会返回 `undefined` 而不是抛错 ——
 * 于是一条「电路没跑对」的断言会被「undefined === undefined」判成通过。
 * probes() 给出的是**具名元件的当前值**，拿不到值本身就是缺失，不会伪装成值。
 */
function runCircuit(words: number[], ticks = 600): CircuitRun {
  const { design, handles } = referenceCpu(words);
  const sim = new Simulator(design, design.root);
  if (sim.hasBlockingError) {
    const errs = sim.logs.filter((l) => l.level === "error").map((l) => l.msg);
    assert.fail(`参考 CPU 电路编译不过：\n${errs.join("\n")}`);
  }
  sim.run(ticks);
  const byId = new Map(sim.probes().map((p) => [p.id, p.value?.value]));
  return {
    regs: handles.regs.map((id) => byId.get(id)),
    mem: sim.readMemory(handles.mem),
    settle: sim.settleOutcome,
    ticks: sim.time,
    compCount: design.root.comps.length,
    blockingError: sim.hasBlockingError,
  };
}

/** 跑参考解释器。 */
function runInterp(words: number[]) {
  const st = newInterpreter();
  loadProgram(st, words);
  runToHalt(st);
  return { regs: [...st.regs], halted: st.halted, output: st.output, mem: st.mem };
}

/** 核心断言：两个独立实现在同一程序上必须给出同一组寄存器。 */
function assertSameRegs(src: string, ticks = 600) {
  const words = prog(src);
  const c = runCircuit(words, ticks);
  const i = runInterp(words);

  // 先证明两侧都**真取到了值**，再比内容。
  // 不这么做的话，「两边都是 undefined」会被 assert.deepEqual 判成一致。
  for (let r = 0; r < 8; r++) {
    assert.ok(typeof c.regs[r] === "number",
      `电路侧 R${r} 没取到值（得 undefined）—— 读法坏了，不是电路坏了。\n${src}`);
  }
  for (let r = 0; r < 8; r++) {
    assert.equal(c.regs[r], i.regs[r],
      `R${r} 不一致：电路 ${c.regs[r]} vs 解释器 ${i.regs[r]}\n程序：\n${src}`);
  }
  return { c, i };
}

/* ------------------------------------------------------------------ *
 * 前置：电路本身能跑起来
 * ------------------------------------------------------------------ */

test("前置：参考 CPU 电路能编译、能推进、且有实体规模", () => {
  const c = runCircuit(prog("  ldi r0, 5\n  hlt\n"));
  assert.equal(c.blockingError, false);
  assert.ok(c.compCount > 50, `参考 CPU 应由大量元件搭成，实测 ${c.compCount}`);
  assert.equal(c.settle, "converged", `仿真应收敛，实测 ${c.settle}`);
  assert.ok(c.ticks > 0, "仿真应真的推进过时间");
});

/* ------------------------------------------------------------------ *
 * 算术与逻辑：两套实现逐条对账
 * ------------------------------------------------------------------ */

test("一致性：LDI / MOV / ADD / SUB", () => {
  assertSameRegs("  ldi r0, 5\n  ldi r1, 7\n  add r0, r1\n  hlt\n");
  assertSameRegs("  ldi r0, 9\n  ldi r1, 4\n  sub r0, r1\n  hlt\n");
  assertSameRegs("  ldi r0, 42\n  mov r2, r0\n  ldi r3, 1\n  hlt\n");
});

test("一致性：AND / OR / XOR / NOT", () => {
  assertSameRegs("  ldi r0, 0b1100\n  ldi r1, 0b1010\n  and r0, r1\n  hlt\n");
  assertSameRegs("  ldi r0, 0b1100\n  ldi r1, 0b1010\n  or r0, r1\n  hlt\n");
  assertSameRegs("  ldi r0, 0b1100\n  ldi r1, 0b1010\n  xor r0, r1\n  hlt\n");
  assertSameRegs("  ldi r0, 0\n  not r0\n  hlt\n");
});

test("一致性：移位（移位量取自寄存器 B）", () => {
  assertSameRegs("  ldi r0, 1\n  ldi r2, 4\n  shl r0, r2\n  hlt\n");
  assertSameRegs("  ldi r0, 8\n  ldi r2, 2\n  shr r0, r2\n  hlt\n");
  // 无符号右移：高位为 1 时不能被符号扩展
  assertSameRegs("  ldi r0, 0xffff\n  ldi r2, 4\n  shr r0, r2\n  hlt\n");
});

test("一致性：CMP 写标志（寄存器不受影响，两边都应如此）", () => {
  assertSameRegs("  ldi r0, 10\n  ldi r1, 20\n  cmp r0, r1\n  hlt\n");
  assertSameRegs("  ldi r0, 7\n  ldi r1, 7\n  cmp r0, r1\n  hlt\n");
});

test("一致性：16 位回绕（两边都必须回绕，不能一边溢出）", () => {
  assertSameRegs("  ldi r0, 65535\n  ldi r1, 2\n  add r0, r1\n  hlt\n");
  assertSameRegs("  ldi r0, 0\n  ldi r1, 1\n  sub r0, r1\n  hlt\n");
});

/* ------------------------------------------------------------------ *
 * 内存与控制流
 * ------------------------------------------------------------------ */

test("一致性：STA / LDA 走同一块内存", () => {
  const src = "  ldi r6, 0x100\n  ldi r2, 0x100\n  ldi r0, 123\n  st r0, [r2]\n  ld r1, [r2]\n  hlt\n";
  const { c, i } = assertSameRegs(src);
  assert.equal(c.regs[1], 123, "电路侧读回自己写的值");
  assert.equal(i.regs[1], 123, "解释器侧读回自己写的值");
});

test("一致性：栈的 push / pop（修好 POP 之后两边都该是 LIFO）", () => {
  const src = [
    "  ldi r6, 0x200",
    "  ldi r0, 11",
    "  ldi r1, 22",
    "  push r0",
    "  push r1",
    "  pop r2",
    "  pop r3",
    "  hlt",
  ].join("\n") + "\n";
  const { c, i } = assertSameRegs(src);
  // 期望值独立于两侧：递减栈，后进先出
  assert.equal(c.regs[2], 22, "电路：先弹出的是后压入的 22");
  assert.equal(c.regs[3], 11, "电路：再弹出 11");
  assert.equal(i.regs[2], 22, "解释器：同");
  assert.equal(i.regs[3], 11, "解释器：同");
  assert.equal(c.regs[6], 0x200, "两次 push 两次 pop 后 SP 回原位");
});

test("一致性：JMP 跳转与 CALL/RET", () => {
  assertSameRegs("  jmp skip\n  ldi r0, 1\nskip:\n  ldi r1, 2\n  hlt\n");
  assertSameRegs("  call sub\n  ldi r3, 9\n  hlt\nsub:\n  ldi r2, 1\n  ret\n");
});

test("一致性：OUT 端口写入的值两边相同", () => {
  const src = "  ldi r0, 5\n  out r0\n  ldi r0, 7\n  out r0\n  hlt\n";
  const { i } = assertSameRegs(src);
  assert.deepEqual(i.output, [5, 7], "解释器侧终端输出按序累积");
  // ⚠️ 电路侧的终端输出经 OUT 元件的 print 日志，**不落 RAM**，
  // 所以本条只对账寄存器，不对账终端输出本身。
  // 要对账终端输出需要读 OUT 元件的日志流，**本轮没查清怎么读**，故不写断言 ——
  // 写一条取不到值却恒过的断言，比不写更坏。
  const c = runCircuit(prog(src));
  assert.equal(typeof c.regs[0], "number", "电路侧寄存器必须取到值");
});

/* ------------------------------------------------------------------ *
 * 规模化：多条指令的组合，避免只测到单条路径
 * ------------------------------------------------------------------ */

test("一致性：多指令组合（覆盖更多译码与时序路径）", () => {
  assertSameRegs([
    "  ldi r0, 0",
    "  ldi r1, 5",
    "  ldi r2, 0",
    "  ldi r6, 0x300",
    "loop:",
    "  ldi r3, 1",
    "  add r0, r3",
    "  add r2, r3",
    "  ldi r3, 3",
    "  push r0",
    "  ldi r3, 0",
    "  pop r4",
    "  ldi r3, 0",
    "  not r3",
    "  or r2, r3",
    "  hlt",
  ].join("\n") + "\n", 1500);
});

/* ------------------------------------------------------------------ *
 * 测试自己也会骗人：这三条钉住「读法坏掉」这个失效模式
 * ------------------------------------------------------------------ */

test("防自欺：regs 读不到值时不得判成「两边一致」", () => {
  // 本文件第一版用 `sim.valueOf({comp, pin: "out"})` 取值，引脚名写错，
  // 三个断言全部拿到 `undefined`，而 `undefined === undefined` 会被
  // 判成「一致」—— 测试全绿，电路其实一点没跑。
  //
  // 这条把「先证明两侧都取到了数」固化成用例：
  // 对一个**故意返回 undefined** 的读法，必须报错而不是通过。
  const badRead = (): (number | undefined)[] => [undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined];
  assert.throws(() => {
    const c = badRead();
    for (let r = 0; r < 8; r++) {
      assert.ok(typeof c[r] === "number", `R${r} 没取到值`);
    }
  }, /没取到值/, "读法坏了却判成一致，就是这条要拦的");
});

test("防自欺：探针读法本身可用（probes 能给出具名元件的值）", () => {
  const { design, handles } = referenceCpu(prog("  ldi r0, 5\n  hlt\n"));
  const sim = new Simulator(design, design.root);
  sim.run(200);
  const byId = new Map(sim.probes().map((p) => [p.id, p.value?.value]));
  assert.equal(typeof byId.get(handles.regs[0]), "number",
    "probes() 必须能给出寄存器的数值；否则上面所有一致性断言都是空转");
  // RAM 也必须可读，否则内存类断言同样是空转
  assert.ok(sim.readMemory(handles.mem).length > 0, "RAM 必须可读");
});

test("防自欺：一致性不是恒真（拿一个必然不同的程序对照）", () => {
  // 若「assertSameRegs」对任何程序都通过，那它什么也没钉。
  // 这里用一个**故意不同**的组合反证：同样的指令但初值不同。
  const w1 = prog("  ldi r0, 5\n  hlt\n");
  const w2 = prog("  ldi r0, 6\n  hlt\n");
  const c1 = runCircuit(w1).regs[0];
  const c2 = runCircuit(w2).regs[0];
  assert.equal(c1, 5);
  assert.equal(c2, 6);
  assert.notEqual(c1, c2, "初值不同结果必须不同 —— 说明读数是真的在随程序变");
});
