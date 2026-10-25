import type { Example, SeqStep } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 包八 · 整机与数据通路（4 个）
 *
 * 前 96 个案例都是零件。这一包把它们接起来跑：
 * 从「寄存器 + ALU」的最小数据通路，到一台能执行 3 条指令的迷你 CPU。
 * ------------------------------------------------------------------ */

/** 迷你 CPU 的指令存储器内容：ADD 1 / ADD 2 / ADD 3 / HALT */
const PROGRAM = [0x01, 0x02, 0x03, 0x80, 0x00, 0x00, 0x00, 0x00];

/** 迷你 CPU 的规格模型：每拍取指、累加、翻译停机位 */
const MINI_CPU_SCRIPT: SeqStep[] = (() => {
  let pc = 0;
  let acc = 0;
  let ir = 0;
  let halted = 0;
  const out: SeqStep[] = [];
  for (let i = 0; i < 8; i++) {
    const en = halted ? 0 : 1;
    if (en) acc = (acc + (ir & 0x7f)) & 0xff;
    halted = halted | ((ir >> 7) & 1);
    ir = PROGRAM[pc];
    if (en) pc = (pc + 1) & 7;
    out.push({ expect: { acc, pc, halted } });
  }
  return out;
})();

export const MACHINE: Example[] = [
  {
    id: "datapath",
    name: "单周期数据通路",
    pack: "machine",
    tier: 4,
    blurb: "两个寄存器喂一个 ALU，结果直接出线——一拍算完。",
    why: "这是「处理器」的骨架图去掉控制逻辑之后剩下的部分。看清楚数据怎么从寄存器流进 ALU 再流出来，你就能自己往里加流水线寄存器，看延迟怎么被切成段。",
    ports: { clk: "时钟", ld: "装载 A/B", a_in: "A 的输入", b_in: "B 的输入", op: "ALU 操作码（0 加 1 减 2 与 3 或 4 异或 5 非 6 左移 7 右移）", y: "ALU 结果" },
    src: `
      in clk 1
      in ld 1
      in a_in 8
      in b_in 8
      in op 3
      out y 8
      ra = reg clk ld a_in width=8
      rb = reg clk ld b_in width=8
      u = alu ra rb op
      y <- u.out
    `,
    seq: [
      { set: { ld: 1, a_in: 5, b_in: 3, op: 0 }, expect: { y: 8 } },
      { set: { ld: 0, op: 1 }, expect: { y: 2 } },
      { set: { ld: 0, op: 2 }, expect: { y: 1 } },
      { set: { ld: 0, op: 4 }, expect: { y: 6 } },
      { set: { ld: 1, a_in: 100, b_in: 0, op: 0 }, expect: { y: 100 } },
    ],
    tags: ["数据通路", "ALU"],
  },
  {
    id: "accumulator",
    name: "累加器机",
    pack: "machine",
    tier: 4,
    blurb: "每拍 acc = acc + imm：一条指令就是一台计算机。",
    why: "最早的计算机（EDSAC 那一代）只有一个累加器。它证明了一件事：只要有一个能加法的寄存器加一个能取指的顺序，就足以算出任何可计算的东西。",
    ports: { clk: "时钟", en: "累加使能", imm: "加数", acc: "累加结果" },
    src: `
      in clk 1
      in en 1
      in imm 8
      out acc 8
      u = add accr imm
      nxt = mux en accr u.sum
      one = const width=1 value=1
      accr = reg clk one nxt width=8
      acc <- accr
    `,
    seq: [
      { set: { en: 1, imm: 5 }, expect: { acc: 5 } },
      { set: { en: 1, imm: 3 }, expect: { acc: 8 } },
      { set: { en: 0, imm: 100 }, expect: { acc: 8 } },
      { set: { en: 1, imm: 2 }, expect: { acc: 10 } },
      { set: { en: 1, imm: 250 }, expect: { acc: 4 } },
    ],
    tags: ["单累加器", "历史"],
  },
  {
    id: "counter-machine",
    name: "计数器机（数到 N 就停）",
    pack: "machine",
    tier: 4,
    blurb: "自增到 N 之后保持不动，并给出 done 标志。",
    why: "这就是「循环」在硬件里的样子：比较 + 条件装载。软件里的 for 循环被编译器展开之后，控制流剩下的就是这套自增、比较、分支的组合。",
    ports: { clk: "时钟", n: "目标值", cnt: "当前计数", done: "已经数到 N" },
    src: `
      in clk 1
      in n 8
      out cnt 8
      out done 1
      one = const width=8 value=1
      u = add cntr one
      c = cmp cntr n
      nxt = mux c.eq u.sum cntr
      one1 = const width=1 value=1
      cntr = reg clk one1 nxt width=8
      cnt <- cntr
      done <- c.eq
    `,
    seq: [
      { set: { n: 3 }, expect: { cnt: 1, done: 0 } },
      { expect: { cnt: 2, done: 0 } },
      { expect: { cnt: 3, done: 1 } },
      { expect: { cnt: 3, done: 1 } },
      { set: { n: 1 }, expect: { cnt: 4, done: 0 } },
    ],
    tags: ["循环", "条件装载"],
  },
  {
    id: "mini-cpu",
    name: "迷你 CPU（真的跑一段程序）",
    pack: "machine",
    tier: 4,
    blurb: "ROM 存程序、PC 取指、IR 锁指令、累加器执行、HALT 停机。",
    why: "这台机器只有 5 个零件，却能执行「1+2+3 然后停机」——它把前面 96 个案例全部串了起来：ROM 是存储、PC 是计数器、IR 是寄存器、累加是加法器、HALT 是锁存。看懂它，你就看懂了什么叫「存储程序」。",
    ports: {
      clk: "时钟",
      rst: "复位（PC 归零）",
      acc: "累加器（这就是这台机器的全部状态）",
      pc: "程序计数器",
      halted: "已经执行到 HALT",
    },
    src: `
      in clk 1
      in rst 1
      out acc 8
      out pc 3
      out halted 1
      prog = rom pcr width=8 addrBits=3 data="0x01 0x02 0x03 0x80 0x00 0x00 0x00 0x00"
      one1 = const width=1 value=1
      pcr = counter clk en rst width=3
      ir = reg clk one1 prog width=8
      si = split ir width=8
      let haltb = si.b7
      imm = merge si.b0 si.b1 si.b2 si.b3 si.b4 si.b5 si.b6 width=7
      hs = or haltb h
      h = dff clk hs
      nen = not h
      let en = nen
      sum = add accr imm
      accr = reg clk nen sum width=8
      acc <- accr
      pc <- pcr
      halted <- h
    `,
    seq: MINI_CPU_SCRIPT,
    tags: ["存储程序", "整机", "27 元件"],
  },
];
