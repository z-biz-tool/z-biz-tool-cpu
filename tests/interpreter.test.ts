// Z16 参考解释器（src/cpu/interpreter.ts）的回归。
// 跑法：node --experimental-strip-types --test tests/interpreter.test.ts
//
// 为什么用它当抓手：优化方案 00 的 P0-1。`src/cpu/`+`src/core/` 合计 158 KB
// 此前**零测试**，而本仓的招牌就是"从 NAND 门搭到能跑汇编的 16 位 CPU"。
//
// **一个刻意的做法**：几乎所有用例都**经汇编器**造程序，而不是手搓机器码。
//   · 现有 19 条测试只测 `src/asm/` 内部，测不到 `asm ↔ interpreter` 之间的契约；
//   · 那才是真 bug 的藏身处 —— 汇编器按 16 位字布局
//     `[15:12]op [11:8]A [7:4]B [3:0]保留`，解释器再解回来；
//     任何一边改了字段含义而另一边没跟上，两边各自单测都绿，合起来是错的。
//   所以这里每次都 `assemble()` 出机器码再喂给解释器，一箭双雕。
//
// 期望值全部**先跑探针量出来、再逐条对照 ISA 文档核实**，不是拍脑袋写的。
// 其中两条最初的期望是错的，记在用例注释里：
//   · SHR 的移位量取自**寄存器 B**（`regs[dec.b] & 15`），不是立即数；
//   · CMP 10,20 得到 flags=6（N|C）而不是 Z —— 10<20 必然非零，且有借位。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newInterpreter, loadProgram, runToHalt, stepOnce, pushInput,
  _internalToSigned as toSigned, isaVersion,
  type InterpreterState,
} from "../src/cpu/interpreter.ts";
import { assemble } from "../src/asm/assembler.ts";
import { ISA_VERSION, REG_SP } from "../src/asm/isa.ts";

/** 汇编 → 机器码。断言零错误，编译期就能抓住语法写错。 */
function asm(src: string): number[] {
  const r = assemble(src.endsWith("\n") ? src : src + "\n");
  assert.deepEqual(r.errors, [], `程序不该有汇编错误：\n${src}\n${JSON.stringify(r.errors)}`);
  return r.words;
}

/** 跑一个程序到停机，**不传** program 数组（走 loadProgram 装入 mem 的路径）。 */
function run(src: string, input: number[] = []): InterpreterState {
  const words = asm(src);
  const st = newInterpreter();
  loadProgram(st, words);
  for (const v of input) pushInput(st, v);
  runToHalt(st);
  return st;
}

/** 同一个程序再跑一遍，但**传** program 数组。两条路径必须给出相同答案。 */
function runWithProgram(src: string, input: number[] = []): InterpreterState {
  const words = asm(src);
  const st = newInterpreter();
  loadProgram(st, words);
  for (const v of input) pushInput(st, v);
  runToHalt(st, words);
  return st;
}

/** 两条调用路径的结果一致性 —— 见下面那条专门锁 bug 的用例。 */
function bothPaths(src: string, input: number[] = []) {
  return { mem: run(src, input), prog: runWithProgram(src, input) };
}

/* ------------------------------------------------------------------ *
 * 基础：状态初值与 ISA 版本
 * ------------------------------------------------------------------ */

