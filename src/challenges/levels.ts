import type { Circuit, CompInstance, CustomDef, Design } from "../core/types.ts";
import { circuit, comp } from "../core/build.ts";
import { totalCost } from "../core/custom.ts";
import { OP, encode } from "../asm/isa.ts";
import { assemble } from "../asm/assembler.ts";
import { assemblesSample } from "../asm/samples.ts";
import { SOLUTIONS } from "./solutions.ts";

/* ------------------------------------------------------------------ *
 * 关卡：每一关给出骨架电路（输入/输出/预置元件）+ 测试用例
 * 元件 id 采用 in-<名> / out-<名> 的稳定命名，便于测试按名字定位
 * ------------------------------------------------------------------ */

/** 备用固定指令序列：万一示例程序汇编失败时用它顶上 */
const FIXED_PROGRAM = [
  encode(OP.LDI, 3, 0),
  1,
  encode(OP.LDI, 0, 0),
  1,
  encode(OP.LDI, 1, 0),
  10,
  encode(OP.SYS, 0, 5),
  encode(OP.ADD, 0, 3),
  encode(OP.CMP, 0, 1),
  encode(OP.JMP, 2, 0),
  3,
  encode(OP.SYS, 0, 0),
];

/** Z16 示例程序 count 的机器码：多关卡共用的「程序即数据」来源 */
const PROG_WORDS: number[] = (() => {
  const res = assemble(assemblesSample("count"), { base: 0 });
  return res.errors.length ? FIXED_PROGRAM : res.words;
})();

/** 字符 ROM 关卡的字模内容 */
const CHARS = "HELLO,Z16!";

export type Value = number | string;

export interface TestPhase {
  /** 输入元件名 → 值（只在阶段开始时设置一次） */
  inputs?: Record<string, Value>;
  /** 该阶段推进的时钟周期数 */
  steps: number;
}

export interface MemExpect {
  /** 存储元件名 */
  name: string;
  at: number;
  expect: Value;
}

export interface LevelTest {
  name?: string;
  inputs?: Record<string, Value>;
  steps?: number;
  /** 多阶段：按时序依次施加输入，比单阶段更贴近真实时序电路 */
  phases?: TestPhase[];
  /** 输出灯期望值（按输出元件名） */
  outputs?: Record<string, Value>;
  /** 命名元件（寄存器/计数器）的输出期望值 */
  regs?: Record<string, Value>;
  /** 存储内容期望 */
  mem?: MemExpect[];
  /** 运行日志期望（print 元件输出，按顺序用逗号连接） */
  log?: string;
}

export interface Level {
  id: string;
  tier: number;
  name: string;
  /** 任务描述 */
  brief: string;
  /** 知识讲解 */
  teach: string;
  /** 允许使用的元件类型；`custom` 表示允许子电路 */
  available: string[];
  /** 骨架电路 */
  skeleton: () => Circuit;
  /** 预置子电路定义 */
  defs?: () => CustomDef[];
  tests: LevelTest[];
  /** 至少需要使用几个自定义子电路 */
  requireDefs?: number;
  /** 基准成本（由参考解答算出） */
  par?: number;
  hint?: string;
}

export const TIERS: { tier: number; name: string; blurb: string }[] = [
  { tier: 1, name: "第一层 · 逻辑门", blurb: "从 NAND 开始，把最基础的门电路点亮" },
  { tier: 2, name: "第二层 · 组合逻辑", blurb: "多比特总线、加法器、ALU 与选择器" },
  { tier: 3, name: "第三层 · 时序与存储", blurb: "时钟、寄存器、RAM 与栈" },
  { tier: 4, name: "第四层 · 造一台 CPU", blurb: "译码、程序计数器、数据通路" },
  { tier: 5, name: "第五层 · 存储体系", blurb: "片选、哈佛结构、查找表与终端" },
];

/* ---------------- 骨架元件快捷构造 ---------------- */

export function ioIn(name: string, y: number, bits = 1, init: Value = 0): CompInstance {
  return comp("in-" + name, "input", 0, y, { bitWidth: bits, init }, { name });
}

export function ioOut(name: string, x: number, y: number, bits = 1, radix = "bin"): CompInstance {
  return comp("out-" + name, "output", x, y, { bitWidth: bits, radix }, { name });
}

export function clkSrc(name = "CLK", x = 0, y = 0): CompInstance {
  return comp("clk", "clock", x, y, { divide: 1, auto: true }, { name });
}

/** 预置存储元件 */
export function memComp(
  name: string,
  x: number,
  y: number,
  type: "ram" | "rom",
  bits: number,
  addrBits: number,
  data: string
): CompInstance {
  return comp(name, type, x, y, { bitWidth: bits, addrBits, data }, { name });
}

/** 预置寄存器 / 计数器 */
export function seqComp(
  name: string,
  x: number,
  y: number,
  type: "reg" | "counter",
  bits: number,
  extra: Record<string, Value> = {}
): CompInstance {
  const params: Record<string, number | string | boolean> = { bitWidth: bits, ...extra };
  return comp(name, type, x, y, params, { name });
}

export function levelDesign(level: Level): Design {
  return {
    name: level.name,
    root: level.skeleton(),
    defs: level.defs ? level.defs() : [],
  };
}

export function solutionDesign(level: Level): Design | undefined {
  const fn = SOLUTIONS[level.id];
  if (!fn) return undefined;
  const design = levelDesign(level);
  fn(design);
  return design;
}

export function parOf(design: Design): number {
  return totalCost(design, design.root);
}

/* ---------------- 测试数据小工具 ---------------- */

const m4 = (v: number) => v & 15;

/** 全加器真值表 */
function fullAddTable(): LevelTest[] {
  const out: LevelTest[] = [];
  for (let a = 0; a <= 1; a++)
    for (let b = 0; b <= 1; b++)
      for (let ci = 0; ci <= 1; ci++) {
        const s = a + b + ci;
        out.push({
          name: `${a}${b}${ci}`,
          inputs: { A: a, B: b, CIN: ci },
          outputs: { SUM: s & 1, COUT: s >> 1 },
        });
      }
  return out;
}

/* ================================================================== *
 * 第一层：逻辑门
 * ================================================================== */

