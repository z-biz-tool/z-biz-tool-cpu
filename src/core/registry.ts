import { bin } from "./types.ts";
import type { CompDef, EvalCtx, ParamSpec, PinSpec } from "./types.ts";

/* ------------------------------------------------------------------ *
 * 元件库：所有内置元件的定义与求值逻辑
 * ------------------------------------------------------------------ */

/** 解析 "0x12,34, 0b1010 / 17" 形式的数据串 */
export function parseDataList(src: string): number[] {
  if (!src.trim()) return [];
  return src
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((tok) => parseWordToken(tok));
}

export function parseWordToken(tok: string): number {
  const t = tok.trim().toLowerCase();
  if (!t) return 0;
  if (t.startsWith("0x")) return parseInt(t.slice(2) || "0", 16) >>> 0;
  if (t.startsWith("0b")) return parseInt(t.slice(2) || "0", 2) >>> 0;
  if (t.startsWith("0o")) return parseInt(t.slice(2) || "0", 8) >>> 0;
  if (t.startsWith("'") && t.length >= 2) {
    // 字符字面量 'A'
    const inner = t.replace(/'/g, "");
    const code = inner.charCodeAt(0);
    return Number.isFinite(code) ? code : 0;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n >>> 0 : 0;
}

function pin(id: string, x: number, y: number, dir: PinSpec["dir"], kind: PinSpec["kind"], extra: Partial<PinSpec> = {}): PinSpec {
  return { id, x, y, dir, kind, width: "auto", ...extra };
}

/** n 输入门：左侧均匀分布，右侧一个输出 */
function gatePins(n: number, w: number, h: number, outId = "out") {
  const pins: PinSpec[] = [];
  for (let i = 0; i < n; i++) pins.push(pin("i" + i, 0, ((i + 0.5) * h) / n, "l", "in"));
  pins.push(pin(outId, w, h / 2, "r", "out"));
  return pins;
}

function inputsParam(min = 2, max = 6): ParamSpec {
  return { key: "inputs", label: "输入数", kind: "int", min, max, step: 1, default: min, structural: true };
}

function bitsParam(defaultBits = 1): ParamSpec {
  return {
    key: "bitWidth",
    label: "位宽",
    kind: "choice",
    options: [1, 2, 4, 8, 16, 32].map((v) => ({ value: v, label: v + " bit" })),
    default: defaultBits,
    structural: true,
  };
}

function gate(
  type: string,
  label: string,
  symbol: string,
  fn: (c: EvalCtx, bits: number, vals: number[]) => number,
  opts: { inputs?: number; negate?: boolean; minInputs?: number } = {}
): CompDef {
  const n = opts.inputs ?? 2;
  const w = 2;
  const h = Math.max(1, n === 1 ? 1 : n);
  const def: CompDef = {
    type,
    label,
    category: "gate",
    size: { w, h },
    pins: gatePins(n, w, h),
    cost: n === 1 ? 1 : n,
    widthMode: "auto",
    glyph: "gate",
    symbol,
    description: label,
    params: n > 1 ? [inputsParam(opts.minInputs ?? 2, 8)] : [],
    eval(c) {
      const bits = c.bits;
      const vals = c.ins.map((id) => c.r(id));
      c.w("out", fn(c, bits, vals));
    },
  };
  return def;
}

const allOnes = (bits: number) => (bits >= 32 ? 0xffffffff : (1 << bits) - 1);

export const BUILTIN_DEFS: CompDef[] = [
  /* ---------------- 输入 / 输出 ---------------- */
  {
    type: "input",
    label: "输入开关",
    category: "io",
    size: { w: 3, h: 2 },
    pins: [pin("out", 3, 1, "r", "out")],
    cost: 0,
    widthMode: "param",
    glyph: "io",
    boundary: true,
    params: [bitsParam(1), { key: "init", label: "初值", kind: "hex", default: 0 }],
    eval(c) {
      c.w("out", c.s.v ?? c.p<number>("init") ?? 0);
    },
    description: "可手动切换的输入端；子电路中作为对外输入引脚",
  },
  {
    type: "button",
    label: "点动按钮",
    category: "io",
    size: { w: 3, h: 2 },
    pins: [pin("out", 3, 1, "r", "out")],
    cost: 0,
    widthMode: "one",
    glyph: "io",
    params: [],
    eval(c) {
      c.w("out", c.s.v ?? 0);
    },
    description: "按住为 1，松开为 0（空格或点击）",
  },
  {
    type: "clock",
    label: "时钟源",
    category: "io",
    size: { w: 3, h: 2 },
    pins: [pin("out", 3, 1, "r", "out")],
    cost: 0,
    widthMode: "one",
    glyph: "io",
    params: [
      { key: "divide", label: "分频(每 N 拍一个上升沿)", kind: "int", min: 1, max: 64, default: 1 },
      { key: "auto", label: "自动随时钟走", kind: "bool", default: true },
    ],
    eval(c) {
      c.w("out", c.s.hi ?? 0);
    },
    description: "每拍输出一个正脉冲，divide 控制分频；关掉自动后可手动拨电平",
  },
  {
    type: "const",
    label: "常量",
    category: "io",
    size: { w: 2, h: 1 },
    pins: [pin("out", 2, 0.5, "r", "out", { widthParam: "bitWidth" })],
    cost: 1,
    widthMode: "param",
    glyph: "io",
    params: [bitsParam(1), { key: "value", label: "值", kind: "hex", default: 0 }],
    eval(c) {
      c.w("out", c.p<number>("value") ?? 0);
    },
  },
  {
    type: "output",
    label: "输出灯",
    category: "io",
    size: { w: 3, h: 2 },
    pins: [pin("in", 0, 1, "l", "in")],
    cost: 0,
    widthMode: "param",
    glyph: "io",
    free: true,
    boundary: true,
    params: [
      bitsParam(1),
      { key: "radix", label: "显示", kind: "choice", options: [
        { value: "bin", label: "二进制" },
        { value: "hex", label: "十六进制" },
        { value: "dec", label: "十进制" },
        { value: "led", label: "指示灯" },
      ], default: "bin" },
    ],
    description: "观测信号；子电路中作为对外输出引脚",
  },
  {
    type: "note",
    label: "文本注释",
    category: "util",
    size: { w: 4, h: 2 },
    pins: [],
    cost: 0,
    widthMode: "one",
    glyph: "label",
    free: true,
    params: [{ key: "text", label: "内容", kind: "text", default: "注释" }],
  },

  /* ---------------- 逻辑门 ---------------- */
  gate("not", "非门 NOT", "1", (_c, bits, v) => (~v[0]) & allOnes(bits), { inputs: 1 }),
  gate("buf", "缓冲器", "1", (_c, bits, v) => v[0] & allOnes(bits), { inputs: 1 }),
  gate("and", "与门 AND", "&", (_c, bits, v) => v.reduce((a, b) => a & b, allOnes(bits)), { inputs: 2 }),
  gate("or", "或门 OR", "≥1", (_c, bits, v) => v.reduce((a, b) => a | b, 0) & allOnes(bits), { inputs: 2 }),
  gate("xor", "异或门 XOR", "⊕", (_c, bits, v) => v.reduce((a, b) => a ^ b, 0) & allOnes(bits), { inputs: 2 }),
  gate("nand", "与非门 NAND", "⊼", (_c, bits, v) => (~v.reduce((a, b) => a & b, allOnes(bits))) & allOnes(bits), { inputs: 2 }),
  gate("nor", "或非门 NOR", "⊽", (_c, bits, v) => (~v.reduce((a, b) => a | b, 0)) & allOnes(bits), { inputs: 2 }),
  gate("xnor", "同或门 XNOR", "⊙", (_c, bits, v) => (~v.reduce((a, b) => a ^ b, 0)) & allOnes(bits), { inputs: 2 }),

  /* ---------------- 算术 / 运算 ---------------- */
  {
    type: "add",
    label: "加法器",
    category: "math",
    size: { w: 3, h: 3 },
    pins: [
      pin("a", 0, 1, "l", "in"),
      pin("b", 0, 2, "l", "in"),
      pin("cin", 0, 0.4, "l", "in", { width: 1 }),
      pin("sum", 3, 1, "r", "out"),
      pin("cout", 3, 2.2, "r", "out", { width: 1 }),
    ],
    cost: 4,
    widthMode: "auto",
    glyph: "box",
    symbol: "+",
    params: [],
    eval(c) {
      const bits = c.bits;
      const s = c.r("a") + c.r("b") + c.r("cin");
      c.w("sum", s & allOnes(bits));
      c.w("cout", Math.floor(s / 2 ** bits) & 1);
    },
    description: "行波进位加法，sum = a + b + cin",
  },
  {
    type: "sub",
    label: "减法器",
    category: "math",
    size: { w: 3, h: 3 },
    pins: [
      pin("a", 0, 1, "l", "in"),
      pin("b", 0, 2, "l", "in"),
      pin("diff", 3, 1, "r", "out"),
      pin("borrow", 3, 2.2, "r", "out", { width: 1 }),
    ],
    cost: 5,
    widthMode: "auto",
    glyph: "box",
    symbol: "−",
    eval(c) {
      const bits = c.bits;
      const a = c.r("a");
      const b = c.r("b");
      c.w("diff", (a - b) & allOnes(bits));
      c.w("borrow", a < b ? 1 : 0);
    },
  },
  {
    type: "cmp",
    label: "比较器",
    category: "math",
    size: { w: 3, h: 4 },
    pins: [
      pin("a", 0, 1.5, "l", "in"),
      pin("b", 0, 2.5, "l", "in"),
      pin("lt", 3, 1, "r", "out", { width: 1 }),
      pin("eq", 3, 2, "r", "out", { width: 1 }),
      pin("gt", 3, 3, "r", "out", { width: 1 }),
    ],
    cost: 4,
    widthMode: "auto",
    glyph: "box",
    symbol: "⋚",
    params: [{ key: "signed", label: "按有符号比较", kind: "bool", default: false }],
    eval(c) {
      const bits = c.bits;
      const a = c.r("a");
      const b = c.r("b");
      const eq = a === b ? 1 : 0;
      let lt: number;
      if (c.p<boolean>("signed")) {
        const sa = toSignedLocal(a, bits);
        const sb = toSignedLocal(b, bits);
        lt = sa < sb ? 1 : 0;
      } else lt = a < b ? 1 : 0;
      c.w("lt", lt);
      c.w("eq", eq);
      c.w("gt", eq || lt ? 0 : 1);
    },
  },
  {
    type: "alu",
    label: "ALU 算术逻辑单元",
    category: "math",
    size: { w: 4, h: 5 },
    pins: [
      pin("a", 0, 1, "l", "in"),
      pin("b", 0, 2, "l", "in"),
      pin("op", 0, 3.6, "l", "in", { width: 3 }),
      pin("out", 4, 1, "r", "out"),
      pin("zero", 4, 2.4, "r", "out", { width: 1 }),
      pin("carry", 4, 3.4, "r", "out", { width: 1 }),
      pin("neg", 4, 4.4, "r", "out", { width: 1 }),
    ],
    cost: 12,
    widthMode: "auto",
    glyph: "box",
    symbol: "ALU",
    params: [],
    eval(c) {
      const bits = c.bits;
      const a = c.r("a");
      const b = c.r("b");
      const m = allOnes(bits);
      const op = c.r("op") & 7;
      let out = 0;
      let carry = 0;
      switch (op) {
        case 0: {
          const s = a + b;
          out = s & m;
          carry = Math.floor(s / 2 ** bits) & 1;
          break;
        }
        case 1: {
          out = (a - b) & m;
          carry = a < b ? 1 : 0;
          break;
        }
        case 2:
          out = a & b;
          break;
        case 3:
          out = a | b;
          break;
        case 4:
          out = a ^ b;
          break;
        case 5:
          out = ~a & m;
          break;
        case 6: {
          const sh = b & 31;
          out = (a << sh) & m;
          carry = sh ? (a >>> (bits - sh)) & 1 : 0;
          break;
        }
        default: {
          const sh = b & 31;
          out = bits >= 32 ? a >>> sh : (a >>> sh) & m;
          carry = sh ? (a >>> (sh - 1)) & 1 : 0;
          break;
        }
      }
      c.w("out", out);
      c.w("zero", out === 0 ? 1 : 0);
      c.w("carry", carry);
      c.w("neg", (out >>> (bits - 1)) & 1);
    },
    description: "op: 0 加 1 减 2 与 3 或 4 异或 5 非 6 左移 7 右移",
  },
  {
    type: "shift",
    label: "移位器",
    category: "math",
    size: { w: 3, h: 3 },
    pins: [
      pin("a", 0, 1, "l", "in"),
      pin("sh", 0, 2, "l", "in", { width: 5 }),
      pin("out", 3, 1.2, "r", "out"),
    ],
    cost: 5,
    widthMode: "auto",
    glyph: "box",
    symbol: "»",
    params: [
      { key: "dir", label: "方向", kind: "choice", options: [
        { value: "left", label: "左移" },
        { value: "right", label: "右移" },
      ], default: "left" },
      { key: "arith", label: "算术(符号扩展)", kind: "bool", default: false },
    ],
    eval(c) {
      const bits = c.bits;
      const m = allOnes(bits);
      const a = c.r("a");
      const sh = Math.min(bits, c.r("sh") & 31);
      if (c.p<string>("dir") === "left") {
        c.w("out", (a << sh) & m);
      } else if (c.p<boolean>("arith")) {
        c.w("out", toSignedLocal(a, bits) >> sh);
      } else {
        c.w("out", bits >= 32 ? a >>> sh : (a >>> sh) & m);
      }
    },
  },

  /* ---------------- 选择 / 总线 ---------------- */
  {
    type: "mux",
    label: "多路选择器",
    category: "mux",
    size: { w: 3, h: 3 },
    pins: [
      pin("sel", 0, 0.5, "l", "in", { width: 1, selParam: "inputs" }),
      pin("i0", 0, 1.5, "l", "in"),
      pin("i1", 0, 2.5, "l", "in"),
      pin("out", 3, 1.5, "r", "out"),
    ],
    cost: 3,
    widthMode: "auto",
    glyph: "box",
    symbol: "MUX",
    params: [inputsParam(2, 8)],
    eval(c) {
      const n = c.p<number>("inputs") || 2;
      const selWidth = Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
      const sel = c.r("sel") & allOnes(selWidth);
      const src = c.r("i" + Math.min(sel, n - 1));
      c.w("out", src);
    },
    description: "按 sel 选择一路输入",
  },
  {
    type: "demux",
    label: "分配器 / 译码器",
    category: "mux",
    size: { w: 3, h: 2 },
    pins: [
      pin("sel", 0, 1, "l", "in", { width: 1 }),
      pin("o0", 3, 0.5, "r", "out", { width: 1 }),
      pin("o1", 3, 1.5, "r", "out", { width: 1 }),
    ],
    cost: 2,
    widthMode: "one",
    glyph: "box",
    symbol: "DEC",
    params: [inputsParam(2, 8)],
    eval(c) {
      const n = c.p<number>("inputs") || 2;
      const sel = c.r("sel") & allOnes(Math.max(1, Math.ceil(Math.log2(Math.max(2, n)))));
      for (let k = 0; k < n; k++) c.w("o" + k, sel === k ? 1 : 0);
    },
  },
  {
    type: "split",
    label: "分线器",
    category: "bus",
    size: { w: 3, h: 2 },
    pins: [pin("in", 0, 1, "l", "in", { widthParam: "bitWidth" })],
    cost: 1,
    widthMode: "param",
    glyph: "box",
    symbol: "↦",
    params: [bitsParam(4)],
    eval(c) {
      const bits = c.bits;
      const v = c.r("in");
      for (let i = 0; i < bits; i++) c.w("b" + i, (v >>> i) & 1);
    },
    description: "把 N 位总线拆成 N 根单线",
  },
  {
    type: "merge",
    label: "合线器",
    category: "bus",
    size: { w: 3, h: 2 },
    pins: [pin("out", 3, 1, "r", "out", { widthParam: "bitWidth" })],
    cost: 1,
    widthMode: "param",
    glyph: "box",
    symbol: "↤",
    params: [bitsParam(4)],
    eval(c) {
      const bits = c.bits;
      let v = 0;
      for (let i = 0; i < bits; i++) v |= (c.r("b" + i) & 1) << i;
      c.w("out", v);
    },
    description: "把 N 根单线合成 N 位总线",
  },

  /* ---------------- 时序元件 ---------------- */
  {
    type: "dff",
    label: "D 触发器",
    category: "seq",
    size: { w: 2, h: 2 },
    pins: [
      pin("clk", 0, 0.5, "l", "in", { width: 1, clock: true }),
      pin("d", 0, 1.5, "l", "in"),
      pin("q", 2, 1, "r", "out"),
    ],
    cost: 2,
    widthMode: "auto",
    glyph: "box",
    symbol: "D",
    eval(c) {
      c.w("q", c.s.q ?? 0);
    },
    onRise(c) {
      c.s.q = c.r("d");
    },
  },
  {
    type: "tff",
    label: "T 触发器",
    category: "seq",
    size: { w: 2, h: 2 },
    pins: [
      pin("clk", 0, 0.5, "l", "in", { width: 1, clock: true }),
      pin("t", 0, 1.5, "l", "in", { width: 1 }),
      pin("q", 2, 1, "r", "out", { width: 1 }),
    ],
    cost: 3,
    widthMode: "one",
    glyph: "box",
    symbol: "T",
    eval(c) {
      c.w("q", c.s.q ?? 0);
    },
    onRise(c) {
      if (c.r("t")) c.s.q = (c.s.q ?? 0) ^ 1;
    },
  },
  {
    type: "dlatch",
    label: "D 锁存器",
    category: "seq",
    size: { w: 2, h: 2 },
    pins: [
      pin("e", 0, 0.5, "l", "in", { width: 1 }),
      pin("d", 0, 1.5, "l", "in"),
      pin("q", 2, 1, "r", "out"),
    ],
    cost: 2,
    widthMode: "auto",
    glyph: "box",
    symbol: "L",
    eval(c) {
      if (c.r("e")) c.s.q = c.r("d");
      c.w("q", c.s.q ?? 0);
    },
    description: "电平敏感：e=1 时跟随 d",
  },
  {
    type: "reg",
    label: "寄存器",
    category: "seq",
    size: { w: 3, h: 3 },
    pins: [
      pin("clk", 0, 0.5, "l", "in", { width: 1, clock: true }),
      pin("load", 0, 1.5, "l", "in", { width: 1 }),
      pin("d", 0, 2.5, "l", "in"),
      pin("q", 3, 1.5, "r", "out"),
    ],
    cost: 4,
    widthMode: "auto",
    glyph: "box",
    symbol: "REG",
    params: [],
    eval(c) {
      c.w("q", c.s.q ?? 0);
    },
    onRise(c) {
      if (c.r("load")) c.s.q = c.r("d");
    },
    description: "上升沿且 load=1 时锁存 d；可命名后在 CPU 视图观察",
  },
  {
    type: "counter",
    label: "计数器",
    category: "seq",
    size: { w: 3, h: 3 },
    pins: [
      pin("clk", 0, 0.5, "l", "in", { width: 1, clock: true }),
      pin("en", 0, 1.5, "l", "in", { width: 1 }),
      pin("rst", 0, 2.5, "l", "in", { width: 1 }),
      pin("out", 3, 1.5, "r", "out", { widthParam: "bitWidth" }),
    ],
    cost: 6,
    widthMode: "param",
    glyph: "box",
    symbol: "CNT",
    params: [bitsParam(4), { key: "down", label: "递减", kind: "bool", default: false }],
    eval(c) {
      c.w("out", c.s.c ?? 0);
    },
    onRise(c) {
      const bits = c.bits;
      if (c.r("rst")) {
        c.s.c = 0;
        return;
      }
      if (!c.r("en")) return;
      const cur = c.s.c ?? 0;
      const m = allOnes(bits);
      c.s.c = c.p<boolean>("down") ? (cur - 1) & m : (cur + 1) & m;
    },
  },

  /* ---------------- 存储 ---------------- */
  {
    type: "ram",
    label: "RAM 随机存储器",
    category: "mem",
    size: { w: 4, h: 6 },
    pins: [
      pin("clk", 0, 0.5, "l", "in", { width: 1, clock: true }),
      pin("wen", 0, 1.5, "l", "in", { width: 1 }),
      pin("addr", 0, 3, "l", "in", { widthParam: "addrBits" }),
      pin("din", 0, 4.5, "l", "in", { widthParam: "bitWidth" }),
      pin("dout", 4, 3, "r", "out", { widthParam: "bitWidth" }),
    ],
    cost: 8,
    widthMode: "param",
    glyph: "mem",
    symbol: "RAM",
    params: [
      bitsParam(16),
      { key: "addrBits", label: "地址线", kind: "int", min: 1, max: 16, default: 8, structural: true },
      { key: "data", label: "初始内容", kind: "data", default: "" },
    ],
    eval(c) {
      const mem = memOf(c);
      c.w("dout", mem[c.r("addr")] ?? 0);
    },
    onRise(c) {
      if (!c.r("wen")) return;
      const mem = memOf(c);
      mem[c.r("addr")] = c.r("din");
    },
    description: "组合读、上升沿写",
  },
  {
    type: "rom",
    label: "ROM / 查找表",
    category: "mem",
    size: { w: 4, h: 5 },
    pins: [
      pin("addr", 0, 2, "l", "in", { widthParam: "addrBits" }),
      pin("out", 4, 2, "r", "out", { widthParam: "bitWidth" }),
    ],
    cost: 6,
    widthMode: "param",
    glyph: "mem",
    symbol: "ROM",
    params: [
      bitsParam(8),
      { key: "addrBits", label: "地址线", kind: "int", min: 1, max: 16, default: 4, structural: true },
      { key: "data", label: "内容", kind: "data", default: "" },
    ],
    eval(c) {
      const mem = memOf(c);
      c.w("out", mem[c.r("addr")] ?? 0);
    },
    description: "只读存储，可用作指令译码器 / 微码",
  },

  /* ---------------- 调试 ---------------- */
  {
    type: "print",
    label: "终端输出",
    category: "util",
    size: { w: 3, h: 3 },
    pins: [
      pin("clk", 0, 0.5, "l", "in", { width: 1, clock: true }),
      pin("en", 0, 1.5, "l", "in", { width: 1 }),
      pin("val", 0, 2.5, "l", "in"),
    ],
    cost: 2,
    widthMode: "auto",
    glyph: "box",
    symbol: "PRINT",
    params: [
      {
        key: "radix",
        label: "显示",
        kind: "choice",
        options: [
          { value: "dec", label: "十进制" },
          { value: "hex", label: "十六进制" },
          { value: "bin", label: "二进制" },
          { value: "char", label: "字符" },
        ],
        default: "dec",
      },
    ],
    onRise(c) {
      if (!c.r("en")) return;
      const v = c.r("val");
      const radix = c.p<string>("radix");
      const text =
        radix === "hex"
          ? "0x" + (v >>> 0).toString(16).toUpperCase()
          : radix === "bin"
            ? bin(v, c.bits)
            : radix === "char"
              ? String.fromCharCode(v & 255)
              : String(v >>> 0);
      c.log?.(text);
    },
    description: "上升沿且 en=1 时把 val 输出到运行日志",
  },
];

function memOf(c: EvalCtx): number[] {
  const key = "data:" + String(c.p<string>("data") ?? "") + "|" + c.bits + "|" + c.p<number>("addrBits");
  if (c.s._memKey !== key || !c.s._mem) {
    const depth = 2 ** (c.p<number>("addrBits") || 8);
    const arr = new Array<number>(depth).fill(0);
    const src = parseDataList(String(c.p<string>("data") ?? ""));
    const m = allOnes(c.bits);
    for (let i = 0; i < Math.min(src.length, depth); i++) arr[i] = src[i] & m;
    c.s._mem = arr;
    c.s._memKey = key;
  }
  return c.s._mem as number[];
}

function toSignedLocal(v: number, bits: number): number {
  const m = allOnes(bits);
  const x = v & m;
  if (bits >= 32) return x | 0;
  const sign = 1 << (bits - 1);
  return (x ^ sign) - sign;
}

/** 引脚数量随参数变化的元件：重建引脚表 */
function expandInputs(def: CompDef, params: Record<string, number | string | boolean>): CompDef {
  const hasCount = (def.params ?? []).some((p) => p.key === "inputs");
  const isMux = def.type === "mux";
  const isDemux = def.type === "demux";
  const baseData = def.pins.filter((p) => p.kind === "in" && /^i\d/.test(p.id)).length;
  const baseOuts = def.pins.filter((p) => p.kind === "out" && /^o\d/.test(p.id)).length;
  const raw = hasCount ? Number(params.inputs) || 0 : 0;
  const n = Math.max(1, Math.min(8, raw || (isDemux ? baseOuts : baseData || 2)));
  const w = def.size.w;
  const h = isMux ? n + 1 : isDemux ? Math.max(2, n) : Math.max(1, n);
  const selBits = Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
  const pins: PinSpec[] = [];
  if (isMux) pins.push(pin("sel", 0, 0.5, "l", "in", { width: selBits, selParam: "inputs" }));
  if (isDemux) pins.push(pin("sel", 0, h / 2, "l", "in", { width: selBits, selParam: "inputs" }));
  for (let i = 0; i < n; i++) {
    const y = isMux ? i + 1.5 : ((i + 0.5) * h) / n;
    pins.push(
      isDemux ? pin("o" + i, w, y, "r", "out", { width: 1 }) : pin("i" + i, 0, y, "l", "in")
    );
  }
  if (!isDemux) pins.push(pin("out", w, h / 2, "r", "out"));
  const cost = isMux ? n + 1 : isDemux ? n : Math.max(1, n);
  return { ...def, size: { w, h }, pins, cost };
}

/** split / merge 的逐位引脚按位宽生成 */
function expandBits(def: CompDef, params: Record<string, number | string | boolean>): CompDef {
  const bits = Math.max(1, Math.min(32, Number(params.bitWidth) || 4));
  const h = Math.max(2, bits);
  const pins: PinSpec[] = [];
  const wide = def.pins.find((p) => p.widthParam === "bitWidth")!;
  const isSplit = def.type === "split";
  pins.push(pin(wide.id, wide.x, h / 2, wide.dir, wide.kind, { widthParam: "bitWidth" }));
  for (let i = 0; i < bits; i++) {
    const y = ((i + 0.5) * h) / bits;
    pins.push(
      isSplit ? pin("b" + i, 3, y, "r", "out", { width: 1 }) : pin("b" + i, 0, y, "l", "in", { width: 1 })
    );
  }
  return { ...def, size: { w: def.size.w, h }, pins };
}

/** 按参数解析出实际使用的元件定义（引脚数量/位宽会改变外形） */
export function resolveDef(type: string, params: Record<string, number | string | boolean>): CompDef | undefined {
  const base = DEF_MAP.get(type);
  if (!base) return undefined;
  if (type === "split" || type === "merge") return expandBits(base, params);
  if (base.category === "gate" || type === "mux" || type === "demux") return expandInputs(base, params);
  return base;
}

const DEF_MAP = new Map<string, CompDef>(BUILTIN_DEFS.map((d) => [d.type, d]));

export function baseDef(type: string): CompDef | undefined {
  return DEF_MAP.get(type);
}

export const CATEGORY_LABEL: Record<string, string> = {
  io: "输入输出",
  gate: "逻辑门",
  math: "运算",
  mux: "选择器",
  bus: "总线",
  seq: "时序",
  mem: "存储",
  util: "辅助",
};

/** 元件库中可拖出的元件；includeIo 时把子电路边界用的输入/输出也列出 */
export function paletteDefs(includeIo = false): CompDef[] {
  return BUILTIN_DEFS.filter((d) => !d.boundary || (includeIo && d.category === "io"));
}

export function defaultParams(def: CompDef): Record<string, number | string | boolean> {
  const p: Record<string, number | string | boolean> = {};
  for (const spec of def.params ?? []) p[spec.key] = spec.default;
  return p;
}
