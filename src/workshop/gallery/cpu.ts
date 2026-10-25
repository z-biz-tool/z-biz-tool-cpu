import type { Example } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 包六 · CPU 部件（12 个）
 * 这一包把「一台处理器」拆成能单独把玩的零件：
 * PC、IR、标志、译码、立即数、跳转、栈指针、内部总线、节拍、停机。
 * ------------------------------------------------------------------ */

/** 微码表：opcode 0..15 → 8 位控制字（各 bit 的含义见 ports） */
const MICROCODE = [0x11, 0x22, 0x44, 0x88, 0x13, 0x25, 0x47, 0x89, 0x15, 0x2a, 0x54, 0xa8, 0x1f, 0x3f, 0x7f, 0xff];

export const CPU: Example[] = [
  {
    id: "pc8",
    name: "程序计数器",
    pack: "cpu",
    tier: 4,
    blurb: "每拍 +1；跳转时装载目标；复位时归零。",
    why: "PC 是「程序」这个概念在硬件里的唯一实体。它的三个优先级（复位 > 装载 > +1）就是指令流的全部控制语义。",
    ports: { clk: "时钟", ld: "装载跳转目标", din: "跳转目标地址", rst: "复位到 0（优先级最高）", pc: "当前指令地址" },
    src: `
      in clk 1
      in ld 1
      in din 8
      in rst 1
      out pc 8
      one = const width=8 value=1
      zero = const width=8 value=0
      inc = add pcr one
      n1 = mux ld inc.sum din
      n2 = mux rst n1 zero
      one1 = const width=1 value=1
      pcr = reg clk one1 n2 width=8
      pc <- pcr
    `,
    seq: [
      { set: { rst: 0, ld: 0 }, expect: { pc: 1 } },
      { expect: { pc: 2 } },
      { set: { ld: 1, din: 42 }, expect: { pc: 42 } },
      { set: { ld: 0 }, expect: { pc: 43 } },
      { set: { rst: 1 }, expect: { pc: 0 } },
      { set: { rst: 0 }, expect: { pc: 1 } },
    ],
    tags: ["取指", "控制语义"],
  },
  {
    id: "ir8",
    name: "指令寄存器",
    pack: "cpu",
    tier: 4,
    blurb: "把 ROM 里取出的那一条指令钉住一个周期。",
    why: "为什么需要 IR？因为存储器只有一个地址口，取完指令地址就要变了。把指令搬进 IR，译码器才能在整拍里稳定地看它。",
    ports: { clk: "时钟", ld: "装载（通常每拍都为 1）", din: "取出的指令字节", q: "当前指令" },
    src: `
      in clk 1
      in ld 1
      in din 8
      out q 8
      ir = reg clk ld din width=8
      q <- ir
    `,
    seq: [
      { set: { ld: 1, din: 0x3c }, expect: { q: 0x3c } },
      { set: { ld: 0, din: 0x99 }, expect: { q: 0x3c } },
      { set: { ld: 1, din: 0x99 }, expect: { q: 0x99 } },
    ],
    tags: ["取指", "指令"],
  },
  {
    id: "flags",
    name: "条件码寄存器",
    pack: "cpu",
    tier: 4,
    blurb: "把 ALU 这一拍算出的 Z/C/N 留住，供下一条指令判断。",
    why: "标志位是「上一拍的结果」被下一拍使用的唯一通道。它也是流水线里最难处理的东西之一——因为它让每一条指令都隐式依赖前一条。",
    ports: { clk: "时钟", ld: "锁存使能", z: "零标志输入", c: "进位标志输入", n: "符号标志输入", zf: "存住的零标志", cf: "存住的进位", nf: "存住的符号" },
    src: `
      in clk 1
      in ld 1
      in z 1
      in c 1
      in n 1
      out zf 1
      out cf 1
      out nf 1
      zr = reg clk ld z width=1
      cr = reg clk ld c width=1
      nr = reg clk ld n width=1
      zf <- zr
      cf <- cr
      nf <- nr
    `,
    seq: [
      { set: { ld: 1, z: 0, c: 1, n: 0 }, expect: { zf: 0, cf: 1, nf: 0 } },
      { set: { ld: 0, z: 1, c: 0, n: 1 }, expect: { zf: 0, cf: 1, nf: 0 } },
      { set: { ld: 1 }, expect: { zf: 1, cf: 0, nf: 1 } },
    ],
    tags: ["标志位", "条件分支"],
  },
  {
    id: "decoder",
    name: "指令译码器（微码 ROM）",
    pack: "cpu",
    tier: 4,
    blurb: "4 位 opcode 当地址，8 位控制字当数据。",
    why: "硬布线控制 vs 微码控制的分水岭就在这张表：改一条指令只需要改表里的一行，而不需要重新画电路。CISC 处理器几万条指令就是这么活下来的。",
    ports: { op: "操作码 0..15", ctrl: "控制字（各 bit 对应一个控制信号）" },
    src: `
      in op 4
      out ctrl 8
      r = rom op width=8 addrBits=4 data="0x11 0x22 0x44 0x88 0x13 0x25 0x47 0x89 0x15 0x2A 0x54 0xA8 0x1F 0x3F 0x7F 0xFF"
      ctrl <- r
    `,
    model: ({ op }) => ({ ctrl: MICROCODE[op] }),
    tags: ["微码", "控制"],
  },
  {
    id: "immext",
    name: "立即数符号扩展",
    pack: "cpu",
    tier: 4,
    blurb: "4 位立即数补成 8 位，负数要补 1 而不是 0。",
    why: "addi r1, r0, -1 里的 -1 是 4 位 0xF。扩成 8 位时若补 0，程序会加上 15 而不是减 1——这类 bug 在真实 ISA 里叫「符号扩展错误」，编译器测试套件专门抓它。",
    ports: { imm: "4 位立即数（补码）", y: "扩展后的 8 位" },
    src: `
      in imm 4
      out y 8
      s = split imm width=4
      m = merge s.b0 s.b1 s.b2 s.b3 s.b3 s.b3 s.b3 s.b3 width=8
      y <- m
    `,
    model: ({ imm }) => ({ y: (imm & 8 ? 0xf0 | imm : imm) & 0xff }),
    tags: ["立即数", "符号扩展"],
  },
  {
    id: "jumptarget",
    name: "跳转目标计算",
    pack: "cpu",
    tier: 4,
    blurb: "PC + 偏移 = 目标地址，一个加法器。",
    why: "相对跳转让代码可以整体搬家（位置无关）。它的代价就是一个加法器，收益是「同一份程序能装在任意地址」——动态库就是这么实现的。",
    ports: { pc: "当前地址", off: "8 位偏移（补码）", tgt: "跳转目标" },
    src: `
      in pc 8
      in off 8
      out tgt 8
      u = add pc off
      tgt <- u.sum
    `,
    model: ({ pc, off }) => ({ tgt: (pc + off) & 255 }),
    tags: ["跳转", "位置无关"],
  },
  {
    id: "sp8",
    name: "栈指针",
    pack: "cpu",
    tier: 4,
    blurb: "push 加一、pop 减一、其余保持。",
    why: "SP 是唯一「由程序自己维护」的寄存器，也是函数调用约定里最容易出错的一个。它的三个动作就是一个三选一多路选择器。",
    ports: { clk: "时钟", push: "压栈（SP+1）", pop: "出栈（SP-1）", sp: "当前栈指针" },
    src: `
      in clk 1
      in push 1
      in pop 1
      out sp 8
      one = const width=8 value=1
      inc = add spr one
      dec = sub spr one
      t1 = mux push spr inc.sum
      dn = mux pop t1 dec.diff
      load = or push pop
      spr = reg clk load dn width=8
      sp <- spr
    `,
    seq: [
      { set: { push: 1, pop: 0 }, expect: { sp: 1 } },
      { set: { push: 1 }, expect: { sp: 2 } },
      { set: { push: 0, pop: 1 }, expect: { sp: 1 } },
      { set: { push: 0, pop: 0 }, expect: { sp: 1 } },
      { set: { pop: 1 }, expect: { sp: 0 } },
    ],
    tags: ["栈", "调用约定"],
  },
  {
    id: "busmux",
    name: "内部总线多路",
    pack: "cpu",
    tier: 4,
    blurb: "同一根 8 位总线，这一拍是谁的数据：ALU？内存？立即数？PC？",
    why: "单总线 CPU 的全部时序就是在抢这一根线。多一个数据源，就多一位选择码、多一个时序冲突要避免。",
    ports: { sel: "00 ALU / 01 内存 / 10 立即数 / 11 PC", alu: "ALU 输出", mem: "内存读出", imm: "立即数", pc: "PC 值", d: "上总线的数据" },
    src: `
      in sel 2
      in alu 8
      in mem 8
      in imm 8
      in pc 8
      out d 8
      m = mux sel alu mem imm pc
      d <- m
    `,
    model: ({ sel, alu, mem, imm, pc }) => ({ d: [alu, mem, imm, pc][sel & 3] }),
    tags: ["总线", "单总线"],
  },
  {
    id: "clkdiv",
    name: "时钟分频（8 位）",
    pack: "cpu",
    tier: 3,
    blurb: "8 位计数器取最高位：256 个时钟周期才走一格。",
    why: "把一个 100MHz 的时钟变成肉眼可见的 0.4Hz——这是「慢下来调试」的物理实现，也是所有定时器的第一级。",
    ports: { clk: "输入时钟", slow: "分频后的慢时钟（最高位）" },
    src: `
      in clk 1
      out slow 1
      one = const width=1 value=1
      zero = const width=1 value=0
      c = counter clk one zero width=8
      s = split c.out width=8
      slow <- s.b7
    `,
    seq: (() => {
      let c = 0;
      const out = [];
      for (let i = 0; i < 6; i++) {
        c = (c + 1) & 255;
        out.push({ expect: { slow: (c >> 7) & 1 } });
      }
      return out;
    })(),
    tags: ["分频", "定时"],
  },
  {
    id: "intctrl",
    name: "中断控制器",
    pack: "cpu",
    tier: 4,
    blurb: "四路中断同时来，先报编号小的那一路，并给出中断号。",
    why: "中断是 CPU 唯一「愿意被动打断自己」的机制。优先级 + 向量号这两件事决定了系统的响应性——实时系统里调错一个优先级，就会出现「低优先级任务饿死」。",
    ports: { i0: "中断源 0（最高）", i1: "中断源 1", i2: "中断源 2", i3: "中断源 3", irq: "有中断待处理", vec: "中断号（最高优先级那一路）" },
    src: `
      in i0 1
      in i1 1
      in i2 1
      in i3 1
      out irq 1
      out vec 2
      n0 = not i0
      n1 = not i1
      n2 = not i2
      g1 = and i1 n0
      g2 = and i2 n0 n1
      g3 = and i3 n0 n1 n2
      v0 = or g1 g3
      v1 = or g2 g3
      m = merge v0 v1 width=2
      o = or i0 i1 i2 i3
      irq <- o
      vec <- m
    `,
    cases: (() => {
      const out: { label: string; set: Record<string, number>; expect: Record<string, number> }[] = [];
      for (let v = 0; v < 16; v++) {
        const r = [v & 1, (v >> 1) & 1, (v >> 2) & 1, (v >> 3) & 1];
        const first = r.findIndex((x) => x === 1);
        out.push({
          label: `源 ${r.join("")}`,
          set: { i0: r[0], i1: r[1], i2: r[2], i3: r[3] },
          expect: { irq: first >= 0 ? 1 : 0, vec: first < 0 ? 0 : first },
        });
      }
      return out;
    })(),
    tags: ["中断", "优先级"],
  },
  {
    id: "microseq",
    name: "节拍发生器 T0–T3",
    pack: "cpu",
    tier: 4,
    blurb: "一条指令分成四个节拍，一根线代表一拍。",
    why: "微程序控制的核心就是「第几拍做什么」。T0 取指、T1 译码、T2 执行、T3 写回——把时间编成一组独热线，控制信号就是这些线与条件码的组合。",
    ports: { clk: "时钟", rst: "回到 T0", t0: "第 0 拍", t1: "第 1 拍", t2: "第 2 拍", t3: "第 3 拍" },
    src: `
      in clk 1
      in rst 1
      out t0 1
      out t1 1
      out t2 1
      out t3 1
      one = const width=1 value=1
      c = counter clk one rst width=2
      d = demux c.out n=4
      t0 <- d.o0
      t1 <- d.o1
      t2 <- d.o2
      t3 <- d.o3
    `,
    seq: [
      { set: { rst: 1 }, expect: { t0: 1, t1: 0, t2: 0, t3: 0 } },
      { set: { rst: 0 }, expect: { t0: 0, t1: 1, t2: 0, t3: 0 } },
      { expect: { t0: 0, t1: 0, t2: 1, t3: 0 } },
      { expect: { t0: 0, t1: 0, t2: 0, t3: 1 } },
      { expect: { t0: 1, t1: 0, t2: 0, t3: 0 } },
      { set: { rst: 1 }, expect: { t0: 1, t1: 0, t2: 0, t3: 0 } },
    ],
    tags: ["微程序", "节拍"],
  },
  {
    id: "halt-latch",
    name: "停机锁存",
    pack: "cpu",
    tier: 4,
    blurb: "HALT 指令被译出来之后，把时钟使能拉低并一直保持。",
    why: "「停机」不是断电，而是不再给时钟。这个 3 元件的小电路解释了一个大问题：为什么有些 CPU 停机后还能被中断唤醒——因为唤醒它的不是时钟，而是另一条复位/中断路径。",
    ports: { clk: "时钟", halt: "译码出的停机信号（1 拍即可）", run: "0 = 已停机" },
    src: `
      in clk 1
      in halt 1
      out run 1
      hs = or h halt
      h = dff clk hs
      nr = not h
      run <- nr
    `,
    seq: [
      { set: { halt: 0 }, expect: { run: 1 } },
      { set: { halt: 1 }, expect: { run: 0 } },
      { set: { halt: 0 }, expect: { run: 0 } },
      { set: { halt: 0 }, expect: { run: 0 } },
    ],
    tags: ["停机", "时钟使能"],
  },
];