const T1: Level[] = [
  {
    id: "t1-gates",
    tier: 1,
    name: "三扇入门",
    brief: "只用 NAND 门，做出 NOT(A)、A AND B、A OR B 三个输出。",
    teach:
      "NAND 是「通用门」：任何布尔函数都能只用它搭出来。NOT = 两输入并接；AND = NAND 后再取反；" +
      "OR = 先分别取反再 NAND（德摩根定律）。",
    available: ["nand", "input", "output"],
    skeleton: () =>
      circuit([
        ioIn("A", 0),
        ioIn("B", 4),
        ioOut("NA", 26, 0),
        ioOut("AB", 26, 4),
        ioOut("OR", 26, 8),
      ]),
    tests: [
      { inputs: { A: 0, B: 0 }, outputs: { NA: 1, AB: 0, OR: 0 } },
      { inputs: { A: 0, B: 1 }, outputs: { NA: 1, AB: 0, OR: 1 } },
      { inputs: { A: 1, B: 0 }, outputs: { NA: 0, AB: 0, OR: 1 } },
      { inputs: { A: 1, B: 1 }, outputs: { NA: 0, AB: 1, OR: 1 } },
    ],
    hint: "NA = NAND(A,A)，还需要一个 NAND(B,B) 才能拼出 OR。",
  },
  {
    id: "t1-xor",
    tier: 1,
    name: "亦或异或",
    brief: "只用 NAND 门实现 X = A ⊕ B。",
    teach:
      "异或 = 「两者不同」。经典做法是 4 个 NAND：先 NAND(A,B) 得到「不能同时为 1」，" +
      "再分别和 A、B 各 NAND 一次，最后合并。",
    available: ["nand", "input", "output"],
    skeleton: () => circuit([ioIn("A", 0), ioIn("B", 4), ioOut("X", 26, 2)]),
    tests: [
      { inputs: { A: 0, B: 0 }, outputs: { X: 0 } },
      { inputs: { A: 0, B: 1 }, outputs: { X: 1 } },
      { inputs: { A: 1, B: 0 }, outputs: { X: 1 } },
      { inputs: { A: 1, B: 1 }, outputs: { X: 0 } },
    ],
  },
  {
    id: "t1-mux2",
    tier: 1,
    name: "二选一",
    brief: "用门电路实现 2 选 1 数据选择器：S=0 输出 A，S=1 输出 B。",
    teach:
      "选择器的布尔式是 (¬S ∧ A) ∨ (S ∧ B)。它是 CPU 里所有「按信号切换数据通路」的基础，" +
      "后面写回、跳转、ALU 选择都靠它。",
    available: ["not", "and", "or", "xor", "nand", "nor", "xnor", "input", "output"],
    skeleton: () => circuit([ioIn("S", 0), ioIn("A", 4), ioIn("B", 8), ioOut("Y", 26, 4)]),
    tests: [
      { inputs: { S: 0, A: 1, B: 0 }, outputs: { Y: 1 } },
      { inputs: { S: 1, A: 1, B: 0 }, outputs: { Y: 0 } },
      { inputs: { S: 0, A: 0, B: 1 }, outputs: { Y: 0 } },
      { inputs: { S: 1, A: 0, B: 1 }, outputs: { Y: 1 } },
    ],
  },
  {
    id: "t1-halfadd",
    tier: 1,
    name: "半加器",
    brief: "输出 SUM = A ⊕ B，COUT = A ∧ B。",
    teach: "一位二进制相加：本位是和的奇偶，进位是两者同时为 1。半加器不考虑低位进位。",
    available: ["not", "and", "or", "xor", "nand", "nor", "input", "output"],
    skeleton: () => circuit([ioIn("A", 0), ioIn("B", 4), ioOut("SUM", 26, 0), ioOut("COUT", 26, 4)]),
    tests: [
      { inputs: { A: 0, B: 0 }, outputs: { SUM: 0, COUT: 0 } },
      { inputs: { A: 0, B: 1 }, outputs: { SUM: 1, COUT: 0 } },
      { inputs: { A: 1, B: 1 }, outputs: { SUM: 0, COUT: 1 } },
    ],
  },
  {
    id: "t1-fulladd",
    tier: 1,
    name: "全加器",
    brief: "把半加器扩展成能接受低位进位的全加器：SUM、COUT。",
    teach:
      "全加器 = 两个半加器 + 一个或门。第一层把 A、B 相加，第二层把低位进位加进来，" +
      "只要任一层产生进位就要往外传。它是所有加法器、ALU 的细胞。",
    available: ["not", "and", "or", "xor", "nand", "nor", "input", "output"],
    skeleton: () =>
      circuit([ioIn("A", 0), ioIn("B", 4), ioIn("CIN", 8), ioOut("SUM", 26, 0), ioOut("COUT", 26, 5)]),
    tests: fullAddTable(),
  },
  {
    id: "t1-dec24",
    tier: 1,
    name: "2-4 译码器",
    brief: "输入 S1S0（两个开关），四根输出线 Y0…Y3 中只有对应那一根为 1。",
    teach:
      "译码器把「编码的地址」展开成「独热」的一根选择线。存储器片选、指令分派、状态机输出" +
      "都是译码器。每一根输出就是一个与门（把为 0 的输入先取反）。",
    available: ["not", "and", "or", "nand", "nor", "input", "output"],
    skeleton: () =>
      circuit([
        ioIn("S0", 0),
        ioIn("S1", 4),
        ioOut("Y0", 26, 0),
        ioOut("Y1", 26, 4),
        ioOut("Y2", 26, 8),
        ioOut("Y3", 26, 12),
      ]),
    tests: [
      { inputs: { S0: 0, S1: 0 }, outputs: { Y0: 1, Y1: 0, Y2: 0, Y3: 0 } },
      { inputs: { S0: 1, S1: 0 }, outputs: { Y0: 0, Y1: 1, Y2: 0, Y3: 0 } },
      { inputs: { S0: 0, S1: 1 }, outputs: { Y0: 0, Y1: 0, Y2: 1, Y3: 0 } },
      { inputs: { S0: 1, S1: 1 }, outputs: { Y0: 0, Y1: 0, Y2: 0, Y3: 1 } },
    ],
  },
  {
    id: "t1-enc4",
    tier: 1,
    name: "优先编码器",
    brief: "D3 优先级最高。输出 Y = 最高位为 1 的下标（2 位），V = 是否有任一输入有效。",
    teach:
      "编码器是译码器的镜像：把独热信号压回二进制地址。「优先」表示多个输入同时有效时只看最高位。" +
      "中断控制器、按键扫描都靠它。用 合线器 把两根 1 位结果拼成 2 位输出。",
    available: ["not", "and", "or", "xor", "nand", "merge", "split", "input", "output"],
    skeleton: () =>
      circuit([
        ioIn("D0", 0),
        ioIn("D1", 4),
        ioIn("D2", 8),
        ioIn("D3", 12),
        ioOut("Y", 26, 2, 2, "dec"),
        ioOut("V", 26, 8),
      ]),
    tests: [
      { inputs: { D0: 0, D1: 0, D2: 0, D3: 0 }, outputs: { Y: 0, V: 0 } },
      { inputs: { D0: 1 }, outputs: { Y: 0, V: 1 } },
      { inputs: { D1: 1, D0: 1 }, outputs: { Y: 1, V: 1 } },
      { inputs: { D2: 1 }, outputs: { Y: 2, V: 1 } },
      { inputs: { D3: 1, D1: 1 }, outputs: { Y: 3, V: 1 } },
    ],
  },
];

/* ================================================================== *
 * 第二层：组合逻辑
 * ================================================================== */

const ADD4: [number, number][] = [
  [1, 2],
  [7, 8],
  [9, 7],
  [0, 0],
  [15, 15],
  [4, 11],
  [2, 13],
  [12, 3],
];

