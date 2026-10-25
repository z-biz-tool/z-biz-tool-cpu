import type { Example } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 包一 · 门级与组合逻辑（16 个）
 * 这一包回答一个问题：**判断**是怎么从「与或非」长出来的。
 * 每个案例都可以单独放进画布、接上开关就跑，也都可以拆开改错。
 * ------------------------------------------------------------------ */

export const LOGIC: Example[] = [
  {
    id: "half-adder",
    name: "半加器",
    pack: "logic",
    tier: 1,
    blurb: "一位加一位：和是异或，进位是与。",
    why: "最小的一次「算术 = 逻辑」。全加器、加法器、ALU、整台 CPU 的进位链，都从这里开始。",
    ports: { a: "加数 A（1 位）", b: "加数 B（1 位）", sum: "本位和：两数不同为 1", cout: "进位：两数同为 1 时进 1" },
    src: `
      in a 1
      in b 1
      out sum 1
      out cout 1
      x = xor a b
      c = and a b
      sum <- x
      cout <- c
    `,
    model: ({ a, b }) => ({ sum: a ^ b, cout: a & b }),
    tags: ["算术起点", "2 元件"],
  },
  {
    id: "full-adder",
    name: "全加器",
    pack: "logic",
    tier: 1,
    blurb: "两个半加器加一个或门：能把低位进位也吃进来。",
    why: "只有全加器可以串联——把 N 个全加器的 cout 接进下一个 cin，就是 N 位加法器。这是「位宽」第一次变成可以复制的结构。",
    ports: {
      a: "被加数 A",
      b: "加数 B",
      ci: "低位送来的进位",
      sum: "本位和",
      cout: "向高位的进位",
    },
    src: `
      in a 1
      in b 1
      in ci 1
      out sum 1
      out cout 1
      x1 = xor a b
      x2 = xor x1 ci
      a1 = and a b
      a2 = and x1 ci
      o1 = or a1 a2
      sum <- x2
      cout <- o1
    `,
    model: ({ a, b, ci }) => ({ sum: (a + b + ci) & 1, cout: (a + b + ci) >> 1 }),
    tags: ["进位链", "6 元件"],
  },
  {
    id: "nand-not",
    name: "用与非门搭非门",
    pack: "logic",
    tier: 1,
    blurb: "把与非门的两个输入并在一起，它就变成了非门。",
    why: "万能门的第一次证明：只要有 NAND，你不需要任何别的门。芯片厂喜欢这句话，因为它意味着只需刻一种晶体管连接方式。",
    ports: { a: "输入", y: "取反后的输出" },
    src: `
      in a 1
      out y 1
      g = nand a a
      y <- g
    `,
    model: ({ a }) => ({ y: a ? 0 : 1 }),
    tags: ["万能门"],
  },
  {
    id: "mux2-gate",
    name: "门级二选一",
    pack: "logic",
    tier: 1,
    blurb: "sel=0 走 A，sel=1 走 B，全部由与或非搭出来。",
    why: "选择是 CPU 里出现最多的动作（写哪个寄存器、下一条指令在哪）。看清楚「选择 = 两个与门 + 一个或门」，后面看数据通路就不会发怵。",
    ports: { sel: "选择端：0 选 a，1 选 b", a: "0 路数据", b: "1 路数据", y: "选中的那一路" },
    src: `
      in sel 1
      in a 1
      in b 1
      out y 1
      ns = not sel
      na = and a ns
      nb = and b sel
      o = or na nb
      y <- o
    `,
    model: ({ sel, a, b }) => ({ y: sel ? b : a }),
    tags: ["数据通路", "4 元件"],
  },
  {
    id: "mux4-gate",
    name: "门级四选一",
    pack: "logic",
    tier: 2,
    blurb: "三个二选一串成四选一：选择端每多一位，通路就翻倍。",
    why: "这是「选择树」的雏形。8 选 1、32 选 1 的寄存器堆读取，都是这棵树继续长高。",
    ports: {
      s0: "选择端低位",
      s1: "选择端高位（s1s0 = 00→d0 … 11→d3）",
      d0: "第 0 路",
      d1: "第 1 路",
      d2: "第 2 路",
      d3: "第 3 路",
      y: "选中的一路",
    },
    src: `
      in s0 1
      in s1 1
      in d0 1
      in d1 1
      in d2 1
      in d3 1
      out y 1
      n0 = not s0
      a0 = and d0 n0
      a1 = and d1 s0
      m01 = or a0 a1
      a2 = and d2 n0
      a3 = and d3 s0
      m23 = or a2 a3
      n1 = not s1
      b0 = and m01 n1
      b1 = and m23 s1
      o = or b0 b1
      y <- o
    `,
    model: ({ s0, s1, d0, d1, d2, d3 }) => ({ y: [d0, d1, d2, d3][s0 + 2 * s1] }),
    tags: ["选择树"],
  },
  {
    id: "majority3",
    name: "三取二表决器",
    pack: "logic",
    tier: 2,
    blurb: "三个人投票，两人同意就通过——两两相与再或起来。",
    why: "冗余计算的入门题：同一条指令算三遍，取多数，就能屏蔽一次瞬时故障。航天器上的三模冗余就是这个电路乘以几万。",
    ports: { a: "表决人 A", b: "表决人 B", c: "表决人 C", y: "多数结果" },
    src: `
      in a 1
      in b 1
      in c 1
      out y 1
      ab = and a b
      bc = and b c
      ac = and a c
      o1 = or ab bc
      o2 = or o1 ac
      y <- o2
    `,
    model: ({ a, b, c }) => ({ y: a + b + c >= 2 ? 1 : 0 }),
    tags: ["容错"],
  },
  {
    id: "parity8",
    name: "8 位奇偶校验位",
    pack: "logic",
    tier: 2,
    blurb: "把 8 根线异或成 1 根：1 的个数是奇数就出 1。",
    why: "最便宜的错误检测。串口、内存 ECC、RAID 都从这里起步——代价只有 1 位，换来「一位翻转能被发现」。",
    ports: { a: "被校验的 8 位字", p: "奇偶位：a 中 1 的个数为奇数则 1" },
    src: `
      in a 8
      out p 1
      s = split a width=8
      x1 = xor s.b0 s.b1
      x2 = xor x1 s.b2
      x3 = xor x2 s.b3
      x4 = xor x3 s.b4
      x5 = xor x4 s.b5
      x6 = xor x5 s.b6
      x7 = xor x6 s.b7
      p <- x7
    `,
    model: ({ a }) => ({ p: [...Array(8)].reduce((n, _, i) => n ^ ((a >> i) & 1), 0) }),
    tags: ["校验", "拆位"],
  },
  {
    id: "eq1",
    name: "一位相等比较器",
    pack: "logic",
    tier: 1,
    blurb: "同或门：两位相同输出 1。",
    why: "相等判断是最基础的分支条件。CPU 的 beq 指令、字符串比较、缓存标签比对，第一块砖都是它。",
    ports: { a: "A", b: "B", eq: "a 与 b 相等时为 1" },
    src: `
      in a 1
      in b 1
      out eq 1
      x = xnor a b
      eq <- x
    `,
    model: ({ a, b }) => ({ eq: a === b ? 1 : 0 }),
    tags: ["比较"],
  },
  {
    id: "cmp2-gate",
    name: "两位比较器（门级）",
    pack: "logic",
    tier: 2,
    blurb: "先比高位，高位相等再比低位——三条输出 lt/eq/gt。",
    why: "比较器不是「一个元件」，而是一条优先级判断链。看清楚高位优先这件事，你就能自己写出 8 位、32 位版本。",
    ports: {
      a1: "A 的高位",
      a0: "A 的低位",
      b1: "B 的高位",
      b0: "B 的低位",
      lt: "A < B",
      eq: "A = B",
      gt: "A > B",
    },
    src: `
      in a1 1
      in a0 1
      in b1 1
      in b0 1
      out lt 1
      out eq 1
      out gt 1
      e1 = xnor a1 b1
      e0 = xnor a0 b0
      eqv = and e1 e0
      na1 = not a1
      ltHigh = and na1 b1
      na0 = not a0
      ltLow = and na0 b0
      ltBoth = and e1 ltLow
      ltAll = or ltHigh ltBoth
      nb1 = not b1
      gtHigh = and a1 nb1
      nb0 = not b0
      gtLow = and a0 nb0
      gtBoth = and e1 gtLow
      gtAll = or gtHigh gtBoth
      lt <- ltAll
      eq <- eqv
      gt <- gtAll
    `,
    model: ({ a1, a0, b1, b0 }) => {
      const a = a1 * 2 + a0;
      const b = b1 * 2 + b0;
      return { lt: a < b ? 1 : 0, eq: a === b ? 1 : 0, gt: a > b ? 1 : 0 };
    },
    tags: ["优先级", "15 元件"],
  },
  {
    id: "dec2to4",
    name: "2-4 译码器",
    pack: "logic",
    tier: 2,
    blurb: "两位地址变四根独热线：只有被选中的那根是 1。",
    why: "译码器是「地址 → 选中」的翻译官。寄存器堆的写使能、片选信号、七段数码管的位选，都是它在干活。",
    ports: { a: "两位选择码", o0: "a=00 时为 1", o1: "a=01 时为 1", o2: "a=10 时为 1", o3: "a=11 时为 1" },
    src: `
      in a 2
      out o0 1
      out o1 1
      out o2 1
      out o3 1
      d = demux a n=4
      o0 <- d.o0
      o1 <- d.o1
      o2 <- d.o2
      o3 <- d.o3
    `,
    model: ({ a }) => ({ o0: a === 0 ? 1 : 0, o1: a === 1 ? 1 : 0, o2: a === 2 ? 1 : 0, o3: a === 3 ? 1 : 0 }),
    tags: ["译码"],
  },
  {
    id: "enc4to2",
    name: "4-2 优先编码器",
    pack: "logic",
    tier: 2,
    blurb: "四根输入线按高序号优先，编成两位二进制 + 一个「有没有人按」。",
    why: "中断控制器就是这么工作的：8 个外设同时举手，先服务编号大的。valid 那一位是「真的有人按吗」——少了它，000 会被误当成有人在按。",
    ports: {
      i0: "输入 0（优先级最低）",
      i1: "输入 1",
      i2: "输入 2",
      i3: "输入 3（优先级最高）",
      y: "最高优先级输入对应的编号",
      v: "至少有一路输入为 1",
    },
    src: `
      in i0 1
      in i1 1
      in i2 1
      in i3 1
      out y 2
      out v 1
      y0 = or i1 i3
      y1 = or i2 i3
      any1 = or i0 i1
      any2 = or any1 i2
      any3 = or any2 i3
      m = merge y0 y1 width=2
      y <- m
      v <- any3
    `,
    cases: [
      { label: "无人按", set: { i0: 0, i1: 0, i2: 0, i3: 0 }, expect: { y: 0, v: 0 } },
      { label: "只有 i0", set: { i0: 1, i1: 0, i2: 0, i3: 0 }, expect: { y: 0, v: 1 } },
      { label: "只有 i1", set: { i0: 0, i1: 1, i2: 0, i3: 0 }, expect: { y: 1, v: 1 } },
      { label: "只有 i2", set: { i0: 0, i1: 0, i2: 1, i3: 0 }, expect: { y: 2, v: 1 } },
      { label: "只有 i3", set: { i0: 0, i1: 0, i2: 0, i3: 1 }, expect: { y: 3, v: 1 } },
      { label: "i1 与 i3 同时", set: { i0: 0, i1: 1, i2: 0, i3: 1 }, expect: { y: 3, v: 1 } },
    ],
    tags: ["中断", "优先"],
  },
  {
    id: "bin2gray",
    name: "二进制转格雷码",
    pack: "logic",
    tier: 2,
    blurb: "g = b 异或 (b 右移一位)：相邻两个码只差一位。",
    why: "格雷码解决「多个位同时翻转时的瞬时错值」。旋转编码器、异步 FIFO 的指针、卡诺图的行列顺序都靠它。",
    ports: { b: "4 位二进制码", g: "4 位格雷码" },
    src: `
      in b 4
      out g 4
      s = split b width=4
      g3 = buf s.b3
      g2 = xor s.b3 s.b2
      g1 = xor s.b2 s.b1
      g0 = xor s.b1 s.b0
      m = merge g0 g1 g2 g3 width=4
      g <- m
    `,
    model: ({ b }) => ({ g: (b ^ (b >> 1)) & 15 }),
    tags: ["编码"],
  },
  {
    id: "gray2bin",
    name: "格雷码转二进制",
    pack: "logic",
    tier: 2,
    blurb: "从高位往低位前缀异或：b3=g3，b2=b3⊕g2，一路下来。",
    why: "这是上一条的逆运算。会写正反两个方向，才算真的懂了一套编码——只会编码不会解码，是读不回来的数据。",
    ports: { g: "4 位格雷码", b: "还原出的 4 位二进制码" },
    src: `
      in g 4
      out b 4
      s = split g width=4
      b3 = buf s.b3
      b2 = xor b3 s.b2
      b1 = xor b2 s.b1
      b0 = xor b1 s.b0
      m = merge b0 b1 b2 b3 width=4
      b <- m
    `,
    model: ({ g }) => ({ b: (g ^ (g >> 1) ^ (g >> 2) ^ (g >> 3)) & 15 }),
    tags: ["编码", "逆运算"],
  },
  {
    id: "gate-suite3",
    name: "三输入门组",
    pack: "logic",
    tier: 1,
    blurb: "同三个输入，并排给出与、或、与非三种答案。",
    why: "把同一组输入接到三种门上，你会直观看到「门」不过是真值表的三种切法。元件参数的 inputs=3 也在这里第一次显形。",
    ports: { a: "输入 A", b: "输入 B", c: "输入 C", all3: "三个都为 1", any3: "至少一个为 1", notAll: "不是三个都为 1" },
    src: `
      in a 1
      in b 1
      in c 1
      out all3 1
      out any3 1
      out notAll 1
      g1 = and a b c
      g2 = or a b c
      g3 = nand a b c
      all3 <- g1
      any3 <- g2
      notAll <- g3
    `,
    model: ({ a, b, c }) => ({
      all3: a & b & c,
      any3: a | b | c,
      notAll: a & b & c ? 0 : 1,
    }),
    tags: ["真值表"],
  },
  {
    id: "xor4-tree",
    name: "四输入奇偶树",
    pack: "logic",
    tier: 1,
    blurb: "四个 1 位异或，两边分组再合并，深度只有 2。",
    why: "同样是四个数异或，串成一条链要 3 级延迟，做成树只要 2 级。这是「延迟 = 层数」这件事的最小例子。",
    ports: { a: "输入 A", b: "输入 B", c: "输入 C", d: "输入 D", p: "四个输入中 1 的个数为奇数" },
    src: `
      in a 1
      in b 1
      in c 1
      in d 1
      out p 1
      x1 = xor a b
      x2 = xor c d
      x3 = xor x1 x2
      p <- x3
    `,
    model: ({ a, b, c, d }) => ({ p: (a ^ b ^ c ^ d) & 1 }),
    tags: ["树形", "延迟"],
  },
  {
    id: "bitrev4",
    name: "4 位位序反转",
    pack: "logic",
    tier: 2,
    blurb: "拆开再倒着合回去：b0 和 b3 交换。",
    why: "FFT、CRC、串行收发里都要反转位序。它同时也是「split + merge 是一对互逆操作」最直白的演示。",
    ports: { a: "输入的 4 位", y: "位序反转后的 4 位" },
    src: `
      in a 4
      out y 4
      s = split a width=4
      m = merge s.b3 s.b2 s.b1 s.b0 width=4
      y <- m
    `,
    model: ({ a }) => ({ y: (((a & 1) << 3) | ((a >> 1) & 1) << 2 | ((a >> 2) & 1) << 1 | ((a >> 3) & 1)) & 15 }),
    tags: ["拆位", "总线"],
  },
];
