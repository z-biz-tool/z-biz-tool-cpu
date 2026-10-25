import type { Example } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 包二 · 算术与数据转换（20 个）
 * 这一包是「算得对」的那一层：加、减、乘、除、比、饱和、BCD、查表。
 * 全部是无符号/补码两种口径都写得清楚的电路，模型对拍逐值比。
 * ------------------------------------------------------------------ */

/** BCD 加法校正的全部合法输入（0..9 各取一位，共 100 组） */
const BCD_CASES = (() => {
  const out: { label: string; set: Record<string, number>; expect: Record<string, number> }[] = [];
  for (let a = 0; a <= 9; a++) {
    for (let b = 0; b <= 9; b++) {
      out.push({
        label: `${a}+${b}`,
        set: { a, b },
        expect: { y: (a + b) % 10, carry: a + b >= 10 ? 1 : 0 },
      });
    }
  }
  return out;
})();

/** 七段码：段序 a b c d e f g，低位在前 */
const SEG_TABLE = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

const signed8 = (v: number) => (v & 0x80 ? v - 256 : v);

export const ARITH: Example[] = [
  {
    id: "add4c",
    name: "4 位加法器（带进位入出）",
    pack: "arith",
    tier: 2,
    blurb: "4 位相加，ci 吃低位进位，co 把溢出交给高一片。",
    why: "单个加法器只有把它级联起来才有意义。看清楚 ci/co 这一对接口，你就能拼出 8 位、32 位——位宽是可以「串」出来的，不是天生就有的。",
    ports: { a: "被加数（4 位）", b: "加数（4 位）", ci: "低位进位", s: "和（4 位）", co: "向高位的进位" },
    src: `
      in a 4
      in b 4
      in ci 1
      out s 4
      out co 1
      u = add a b ci
      s <- u.sum
      co <- u.cout
    `,
    model: ({ a, b, ci }) => ({ s: (a + b + ci) & 15, co: (a + b + ci) >> 4 }),
    tags: ["进位链"],
  },
  {
    id: "add8",
    name: "8 位行波加法器",
    pack: "arith",
    tier: 2,
    blurb: "两片 4 位加法器首尾相接：低片的进位喂给高片。",
    why: "这是「用窄元件搭宽数据通路」的标准动作：拆开、两半各算、再合回去。后面 32 位寄存器、64 位地址，全是这个套路叠出来的。",
    ports: { a: "被加数（8 位）", b: "加数（8 位）", s: "和（8 位）", co: "最高位进位" },
    src: `
      in a 8
      in b 8
      out s 8
      out co 1
      sa = split a width=8
      sb = split b width=8
      al = merge sa.b0 sa.b1 sa.b2 sa.b3 width=4
      ah = merge sa.b4 sa.b5 sa.b6 sa.b7 width=4
      bl = merge sb.b0 sb.b1 sb.b2 sb.b3 width=4
      bh = merge sb.b4 sb.b5 sb.b6 sb.b7 width=4
      lo = add al bl
      hi = add ah bh lo.cout
      sl = split lo.sum width=4
      sh = split hi.sum width=4
      m = merge sl.b0 sl.b1 sl.b2 sl.b3 sh.b0 sh.b1 sh.b2 sh.b3 width=8
      s <- m
      co <- hi.cout
    `,
    model: ({ a, b }) => ({ s: (a + b) & 255, co: (a + b) >> 8 }),
    tags: ["位宽拼装", "16 元件"],
  },
  {
    id: "sub4",
    name: "4 位减法器",
    pack: "arith",
    tier: 2,
    blurb: "差与借位一起出：借位是「不够减」的那面旗。",
    why: "有了借位，你就能做比较（a<b 就是借位=1）、能做补码减法、能做多字节大数减法。减法和比较其实是同一个电路。",
    ports: { a: "被减数", b: "减数", d: "差（4 位）", br: "借位：a < b 时为 1" },
    src: `
      in a 4
      in b 4
      out d 4
      out br 1
      u = sub a b
      d <- u.diff
      br <- u.borrow
    `,
    model: ({ a, b }) => ({ d: (a - b) & 15, br: a < b ? 1 : 0 }),
    tags: ["补码"],
  },
  {
    id: "addsub8",
    name: "加减一体（sub 控制）",
    pack: "arith",
    tier: 2,
    blurb: "一个控制位决定加还是减：减法 = 加补码。",
    why: "CPU 的 ALU 里只造一个加法器，减法靠「取反 + 进位入 1」借道。这个案例就是那句「减法即加法」的电路版，接上 sub 位就能亲眼看到进位方向反过来。",
    ports: {
      a: "左操作数",
      b: "右操作数",
      sub: "0 = 加，1 = 减",
      y: "结果（8 位）",
      co: "加减后的进位/无借位标志",
    },
    src: `
      in a 8
      in b 8
      in sub 1
      out y 8
      out co 1
      nb = not b
      bx = mux sub b nb
      u = add a bx sub
      y <- u.sum
      co <- u.cout
    `,
    model: ({ a, b, sub }) => ({
      y: sub ? (a - b) & 255 : (a + b) & 255,
      co: sub ? (a >= b ? 1 : 0) : (a + b) >> 8,
    }),
    tags: ["ALU 雏形"],
  },
  {
    id: "inc8",
    name: "8 位增量器",
    pack: "arith",
    tier: 2,
    blurb: "a + 1，顺带给出溢出位。",
    why: "程序计数器每拍就做这一件事。把它单独拎出来，你会看到 PC 的门数其实极少——难的是它背后的时序，而不是加法。",
    ports: { a: "输入值", y: "a + 1", co: "从 0xFF 加到 0 时的进位" },
    src: `
      in a 8
      out y 8
      out co 1
      one = const width=8 value=1
      u = add a one
      y <- u.sum
      co <- u.cout
    `,
    model: ({ a }) => ({ y: (a + 1) & 255, co: a === 255 ? 1 : 0 }),
    tags: ["PC"],
  },
  {
    id: "neg8",
    name: "8 位取负（补码）",
    pack: "arith",
    tier: 2,
    blurb: "取反加一：把 a 变成 -a。",
    why: "补码的核心恒等式。注意 0x80 取负还是 0x80——这不是 bug，是补码表示范围不对称的必然结果，能解释它的人就看懂了有符号数的边界。",
    ports: { a: "输入值", y: "-a 的补码表示" },
    src: `
      in a 8
      out y 8
      nb = not a
      one = const width=8 value=1
      u = add nb one
      y <- u.sum
    `,
    model: ({ a }) => ({ y: (-a) & 255 }),
    tags: ["补码"],
  },
  {
    id: "abs8",
    name: "8 位绝对值",
    pack: "arith",
    tier: 2,
    blurb: "看符号位：负就取负，正就直通。",
    why: "一个 mux 加一个取负器就能算绝对值，这是「用符号位做数据选择」的第一个真实用途。它也解释了为什么 0x80 的绝对值还是 0x80。",
    ports: { a: "8 位有符号数", y: "绝对值", neg: "输入是否为负" },
    src: `
      in a 8
      out y 8
      out neg 1
      sa = split a width=8
      nb = not a
      one = const width=8 value=1
      u = add nb one
      o = mux sa.b7 a u.sum
      y <- o
      neg <- sa.b7
    `,
    model: ({ a }) => ({ y: Math.abs(signed8(a)) & 255, neg: a & 0x80 ? 1 : 0 }),
    tags: ["符号位"],
  },
  {
    id: "mul10",
    name: "乘 10（移位加）",
    pack: "arith",
    tier: 2,
    blurb: "x*10 = x<<3 + x<<1，一个加法器就够。",
    why: "编译器天天干这件事：把「乘常数」翻译成移位和加。看懂它，你就知道为什么常数乘法比变量乘法快一个数量级。",
    ports: { a: "输入值", y: "(a × 10) 的低 8 位" },
    src: `
      in a 8
      out y 8
      k1 = const width=5 value=1
      k3 = const width=5 value=3
      s1 = shift a k1 dir=left
      s3 = shift a k3 dir=left
      u = add s1 s3
      y <- u.sum
    `,
    model: ({ a }) => ({ y: (a * 10) & 255 }),
    tags: ["强度削减"],
  },
  {
    id: "mul4x4",
    name: "4×4 乘法器（移位加）",
    pack: "arith",
    tier: 3,
    blurb: "四个部分积，按位权错开，再用加法器摞起来。",
    why: "乘法器不是魔法：b 的每一位决定「要不要把 a 加进来」，加的位置由位权决定。真实芯片用的是华莱士树，但结构思想与这里一模一样。",
    ports: { a: "被乘数（4 位）", b: "乘数（4 位）", p: "积（8 位）" },
    src: `
      in a 4
      in b 4
      out p 8
      sa = split a width=4
      sb = split b width=4
      z8 = const width=8 value=0
      z1 = const width=1 value=0
      ax = merge sa.b0 sa.b1 sa.b2 sa.b3 z1 z1 z1 z1 width=8
      t0 = mux sb.b0 z8 ax
      t1 = mux sb.b1 z8 ax
      t2 = mux sb.b2 z8 ax
      t3 = mux sb.b3 z8 ax
      k0 = const width=5 value=0
      k1 = const width=5 value=1
      k2 = const width=5 value=2
      k3 = const width=5 value=3
      q0 = shift t0 k0 dir=left
      q1 = shift t1 k1 dir=left
      q2 = shift t2 k2 dir=left
      q3 = shift t3 k3 dir=left
      u1 = add q0 q1
      u2 = add u1.sum q2
      u3 = add u2.sum q3
      p <- u3.sum
    `,
    model: ({ a, b }) => ({ p: (a * b) & 255 }),
    tags: ["部分积", "24 元件"],
  },
  {
    id: "div2",
    name: "除 2：商与余数",
    pack: "arith",
    tier: 2,
    blurb: "右移一位得商，被移出去的那一位就是余数。",
    why: "除数是 2 的幂时，除法退化成移位的取舍问题：商在线上，余数在被丢掉的那一位。CPU 的除法指令要为「余数去哪」专门留一个寄存器。",
    ports: { a: "被除数", q: "商（a >> 1）", r: "余数（a 的最低位）" },
    src: `
      in a 8
      out q 8
      out r 1
      one = const width=5 value=1
      sh = shift a one dir=right
      sa = split a width=8
      q <- sh
      r <- sa.b0
    `,
    model: ({ a }) => ({ q: a >> 1, r: a & 1 }),
    tags: ["移位即乘除"],
  },
  {
    id: "min8",
    name: "8 位最小值",
    pack: "arith",
    tier: 2,
    blurb: "比较 + 选择：a<b 就取 a。",
    why: "min/max 是向量化、图像、排序网络里出现最频繁的两个算子。它的电路只有两级，但把它串成一棵树，就能一条拍里求出 8 个数的最小值。",
    ports: { a: "A", b: "B", y: "较小者" },
    src: `
      in a 8
      in b 8
      out y 8
      c = cmp a b
      o = mux c.lt b a
      y <- o
    `,
    model: ({ a, b }) => ({ y: Math.min(a, b) }),
    tags: ["比较 + 选择"],
  },
  {
    id: "max8",
    name: "8 位最大值",
    pack: "arith",
    tier: 2,
    blurb: "比较 + 选择：a>b 就取 a。",
    why: "与 min 只差一根线的接法，但它是「归约树」的另一半：求最大值时，同一棵比较树可以同时算出最小值，代价是每个节点多一个 mux。",
    ports: { a: "A", b: "B", y: "较大者" },
    src: `
      in a 8
      in b 8
      out y 8
      c = cmp a b
      o = mux c.gt b a
      y <- o
    `,
    model: ({ a, b }) => ({ y: Math.max(a, b) }),
    tags: ["比较 + 选择"],
  },
  {
    id: "avg8",
    name: "平均而不溢出",
    pack: "arith",
    tier: 2,
    blurb: "(a&b) + ((a^b)>>1)：先取公共位，再折半余量。",
    why: "直接 (a+b)/2 会在 a、b 都很大时溢出。教科书那个「取平均」写法为什么要拆成 and/xor，这个案例能让你亲手算出来。",
    ports: { a: "A", b: "B", y: "(a + b) / 2 向下取整" },
    src: `
      in a 8
      in b 8
      out y 8
      an = and a b
      xo = xor a b
      one = const width=5 value=1
      sh = shift xo one dir=right
      u = add an sh
      y <- u.sum
    `,
    model: ({ a, b }) => ({ y: (a + b) >> 1 }),
    tags: ["防溢出", "位运算技巧"],
  },
  {
    id: "satadd8",
    name: "饱和加法",
    pack: "arith",
    tier: 2,
    blurb: "加到 255 就不再涨，溢出位单独报出来。",
    why: "图像处理、音频处理、DSP 全在用它：宁可削顶，也不要绕回 0 造成刺耳噪声或黑点。这是「错误处理可以是电路的一部分」的例子。",
    ports: { a: "A", b: "B", y: "饱和后的和（上限 255）", sat: "发生饱和时为 1" },
    src: `
      in a 8
      in b 8
      out y 8
      out sat 1
      u = add a b
      cap = const width=8 value=255
      o = mux u.cout u.sum cap
      y <- o
      sat <- u.cout
    `,
    model: ({ a, b }) => ({ y: Math.min(a + b, 255), sat: a + b > 255 ? 1 : 0 }),
    tags: ["饱和", "DSP"],
  },
  {
    id: "bcdadd",
    name: "BCD 加法与校正",
    pack: "arith",
    tier: 3,
    blurb: "两个十进制数字相加，超过 9 就加 6 校正、并进位。",
    why: "为什么电子表、收银机里要专门有 BCD 电路？因为 0.1 这样的十进制小数二进制存不准。这个案例把「+6 校正」这条规则变成电路，100 组输入全部验过。",
    ports: { a: "BCD 数字 A（0..9）", b: "BCD 数字 B（0..9）", y: "和的个位（0..9）", carry: "十进制进位" },
    src: `
      in a 4
      in b 4
      out y 4
      out carry 1
      u = add a b
      ten = const width=4 value=10
      c = cmp u.sum ten
      ge = or c.gt c.eq
      big = or ge u.cout
      six = const width=4 value=6
      cor = add u.sum six
      o = mux big u.sum cor.sum
      y <- o
      carry <- big
    `,
    cases: BCD_CASES,
    tags: ["BCD", "100 组穷举"],
  },
  {
    id: "cmp8s",
    name: "8 位有符号比较器",
    pack: "arith",
    tier: 2,
    blurb: "同一串位，按有符号解释：0xFF 是 -1，不是 255。",
    why: "同一个比较器，signed 一开一关，答案在 0x80 附近完全相反。这是「位的含义来自解释，而不是来自线」最锋利的一课。",
    ports: { a: "A（补码）", b: "B（补码）", lt: "A < B", eq: "A = B", gt: "A > B" },
    src: `
      in a 8
      in b 8
      out lt 1
      out eq 1
      out gt 1
      c = cmp a b signed=true
      lt <- c.lt
      eq <- c.eq
      gt <- c.gt
    `,
    model: ({ a, b }) => {
      const x = signed8(a);
      const y = signed8(b);
      return { lt: x < y ? 1 : 0, eq: x === y ? 1 : 0, gt: x > y ? 1 : 0 };
    },
    tags: ["补码"],
  },
  {
    id: "alu4op",
    name: "4 操作 ALU",
    pack: "arith",
    tier: 3,
    blurb: "加/减/与/或四条路并排算，op 两位选一条出去。",
    why: "真实 ALU 就是「所有运算并行算出来，再由选择器挑一个」。并行的浪费换来一拍出结果——这个取舍是处理器设计里最经典的一笔。",
    ports: { a: "左操作数", b: "右操作数", op: "00 加 / 01 减 / 10 与 / 11 或", y: "结果", z: "结果为零标志" },
    src: `
      in a 8
      in b 8
      in op 2
      out y 8
      out z 1
      u1 = add a b
      u2 = sub a b
      u3 = and a b
      u4 = or a b
      m = mux op u1.sum u2.diff u3 u4
      zero = const width=8 value=0
      c = cmp m zero
      y <- m
      z <- c.eq
    `,
    model: ({ a, b, op }) => {
      const v = op === 0 ? a + b : op === 1 ? a - b : op === 2 ? a & b : a | b;
      return { y: v & 255, z: (v & 255) === 0 ? 1 : 0 };
    },
    tags: ["ALU", "并行计算"],
  },
  {
    id: "sqtable",
    name: "平方表（ROM 查表）",
    pack: "arith",
    tier: 3,
    blurb: "把 16 个平方数烧进 ROM：查表比乘法快得多。",
    why: "查表是「用存储换时间」的原型。着色器里的 LUT、神经网络里的查表量化、三角函数表，都是这一个动作的放大版。",
    ports: { a: "输入 0..15", y: "a 的平方（8 位）" },
    src: `
      in a 4
      out y 8
      r = rom a width=8 addrBits=4 data="0 1 4 9 16 25 36 49 64 81 100 121 144 169 196 225"
      y <- r
    `,
    model: ({ a }) => ({ y: a * a }),
    tags: ["查表", "ROM"],
  },
  {
    id: "sevenseg",
    name: "七段数码管译码",
    pack: "arith",
    tier: 2,
    blurb: "4 位二进制进去，7 段亮灭出来——一张表就够。",
    why: "每一位对应一根线，看起来是纯查表，但它是「人能读懂电平」的第一步。把 7 根线接上真实数码管，你就有了一个能显示数字的机器。",
    ports: { d: "输入数字 0..15", seg: "七段码：a b c d e f g，低位在前" },
    src: `
      in d 4
      out seg 7
      r = rom d width=7 addrBits=4 data="0x3F 0x06 0x5B 0x4F 0x66 0x6D 0x7D 0x07 0x7F 0x6F 0x77 0x7C 0x39 0x5E 0x79 0x71"
      seg <- r
    `,
    model: ({ d }) => ({ seg: SEG_TABLE[d] }),
    tags: ["显示", "查表"],
  },
  {
    id: "clamp8",
    name: "区间夹取",
    pack: "arith",
    tier: 2,
    blurb: "先抬到下限，再压到上限：min(max(x, lo), hi)。",
    why: "边界检查是安全漏洞的头号来源。用两级比较器把值钉死在合法区间，是硬件里最便宜的一道护栏——摄像头、音频、电机控制里随处可见。",
    ports: { a: "输入值", lo: "下限", hi: "上限", y: "夹取后的值" },
    src: `
      in a 8
      in lo 8
      in hi 8
      out y 8
      c1 = cmp a lo
      m1 = mux c1.lt a lo
      c2 = cmp m1 hi
      m2 = mux c2.gt m1 hi
      y <- m2
    `,
    model: ({ a, lo, hi }) => ({ y: Math.min(Math.max(a, lo), hi) }),
    tags: ["边界检查"],
  },
];