const T2: Level[] = [
  {
    id: "t2-add4",
    tier: 2,
    name: "4 位行波加法器",
    brief: "把 4 个全加器串起来：S = A + B（4 位），C 是最高位进位。",
    teach:
      "多比特加法的唯一新东西是「进位逐级传递」。把 1 位全加器封装成子电路，然后复制 4 份，" +
      "位宽靠 分线器/合线器 在总线与单线之间转换。",
    available: ["not", "and", "or", "xor", "nand", "split", "merge", "add", "custom", "input", "output"],
    skeleton: () =>
      circuit([ioIn("A", 0, 4), ioIn("B", 6, 4), ioOut("S", 30, 0, 4, "hex"), ioOut("C", 30, 8)]),
    tests: ADD4.map(([a, b]) => ({
      inputs: { A: a, B: b },
      outputs: { S: m4(a + b), C: (a + b) >> 4 },
    })),
    hint: "先把 A、B 各自拆成 4 根单线，逐位相加，再合并 S。",
  },
  {
    id: "t2-addsub",
    tier: 2,
    name: "加减一体",
    brief: "M=0 时 R = A + B，M=1 时 R = A − B（都按 4 位回绕）。V = 有符号溢出标志。",
    teach:
      "减法是「加上取反加一」。把 M 同时接到 B 的异或端和加法器的 cin，一条电路就同时会加和减。" +
      "溢出看的是符号位：两个同号数相加得到异号结果即溢出。",
    available: ["not", "and", "or", "xor", "add", "sub", "cmp", "mux", "split", "merge", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        ioIn("A", 0, 4),
        ioIn("B", 6, 4),
        ioIn("M", 12),
        ioOut("R", 30, 0, 4, "hex"),
        ioOut("V", 30, 8),
      ]),
    tests: [
      [3, 4, 0],
      [7, 7, 0],
      [8, 8, 0],
      [3, 4, 1],
      [0, 7, 1],
      [7, 8, 1],
      [1, 1, 1],
    ].map(([a, b, mo]) => {
      const beff = mo ? (b ^ 15) & 15 : b;
      const sum = (a + beff + mo) & 15;
      const v = ((a ^ sum) & (beff ^ sum)) >> 3;
      return { inputs: { A: a, B: b, M: mo }, outputs: { R: sum, V: v } };
    }),
  },
  {
    id: "t2-alu4",
    tier: 2,
    name: "4 位 ALU",
    brief: "OP 选功能：0 加、1 减、2 与、3 或。输出 R 与零标志 Z。",
    teach:
      "这就是 ALU 的雏形：所有功能同时算出来，用一个多路选择器按操作码挑一个。" +
      "零标志由比较器产生，CPU 的条件跳转直接用它。",
    available: ["not", "and", "or", "xor", "add", "sub", "cmp", "mux", "const", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        ioIn("A", 0, 4),
        ioIn("B", 6, 4),
        ioIn("OP", 12, 2, 0),
        ioOut("R", 30, 0, 4, "hex"),
        ioOut("Z", 30, 8),
      ]),
    tests: (() => {
      const pairs: [number, number][] = [
        [5, 3],
        [2, 9],
        [0, 0],
        [15, 1],
      ];
      const out: LevelTest[] = [];
      for (const [a, b] of pairs)
        for (let op = 0; op < 4; op++) {
          const r = op === 0 ? m4(a + b) : op === 1 ? m4(a - b) : op === 2 ? a & b : a | b;
          out.push({ name: `${op}(${a},${b})`, inputs: { A: a, B: b, OP: op }, outputs: { R: r, Z: r ? 0 : 1 } });
        }
      return out;
    })(),
  },
  {
    id: "t2-cmp4",
    tier: 2,
    name: "逐位比较器",
    brief: "不用现成的比较器元件，从高位到低位逐位比较，输出 LT、GT、EQ。",
    teach:
      "比较要先看高位：只有高位相等时低位才有发言权。所以每级携带一个「上面全相等」的信号，" +
      "这正是优先编码思想在比较里的应用。",
    available: ["not", "and", "or", "xor", "xnor", "nand", "split", "merge", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        ioIn("A", 0, 4),
        ioIn("B", 6, 4),
        ioOut("LT", 30, 0),
        ioOut("GT", 30, 4),
        ioOut("EQ", 30, 8),
      ]),
    tests: [
      [0, 0],
      [3, 9],
      [9, 3],
      [15, 15],
      [8, 7],
      [7, 8],
    ].map(([a, b]) => ({
      name: `${a} vs ${b}`,
      inputs: { A: a, B: b },
      outputs: { LT: a < b ? 1 : 0, GT: a > b ? 1 : 0, EQ: a === b ? 1 : 0 },
    })),
  },
  {
    id: "t2-shift4",
    tier: 2,
    name: "桶形移位器",
    brief: "R = V 左移 SH 位（0…3），低位的空出来的位置补 0。",
    teach:
      "想要「任意位移」又不用一长串触发器，就用 barrel shifter：每个输出位都是一路多路选择器，" +
      "选择端直接接位移量。代价是选择器数量随位宽增长。",
    available: ["mux", "const", "split", "merge", "and", "or", "custom", "input", "output"],
    skeleton: () =>
      circuit([ioIn("V", 0, 4), ioIn("SH", 6, 2), ioOut("R", 30, 0, 4, "hex")]),
    tests: [2, 5, 9, 14].flatMap((v) =>
      [0, 1, 2, 3].map((s) => ({
        name: `${v}<<${s}`,
        inputs: { V: v, SH: s },
        outputs: { R: m4(v << s) },
      }))
    ),
  },
  {
    id: "t2-mux8",
    tier: 2,
    name: "8 选 1 数据选择器",
    brief: "按 S 从 D0…D7 中选一路 4 位数据输出。",
    teach:
      "元件库里的 MUX 把「输入数」做成了参数，位宽则自动跟随总线。" +
      "注意选择端的位数：8 路需要 3 位，元件会按输入数自动算好。",
    available: ["mux", "demux", "const", "input", "output", "custom"],
    skeleton: () =>
      circuit([
        ioIn("S", 0, 3),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ioIn("D" + i, 4 + i * 4, 4, i)),
        ioOut("Y", 30, 12, 4, "hex"),
      ]),
    tests: [0, 2, 5, 7].map((s) => ({
      name: "sel " + s,
      inputs: { S: s, ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ["D" + i, (i * 3 + 1) & 15])) },
      outputs: { Y: (s * 3 + 1) & 15 },
    })),
  },
  {
    id: "t2-parity",
    tier: 2,
    name: "奇偶校验",
    brief: "D 是 8 位数据，P 是随行的校验位。数据或校验位出错时 BAD=1，否则为 0。",
    teach:
      "异或门是「奇偶检测器」：把 8 位异或到底就得到 1 的个数的奇偶。" +
      "把它和数据本身再异或一次即可判错。这是存储链路里最廉价的保护。",
    available: ["xor", "xnor", "and", "or", "not", "nand", "split", "merge", "input", "output", "custom"],
    skeleton: () => circuit([ioIn("D", 0, 8), ioIn("P", 10), ioOut("BAD", 30, 4)]),
    tests: [
      { inputs: { D: 0x00, P: 0 }, outputs: { BAD: 0 } },
      { inputs: { D: 0x03, P: 0 }, outputs: { BAD: 0 } },
      { inputs: { D: 0x07, P: 1 }, outputs: { BAD: 0 } },
      { inputs: { D: 0x07, P: 0 }, outputs: { BAD: 1 } },
      { inputs: { D: 0xff, P: 0 }, outputs: { BAD: 0 } },
      { inputs: { D: 0xfe, P: 0 }, outputs: { BAD: 1 } },
      // doc 03 §7 反例：偶数比特翻转漏检 — 单比特 XOR 校验无法检出
      { name: "偶数比特翻转漏检（已知的限制）", inputs: { D: 0x03, P: 0 }, outputs: { BAD: 0 } },
      { name: "双比特翻转漏检（已知的限制）", inputs: { D: 0x0f, P: 0 }, outputs: { BAD: 0 } },
    ],
  },
];

/* ================================================================== *
 * 第三层：时序与存储
 * ================================================================== */