test("newInterpreter：初值干净，8 个寄存器、pc=0、未停机", () => {
  const st = newInterpreter();
  assert.equal(st.pc, 0);
  assert.equal(st.regs.length, 8);
  assert.deepEqual([...st.regs], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(st.flags, 0);
  assert.equal(st.retired, 0);
  assert.equal(st.halted, false);
  assert.equal(st.fault, undefined);
  assert.deepEqual(st.output, []);
  assert.equal(st.mem.size, 0);
});

test("isaVersion 与 ISA_VERSION 常量一致（序列化项目靠它识别语义）", () => {
  assert.equal(isaVersion(), ISA_VERSION);
  assert.equal(isaVersion(), "z16/1.1", "ISA 版本号是公开契约，改它等于换语义");
});

test("toSigned：16 位补码解读", () => {
  assert.equal(toSigned(0xffff), -1);
  assert.equal(toSigned(0x8000), -32768);
  assert.equal(toSigned(0x7fff), 32767);
  assert.equal(toSigned(5), 5);
  assert.equal(toSigned(0), 0);
});

/* ------------------------------------------------------------------ *
 * 立即数与寄存器传送
 * ------------------------------------------------------------------ */

test("LDI：两字指令，立即数落进目标寄存器", () => {
  const st = run("  ldi r0, 5\n  ldi r1, 300\n  hlt\n");
  assert.equal(st.regs[0], 5);
  assert.equal(st.regs[1], 300);
});

test("LDI：负数按 16 位补码存（0xFFFB）", () => {
  const st = run("  ldi r0, -5\n  hlt\n");
  assert.equal(st.regs[0], 0xfffb, "-5 应存成 16 位补码 65531");
  assert.equal(toSigned(st.regs[0]), -5, "解读回来应是 -5");
});

test("MOV：寄存器间传送", () => {
  const st = run("  ldi r0, 42\n  mov r1, r0\n  hlt\n");
  assert.equal(st.regs[1], 42);
});

/* ------------------------------------------------------------------ *
 * 算术与逻辑：期望值按 ISA 语义推，不靠快照
 * ------------------------------------------------------------------ */

test("ADD / SUB：基本与 16 位回绕", () => {
  assert.equal(run("  ldi r0, 5\n  ldi r1, 7\n  add r0, r1\n  hlt\n").regs[0], 12);
  assert.equal(run("  ldi r0, 9\n  ldi r1, 4\n  sub r0, r1\n  hlt\n").regs[0], 5);
  // 溢出必须回绕到 16 位，不能变成 65537
  assert.equal(run("  ldi r0, 65535\n  ldi r1, 2\n  add r0, r1\n  hlt\n").regs[0], 1);
  assert.equal(run("  ldi r0, 0\n  ldi r1, 1\n  sub r0, r1\n  hlt\n").regs[0], 0xffff);
});

test("AND / OR / XOR / NOT：逐位运算", () => {
  assert.equal(run("  ldi r0, 0b1100\n  ldi r1, 0b1010\n  and r0, r1\n  hlt\n").regs[0], 0b1000);
  assert.equal(run("  ldi r0, 0b1100\n  ldi r1, 0b1010\n  or r0, r1\n  hlt\n").regs[0], 0b1110);
  assert.equal(run("  ldi r0, 0b1100\n  ldi r1, 0b1010\n  xor r0, r1\n  hlt\n").regs[0], 0b0110);
  assert.equal(run("  ldi r0, 0\n  not r0\n  hlt\n").regs[0], 0xffff, "NOT 0 应为 0xFFFF");
});

test("SHL / SHR：移位量取自**寄存器 B**，不是立即数", () => {
  // 实现的移位量是 `regs[dec.b] & 15`。
  // 本条最初写成 `shr r0, 2` 并期望 8>>2=4，实得 8 —— 因为那是「按 R2 移位」，
  // 而 R2=0。语义没错，是期望写错了；此处用寄存器把移位量显式装载。
  const shl = run("  ldi r0, 1\n  ldi r2, 4\n  shl r0, r2\n  hlt\n");
  assert.equal(shl.regs[0], 16, "1 左移 4 位 = 16");
  const shr = run("  ldi r0, 8\n  ldi r2, 2\n  shr r0, r2\n  hlt\n");
  assert.equal(shr.regs[0], 2, "8 右移 2 位 = 2");
  // 右移用无符号 >>>，高位是 1 时不该被符号扩展成全 1
  const ushr = run("  ldi r0, 0xffff\n  ldi r2, 4\n  shr r0, r2\n  hlt\n");
  assert.equal(ushr.regs[0], 0x0fff, "0xFFFF 无符号右移 4 位 = 0x0FFF");
  // 移位量只取低 4 位（& 15）
  const masked = run("  ldi r0, 1\n  ldi r2, 16\n  shl r0, r2\n  hlt\n");
  assert.equal(masked.regs[0], 1, "移位量 16 经 & 15 后为 0，结果应不变");
});

/* ------------------------------------------------------------------ *
 * 标志位
 * ------------------------------------------------------------------ */

test("CMP：按 A−B 的结果写 Z / N / C", () => {
  // 期望值取自 flags 位定义：Z=1, N=2, C=4
  const lt = run("  ldi r0, 10\n  ldi r1, 20\n  cmp r0, r1\n  hlt\n");
  assert.equal(lt.flags, 2 | 4, "10<20：非零(N) 且有借位(C)，Z 不该置位");
  const eq = run("  ldi r0, 7\n  ldi r1, 7\n  cmp r0, r1\n  hlt\n");
  assert.equal(eq.flags, 1, "相等只置 Z");
  const gt = run("  ldi r0, 20\n  ldi r1, 10\n  cmp r0, r1\n  hlt\n");
  assert.equal(gt.flags, 0, "20>10：无零、无负、无借位");
});

test("CMP 不改寄存器（只写标志）", () => {
  const st = run("  ldi r0, 10\n  ldi r1, 20\n  cmp r0, r1\n  hlt\n");
  assert.equal(st.regs[0], 10, "CMP 不应动 r0");
  assert.equal(st.regs[1], 20, "CMP 不应动 r1");
});

/* ------------------------------------------------------------------ *
 * 内存：STA / LDA，以及那条真正的 bug
 * ------------------------------------------------------------------ */

test("STA / LDA：存进去读得回来（mem 路径）", () => {
  const st = run("  ldi r2, 0x20\n  ldi r0, 123\n  st r0, [r2]\n  ld r1, [r2]\n  out r1\n  hlt\n");
  assert.equal(st.mem.get(0x20), 123, "写进 mem[0x20] 的应是 123");
  assert.deepEqual(st.output, [123], "读回来并输出应是 123");
});

test("LDA 的读取来源与调用路径无关（2026-10-04 修的真 bug）", () => {
  // 修复前：LDA 写成 `program ? program[addr] : takeWord(mem, addr)`，
  // 而 STA 永远写 mem。于是同一条程序的结果**取决于调用方有没有传 program**：
  //   runToHalt(state, program) → out = [0]      ❌ 存进去的读不回来
  //   runToHalt(state)          → out = [123]    ✅
  // 本仓头注释说这个解释器用于「差分验证」—— 拿一个读不回自己存储的解释器去
  // 比对电路实现，差分出来的差异分不清是电路错还是解释器错。
  const src = "  ldi r2, 0x20\n  ldi r0, 123\n  st r0, [r2]\n  ld r1, [r2]\n  out r1\n  hlt\n";
  const { mem, prog } = bothPaths(src);
  assert.deepEqual(prog.output, [123], "传 program 数组时也必须读得回自己写的值");
  assert.deepEqual(prog.output, mem.output, "两条调用路径必须给出同一个答案");
});

test("LDI 读立即数同样与调用路径无关（自改写代码段的情形）", () => {
  // 同一个不对称也存在于 LDI 的立即数读取：走 program 会拿到旧指令字。
  const src = "  ldi r2, 0x20\n  ldi r0, 7\n  st r0, [r2]\n  ldi r1, 99\n  ld r3, [r2]\n  out r3\n  hlt\n";
  const { mem, prog } = bothPaths(src);
  assert.deepEqual(prog.output, mem.output, "两条调用路径必须一致");
  assert.deepEqual(prog.output, [7]);
});

/* ------------------------------------------------------------------ *
 * 输出 / 输入
 * ------------------------------------------------------------------ */

test("OUT：按产生顺序累积到 output", () => {
  const st = run("  ldi r0, 5\n  out r0\n  ldi r0, 7\n  out r0\n  hlt\n");
  assert.deepEqual(st.output, [5, 7], "输出顺序必须与产生顺序一致");
});

test("IN：从输入队列取值，取完即出队", () => {
  const st = run("  in r0\n  out r0\n  in r1\n  out r1\n  hlt\n", [42, 43]);
  assert.deepEqual(st.output, [42, 43], "两次 IN 应依次取到 42、43");
  assert.deepEqual(st.input, [], "取完后输入队列应为空");
});

/* ------------------------------------------------------------------ *
 * 控制流
 * ------------------------------------------------------------------ */

test("JMP：跳转改变 PC，且无条件", () => {
  const st = run("  jmp skip\n  ldi r0, 1\nskip:\n  ldi r1, 2\n  hlt\n");
  assert.equal(st.regs[0], 0, "被跳过的那条不该执行");
  assert.equal(st.regs[1], 2);
});

test("JMP 是**无条件**的 —— Z16 没有条件跳转（ISA 事实，非实现缺陷）", () => {
  // 本条最初写成「循环：cmp 后 jmp，期望 r0 数到 4」，结果跑成死循环、
  // 由 runToHalt 的 maxSteps 兜住。查 ISA 才发现 OP 表里只有 JMP，
  // **没有任何条件分支**（CMP 只写标志，供电路侧的 COND 信号用）。
  // 所以「数到 4 就跳出」在 Z16 上根本写不出来 —— 这是 ISA 的事实，
  // 不是解释器没实现。此处改为把该事实钉住：
  const st = run("  jmp skip\n  ldi r0, 1\nskip:\n  ldi r1, 2\n  hlt\n");
  assert.equal(st.regs[0], 0, "被跳过的指令不该执行");
  assert.equal(st.regs[1], 2);
});

test("无条件 JMP 自环由 maxSteps 兜住，不会真的挂死", () => {
  // 唯一的循环形态就是自环；它必须被步数上限拦住并给出 fault，而不是无限跑。
  const words = asm("loop:\n  jmp loop\n");
  const st = newInterpreter();
  loadProgram(st, words);
  const steps = runToHalt(st, words, 500);
  assert.equal(steps.length, 500, "应正好返回上限那么多步");
  assert.equal(st.halted, false, "被上限打断时不该声称已停机");
  assert.ok(st.fault !== undefined, "被上限打断必须给 fault，不能静默停下");
});

test("CALL / RET：子程序返回后继续", () => {
  const st = run([
    "  call sub",
    "  ldi r3, 9",
    "  hlt",
    "sub:",
    "  ldi r2, 1",
    "  ret",
  ].join("\n") + "\n");
  assert.equal(st.regs[2], 1, "子程序该执行过");
  assert.equal(st.regs[3], 9, "返回后主流程该继续");
});

test("PUSH / POP：栈**向下生长**，且 SP 与程序映像重叠是真实隐患", () => {
  // 配对关系：PUSH 先自减再写；POP 先读当前 SP 再自增。修复前 POP 是
  // 「先自增再读」，与 PUSH 错开一格 —— 详见 src/cpu/interpreter.ts 里的修复注释。
  //
  // ⚠️ 剩下的陷阱：解释器初值 SP = 0，而 0 是**程序映像的首地址**。
  // 修好 POP 之后，SP=0 下两次往返仍能正确工作（压到 0xFFFF、0xFFFE 再读回），
  // 但**栈越深就越往程序区里踩**，最终覆盖代码字。所以栈深不应超过程序长度。
  //
  // ⚠️ 本条最初还有一条「SP 未初始化 ⇒ 弹出 0」的断言，那是在 POP 修好**之前**
  // 写的、用来固化 bug 现状的；修复后它立刻失效。**钉 bug 现状的断言必须
  // 跟着修复一起改掉**，否则会把正确的修复判成回归。
  const twice = run([
    "  ldi r0, 1", "  push r0",
    "  ldi r0, 2", "  push r0",
    "  ldi r0, 0", "  pop r1", "  out r1",
    "  pop r1", "  out r1",
    "  hlt",
  ].join("\n") + "\n");
  assert.deepEqual(twice.output, [2, 1], "SP=0 下两次往返仍是后进先出");
  assert.equal(twice.mem.get(0xffff), 1, "第一次压到 0xFFFF");
  assert.equal(twice.mem.get(0xfffe), 2, "第二次压到 0xFFFE（向下生长）");

  // 推荐用法：先初始化 SP 到程序之外
  const st = run("  ldi r6, 0x100\n  ldi r0, 55\n  push r0\n  ldi r0, 0\n  pop r1\n  out r1\n  hlt\n");
  assert.equal(st.regs[6], 0x100, "一次 push 一条 pop 后 SP 应回到原位");
  assert.equal(st.mem.get(0x0ff), 55, "递减栈：值落在 SP−1");
  assert.deepEqual(st.output, [55], "弹出的应是 55");
});

test("PUSH / POP 多次：后进先出", () => {
  const st = run([
    "  ldi r6, 0x100",
    "  ldi r0, 1",
    "  ldi r1, 2",
    "  ldi r2, 3",
    "  push r0",
    "  push r1",
    "  push r2",
    "  pop r3",
    "  out r3",
    "  pop r3",
    "  out r3",
    "  pop r3",
    "  out r3",
    "  hlt",
  ].join("\n") + "\n");
  assert.deepEqual(st.output, [3, 2, 1], "应后进先出");
  assert.equal(st.regs[6], 0x100, "三次 push 三次 pop 后 SP 回原位");
});

/* ------------------------------------------------------------------ *
 * 停机与单步
 * ------------------------------------------------------------------ */

test("HLT：置 halted，且不再前进", () => {
  const st = run("  ldi r0, 1\n  hlt\n  ldi r0, 2\n");
  assert.equal(st.halted, true);
  assert.equal(st.regs[0], 1, "HLT 之后的指令不该执行");
});

test("stepOnce：每次退一条，返回该拍的 retire 事件", () => {
  const words = asm("  ldi r0, 1\n  ldi r1, 2\n  hlt\n");
  const st = newInterpreter();
  loadProgram(st, words);
  const s1 = stepOnce(st);
  assert.equal(s1?.pc, 0, "第一条指令的地址是 0");
  assert.equal(s1?.a, 0, "LDI 的 A 字段应是 0");
  assert.equal(st.regs[0], 1);
  stepOnce(st);
  assert.equal(st.regs[1], 2);
  assert.equal(st.halted, false);
  const s3 = stepOnce(st);
  assert.equal(st.halted, true);
  assert.equal(s3?.pc, 4, "第三条指令（HLT）在地址 4");
});

test("retired 逐条累加到停机", () => {
  const st = run("  ldi r0, 1\n  ldi r1, 2\n  add r0, r1\n  hlt\n");
  assert.equal(st.retired, 4, "4 条指令应各计一次");
});

/* ------------------------------------------------------------------ *
 * 所有用例都必须满足的跨路径不变量
 * ------------------------------------------------------------------ */

test("不变量：以上每条程序，两种调用路径的 output 与寄存器完全一致", () => {
  const progs = [
    "  ldi r0, 5\n  out r0\n  hlt\n",
    "  ldi r2, 0x30\n  ldi r0, 9\n  st r0, [r2]\n  ld r1, [r2]\n  out r1\n  hlt\n",
    "  ldi r0, 1\nloop:\n  ldi r1, 1\n  add r0, r1\n  ldi r1, 3\n  cmp r0, r1\n  jmp loop\n  out r0\n  hlt\n",
    "  in r0\n  out r0\n  hlt\n",
  ];
  for (const src of progs) {
    const { mem, prog } = bothPaths(src, [7]);
    assert.deepEqual(prog.output, mem.output, `output 不一致：${src}`);
    assert.deepEqual([...prog.regs], [...mem.regs], `寄存器不一致：${src}`);
    assert.equal(prog.halted, mem.halted, `halted 不一致：${src}`);
    assert.equal(prog.retired, mem.retired, `retired 不一致：${src}`);
  }
});