const T3: Level[] = [
  {
    id: "t3-reg4",
    tier: 3,
    name: "带加载的寄存器",
    brief: "LOAD=1 时下一个上升沿锁存 D；LOAD=0 时保持不变。不允许直接使用 REG 元件。",
    teach:
      "寄存器 = D 触发器 + 反馈。想「有时才更新」，就把 Q 反馈回 D：D' = LOAD ? D : Q，" +
      "这正是 CPU 寄存器堆里每个位的写法。",
    available: ["dff", "dlatch", "tff", "and", "or", "not", "mux", "clock", "split", "merge", "const", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("D", 6, 4),
        ioIn("LOAD", 12),
        ioOut("Q", 30, 0, 4, "hex"),
      ]),
    tests: [
      { name: "加载 5", inputs: { D: 5, LOAD: 1 }, steps: 1, outputs: { Q: 5 } },
      { name: "保持", inputs: { D: 5, LOAD: 1 }, steps: 1, phases: [{ inputs: { D: 9, LOAD: 0 }, steps: 3 }], outputs: { Q: 5 } },
      { name: "换值", phases: [{ inputs: { D: 0xa, LOAD: 1 }, steps: 2 }, { inputs: { D: 0xc, LOAD: 1 }, steps: 1 }], outputs: { Q: 0xc } },
      { name: "始终不加载", inputs: { D: 0xf, LOAD: 0 }, steps: 4, outputs: { Q: 0 } },
    ],
    hint: "别忘了把 CLK 接到每个触发器的 clk 脚。",
  },
  {
    id: "t3-count",
    tier: 3,
    name: "可复位的计数器",
    brief: "用计数器元件实现 4 位递增：EN=1 时每拍 +1，RST=1 时清零，溢出自然回绕。",
    teach: "计数器只是「带使能的加一寄存器」。看时钟元件、分频参数和 rst/en 引脚怎么配合。",
    available: ["counter", "reg", "dff", "tff", "and", "or", "not", "clock", "const", "cmp", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("EN", 6),
        ioIn("RST", 10),
        ioOut("Q", 30, 0, 4, "dec"),
      ]),
    tests: [
      { name: "走 5 拍", inputs: { EN: 1 }, steps: 5, outputs: { Q: 5 } },
      { name: "回绕", inputs: { EN: 1 }, steps: 17, outputs: { Q: 1 } },
      { name: "停止", inputs: { EN: 0 }, steps: 6, outputs: { Q: 0 } },
      {
        name: "中途复位",
        phases: [
          { inputs: { EN: 1, RST: 0 }, steps: 3 },
          { inputs: { RST: 1 }, steps: 1 },
          { inputs: { RST: 0 }, steps: 2 },
        ],
        outputs: { Q: 2 },
      },
    ],
  },
  {
    id: "t3-mod6",
    tier: 3,
    name: "模 6 计数器",
    brief: "计数 0→5 后回到 0，而不是 4 位的 0→15。",
    teach:
      "只要把「等于目标值」接回清零端即可。注意计数器是在上升沿采样 rst 的，" +
      "所以比较结果要在同一个节拍之前就成立。",
    available: ["counter", "cmp", "const", "and", "or", "not", "mux", "clock", "reg", "input", "output", "custom"],
    skeleton: () =>
      circuit([clkSrc("CLK", 0, 0), ioOut("Q", 30, 0, 4, "dec"), ioOut("ROLL", 30, 6)]),
    tests: [
      { name: "0..5", steps: 5, outputs: { Q: 5, ROLL: 1 } },
      { name: "回绕", steps: 6, outputs: { Q: 0, ROLL: 0 } },
      { name: "再来一圈", steps: 14, outputs: { Q: 2 } },
    ],
    hint: "ROLL 表示「当前正好数到 5」，可以用比较器等于 5 直接给出。",
  },
  {
    id: "t3-shiftreg",
    tier: 3,
    name: "串入并出移位寄存器",
    brief: "SER 每拍移进一位，P0…P3 同时给出当前 4 位内容（P0 是最早的一级）。",
    teach:
      "把触发器一根一根串起来，数据就像流水一样穿过。总线、UART、乘加阵列的底层都是它。",
    available: ["dff", "dlatch", "tff", "and", "or", "not", "mux", "clock", "const", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("SER", 6),
        ioOut("P0", 30, 0),
        ioOut("P1", 30, 4),
        ioOut("P2", 30, 8),
        ioOut("P3", 30, 12),
      ]),
    tests: [
      {
        name: "移入一个 1",
        phases: [
          { inputs: { SER: 1 }, steps: 1 },
          { inputs: { SER: 0 }, steps: 2 },
        ],
        outputs: { P0: 0, P1: 0, P2: 1, P3: 0 },
      },
      {
        name: "移入 1010",
        phases: [
          { inputs: { SER: 1 }, steps: 1 },
          { inputs: { SER: 0 }, steps: 1 },
          { inputs: { SER: 1 }, steps: 1 },
          { inputs: { SER: 0 }, steps: 1 },
        ],
        outputs: { P0: 0, P1: 1, P2: 0, P3: 1 },
      },
      { name: "全 0", steps: 4, outputs: { P0: 0, P1: 0, P2: 0, P3: 0 } },
    ],
  },
  {
    id: "t3-edge",
    tier: 3,
    name: "边沿检测",
    brief: "BTN 从 0 变 1 之后（滞后一拍），输出 P 给出一个单拍脉冲。",
    teach:
      "「变化」在数字电路里靠比较本拍和上一拍得到：Q = 上一拍的 BTN，P = BTN ∧ ¬Q。" +
      "CPU 的启动、复位、按键响应都要靠它把电平事件变成单拍信号。",
    available: ["dff", "reg", "and", "or", "not", "mux", "clock", "const", "input", "output", "custom"],
    skeleton: () => circuit([clkSrc("CLK", 0, 0), ioIn("BTN", 6), ioOut("P", 30, 2)]),
    tests: [
      { name: "上升沿后一拍", phases: [{ inputs: { BTN: 1 }, steps: 1 }], outputs: { P: 1 } },
      {
        name: "保持高电平则无脉冲",
        phases: [
          { inputs: { BTN: 1 }, steps: 1 },
          { inputs: { BTN: 1 }, steps: 1 },
        ],
        outputs: { P: 0 },
      },
      {
        name: "再次按下",
        phases: [
          { inputs: { BTN: 1 }, steps: 1 },
          { inputs: { BTN: 0 }, steps: 1 },
          { inputs: { BTN: 1 }, steps: 1 },
        ],
        outputs: { P: 1 },
      },
      { name: "不按下", steps: 3, outputs: { P: 0 } },
    ],
  },
  {
    id: "t3-ram",
    tier: 3,
    name: "读写一块 RAM",
    brief: "RAM 已放在画布上（名为 RAM）。WE=1 的上升沿写入 (ADDR, DIN)，否则读出该地址。",
    teach:
      "RAM 是「组合读 + 时钟写」：地址随时可改、数据当拍出。写使能必须和时钟对齐，" +
      "否则你在同一拍里既写又读会出现新旧混叠。",
    available: ["ram", "rom", "reg", "counter", "mux", "and", "or", "not", "cmp", "clock", "const", "split", "merge", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        memComp("RAM", 14, 2, "ram", 8, 4, ""),
        ioIn("DIN", 6, 8),
        ioIn("ADDR", 16, 4),
        ioIn("WE", 22),
        ioOut("DOUT", 34, 2, 8, "hex"),
      ]),
    tests: [
      {
        name: "写入并读回",
        phases: [
          { inputs: { WE: 1, ADDR: 3, DIN: 0x2a }, steps: 1 },
          { inputs: { WE: 0 }, steps: 1 },
        ],
        outputs: { DOUT: 0x2a },
        mem: [{ name: "RAM", at: 3, expect: 0x2a }],
      },
      {
        name: "各地址互不干扰",
        phases: [
          { inputs: { WE: 1, ADDR: 0, DIN: 0x11 }, steps: 1 },
          { inputs: { WE: 0, ADDR: 5, DIN: 0x22 }, steps: 1 },
          { inputs: { WE: 0, ADDR: 0 }, steps: 1 },
        ],
        outputs: { DOUT: 0x11 },
        mem: [
          { name: "RAM", at: 0, expect: 0x11 },
          { name: "RAM", at: 5, expect: 0 },
        ],
      },
      {
        name: "不写就没内容",
        phases: [
          { inputs: { WE: 0, ADDR: 2, DIN: 0xff }, steps: 3 },
          { inputs: { WE: 0, ADDR: 2 }, steps: 1 },
        ],
        outputs: { DOUT: 0 },
      },
      {
        name: "覆盖写",
        phases: [
          { inputs: { WE: 1, ADDR: 7, DIN: 0x01 }, steps: 1 },
          { inputs: { ADDR: 7, DIN: 0x02 }, steps: 1 },
          { inputs: { WE: 0, ADDR: 7 }, steps: 1 },
        ],
        outputs: { DOUT: 0x02 },
        mem: [{ name: "RAM", at: 7, expect: 0x02 }],
      },
    ],
  },
  {
    id: "t3-file",
    tier: 3,
    name: "寄存器堆",
    brief: "4 个 4 位寄存器（R0…R3 已在画布上）。W 选中写入口，RA/RB 是两个读地址。",
    teach:
      "CPU 的寄存器堆就是一个小型双读单写 RAM：写端用译码得到片选，读端用多路选择器按地址挑。" +
      "两个读口彼此独立，所以取指和执行可以同时进行。",
    available: ["reg", "dff", "mux", "demux", "and", "or", "not", "cmp", "clock", "const", "ram", "split", "merge", "custom", "input", "output"],
    skeleton: () => {
      const comps = [
        clkSrc("CLK", 0, 0),
        ioIn("DIN", 6, 4, 4),
        ioIn("W", 12),
        ioIn("WA", 16, 2),
        ioIn("RA", 22, 2),
        ioIn("RB", 26, 2),
        ioOut("QA", 46, 0, 4, "hex"),
        ioOut("QB", 46, 6, 4, "hex"),
      ];
      for (let i = 0; i < 4; i++) comps.push(seqComp("R" + i, 26, 14 + i * 5, "reg", 4));
      return circuit(comps);
    },
    tests: [
      {
        name: "写 R2 读两路",
        phases: [
          { inputs: { W: 1, WA: 2, DIN: 0xa }, steps: 1 },
          { inputs: { W: 0, RA: 2, RB: 0 }, steps: 1 },
        ],
        outputs: { QA: 0xa, QB: 0 },
        regs: { R2: 0xa, R0: 0 },
      },
      {
        name: "各写各的",
        phases: [
          { inputs: { W: 1, WA: 0, DIN: 0x3 }, steps: 1 },
          { inputs: { WA: 1, DIN: 0x7 }, steps: 1 },
          { inputs: { WA: 3, DIN: 0xc }, steps: 1 },
          { inputs: { W: 0, RA: 1, RB: 3 }, steps: 1 },
        ],
        outputs: { QA: 7, QB: 0xc },
        regs: { R0: 3, R1: 7, R3: 0xc },
      },
      {
        name: "写使能关掉就不变",
        phases: [
          { inputs: { W: 0, WA: 1, DIN: 0xf }, steps: 3 },
          { inputs: { RA: 1 }, steps: 1 },
        ],
        outputs: { QA: 0 },
        regs: { R1: 0 },
      },
    ],
  },
  {
    id: "t3-stack",
    tier: 3,
    name: "硬件栈",
    brief:
      "OP：1 入栈（把 DIN 写入栈顶并上移）、2 出栈（下移并读出）、0 不动；空栈时出栈无效。SP、STACK 已在画布上。",
    teach:
      "函数调用、中断现场都靠栈。栈 = 一块 RAM + 一个栈指针：入栈先写后加，出栈先减后读。" +
      "「先」和「后」差一个节拍，就是所有越界 bug 的来源。",
    available: ["ram", "reg", "counter", "mux", "add", "sub", "cmp", "and", "or", "not", "const", "clock", "split", "merge", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        memComp("STACK", 16, 4, "ram", 8, 5, ""),
        seqComp("SP", 40, 4, "reg", 5),
        ioIn("DIN", 6, 8),
        ioIn("OP", 12, 2),
        ioOut("TOS", 46, 0, 8, "hex"),
      ]),
    tests: [
      {
        name: "两次入栈",
        phases: [
          { inputs: { OP: 1, DIN: 5 }, steps: 1 },
          { inputs: { DIN: 3 }, steps: 1 },
          { inputs: { OP: 0 }, steps: 1 },
        ],
        regs: { SP: 2 },
        mem: [
          { name: "STACK", at: 0, expect: 5 },
          { name: "STACK", at: 1, expect: 3 },
        ],
      },
      {
        name: "出栈回到上一个",
        phases: [
          { inputs: { OP: 1, DIN: 5 }, steps: 1 },
          { inputs: { DIN: 3 }, steps: 1 },
          { inputs: { OP: 2, DIN: 0 }, steps: 1 },
          { inputs: { OP: 0 }, steps: 1 },
        ],
        outputs: { TOS: 3 },
        regs: { SP: 1 },
      },
      {
        name: "空栈不动",
        phases: [{ inputs: { OP: 2 }, steps: 2 }, { inputs: { OP: 0 }, steps: 1 }],
        regs: { SP: 0 },
        outputs: { TOS: 0 },
      },
    ],
    hint: "出栈时 SP 要先减一再读，才能读到上一个压进来的值；否则 pop 会读到刚写的那个。",
  },
];

/* ================================================================== *
 * 第四层：造一台 CPU
 * ================================================================== */

const T4: Level[] = [
  {
    id: "t4-alu8",
    tier: 4,
    name: "封装一台 8 位 ALU",
    brief:
      "OP：0 加 1 减 2 与 3 或 4 异或 5 非 A 6 左移 7 右移。要求把 ALU 做成子电路（封装）再放进主电路。",
    teach:
      "封装是整个工程的核心方法：把复杂的电路收成一个元件，之后你只关心它的引脚。" +
      "在子电路画布上放好 INPUT/OUTPUT 元件，选中电路按 G 就能生成新元件，成本会累加。",
    available: ["add", "sub", "and", "or", "xor", "not", "shift", "mux", "cmp", "const", "split", "merge", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        ioIn("A", 0, 8),
        ioIn("B", 8, 8),
        ioIn("OP", 16, 3),
        ioOut("R", 44, 0, 8, "hex"),
        ioOut("Z", 44, 10),
      ]),
    requireDefs: 1,
    tests: (() => {
      const out: LevelTest[] = [];
      const pairs: [number, number][] = [
        [0x12, 0x0a],
        [0xff, 0x01],
        [0x3c, 0x3c],
        [0x00, 0x00],
      ];
      for (const [a, b] of pairs)
        for (let op = 0; op < 8; op++) {
          let r = 0;
          switch (op) {
            case 0: r = a + b; break;
            case 1: r = a - b; break;
            case 2: r = a & b; break;
            case 3: r = a | b; break;
            case 4: r = a ^ b; break;
            case 5: r = ~a; break;
            case 6: r = a << (b & 31); break;
            default: r = a >>> (b & 31);
          }
          r &= 255;
          out.push({ name: `${op}(${a},${b})`, inputs: { A: a, B: b, OP: op }, outputs: { R: r, Z: r ? 0 : 1 } });
        }
      return out;
    })(),
    hint: "移位用 移位器 元件，非 A 用位宽跟随的一输入非门。",
  },
  {
    id: "t4-instdec",
    tier: 4,
    name: "16 位指令译码",
    brief: "IR 是一条 Z16 指令：[15:12] 操作码、[11:8] A、[7:4] B。把它们拆成三个输出。",
    teach:
      "指令只是一串数字，译码就是切片。分线器把 16 位总线摊成 16 根单线，" +
      "再用合线器按需要的字段重新拼起来 —— 这就是「地址即结构」。",
    available: ["split", "merge", "demux", "mux", "const", "and", "or", "not", "input", "output", "custom"],
    skeleton: () =>
      circuit([
        ioIn("IR", 0, 16, 0x5130),
        ioOut("OP", 44, 0, 4, "dec"),
        ioOut("RA", 44, 6, 4, "dec"),
        ioOut("RB", 44, 12, 4, "dec"),
      ]),
    tests: [
      { inputs: { IR: 0x5130 }, outputs: { OP: 5, RA: 1, RB: 3 } },
      { inputs: { IR: 0xf000 }, outputs: { OP: 15, RA: 0, RB: 0 } },
      { inputs: { IR: 0x00c0 }, outputs: { OP: 0, RA: 0, RB: 12 } },
      { inputs: { IR: 0x9e70 }, outputs: { OP: 9, RA: 14, RB: 7 } },
    ],
  },
  {
    id: "t4-pc",
    tier: 4,
    name: "程序计数器",
    brief: "EN=1 且 LD=0 时每拍 +1；LD=1 时载入 TARGET；否则停住。",
    teach:
      "PC 是 CPU 的时间轴。顺序执行 = 加一，跳转 = 载入。把「下一拍的值」用一个选择器拼出来，" +
      "再加一个延迟（分支时指令已被取走，所以要清掉刚取的那条）—— 现代 CPU 叫分支预测失败气泡。",
    available: ["reg", "counter", "mux", "add", "and", "or", "not", "const", "clock", "cmp", "split", "merge", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("EN", 6),
        ioIn("LD", 10),
        ioIn("TARGET", 14, 4),
        ioOut("PC", 34, 0, 4, "dec"),
      ]),
    tests: [
      { name: "顺序走", inputs: { EN: 1 }, steps: 3, outputs: { PC: 3 } },
      { name: "停止", inputs: { EN: 0 }, steps: 4, outputs: { PC: 0 } },
      { name: "跳转", inputs: { EN: 1, LD: 1, TARGET: 0xa }, steps: 1, outputs: { PC: 0xa } },
      {
        name: "跳转后继续",
        phases: [
          { inputs: { EN: 1, LD: 1, TARGET: 5 }, steps: 1 },
          { inputs: { LD: 0 }, steps: 2 },
        ],
        outputs: { PC: 7 },
      },
      {
        name: "重复载入优先",
        phases: [
          { inputs: { EN: 1, LD: 1, TARGET: 9 }, steps: 1 },
          { inputs: { EN: 1, LD: 1, TARGET: 0 }, steps: 1 },
        ],
        outputs: { PC: 0 },
      },
    ],
  },
  {
    id: "t4-progmem",
    tier: 4,
    name: "程序即数据",
    brief:
      "PROG 里装着一段已汇编好的 Z16 程序（每条指令 1 或 2 个字）。给地址 A 输出该字的三个字段。",
    teach:
      "冯·诺依曼的关键洞见：指令和数据在同一块存储里，没有区别。改变存储内容就等于改变行为，" +
      "这就是「可编程」的全部含义。",
    available: ["split", "merge", "rom", "ram", "mux", "cmp", "const", "counter", "clock", "and", "or", "not", "input", "output", "custom"],
    skeleton: () => {
      const words = PROG_WORDS;
      return circuit([
        memComp("PROG", 16, 4, "rom", 16, 8, words.map((w) => "0x" + w.toString(16)).join(",")),
        ioIn("A", 6, 8),
        ioOut("OP", 44, 0, 4, "dec"),
        ioOut("RA", 44, 6, 4, "dec"),
        ioOut("RB", 44, 12, 4, "dec"),
        ioOut("WORD", 44, 18, 16, "hex"),
      ]);
    },
    tests: (() => {
      const out: LevelTest[] = [];
      [0, 1, 2, 3, 5].forEach((a) => {
        const w = PROG_WORDS[a] ?? 0;
        out.push({
          name: "地址 " + a,
          inputs: { A: a },
          outputs: { OP: (w >> 12) & 15, RA: (w >> 8) & 15, RB: (w >> 4) & 15, WORD: w },
        });
      });
      return out;
    })(),
  },
  {
    id: "t4-machine",
    tier: 4,
    name: "让 CPU 跑起来",
    brief:
      "画布上已经放好：一块 16 位 RAM（MEM，已写入程序）、一个终端（OUT，字符/十进制模式）。" +
      "把它们连成一台能取指执行的 CPU：程序从地址 0 开始跑，SYS OUT 把值写到端口地址 0xF0，" +
      "终端的 en 只应在「写使能且地址=0xF0」时拉高，HLT 后 DONE 置 1。190 拍内要打印出 1..10。",
    teach:
      "到这里你已经有了全部零件：PC 取指、译码切片、寄存器堆、ALU、条件跳转、栈与调用。" +
      "把它们按「一拍做一件事」串起来，就是一台真正的计算机。",
    available: [
      "ram", "rom", "reg", "counter", "mux", "demux", "add", "sub", "cmp", "alu", "shift", "split", "merge",
      "and", "or", "not", "xor", "const", "clock", "print", "input", "output", "custom", "tff", "dff", "dlatch", "buf", "xnor", "nand", "nor", "button", "note",
    ],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        memComp("MEM", 16, 4, "ram", 16, 16, PROG_WORDS.map((w) => "0x" + w.toString(16)).join(",")),
        comp("OUT", "print", 44, 4, { radix: "dec" }, { name: "OUT" }),
        ioOut("DONE", 44, 0),
      ]),
    tests: [
      {
        name: "计数程序输出 1..10",
        steps: 190,
        log: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].join(","),
        outputs: { DONE: 1 },
      },
      // doc 03 §6.4 变式：验证中间状态——15 步时应已看到第一个输出（3 条 LDI 各 3 拍 + add 2 拍 + out 2 拍 = 11 拍）
      {
        name: "部分输出：第 15 拍已出现 1",
        steps: 15,
        log: "1",
        outputs: { DONE: 0 },
      },
      // doc 03 §6.4 边界：步数不足不应报告 DONE
      {
        name: "步数不足时 DONE 仍为 0",
        steps: 5,
        outputs: { DONE: 0 },
      },
    ],
    hint: "DONE 用来表示「已经 HLT」：译出 SYS/HLT 后拉高，同时停掉 PC 计数。",
  },
];

/* ================================================================== *
 * 第五层：存储体系
 * ================================================================== */

const T5: Level[] = [
  {
    id: "t5-bank",
    tier: 5,
    name: "存储扩展与片选",
    brief: "4 片 8×8 RAM（BANK0…BANK3 已在画布上）合成 32×8 存储：高 2 位选片，低 3 位是片内地址。",
    teach:
      "单片存储总是又小又便宜，靠地址高位译码出片选就能拼出更大的存储。" +
      "没被选中的那片必须不写、也不影响总线 —— 这就是「地址译码 + 三态/选择」。",
    available: ["ram", "demux", "mux", "split", "merge", "and", "or", "not", "const", "clock", "reg", "counter", "cmp", "custom", "input", "output"],
    skeleton: () => {
      const comps = [
        clkSrc("CLK", 0, 0),
        ioIn("DIN", 6, 8),
        ioIn("A", 14, 5),
        ioIn("WE", 22),
        ioOut("DOUT", 56, 0, 8, "hex"),
      ];
      for (let i = 0; i < 4; i++) comps.push(memComp("BANK" + i, 30, 2 + i * 8, "ram", 8, 3, ""));
      return circuit(comps);
    },
    tests: [
      {
        name: "写第 1 片",
        phases: [
          { inputs: { WE: 1, A: 9, DIN: 0x11 }, steps: 1 },
          { inputs: { WE: 0, A: 9 }, steps: 1 },
        ],
        outputs: { DOUT: 0x11 },
        mem: [
          { name: "BANK1", at: 1, expect: 0x11 },
          { name: "BANK0", at: 1, expect: 0 },
        ],
      },
      {
        name: "跨片写入",
        phases: [
          { inputs: { WE: 1, A: 2, DIN: 0x21 }, steps: 1 },
          { inputs: { A: 11, DIN: 0x22 }, steps: 1 },
          { inputs: { A: 25, DIN: 0x23 }, steps: 1 },
          { inputs: { A: 30, DIN: 0x24 }, steps: 1 },
          { inputs: { WE: 0, A: 25 }, steps: 1 },
        ],
        outputs: { DOUT: 0x23 },
        mem: [
          { name: "BANK0", at: 2, expect: 0x21 },
          { name: "BANK1", at: 3, expect: 0x22 },
          { name: "BANK3", at: 1, expect: 0x23 },
          { name: "BANK3", at: 6, expect: 0x24 },
        ],
      },
      {
        name: "读任意地址",
        phases: [
          { inputs: { WE: 1, A: 0, DIN: 0x55 }, steps: 1 },
          { inputs: { A: 31, DIN: 0x66 }, steps: 1 },
          { inputs: { WE: 0, A: 0 }, steps: 1 },
        ],
        outputs: { DOUT: 0x55 },
      },
    ],
  },
  {
    id: "t5-harvard",
    tier: 5,
    name: "哈佛结构求和",
    brief:
      "IROM 存 8 条「取数地址」，DRAM 存 8 个采样值。RUN=1 时依次按 IROM 指出的地址取数并累加到 SUM；RUN=0 时 PC 与累加器都要停住。",
    teach:
      "指令和数据分开放，就是哈佛结构：取指和取数各有一条总线，一拍能干两件事。" +
      "DSP 芯片到今天还是这个形状。",
    available: ["ram", "rom", "reg", "counter", "mux", "add", "cmp", "and", "or", "not", "const", "clock", "split", "merge", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        memComp("IROM", 16, 4, "rom", 16, 6, "0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07"),
        memComp("DRAM", 30, 4, "ram", 8, 4, "0x0a,0x0b,0x0c,0x0d,0x0e,0x0f,0x10,0x11"),
        ioIn("RUN", 6, 1, 1),
        ioOut("SUM", 58, 0, 8, "hex"),
        ioOut("DONE", 58, 10),
      ]),
    tests: [
      { name: "取前 4 个", phases: [{ inputs: { RUN: 1 }, steps: 4 }, { inputs: { RUN: 0 }, steps: 1 }], outputs: { SUM: 0x0a + 0x0b + 0x0c + 0x0d, DONE: 0 } },
      { name: "全部累加", phases: [{ inputs: { RUN: 1 }, steps: 8 }, { inputs: { RUN: 0 }, steps: 2 }], outputs: { SUM: 108, DONE: 1 } },
      { name: "RUN 为 0 不动", phases: [{ inputs: { RUN: 0 }, steps: 5 }], outputs: { SUM: 0, DONE: 0 } },
    ],
  },
  {
    id: "t5-charrom",
    tier: 5,
    name: "查表与终端",
    brief: "FONT 是一块字符 ROM（内容为一串 ASCII）。每个节拍输出下一个字符，并把当前字符打印到终端 TERM。",
    teach:
      "ROM 不只是存程序，它是一张「地址 → 内容」的表：字形、波形、正弦、字模都可以查表得到。" +
      "配上终端元件，就能看到真实的输出流。",
    available: ["rom", "counter", "reg", "print", "mux", "and", "or", "not", "const", "clock", "cmp", "split", "merge", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        memComp("FONT", 16, 4, "rom", 8, 4, Array.from(CHARS, (c) => "0x" + c.charCodeAt(0).toString(16)).join(",")),
        seqComp("IDX", 40, 4, "counter", 4),
        comp("TERM", "print", 50, 12, { radix: "char" }, { name: "TERM" }),
        ioOut("CHR", 58, 0, 8, "hex"),
      ]),
    tests: [
      { name: "前 5 个字符", steps: 5, outputs: { CHR: CHARS.charCodeAt(5) }, log: CHARS.slice(0, 5).split("").join(",") },
      { name: "走 3 拍", steps: 3, outputs: { CHR: CHARS.charCodeAt(3) }, log: CHARS.slice(0, 3).split("").join(",") },
    ],
  },
  {
    id: "t5-micro",
    tier: 5,
    name: "微程序控制器",
    brief:
      "CTRL 是控制存储器：每个 8 位字按位表示微操作 —— bit0 允许 PC 计数、bit1 写存储、bit2-4 ALU 操作、bit5 写回寄存器、bit7 停机。按 ST 输出各控制信号。",
    teach:
      "把「这一拍该干什么」写成表，用状态计数器的值去查，这就是微程序控制。" +
      "本工具的参考 CPU 正是这么造的：一条 ROM 记录 = 一组使能信号。",
    available: ["rom", "split", "merge", "mux", "demux", "cmp", "const", "counter", "clock", "and", "or", "not", "custom", "input", "output"],
    skeleton: () =>
      circuit([
        memComp("CTRL", 16, 4, "rom", 8, 4, "0x01,0x05,0x0d,0x21,0x33,0x41,0x81,0x00"),
        ioIn("ST", 6, 4),
        ioOut("PC_EN", 50, 0),
        ioOut("MEM_WE", 50, 4),
        ioOut("ALU_OP", 50, 8, 3, "dec"),
        ioOut("RF_LD", 50, 14),
        ioOut("HALT", 50, 20),
      ]),
    tests: [
      { inputs: { ST: 0 }, outputs: { PC_EN: 1, MEM_WE: 0, ALU_OP: 0, RF_LD: 0, HALT: 0 } },
      { inputs: { ST: 1 }, outputs: { PC_EN: 1, MEM_WE: 0, ALU_OP: 1, RF_LD: 0, HALT: 0 } },
      { inputs: { ST: 2 }, outputs: { PC_EN: 1, MEM_WE: 0, ALU_OP: 3, RF_LD: 0, HALT: 0 } },
      { inputs: { ST: 4 }, outputs: { PC_EN: 1, MEM_WE: 1, ALU_OP: 4, RF_LD: 1, HALT: 0 } },
      { inputs: { ST: 6 }, outputs: { PC_EN: 1, MEM_WE: 0, ALU_OP: 0, RF_LD: 0, HALT: 1 } },
      { inputs: { ST: 7 }, outputs: { PC_EN: 0, MEM_WE: 0, ALU_OP: 0, RF_LD: 0, HALT: 0 } },
      // doc 03 §7 关键约束：CTRL 输出原始位域；当 HALT 和 PC_EN 同时为 1（ST=6）时，
      // 哪一个先生效由外部组合逻辑决定；本工具的参考 CPU 把 HALT 放在 OR 链末端
      // 实现「停机后停掉所有写」，但这一约定不属于关卡契约
      {
        name: "doc 03 §7：HALT 与 PC_EN 同时为 1 时由使用方决定",
        inputs: { ST: 6 },
        outputs: { PC_EN: 1, HALT: 1 },
      },
    ],
  },
];

export const LEVELS: Level[] = [...T1, ...T2, ...T3, ...T4, ...T5];

export const LEVEL_IDS = LEVELS.map((l) => l.id);

/* ================================================================== *
 * 存储书《囚禁电荷》（book-memory）
 *
 * 与 CPU 书 31 关分账：不进 LEVELS（发布门禁按五世界数量校验），
 * 由关卡面板单独成节、levelById 单独可寻址。tier 6。
 * 母本：z-how-linux-runs/memory_work/，序列草案：_doc/全量设计/08。
 * ================================================================== */

/* ---------------- 世界 M1 存就是状态 ---------------- */

const M1: Level[] = [
  {
    id: "m1-1-norlatch",
    tier: 6,
    name: "两个非门锁住一位",
    brief: "用两只或非门交叉耦合，做出能写、能保持 32 拍以上的一位：S 置 1、R 置 0，撒手后 Q 不变。",
    teach:
      "最原始的存储不需要电容：两个或非门互相咬住对方的输出，就成一个双稳态——SRAM 的细胞。" +
      "S=R=0 时电路『记得』上次是谁最后说话；S=R=1 是禁态（两个输出一起掉 0），别碰。",
    available: ["input", "output", "clock", "nor", "nand", "not", "and", "or", "const"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("S", 4, 1),
        ioIn("R", 8, 1),
        ioOut("Q", 40, 0),
        ioOut("QN", 40, 4),
      ]),
    tests: [
      {
        name: "置 1 后保持 32 拍",
        phases: [
          { inputs: { S: 1, R: 0 }, steps: 1 },
          { inputs: { S: 0, R: 0 }, steps: 32 },
        ],
        outputs: { Q: 1, QN: 0 },
      },
      {
        name: "再置 0 后保持 32 拍",
        phases: [
          { inputs: { S: 1, R: 0 }, steps: 1 },
          { inputs: { S: 0, R: 1 }, steps: 1 },
          { inputs: { S: 0, R: 0 }, steps: 32 },
        ],
        outputs: { Q: 0, QN: 1 },
      },
    ],
    hint: "Q = NOR(R, Q̄)，Q̄ = NOR(S, Q)。交叉互相喂，谁也松不开谁。",
  },
  {
    id: "m1-2-decode4",
    tier: 6,
    name: "4×4 阵列与译码",
    brief:
      "四格 C0..C3（各 4 位寄存器）就是一座小阵列。用译码器把 2 位地址展开成四根字线：WE=1 时写入地址选中的一格；DOUT 永远给出地址选中的那格。",
    teach:
      "一根字线开一行，一根位线过一行——译码器是把『地址』翻译成『哪一格』的翻译官。" +
      "写走译码器+WE，读走多路选择器。RAM 内部就是这套机构。",
    available: ["input", "output", "clock", "demux", "mux", "reg", "and", "or", "not", "const"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("ADDR", 4, 2),
        ioIn("DIN", 8, 4),
        ioIn("WE", 14, 1),
        seqComp("C0", 20, 0, "reg", 4),
        seqComp("C1", 20, 5, "reg", 4),
        seqComp("C2", 20, 10, "reg", 4),
        seqComp("C3", 20, 15, "reg", 4),
        ioOut("DOUT", 48, 6, 4),
      ]),
    tests: [
      {
        name: "写 C0=0x5 再读回",
        phases: [
          { inputs: { ADDR: 0, DIN: 5, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 0, DIN: 0, WE: 0 }, steps: 1 },
        ],
        outputs: { DOUT: 5 },
      },
      {
        name: "写 C1=0xA 再读回",
        phases: [
          { inputs: { ADDR: 1, DIN: 10, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 1, DIN: 0, WE: 0 }, steps: 1 },
        ],
        outputs: { DOUT: 10 },
      },
      {
        name: "写 C2=0x3 再读回",
        phases: [
          { inputs: { ADDR: 2, DIN: 3, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 2, DIN: 0, WE: 0 }, steps: 1 },
        ],
        outputs: { DOUT: 3 },
      },
      {
        name: "写 C3=0xF 再读回",
        phases: [
          { inputs: { ADDR: 3, DIN: 15, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 3, DIN: 0, WE: 0 }, steps: 1 },
        ],
        outputs: { DOUT: 15 },
      },
    ],
    hint: "译码器 sel 接 ADDR，四根输出各 AND 一把 WE 就是四根写使能；读用 4 选 1 MUX。",
  },
];

const M2: Level[] = [
  {
    id: "m2-1-leakycap",
    tier: 6,
    name: "会漏的电容",
    brief:
      "把 D 上的两位数据写进电容位元 CAP（EN 是字线，D 接位线 BL），然后撒手不管。用例 1 只等一小会儿；用例 2 要等很久。",
    teach:
      "DRAM 的一位就是一个电容：电平 0/1/2 表示 GND / VDD÷2 / VDD。EN=1 的时钟沿把 BL 上的电平采进电容，此后每 16 拍漏掉一级。" +
      "观测 Q 不会伤害它；但开字线的沿上如果位线没人顶着，电荷在读到的瞬间就被毁了——那是下一关的事。",
    available: ["input", "output", "clock", "CAPCELL", "or", "and", "not", "const"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("EN", 4, 1),
        ioIn("D", 8, 2),
        comp("cap", "CAPCELL", 14, 2, { leakN: 16 }, { name: "CAP" }),
        ioOut("Q", 40, 2, 2),
      ]),
    tests: [
      {
        name: "写满后等 12 拍，还在",
        phases: [
          { inputs: { EN: 1, D: 2 }, steps: 1 },
          { inputs: { EN: 0 }, steps: 12 },
        ],
        outputs: { Q: 2 },
      },
      {
        name: "写满后等 60 拍——电容还记得吗？",
        phases: [
          { inputs: { EN: 1, D: 2 }, steps: 1 },
          { inputs: { EN: 0 }, steps: 60 },
        ],
        outputs: { Q: 2 },
      },
    ],
    hint: "电容每 16 拍漏一级电，等 60 拍就是漏光。唯一的办法：别让它闲着——想办法不断地把数据写回去。",
  },
  {
    id: "m2-2-destructive",
    tier: 6,
    name: "读即毁",
    brief:
      "这回电容没有数据线：写与读都只能走位线 BL，而 BL 上只有感应放大器能给出电平。把『预充电 → 放大 → 反复开字线』的回路搭起来，读 6 次数据还在。",
    teach:
      "DRAM 的读是破坏性的：字线一开，电容把电荷摊到位线上，自己掉半级。" +
      "感应放大器趁半电平还没塌，把它拉成满幅、顺势写回单元——『读』其实是『读-放大-回写』三合一。" +
      "没有感放，开字线的沿上位线没人顶，电荷直接被毁。",
    available: ["input", "output", "clock", "CAPCELL", "SENSEAMP", "or", "and", "not"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("EN", 4, 1),
        ioIn("SE", 8, 1),
        comp("cap", "CAPCELL", 14, 2, { leakN: 999 }, { name: "CAP" }),
        ioOut("Q", 40, 2, 2),
      ]),
    tests: [
      {
        name: "预充电半电平进单元，放大成满幅",
        phases: [
          { inputs: { EN: 1, SE: 0 }, steps: 1 },
          { inputs: { EN: 1, SE: 1 }, steps: 3 },
        ],
        outputs: { Q: 2 },
      },
      {
        name: "反复开字线读 6 次，数据仍在",
        phases: [
          { inputs: { EN: 1, SE: 0 }, steps: 1 },
          { inputs: { EN: 1, SE: 1 }, steps: 1 },
          { inputs: { EN: 0 }, steps: 1 },
          { inputs: { EN: 1 }, steps: 1 },
          { inputs: { EN: 0 }, steps: 1 },
          { inputs: { EN: 1 }, steps: 1 },
          { inputs: { EN: 0 }, steps: 1 },
          { inputs: { EN: 1 }, steps: 1 },
          { inputs: { EN: 0 }, steps: 1 },
          { inputs: { EN: 1 }, steps: 1 },
          { inputs: { EN: 0 }, steps: 1 },
          { inputs: { EN: 1 }, steps: 1 },
        ],
        outputs: { Q: 2 },
      },
    ],
    hint: "SA 的 SE=0 输出 VDD/2（预充电），SE=1 把 IN 上的电平拉成满幅。CAP 的 Q → SA 的 IN，SA 的 OUT → CAP 的 BL，闭环就成了。",
  },
  {
    id: "m2-3-refresh",
    tier: 6,
    name: "刷新调度",
    brief:
      "四格电容 C0..C3 每 96 拍漏一级，撑不过 200 拍——除非有人不停把它们逐行写回去。刷新控制器 REF 已就位（每 8 拍行号 +1）：搭出『逐行刷新 + 随时写入』的回路，让四个值都活着。",
    teach:
      "64ms ÷ 8192 行，就是每行必须在漏光前被轮到一次——刷新周期的数学来历。" +
      "REFCTRL 只给行号，执行靠你：行号译码开字线，位线用单元自己的 Q 回馈，自己写回自己。" +
      "写入与刷新共用一根字线：WE 命中地址时写新值，REF 命中行号时回写旧值。",
    available: ["input", "output", "clock", "CAPCELL", "REFCTRL", "demux", "mux", "and", "or", "not", "const", "cmp"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("ADDR", 4, 2),
        ioIn("D", 8, 2),
        ioIn("WE", 12, 1),
        comp("ref", "REFCTRL", 8, 20, { addrBits: 2, window: 8 }, { name: "REF" }),
        comp("c0", "CAPCELL", 22, 0, { leakN: 96 }, { name: "C0" }),
        comp("c1", "CAPCELL", 22, 5, { leakN: 96 }, { name: "C1" }),
        comp("c2", "CAPCELL", 22, 10, { leakN: 96 }, { name: "C2" }),
        comp("c3", "CAPCELL", 22, 15, { leakN: 96 }, { name: "C3" }),
        ioOut("Q0", 46, 0, 2),
        ioOut("Q1", 46, 5, 2),
        ioOut("Q2", 46, 10, 2),
        ioOut("Q3", 46, 15, 2),
      ]),
    tests: [
      {
        name: "写满四格，撑过 200 拍",
        phases: [
          { inputs: { ADDR: 0, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 1, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 2, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 3, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 0, D: 0, WE: 0 }, steps: 200 },
        ],
        outputs: { Q0: 2, Q1: 2, Q2: 2, Q3: 2 },
      },
      {
        name: "中途改写一格，各格都活着",
        phases: [
          { inputs: { ADDR: 0, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 1, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 2, D: 1, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 3, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 1, D: 1, WE: 1 }, steps: 1 },
          { inputs: { ADDR: 0, D: 0, WE: 0 }, steps: 100 },
        ],
        outputs: { Q0: 2, Q1: 1, Q2: 1, Q3: 2 },
      },
    ],
    hint: "每格 EN = REF 行号命中 OR 写地址命中；BL = WE ? D : 自己的 Q。刷新就是自己写回自己。",
  },
  {
    id: "m2-4-wordline",
    tier: 6,
    name: "字线不许串门",
    brief:
      "2 行 × 2 列电容阵列（ROW/COL 各 1 位）。写 (ROW,COL) 那一格时译码必须精确到只开一根字线——误开的字线会让邻居沿位线被冲掉。写一格、盯三格。",
    teach:
      "DRAM 阵列每根字线连一整行电容：译码多开一根线，整行的电荷全毁。" +
      "字线 = 行译码 AND 列译码 AND WE；位线按列共享。译码器的精度是存储器的命根子。",
    available: ["input", "output", "clock", "CAPCELL", "demux", "mux", "and", "or", "not", "const"],
    skeleton: () =>
      circuit([
        clkSrc("CLK", 0, 0),
        ioIn("ROW", 4, 1),
        ioIn("COL", 8, 1),
        ioIn("D", 12, 2),
        ioIn("WE", 16, 1),
        comp("g00", "CAPCELL", 26, 0, { leakN: 999 }, { name: "G00" }),
        comp("g01", "CAPCELL", 26, 5, { leakN: 999 }, { name: "G01" }),
        comp("g10", "CAPCELL", 26, 10, { leakN: 999 }, { name: "G10" }),
        comp("g11", "CAPCELL", 26, 15, { leakN: 999 }, { name: "G11" }),
        ioOut("Q00", 48, 0, 2),
        ioOut("Q01", 48, 5, 2),
        ioOut("Q10", 48, 10, 2),
        ioOut("Q11", 48, 15, 2),
      ]),
    tests: [
      {
        name: "写 G11=满电平，别惊动任何人",
        phases: [
          { inputs: { ROW: 1, COL: 1, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ROW: 0, COL: 0, D: 0, WE: 0 }, steps: 2 },
        ],
        outputs: { Q00: 0, Q01: 0, Q10: 0, Q11: 2 },
      },
      {
        name: "连写三格，先写的还在",
        phases: [
          { inputs: { ROW: 1, COL: 1, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ROW: 0, COL: 1, D: 1, WE: 1 }, steps: 1 },
          { inputs: { ROW: 0, COL: 0, D: 2, WE: 1 }, steps: 1 },
          { inputs: { ROW: 0, COL: 0, D: 0, WE: 0 }, steps: 2 },
        ],
        outputs: { Q00: 2, Q01: 1, Q10: 0, Q11: 2 },
      },
    ],
    hint: "EN(r,c) = 行译码 AND 列译码 AND WE。位线按列共享：BL(列) = WE ? D : 按行选出的本列选中格的 Q。",
  },
  {
    id: "m2-4b-secdec",
    tier: 6,
    name: "★ 汉明纠错",
    brief:
      "给 4 位数据搭一套纠错编码：故障开关 FLT1/FLT2 接进你码字的任意两个不同位置，接收端要把单翻转自动纠正（CORR 输出纠完的数据）；两位同时翻必须报警 DERR=1。",
    teach:
      "内存每 64 位配 8 位校验就是这么做的：校验位按『地址含这一位的数据位』分组配平，读出时重算 syndrome，非零即错位（memory_work 01 §7.2）。" +
      "纠一位要码距 ≥3；再检出两位，加一位全组奇偶即可——SECDED = Single Error Correct, Double Error Detect。",
    available: ["input", "output", "clock", "xor", "and", "or", "not", "const", "split", "merge", "mux", "demux", "cmp", "dff"],
    skeleton: () =>
      circuit([
        ioIn("D", 0, 4),
        ioIn("FLT1", 4, 1),
        ioIn("FLT2", 8, 1),
        ioOut("CORR", 60, 0, 4),
        ioOut("DERR", 60, 6, 1),
      ]),
    tests: [
      { name: "无故障直通", phases: [{ inputs: { D: 11, FLT1: 0, FLT2: 0 }, steps: 1 }], outputs: { CORR: 11, DERR: 0 } },
      { name: "单错自动纠正", phases: [{ inputs: { D: 13, FLT1: 1, FLT2: 0 }, steps: 1 }], outputs: { CORR: 13, DERR: 0 } },
      { name: "双位错必须报警", phases: [{ inputs: { D: 11, FLT1: 1, FLT2: 1 }, steps: 1 }], outputs: { DERR: 1 } },
    ],
    hint: "编码和校验全是异或。码字 7 位按 1..7 编号，校验位放 2 的幂位置，再加一位全偶校验：syndrome≠0 且全偶被破坏 = 纠它；syndrome≠0 且全偶完好 = 双错，报警。",
  },
];

export const STORAGE_LEVELS: Level[] = [...M1, ...M2];

export function levelById(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id) ?? STORAGE_LEVELS.find((l) => l.id === id);
}

export function levelsByTier(tier: number): Level[] {
  return LEVELS.filter((l) => l.tier === tier);
}

/** 基准成本：能自动算的就用参考解答的成本 */
export function parCost(level: Level): number | undefined {
  if (level.par !== undefined) return level.par;
  const sol = solutionDesign(level);
  return sol ? parOf(sol) : undefined;
}
