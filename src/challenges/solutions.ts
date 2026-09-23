import { wireReferenceCpu } from "../cpu/reference.ts";
import { CircuitBuilder } from "../core/build.ts";
import type { CustomDef, Design } from "../core/types.ts";

/* ------------------------------------------------------------------ *
 * 参考解答：每关一个「在骨架上补线」的函数。
 * 它们既用于判题自检，也可以在界面里一键载入对照。
 * ------------------------------------------------------------------ */

export type Fix = (design: Design) => void;

function onRoot(fn: (b: CircuitBuilder, design: Design) => void): Fix {
  return (design) => {
    const b = new CircuitBuilder();
    b.seed(design.root);
    fn(b, design);
    design.root = b.build();
  };
}

/** 子电路边界：输入 / 输出元件的 id 就是对外引脚名 */
function ioIn(b: CircuitBuilder, pin: string, y: number, bits: number) {
  return b.add("input", 0, y, { bitWidth: bits }, { id: pin, name: pin.toUpperCase() });
}

function ioOut(b: CircuitBuilder, pin: string, x: number, y: number, bits: number) {
  return b.add("output", x, y, { bitWidth: bits }, { id: pin, name: pin.toUpperCase() });
}

/* ---------------- 子电路：一位全加器 ---------------- */

function fullAdderDef(): CustomDef {
  const c = new CircuitBuilder();
  ioIn(c, "a", 0, 1);
  ioIn(c, "b", 4, 1);
  ioIn(c, "cin", 8, 1);
  ioOut(c, "sum", 26, 0, 1);
  ioOut(c, "cout", 26, 6, 1);
  const x1 = c.add("xor", 8, 0, {});
  const x2 = c.add("xor", 14, 0, {});
  const a1 = c.add("and", 8, 5, {});
  const a2 = c.add("and", 14, 5, {});
  const o = c.add("or", 20, 5, {});
  c.link([
    ["a", "out", x1, "i0"],
    ["b", "out", x1, "i1"],
    [x1, "out", x2, "i0"],
    ["cin", "out", x2, "i1"],
    [x1, "out", a1, "i0"],
    ["cin", "out", a1, "i1"],
    ["a", "out", a2, "i0"],
    ["b", "out", a2, "i1"],
    [a1, "out", o, "i0"],
    [a2, "out", o, "i1"],
    [x2, "out", "sum", "in"],
    [o, "out", "cout", "in"],
  ]);
  return { id: "fulladder", name: "全加器", circuit: c.build() };
}

/* ---------------- 子电路：8 位 ALU ---------------- */

function alu8Def(): CustomDef {
  const c = new CircuitBuilder();
  ioIn(c, "a", 0, 8);
  ioIn(c, "b", 6, 8);
  ioIn(c, "op", 12, 3);
  ioOut(c, "r", 44, 0, 8);
  ioOut(c, "z", 44, 9, 1);
  const add = c.add("add", 10, 0, {});
  const sub = c.add("sub", 10, 6, {});
  const and = c.add("and", 10, 12, {});
  const or = c.add("or", 10, 17, {});
  const xor = c.add("xor", 10, 22, {});
  const not = c.add("not", 10, 27, { inputs: 1 });
  const shl = c.add("shift", 10, 32, { dir: "left" });
  const shr = c.add("shift", 10, 37, { dir: "right" });
  const mux = c.add("mux", 26, 0, { inputs: 8 });
  const zero = c.add("cmp", 26, 20, {});
  const z0 = c.add("const", 20, 26, { bitWidth: 8, value: 0 });
  c.link([
    ["a", "out", add, "a"],
    ["b", "out", add, "b"],
    ["a", "out", sub, "a"],
    ["b", "out", sub, "b"],
    ["a", "out", and, "i0"],
    ["b", "out", and, "i1"],
    ["a", "out", or, "i0"],
    ["b", "out", or, "i1"],
    ["a", "out", xor, "i0"],
    ["b", "out", xor, "i1"],
    ["a", "out", not, "i0"],
    ["a", "out", shl, "a"],
    ["b", "out", shl, "sh"],
    ["a", "out", shr, "a"],
    ["b", "out", shr, "sh"],
    ["op", "out", mux, "sel"],
    [mux, "out", "r", "in"],
    [mux, "out", zero, "a"],
    [z0, "out", zero, "b"],
    [zero, "eq", "z", "in"],
  ]);
  const outs = [add, sub, and, or, xor, not, shl, shr];
  outs.forEach((id, i) => c.connect(id, i === 0 ? "sum" : i === 1 ? "diff" : "out", mux, "i" + i));
  return { id: "alu8", name: "ALU8", circuit: c.build() };
}

/* ================================================================== *
 * 各关参考解答
 * ================================================================== */

export const SOLUTIONS: Record<string, Fix> = {
  /* ---------------- 第一层 ---------------- */
  "t1-gates": onRoot((b) => {
    const na = b.add("nand", 8, 1, {});
    const nb = b.add("nand", 8, 8, {});
    const nab = b.add("nand", 12, 4, {});
    const ab = b.add("nand", 18, 4, {});
    const o = b.add("nand", 18, 10, {});
    b.link([
      ["A", "out", na, "i0"],
      ["A", "out", na, "i1"],
      ["B", "out", nb, "i0"],
      ["B", "out", nb, "i1"],
      ["A", "out", nab, "i0"],
      ["B", "out", nab, "i1"],
      [nab, "out", ab, "i0"],
      [nab, "out", ab, "i1"],
      [na, "out", o, "i0"],
      [nb, "out", o, "i1"],
      [na, "out", "NA", "in"],
      [ab, "out", "AB", "in"],
      [o, "out", "OR", "in"],
    ]);
  }),

  "t1-xor": onRoot((b) => {
    const n1 = b.add("nand", 8, 2, {});
    const n2 = b.add("nand", 14, 0, {});
    const n3 = b.add("nand", 14, 6, {});
    const x = b.add("nand", 20, 3, {});
    b.link([
      ["A", "out", n1, "i0"],
      ["B", "out", n1, "i1"],
      ["A", "out", n2, "i0"],
      [n1, "out", n2, "i1"],
      ["B", "out", n3, "i0"],
      [n1, "out", n3, "i1"],
      [n2, "out", x, "i0"],
      [n3, "out", x, "i1"],
      [x, "out", "X", "in"],
    ]);
  }),

  "t1-mux2": onRoot((b) => {
    const ns = b.add("not", 8, 0, {});
    const a1 = b.add("and", 14, 0, {});
    const a2 = b.add("and", 14, 6, {});
    const y = b.add("or", 20, 3, {});
    b.link([
      ["S", "out", ns, "i0"],
      [ns, "out", a1, "i0"],
      ["A", "out", a1, "i1"],
      ["S", "out", a2, "i0"],
      ["B", "out", a2, "i1"],
      [a1, "out", y, "i0"],
      [a2, "out", y, "i1"],
      [y, "out", "Y", "in"],
    ]);
  }),

  "t1-halfadd": onRoot((b) => {
    const x = b.add("xor", 10, 0, {});
    const a = b.add("and", 10, 6, {});
    b.link([
      ["A", "out", x, "i0"],
      ["B", "out", x, "i1"],
      ["A", "out", a, "i0"],
      ["B", "out", a, "i1"],
      [x, "out", "SUM", "in"],
      [a, "out", "COUT", "in"],
    ]);
  }),

  "t1-fulladd": onRoot((b) => {
    const x1 = b.add("xor", 10, 0, {});
    const s = b.add("xor", 16, 0, {});
    const c1 = b.add("and", 10, 6, {});
    const c2 = b.add("and", 16, 6, {});
    const co = b.add("or", 22, 6, {});
    b.link([
      ["A", "out", x1, "i0"],
      ["B", "out", x1, "i1"],
      [x1, "out", s, "i0"],
      ["CIN", "out", s, "i1"],
      [x1, "out", c1, "i0"],
      ["CIN", "out", c1, "i1"],
      ["A", "out", c2, "i0"],
      ["B", "out", c2, "i1"],
      [c1, "out", co, "i0"],
      [c2, "out", co, "i1"],
      [s, "out", "SUM", "in"],
      [co, "out", "COUT", "in"],
    ]);
  }),

  "t1-dec24": onRoot((b) => {
    const n0 = b.add("not", 8, 0, {});
    const n1 = b.add("not", 8, 6, {});
    b.link([
      ["S0", "out", n0, "i0"],
      ["S1", "out", n1, "i0"],
    ]);
    const sig = { S0: "S0", S1: "S1", n0, n1 };
    const tbl: [string, keyof typeof sig, keyof typeof sig][] = [
      ["Y0", "n1", "n0"],
      ["Y1", "n1", "S0"],
      ["Y2", "S1", "n0"],
      ["Y3", "S1", "S0"],
    ];
    tbl.forEach(([out, ia, ib], i) => {
      const g = b.add("and", 16, i * 5, {});
      b.connect(sig[ia], "out", g, "i0");
      b.connect(sig[ib], "out", g, "i1");
      b.connect(g, "out", out, "in");
    });
  }),

  "t1-enc4": onRoot((b) => {
    const n2 = b.add("not", 8, 8, {});
    const a = b.add("and", 14, 8, {});
    const y0 = b.add("or", 20, 4, {});
    const y1 = b.add("or", 14, 16, {});
    const v = b.add("or", 20, 20, { inputs: 4 });
    const mg = b.add("merge", 26, 2, { bitWidth: 2 });
    b.link([
      ["D2", "out", n2, "i0"],
      [n2, "out", a, "i0"],
      ["D1", "out", a, "i1"],
      ["D3", "out", y0, "i0"],
      [a, "out", y0, "i1"],
      ["D3", "out", y1, "i0"],
      ["D2", "out", y1, "i1"],
      ["D0", "out", v, "i0"],
      ["D1", "out", v, "i1"],
      ["D2", "out", v, "i2"],
      ["D3", "out", v, "i3"],
      [y0, "out", mg, "b0"],
      [y1, "out", mg, "b1"],
      [mg, "out", "Y", "in"],
      [v, "out", "V", "in"],
    ]);
  }),

  /* ---------------- 第二层 ---------------- */
  "t2-add4": onRoot((b, design) => {
    design.defs.push(fullAdderDef());
    const sa = b.add("split", 8, 14, { bitWidth: 4 });
    const sb = b.add("split", 8, 22, { bitWidth: 4 });
    const mg = b.add("merge", 40, 14, { bitWidth: 4 });
    const c0 = b.add("const", 8, 30, { bitWidth: 1, value: 0 });
    b.link([
      ["A", "out", sa, "in"],
      ["B", "out", sb, "in"],
    ]);
    let prev = "";
    for (let i = 0; i < 4; i++) {
      const fa = b.add("custom:fulladder", 14 + i * 7, 2 + i * 6, {});
      b.connect(sa, "b" + i, fa, "a");
      b.connect(sb, "b" + i, fa, "b");
      if (!prev) b.connect(c0, "out", fa, "cin");
      else b.connect(prev, "cout", fa, "cin");
      b.connect(fa, "sum", mg, "b" + i);
      prev = fa;
      if (i === 3) b.connect(fa, "cout", "C", "in");
    }
    b.connect(mg, "out", "S", "in");
  }),

  "t2-addsub": onRoot((b) => {
    const sa = b.add("split", 8, 0, { bitWidth: 4 });
    const sb = b.add("split", 8, 8, { bitWidth: 4 });
    const sr = b.add("split", 32, 0, { bitWidth: 4 });
    const mg = b.add("merge", 22, 8, { bitWidth: 4 });
    b.link([
      ["A", "out", sa, "in"],
      ["B", "out", sb, "in"],
    ]);
    const bx: string[] = [];
    for (let i = 0; i < 4; i++) {
      const x = b.add("xor", 14, 1 + i * 2, {});
      b.connect(sb, "b" + i, x, "i0");
      b.connect("M", "out", x, "i1");
      b.connect(x, "out", mg, "b" + i);
      bx.push(x);
    }
    const add = b.add("add", 28, 4, {});
    b.link([
      ["A", "out", add, "a"],
      [mg, "out", add, "b"],
      ["M", "out", add, "cin"],
      [add, "sum", "R", "in"],
      [add, "sum", sr, "in"],
    ]);
    const v1 = b.add("xor", 38, 2, {});
    const v2 = b.add("xor", 38, 6, {});
    const v3 = b.add("and", 43, 4, {});
    b.link([
      [sa, "b3", v1, "i0"],
      [sr, "b3", v1, "i1"],
      [bx[3], "out", v2, "i0"],
      [sr, "b3", v2, "i1"],
      [v1, "out", v3, "i0"],
      [v2, "out", v3, "i1"],
      [v3, "out", "V", "in"],
    ]);
  }),

  "t2-alu4": onRoot((b) => {
    const add = b.add("add", 10, 0, {});
    const sub = b.add("sub", 10, 6, {});
    const and = b.add("and", 10, 13, {});
    const or = b.add("or", 10, 18, {});
    const mux = b.add("mux", 24, 0, { inputs: 4 });
    const zero = b.add("cmp", 32, 8, {});
    const z0 = b.add("const", 26, 14, { bitWidth: 4, value: 0 });
    b.link([
      ["A", "out", add, "a"],
      ["B", "out", add, "b"],
      ["A", "out", sub, "a"],
      ["B", "out", sub, "b"],
      ["A", "out", and, "i0"],
      ["B", "out", and, "i1"],
      ["A", "out", or, "i0"],
      ["B", "out", or, "i1"],
      [add, "sum", mux, "i0"],
      [sub, "diff", mux, "i1"],
      [and, "out", mux, "i2"],
      [or, "out", mux, "i3"],
      ["OP", "out", mux, "sel"],
      [mux, "out", "R", "in"],
      [mux, "out", zero, "a"],
      [z0, "out", zero, "b"],
      [zero, "eq", "Z", "in"],
    ]);
  }),

  "t2-cmp4": onRoot((b) => {
    const sa = b.add("split", 8, 0, { bitWidth: 4 });
    const sb = b.add("split", 8, 8, { bitWidth: 4 });
    const one = b.add("const", 8, 20, { bitWidth: 1, value: 1 });
    const zero = b.add("const", 8, 24, { bitWidth: 1, value: 0 });
    b.link([
      ["A", "out", sa, "in"],
      ["B", "out", sb, "in"],
    ]);
    let gt = zero;
    let lt = zero;
    let eq = one;
    for (let i = 3; i >= 0; i--) {
      const y = 2 + (3 - i) * 6;
      const na = b.add("not", 14, y, {});
      const nb = b.add("not", 14, y + 1, {});
      const g = b.add("and", 19, y, { inputs: 3 });
      const l = b.add("and", 19, y + 1, { inputs: 3 });
      const e = b.add("xnor", 24, y, {});
      const ng = b.add("or", 30, y, {});
      const nl = b.add("or", 30, y + 1, {});
      const ne = b.add("and", 36, y, {});
      b.link([
        [sa, "b" + i, na, "i0"],
        [sb, "b" + i, nb, "i0"],
        [sa, "b" + i, g, "i0"],
        [nb, "out", g, "i1"],
        [eq, "out", g, "i2"],
        [na, "out", l, "i0"],
        [sb, "b" + i, l, "i1"],
        [eq, "out", l, "i2"],
        [sa, "b" + i, e, "i0"],
        [sb, "b" + i, e, "i1"],
        [gt, "out", ng, "i0"],
        [g, "out", ng, "i1"],
        [lt, "out", nl, "i0"],
        [l, "out", nl, "i1"],
        [eq, "out", ne, "i0"],
        [e, "out", ne, "i1"],
      ]);
      gt = ng;
      lt = nl;
      eq = ne;
    }
    b.link([
      [gt, "out", "GT", "in"],
      [lt, "out", "LT", "in"],
      [eq, "out", "EQ", "in"],
    ]);
  }),

  "t2-shift4": onRoot((b) => {
    const s = b.add("split", 8, 0, { bitWidth: 4 });
    const mg = b.add("merge", 30, 0, { bitWidth: 4 });
    b.connect("V", "out", s, "in");
    for (let k = 0; k < 4; k++) {
      const mux = b.add("mux", 16, 1 + k * 5, { inputs: 4 });
      b.connect("SH", "out", mux, "sel");
      for (let sh = 0; sh < 4; sh++) {
        const src = k - sh;
        if (src >= 0) b.connect(s, "b" + src, mux, "i" + sh);
      }
      b.connect(mux, "out", mg, "b" + k);
    }
    b.connect(mg, "out", "R", "in");
  }),

  "t2-mux8": onRoot((b) => {
    const mux = b.add("mux", 16, 4, { inputs: 8 });
    b.connect("S", "out", mux, "sel");
    for (let i = 0; i < 8; i++) b.connect("D" + i, "out", mux, "i" + i);
    b.connect(mux, "out", "Y", "in");
  }),

  "t2-parity": onRoot((b) => {
    const s = b.add("split", 10, 0, { bitWidth: 8 });
    b.connect("D", "out", s, "in");
    let prev = "";
    for (let i = 1; i < 8; i++) {
      const x = b.add("xor", 18 + i * 4, 1, {});
      b.connect(prev || s, prev ? "out" : "b0", x, "i0");
      b.connect(s, "b" + i, x, "i1");
      prev = x;
    }
    const bad = b.add("xor", 56, 1, {});
    b.link([
      [prev, "out", bad, "i0"],
      ["P", "out", bad, "i1"],
      [bad, "out", "BAD", "in"],
    ]);
  }),

  /* ---------------- 第三层 ---------------- */
  "t3-reg4": onRoot((b) => {
    const s = b.add("split", 8, 6, { bitWidth: 4 });
    const mg = b.add("merge", 34, 6, { bitWidth: 4 });
    b.connect("D", "out", s, "in");
    for (let i = 0; i < 4; i++) {
      const mux = b.add("mux", 14, 1 + i * 5, {});
      const d = b.add("dff", 22, 2 + i * 5, {});
      b.link([
        ["LOAD", "out", mux, "sel"],
        [d, "q", mux, "i0"],
        [s, "b" + i, mux, "i1"],
        ["CLK", "out", d, "clk"],
        [mux, "out", d, "d"],
        [d, "q", mg, "b" + i],
      ]);
    }
    b.connect(mg, "out", "Q", "in");
  }),

  "t3-count": onRoot((b) => {
    const c = b.add("counter", 16, 2, { bitWidth: 4 });
    b.link([
      ["CLK", "out", c, "clk"],
      ["EN", "out", c, "en"],
      ["RST", "out", c, "rst"],
      [c, "out", "Q", "in"],
    ]);
  }),

  "t3-mod6": onRoot((b) => {
    const one = b.add("const", 10, 2, { bitWidth: 1, value: 1 });
    const five = b.add("const", 10, 8, { bitWidth: 4, value: 5 });
    const c = b.add("counter", 18, 2, { bitWidth: 4 });
    const cmp = b.add("cmp", 28, 6, {});
    b.link([
      ["CLK", "out", c, "clk"],
      [one, "out", c, "en"],
      [c, "out", cmp, "a"],
      [five, "out", cmp, "b"],
      [cmp, "eq", c, "rst"],
      [cmp, "eq", "ROLL", "in"],
      [c, "out", "Q", "in"],
    ]);
  }),

  "t3-shiftreg": onRoot((b) => {
    let prev = "SER";
    let prevPin = "out";
    for (let i = 0; i < 4; i++) {
      const d = b.add("dff", 12 + i * 6, 2, {});
      b.connect(prev, prevPin, d, "d");
      b.link([
        ["CLK", "out", d, "clk"],
        [d, "q", "P" + i, "in"],
      ]);
      prev = d;
      prevPin = "q";
    }
  }),

  "t3-edge": onRoot((b) => {
    const q = b.add("dff", 12, 2, {});
    const nq = b.add("not", 18, 4, {});
    const gate = b.add("and", 22, 8, {});
    const p = b.add("dff", 30, 2, {});
    b.link([
      ["CLK", "out", q, "clk"],
      ["BTN", "out", q, "d"],
      [q, "q", nq, "i0"],
      ["BTN", "out", gate, "i0"],
      [nq, "out", gate, "i1"],
      ["CLK", "out", p, "clk"],
      [gate, "out", p, "d"],
      [p, "q", "P", "in"],
    ]);
  }),

  "t3-ram": onRoot((b) => {
    b.link([
      ["CLK", "out", "RAM", "clk"],
      ["WE", "out", "RAM", "wen"],
      ["ADDR", "out", "RAM", "addr"],
      ["DIN", "out", "RAM", "din"],
      ["RAM", "dout", "DOUT", "in"],
    ]);
  }),

  "t3-file": onRoot((b) => {
    const dec = b.add("demux", 12, 34, { inputs: 4 });
    const ra = b.add("mux", 40, 2, { inputs: 4 });
    const rb = b.add("mux", 40, 20, { inputs: 4 });
    b.link([
      ["WA", "out", dec, "sel"],
      ["RA", "out", ra, "sel"],
      ["RB", "out", rb, "sel"],
    ]);
    for (let i = 0; i < 4; i++) {
      const g = b.add("and", 20, 32 + i * 3, {});
      b.link([
        [dec, "o" + i, g, "i0"],
        ["W", "out", g, "i1"],
        [g, "out", "R" + i, "load"],
        ["DIN", "out", "R" + i, "d"],
        ["CLK", "out", "R" + i, "clk"],
        ["R" + i, "q", ra, "i" + i],
        ["R" + i, "q", rb, "i" + i],
      ]);
    }
    b.link([
      [ra, "out", "QA", "in"],
      [rb, "out", "QB", "in"],
    ]);
  }),

  "t3-stack": onRoot((b) => {
    const one = b.add("const", 6, 20, { bitWidth: 1, value: 1 });
    const two = b.add("const", 6, 24, { bitWidth: 1, value: 2 });
    const zero = b.add("const", 6, 28, { bitWidth: 1, value: 0 });
    const isPush = b.add("cmp", 14, 18, {});
    const isPop = b.add("cmp", 14, 26, {});
    const notEmpty = b.add("cmp", 14, 34, {});
    const canPop = b.add("and", 24, 28, {});
    const doIt = b.add("or", 30, 24, {});
    const inc = b.add("add", 36, 12, {});
    const dec = b.add("sub", 36, 20, {});
    const sel = b.add("mux", 44, 16, {});
    b.link([
      ["OP", "out", isPush, "a"],
      [one, "out", isPush, "b"],
      ["OP", "out", isPop, "a"],
      [two, "out", isPop, "b"],
      ["SP", "q", notEmpty, "a"],
      [zero, "out", notEmpty, "b"],
      [isPop, "eq", canPop, "i0"],
      [notEmpty, "gt", canPop, "i1"],
      [isPush, "eq", doIt, "i0"],
      [canPop, "out", doIt, "i1"],
      ["SP", "q", inc, "a"],
      [one, "out", inc, "b"],
      ["SP", "q", dec, "a"],
      [one, "out", dec, "b"],
      [dec, "diff", sel, "i0"],
      [inc, "sum", sel, "i1"],
      [isPush, "eq", sel, "sel"],
      [doIt, "out", "SP", "load"],
      ["CLK", "out", "SP", "clk"],
      [sel, "out", "SP", "d"],
      ["CLK", "out", "STACK", "clk"],
      [isPush, "eq", "STACK", "wen"],
      ["SP", "q", "STACK", "addr"],
      ["DIN", "out", "STACK", "din"],
      ["STACK", "dout", "TOS", "in"],
    ]);
  }),

  /* ---------------- 第四层 ---------------- */
  "t4-alu8": onRoot((b, design) => {
    design.defs.push(alu8Def());
    const u = b.add("custom:alu8", 24, 4, {});
    b.link([
      ["A", "out", u, "a"],
      ["B", "out", u, "b"],
      ["OP", "out", u, "op"],
      [u, "r", "R", "in"],
      [u, "z", "Z", "in"],
    ]);
  }),

  "t4-instdec": onRoot((b) => {
    const s = b.add("split", 12, 0, { bitWidth: 16 });
    const mop = b.add("merge", 32, 0, { bitWidth: 4 });
    const mra = b.add("merge", 32, 8, { bitWidth: 4 });
    const mrb = b.add("merge", 32, 16, { bitWidth: 4 });
    b.link([
      ["IR", "out", s, "in"],
    ]);
    const fields: [string, number][] = [
      ["OP", 12],
      ["RA", 8],
      ["RB", 4],
    ];
    for (const [out, hi] of fields) {
      const m = out === "OP" ? mop : out === "RA" ? mra : mrb;
      for (let i = 0; i < 4; i++) b.connect(s, "b" + (hi + i), m, "b" + i);
      b.connect(m, "out", out, "in");
    }
  }),

  "t4-pc": onRoot((b) => {
    const one = b.add("const", 10, 20, { bitWidth: 4, value: 1 });
    const always = b.add("const", 10, 24, { bitWidth: 1, value: 1 });
    const inc = b.add("add", 18, 16, {});
    const mInc = b.add("mux", 26, 12, {});
    const mLd = b.add("mux", 34, 8, {});
    const r = b.add("reg", 42, 4, { bitWidth: 4 });
    b.link([
      [r, "q", inc, "a"],
      [one, "out", inc, "b"],
      [r, "q", mInc, "i0"],
      [inc, "sum", mInc, "i1"],
      ["EN", "out", mInc, "sel"],
      [mInc, "out", mLd, "i0"],
      ["TARGET", "out", mLd, "i1"],
      ["LD", "out", mLd, "sel"],
      [mLd, "out", r, "d"],
      ["CLK", "out", r, "clk"],
      [always, "out", r, "load"],
      [r, "q", "PC", "in"],
    ]);
  }),

  "t4-progmem": onRoot((b) => {
    const s = b.add("split", 30, 0, { bitWidth: 16 });
    const mop = b.add("merge", 46, 0, { bitWidth: 4 });
    const mra = b.add("merge", 46, 8, { bitWidth: 4 });
    const mrb = b.add("merge", 46, 16, { bitWidth: 4 });
    b.link([
      ["A", "out", "PROG", "addr"],
      ["PROG", "out", s, "in"],
      ["PROG", "out", "WORD", "in"],
    ]);
    const fields: [string, number, string][] = [
      ["OP", 12, "mop"],
      ["RA", 8, "mra"],
      ["RB", 4, "mrb"],
    ];
    for (const f of fields) {
      const m = f[2] === "mop" ? mop : f[2] === "mra" ? mra : mrb;
      for (let i = 0; i < 4; i++) b.connect(s, "b" + (f[1] + i), m, "b" + i);
      b.connect(m, "out", f[0], "in");
    }
  }),

  /* ---------------- 第五层 ---------------- */
  "t5-bank": onRoot((b) => {
    const s = b.add("split", 10, 10, { bitWidth: 5 });
    const lo = b.add("merge", 20, 4, { bitWidth: 3 });
    const hi = b.add("merge", 20, 12, { bitWidth: 2 });
    const dec = b.add("demux", 26, 20, { inputs: 4 });
    const mux = b.add("mux", 56, 4, { inputs: 4 });
    b.link([
      ["A", "out", s, "in"],
      [s, "b3", hi, "b0"],
      [s, "b4", hi, "b1"],
      [hi, "out", dec, "sel"],
      [hi, "out", mux, "sel"],
    ]);
    for (let i = 0; i < 3; i++) b.connect(s, "b" + i, lo, "b" + i);
    for (let k = 0; k < 4; k++) {
      const bank = "BANK" + k;
      const g = b.add("and", 34, 30 + k * 3, {});
      b.link([
        [dec, "o" + k, g, "i0"],
        ["WE", "out", g, "i1"],
        ["CLK", "out", bank, "clk"],
        [g, "out", bank, "wen"],
        [lo, "out", bank, "addr"],
        ["DIN", "out", bank, "din"],
        [bank, "dout", mux, "i" + k],
      ]);
    }
    b.connect(mux, "out", "DOUT", "in");
  }),

  "t5-harvard": onRoot((b) => {
    const eight = b.add("const", 10, 24, { bitWidth: 4, value: 8 });
    const done = b.add("cmp", 20, 22, {});
    const notDone = b.add("not", 26, 24, {});
    const go = b.add("and", 32, 22, {});
    const pc = b.add("counter", 20, 4, { bitWidth: 4 });
    const s = b.add("split", 40, 2, { bitWidth: 16 });
    const lo = b.add("merge", 48, 6, { bitWidth: 4 });
    const sum = b.add("add", 52, 16, {});
    const acc = b.add("reg", 58, 12, { bitWidth: 8 });
    b.link([
      ["CLK", "out", pc, "clk"],
      [pc, "out", "IROM", "addr"],
      [pc, "out", done, "a"],
      [eight, "out", done, "b"],
      [done, "eq", notDone, "i0"],
      [notDone, "out", go, "i0"],
      ["RUN", "out", go, "i1"],
      [go, "out", pc, "en"],
      ["IROM", "out", s, "in"],
      [acc, "q", sum, "a"],
      [sum, "sum", acc, "d"],
      ["RUN", "out", acc, "load"],
      ["CLK", "out", acc, "clk"],
      [acc, "q", "SUM", "in"],
      [done, "eq", "DONE", "in"],
    ]);
    for (let i = 0; i < 4; i++) b.connect(s, "b" + i, lo, "b" + i);
    b.link([
      [lo, "out", "DRAM", "addr"],
      ["DRAM", "dout", sum, "b"],
    ]);
  }),

  "t5-charrom": onRoot((b) => {
    const one = b.add("const", 10, 20, { bitWidth: 1, value: 1 });
    b.link([
      ["CLK", "out", "IDX", "clk"],
      [one, "out", "IDX", "en"],
      ["IDX", "out", "FONT", "addr"],
      ["FONT", "out", "CHR", "in"],
      ["FONT", "out", "TERM", "val"],
      ["CLK", "out", "TERM", "clk"],
      [one, "out", "TERM", "en"],
    ]);
  }),

  "t5-micro": onRoot((b) => {
    const s = b.add("split", 34, 0, { bitWidth: 8 });
    const op = b.add("merge", 44, 6, { bitWidth: 3 });
    b.link([
      ["ST", "out", "CTRL", "addr"],
      ["CTRL", "out", s, "in"],
      [s, "b2", op, "b0"],
      [s, "b3", op, "b1"],
      [s, "b4", op, "b2"],
      [op, "out", "ALU_OP", "in"],
      [s, "b0", "PC_EN", "in"],
      [s, "b1", "MEM_WE", "in"],
      [s, "b5", "RF_LD", "in"],
      [s, "b7", "HALT", "in"],
    ]);
  }),

  /* 第四层的压轴关卡：直接给出完整的微程序 CPU */
  "t4-machine": (design) => {
    wireReferenceCpu(design);
  },

  /* ---------------- 存储书 ---------------- */
  "m1-1-norlatch": onRoot((b) => {
    /* 交叉耦合：Q = NOR(R, Q̄)，Q̄ = NOR(S, Q) */
    const gq = b.add("nor", 16, 0, {});
    const gqn = b.add("nor", 16, 6, {});
    b.link([
      ["R", "out", gq, "i0"],
      [gqn, "out", gq, "i1"],
      [gq, "out", "Q", "in"],
      ["S", "out", gqn, "i0"],
      [gq, "out", gqn, "i1"],
      [gqn, "out", "QN", "in"],
    ]);
  }),
  "m1-2-decode4": onRoot((b) => {
    /* 写走 2→4 译码 + WE，读走 4 选 1 */
    const dec = b.add("demux", 12, 2, { inputs: 4 });
    const rd = b.add("mux", 38, 0, { inputs: 4 });
    b.link([
      ["ADDR", "out", dec, "sel"],
      ["ADDR", "out", rd, "sel"],
    ]);
    for (let k = 0; k < 4; k++) {
      const w = b.add("and", 16, k * 5, {});
      b.link([
        ["WE", "out", w, "i0"],
        [dec, "o" + k, w, "i1"],
        ["CLK", "out", "C" + k, "clk"],
        [w, "out", "C" + k, "load"],
        ["DIN", "out", "C" + k, "d"],
        ["C" + k, "q", rd, "i" + k],
      ]);
    }
    b.link([[rd, "out", "DOUT", "in"]]);
  }),
  "m2-1-leakycap": onRoot((b) => {
    /* 刷新 = 别让电容闲着：EN 提高为 EN|CLK，每个沿都把 D 上的数据重写回去 */
    const g = b.add("or", 8, 14, {});
    b.link([
      ["CLK", "out", "cap", "CLK"],
      ["EN", "out", g, "i0"],
      ["CLK", "out", g, "i1"],
      [g, "out", "cap", "EN"],
      ["D", "out", "cap", "BL"],
      ["cap", "Q", "Q", "in"],
    ]);
  }),
  "m2-2-destructive": onRoot((b) => {
    /* 读-放大-回写闭环：单元的 Q 喂给感放，感放输出顶住位线 */
    const sa = b.add("SENSEAMP", 26, 2, {});
    b.link([
      ["CLK", "out", "cap", "CLK"],
      ["EN", "out", "cap", "EN"],
      ["cap", "Q", sa, "IN"],
      [sa, "OUT", "cap", "BL"],
      ["SE", "out", sa, "SE"],
      ["cap", "Q", "Q", "in"],
    ]);
  }),
  "m2-3-refresh": onRoot((b) => {
    /* 写命中与刷新行分时驱动字线；位线 = WE ? D : 自己的 Q（自己写回自己） */
    const nw = b.add("not", 12, 20, {});
    const rdec = b.add("demux", 14, 24, { inputs: 4 });
    const wdec = b.add("demux", 14, 34, { inputs: 4 });
    b.link([
      ["CLK", "out", "ref", "CLK"],
      ["ref", "ROW", rdec, "sel"],
      ["ADDR", "out", wdec, "sel"],
      ["WE", "out", nw, "i0"],
    ]);
    for (let k = 0; k < 4; k++) {
      const cell = "c" + k;
      const y = k * 12;
      const w = b.add("and", 16, y, {});
      const r = b.add("and", 16, y + 2, {});
      const en = b.add("or", 18, y + 1, {});
      const mx = b.add("mux", 19, y + 5, { inputs: 2 });
      b.link([
        ["WE", "out", w, "i0"],
        [wdec, "o" + k, w, "i1"],
        [nw, "out", r, "i0"],
        [rdec, "o" + k, r, "i1"],
        [w, "out", en, "i0"],
        [r, "out", en, "i1"],
        [en, "out", cell, "EN"],
        ["CLK", "out", cell, "CLK"],
        [cell, "Q", mx, "i0"],
        ["D", "out", mx, "i1"],
        ["WE", "out", mx, "sel"],
        [mx, "out", cell, "BL"],
        [cell, "Q", "Q" + k, "in"],
      ]);
    }
  }),
  "m2-4-wordline": onRoot((b) => {
    /* 字线 = 行译码 AND 列译码 AND WE；位线按列共享，读侧按行选源 */
    const rdec = b.add("demux", 18, 0, { inputs: 2 });
    const cdec = b.add("demux", 18, 8, { inputs: 2 });
    b.link([
      ["ROW", "out", rdec, "sel"],
      ["COL", "out", cdec, "sel"],
    ]);
    const cellId = [
      ["g00", "Q00"],
      ["g01", "Q01"],
      ["g10", "Q10"],
      ["g11", "Q11"],
    ];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const [id, lamp] = cellId[r * 2 + c];
        const e = b.add("and", 20, r * 12 + c * 4, { inputs: 3 });
        b.link([
          [rdec, "o" + r, e, "i0"],
          [cdec, "o" + c, e, "i1"],
          ["WE", "out", e, "i2"],
          [e, "out", id, "EN"],
          ["CLK", "out", id, "CLK"],
          [id, "Q", lamp, "in"],
        ]);
      }
    }
    for (let c = 0; c < 2; c++) {
      const fb = b.add("mux", 34, c * 10, { inputs: 2 });
      const bl = b.add("mux", 38, c * 10, { inputs: 2 });
      b.link([
        ["ROW", "out", fb, "sel"],
        ["g0" + c, "Q", fb, "i0"],
        ["g1" + c, "Q", fb, "i1"],
        ["WE", "out", bl, "sel"],
        [fb, "out", bl, "i0"],
        ["D", "out", bl, "i1"],
        [bl, "out", "g0" + c, "BL"],
        [bl, "out", "g1" + c, "BL"],
      ]);
    }
  }),
  "m2-4b-secdec": onRoot((b) => {
    /* Hamming(7,4) + 全偶校验（SECDED）。码字位置 1..7 = [p1, p2, d0, p4, d1, d2, d3]，
       FLT1 打在位 2、FLT2 打在位 5；接收端重算 syndrome 与总奇偶：
       syndrome≠0 且总偶被破坏 = 单错纠正；syndrome≠0 且总偶完好 = 双错报警 */
    const sd = b.add("split", 2, 10, { bitWidth: 4 });
    b.link([["D", "out", sd, "in"]]);
    const p1 = b.add("xor", 8, 0, { inputs: 3 });
    const p2 = b.add("xor", 8, 5, { inputs: 3 });
    const p4 = b.add("xor", 8, 10, { inputs: 3 });
    const x2 = b.add("xor", 12, 5, {});
    const x5 = b.add("xor", 12, 15, {});
    b.link([
      [sd, "b0", p1, "i0"],
      [sd, "b1", p1, "i1"],
      [sd, "b3", p1, "i2"],
      [sd, "b0", p2, "i0"],
      [sd, "b2", p2, "i1"],
      [sd, "b3", p2, "i2"],
      [sd, "b1", p4, "i0"],
      [sd, "b2", p4, "i1"],
      [sd, "b3", p4, "i2"],
      [p2, "out", x2, "i0"],
      ["FLT1", "out", x2, "i1"],
      [sd, "b1", x5, "i0"],
      ["FLT2", "out", x5, "i1"],
    ]);
    /* 接收位 R1..R7 = p1, x2, d0, p4, x5, d2, d3 */
    const s1 = b.add("xor", 18, 0, { inputs: 4 });
    const s2 = b.add("xor", 18, 6, { inputs: 4 });
    const s4 = b.add("xor", 18, 12, { inputs: 4 });
    b.link([
      [p1, "out", s1, "i0"],
      [sd, "b0", s1, "i1"],
      [x5, "out", s1, "i2"],
      [sd, "b3", s1, "i3"],
      [x2, "out", s2, "i0"],
      [sd, "b0", s2, "i1"],
      [sd, "b2", s2, "i2"],
      [sd, "b3", s2, "i3"],
      [p4, "out", s4, "i0"],
      [x5, "out", s4, "i1"],
      [sd, "b2", s4, "i2"],
      [sd, "b3", s4, "i3"],
    ]);
    const sm = b.add("merge", 22, 6, { bitWidth: 3 });
    const dec = b.add("demux", 25, 4, { inputs: 8 });
    b.link([
      [s1, "out", sm, "b0"],
      [s2, "out", sm, "b1"],
      [s4, "out", sm, "b2"],
      [sm, "out", dec, "sel"],
    ]);
    /* 数据位都在偶数位置之外：3=d0、5=d1、6=d2、7=d3，按 syndrome 翻转 */
    const c3 = b.add("xor", 30, 0, {});
    const c5 = b.add("xor", 30, 4, {});
    const c6 = b.add("xor", 30, 8, {});
    const c7 = b.add("xor", 30, 12, {});
    const corr = b.add("merge", 34, 4, { bitWidth: 4 });
    b.link([
      [sd, "b0", c3, "i0"],
      [dec, "o3", c3, "i1"],
      [x5, "out", c5, "i0"],
      [dec, "o5", c5, "i1"],
      [sd, "b2", c6, "i0"],
      [dec, "o6", c6, "i1"],
      [sd, "b3", c7, "i0"],
      [dec, "o7", c7, "i1"],
      [c3, "out", corr, "b0"],
      [c5, "out", corr, "b1"],
      [c6, "out", corr, "b2"],
      [c7, "out", corr, "b3"],
      [corr, "out", "CORR", "in"],
    ]);
    /* 双错检测：两位翻转不破坏总偶校验，但 syndrome 必然非零 */
    const rxp = b.add("xor", 18, 20, { inputs: 7 });
    const pall = b.add("xor", 18, 30, { inputs: 7 });
    b.link([
      [p1, "out", rxp, "i0"],
      [x2, "out", rxp, "i1"],
      [sd, "b0", rxp, "i2"],
      [p4, "out", rxp, "i3"],
      [x5, "out", rxp, "i4"],
      [sd, "b2", rxp, "i5"],
      [sd, "b3", rxp, "i6"],
      [p1, "out", pall, "i0"],
      [p2, "out", pall, "i1"],
      [sd, "b0", pall, "i2"],
      [p4, "out", pall, "i3"],
      [sd, "b1", pall, "i4"],
      [sd, "b2", pall, "i5"],
      [sd, "b3", pall, "i6"],
    ]);
    const pbr = b.add("xor", 24, 26, {});
    const npb = b.add("not", 26, 26, { inputs: 1 });
    const anys = b.add("or", 24, 20, { inputs: 3 });
    const derr = b.add("and", 28, 22, {});
    b.link([
      [rxp, "out", pbr, "i0"],
      [pall, "out", pbr, "i1"],
      [pbr, "out", npb, "i0"],
      [s1, "out", anys, "i0"],
      [s2, "out", anys, "i1"],
      [s4, "out", anys, "i2"],
      [npb, "out", derr, "i0"],
      [anys, "out", derr, "i1"],
      [derr, "out", "DERR", "in"],
    ]);
  }),
  "m3-1-slowprog": onRoot((b) => {
    b.link([
      ["CLK", "out", "fg", "CLK"],
      ["P", "out", "fg", "PROG"],
      ["E", "out", "fg", "ERASE"],
      ["fg", "Q", "Q", "in"],
      ["fg", "PE", "PE", "in"],
    ]);
  }),
  "m3-2-blockerase": onRoot((b) => {
    /* 编程走地址译码，擦除是全块一根线 */
    const dec = b.add("demux", 16, 0, { inputs: 4 });
    b.link([
      ["CLK", "out", "f0", "CLK"],
      ["CLK", "out", "f1", "CLK"],
      ["CLK", "out", "f2", "CLK"],
      ["CLK", "out", "f3", "CLK"],
      ["ADDR", "out", dec, "sel"],
      ["ERASE", "out", "f0", "ERASE"],
      ["ERASE", "out", "f1", "ERASE"],
      ["ERASE", "out", "f2", "ERASE"],
      ["ERASE", "out", "f3", "ERASE"],
    ]);
    for (let k = 0; k < 4; k++) {
      const w = b.add("and", 18, k * 5, {});
      b.link([
        ["WR", "out", w, "i0"],
        [dec, "o" + k, w, "i1"],
        [w, "out", "f" + k, "PROG"],
        ["f" + k, "Q", "Q" + k, "in"],
      ]);
    }
  }),
  "m3-3-wear": onRoot((b) => {
    /* 轮转磨损均衡：请求计数 → 译码，每次只擦一格 */
    const cnt = b.add("counter", 12, 20, { bitWidth: 2 });
    const dec = b.add("demux", 16, 20, { inputs: 4 });
    b.link([
      ["CLK", "out", cnt, "clk"],
      ["CLK", "out", "f0", "CLK"],
      ["CLK", "out", "f1", "CLK"],
      ["CLK", "out", "f2", "CLK"],
      ["CLK", "out", "f3", "CLK"],
      ["E", "out", cnt, "en"],
      [cnt, "out", dec, "sel"],
    ]);
    for (let k = 0; k < 4; k++) {
      const e = b.add("and", 18, k * 5, {});
      b.link([
        ["E", "out", e, "i0"],
        [dec, "o" + k, e, "i1"],
        [e, "out", "f" + k, "ERASE"],
        ["f" + k, "PE", "PE" + k, "in"],
        ["f" + k, "STS", "S" + k, "in"],
      ]);
    }
  }),
  "m4-1-logwrite": onRoot((b) => {
    /* 追加 {BLK,VAL} 进 LOG（地址=写指针），MAP[BLK]=VAL 指到最新版 */
    const cnt = b.add("counter", 14, 14, { bitWidth: 2 }, { name: "CNT" });
    const sp = b.add("split", 14, 0, { bitWidth: 2 });
    const mg = b.add("merge", 17, 2, { bitWidth: 3 });
    b.link([
      ["CLK", "out", "LOG", "clk"],
      ["CLK", "out", "MAP", "clk"],
      ["CLK", "out", cnt, "clk"],
      ["WR", "out", "LOG", "wen"],
      ["WR", "out", "MAP", "wen"],
      ["WR", "out", cnt, "en"],
      [cnt, "out", "LOG", "addr"],
      ["VAL", "out", sp, "in"],
      [sp, "b0", mg, "b0"],
      [sp, "b1", mg, "b1"],
      ["BLK", "out", mg, "b2"],
      [mg, "out", "LOG", "din"],
      ["BLK", "out", "MAP", "addr"],
      ["VAL", "out", "MAP", "din"],
    ]);
  }),
  "m4-2-waf": onRoot((b) => {
    /* 写放大流水线：dff 把 WR 晚一拍成 APP——先落主机视图，下一拍整块重写进日志。
       APP 期间 FILE 的地址已切到追加源，FILE.wen = WR·¬APP 掐掉重叠期的误写 */
    const dly = b.add("dff", 14, 8, {});
    const nw = b.add("not", 14, 12, { inputs: 1 });
    const wen = b.add("and", 16, 10, {});
    const cnt = b.add("counter", 17, 14, { bitWidth: 3 }, { name: "CNT" });
    const sp = b.add("split", 20, 14, { bitWidth: 3 });
    const la = b.add("merge", 23, 14, { bitWidth: 2 });
    const fa = b.add("mux", 24, 0, { inputs: 2 });
    b.link([
      ["CLK", "out", "FILE", "clk"],
      ["CLK", "out", "LOG", "clk"],
      ["CLK", "out", dly, "clk"],
      ["CLK", "out", cnt, "clk"],
      ["WR", "out", dly, "d"],
      [dly, "q", nw, "i0"],
      ["WR", "out", wen, "i0"],
      [nw, "out", wen, "i1"],
      [wen, "out", "FILE", "wen"],
      ["VAL", "out", "FILE", "din"],
      [dly, "q", fa, "sel"],
      ["BLK", "out", fa, "i0"],
      [sp, "b0", fa, "i1"],
      [fa, "out", "FILE", "addr"],
      [dly, "q", cnt, "en"],
      [cnt, "out", sp, "in"],
      [sp, "b0", la, "b0"],
      [sp, "b1", la, "b1"],
      [la, "out", "LOG", "addr"],
      ["FILE", "dout", "LOG", "din"],
      [dly, "q", "LOG", "wen"],
    ]);
  }),
  "m5-1-seek": onRoot((b) => {
    b.link([
      ["CLK", "out", "pl", "CLK"],
      ["TARGET", "out", "pl", "TARGET"],
      ["STEP", "out", "pl", "STEP"],
      ["RD", "out", "pl", "RD"],
      ["pl", "Q", "Q", "in"],
    ]);
  }),
  "m5-2-elevator": onRoot((b) => {
    /* 磁头从道 0 扫到道 3，路过即读；print 在沿上取值 */
    const t3 = b.add("const", 14, 0, { bitWidth: 2, value: 3 });
    const one = b.add("const", 14, 4, { value: 1 });
    b.link([
      ["CLK", "out", "pl", "CLK"],
      [t3, "out", "pl", "TARGET"],
      [one, "out", "pl", "STEP"],
      [one, "out", "pl", "RD"],
      ["CLK", "out", "pt", "clk"],
      ["GO", "out", "pt", "en"],
      ["pl", "Q", "pt", "val"],
    ]);
  }),
  "m5-3-density": onRoot((b) => {
    /* 同一电路读两块盘：只有打印门控随 SEL 切换，疏盘多等一倍 */
    const one = b.add("const", 14, 0, { value: 1 });
    const ns = b.add("not", 14, 4, {});
    const ga = b.add("and", 16, 2, {});
    const z8 = b.add("const", 14, 8, { bitWidth: 8 });
    const eqz = b.add("cmp", 30, 12, {});
    const nz = b.add("not", 33, 12, { inputs: 1 });
    const gb = b.add("and", 35, 10, { inputs: 3 });
    b.link([
      ["CLK", "out", "pa", "CLK"],
      ["CLK", "out", "pb", "CLK"],
      [one, "out", "pa", "RD"],
      [one, "out", "pb", "RD"],
      ["SEL", "out", ns, "i0"],
      ["GO", "out", ga, "i0"],
      [ns, "out", ga, "i1"],
      [ga, "out", "pta", "en"],
      ["CLK", "out", "pta", "clk"],
      ["pa", "Q", "pta", "val"],
      ["pb", "Q", eqz, "a"],
      [z8, "out", eqz, "b"],
      [eqz, "eq", nz, "i0"],
      ["GO", "out", gb, "i0"],
      ["SEL", "out", gb, "i1"],
      [nz, "out", gb, "i2"],
      [gb, "out", "ptb", "en"],
      ["CLK", "out", "ptb", "clk"],
      ["pb", "Q", "ptb", "val"],
    ]);
  }),
  "m6-1-tiers": onRoot((b) => {
    /* 热：常数直通；温：小 RAM；冷：盘上——mux 按页号选层 */
    const mx = b.add("mux", 38, 2, { inputs: 4 });
    const hot = b.add("const", 20, 20, { bitWidth: 2, value: 3 });
    const z2 = b.add("const", 20, 24, { bitWidth: 2 });
    const t3 = b.add("const", 30, 20, { bitWidth: 2, value: 3 });
    const one = b.add("const", 30, 24, { value: 1 });
    b.link([
      ["CLK", "out", "WARM", "clk"],
      ["PAGE", "out", "WARM", "addr"],
      ["CLK", "out", "cold", "CLK"],
      [t3, "out", "cold", "TARGET"],
      [one, "out", "cold", "STEP"],
      [one, "out", "cold", "RD"],
      ["PAGE", "out", mx, "sel"],
      [hot, "out", mx, "i0"],
      ["WARM", "dout", mx, "i1"],
      [z2, "out", mx, "i2"],
      ["cold", "Q", mx, "i3"],
      [mx, "out", "DATA", "in"],
    ]);
  }),
  "m6-2-locality": onRoot((b) => {
    /* A 盘照旧直读；B 盘转满一圈（ROT==3）才挪一道——局部性税单 */
    const one = b.add("const", 12, 0, { value: 1 });
    const t3 = b.add("const", 12, 16, { bitWidth: 2, value: 3 });
    const t38 = b.add("const", 12, 20, { bitWidth: 8, value: 3 });
    const z8 = b.add("const", 12, 24, { bitWidth: 8 });
    const eqr = b.add("cmp", 30, 16, {});
    const step = b.add("and", 33, 14, { inputs: 3 });
    const ns = b.add("not", 14, 4, {});
    const ga = b.add("and", 16, 2, {});
    const eqz = b.add("cmp", 30, 24, {});
    const nz = b.add("not", 33, 24, { inputs: 1 });
    const gb = b.add("and", 35, 20, { inputs: 3 });
    b.link([
      ["CLK", "out", "la", "CLK"],
      ["CLK", "out", "lb", "CLK"],
      [one, "out", "la", "RD"],
      [one, "out", "lb", "RD"],
      [t3, "out", "lb", "TARGET"],
      ["lb", "ROT", eqr, "a"],
      [t38, "out", eqr, "b"],
      ["GO", "out", step, "i0"],
      ["SW", "out", step, "i1"],
      [eqr, "eq", step, "i2"],
      [step, "out", "lb", "STEP"],
      ["SW", "out", ns, "i0"],
      ["GO", "out", ga, "i0"],
      [ns, "out", ga, "i1"],
      [ga, "out", "pta", "en"],
      ["CLK", "out", "pta", "clk"],
      ["la", "Q", "pta", "val"],
      ["lb", "Q", eqz, "a"],
      [z8, "out", eqz, "b"],
      [eqz, "eq", nz, "i0"],
      ["GO", "out", gb, "i0"],
      ["SW", "out", gb, "i1"],
      [nz, "out", gb, "i2"],
      [gb, "out", "ptb", "en"],
      ["CLK", "out", "ptb", "clk"],
      ["lb", "Q", "ptb", "val"],
    ]);
  }),
  "m6-3-fsync": onRoot((b) => {
    /* 页缓存易失、fsync 落盘：落的是缓存此刻的值、PG 此刻指向的页 */
    b.link([
      ["CLK", "out", "cache", "CLK"],
      ["WR", "out", "cache", "EN"],
      ["DIN", "out", "cache", "BL"],
      ["CLK", "out", "DISK", "clk"],
      ["PG", "out", "DISK", "addr"],
      ["cache", "Q", "DISK", "din"],
      ["FS", "out", "DISK", "wen"],
    ]);
  }),
  "f1-1-onetick": onRoot((b) => {
    /* 一拍串联三加法器：A+B → +C → +D → R */
    const ab = b.add("add", 22, 0, {});
    const abc = b.add("add", 26, 0, {});
    const abcd = b.add("add", 30, 0, {});
    b.link([
      ["A", "out", ab, "a"],
      ["B", "out", ab, "b"],
      [ab, "sum", abc, "a"],
      ["C", "out", abc, "b"],
      [abc, "sum", abcd, "a"],
      ["D", "out", abcd, "b"],
      [abcd, "sum", "R", "in"],
    ]);
  }),
  "f1-2-cut": onRoot((b) => {
    /* 加 reg 在第二/三级之间；load 始终 1 让 reg 每拍更新 */
    const one = b.add("const", 18, 8, { value: 1 });
    const ab = b.add("add", 22, 0, {});
    const p = b.add("reg", 26, 0, { bitWidth: 5 });
    const abc = b.add("add", 30, 0, {});
    const abcd = b.add("add", 34, 0, {});
    b.link([
      [one, "out", p, "load"],
      ["CLK", "out", p, "clk"],
      [ab, "sum", p, "d"],
      ["A", "out", ab, "a"],
      ["B", "out", ab, "b"],
      [p, "q", abc, "a"],
      ["C", "out", abc, "b"],
      [abc, "sum", abcd, "a"],
      ["D", "out", abcd, "b"],
      [abcd, "sum", "R", "in"],
    ]);
  }),
  "f1-3-throughput": onRoot((b) => {
    const one = b.add("const", 18, 8, { value: 1 });
    const ab = b.add("add", 22, 0, {});
    const p = b.add("reg", 26, 0, { bitWidth: 5 });
    const abc = b.add("add", 30, 0, {});
    const abcd = b.add("add", 34, 0, {});
    b.link([
      [one, "out", p, "load"],
      ["CLK", "out", p, "clk"],
      [ab, "sum", p, "d"],
      ["A", "out", ab, "a"],
      ["B", "out", ab, "b"],
      [p, "q", abc, "a"],
      ["C", "out", abc, "b"],
      [abc, "sum", abcd, "a"],
      ["D", "out", abcd, "b"],
      [abcd, "sum", "R", "in"],
    ]);
  }),
  "f1-4-bypass": onRoot((b) => {
    /* add(A,B) 一路进 reg.d；mux 按 SEL 在 reg.q 与 add.sum 之间选 */
    const one = b.add("const", 18, 8, { value: 1 });
    const ab = b.add("add", 22, 0, {});
    const p = b.add("reg", 26, 0, { bitWidth: 5 });
    const mx = b.add("mux", 30, 0, { inputs: 2 });
    b.link([
      [one, "out", p, "load"],
      ["CLK", "out", p, "clk"],
      ["A", "out", ab, "a"],
      ["B", "out", ab, "b"],
      [ab, "sum", p, "d"],
      ["SEL", "out", mx, "sel"],
      [p, "q", mx, "i0"],
      [ab, "sum", mx, "i1"],
      [mx, "out", "R", "in"],
    ]);
  }),
  "f2-1-branch": onRoot((b) => {
    /* 1 给加法器，2 给分支目标——别混 */
    const c1 = b.add("const", 14, 0, { bitWidth: 3, value: 1 });
    const c2 = b.add("const", 14, 4, { bitWidth: 3, value: 2 });
    const inc = b.add("add", 16, 4, {});
    const mx = b.add("mux", 18, 0, { inputs: 2 });
    b.link([
      ["PC", "out", inc, "a"],
      [c1, "out", inc, "b"],
      [inc, "sum", mx, "i0"],
      [c2, "out", mx, "i1"],
      ["TAKEN", "out", mx, "sel"],
      [mx, "out", "NEXT", "in"],
    ]);
  }),
  "f2-2-alwaystaken": onRoot((b) => {
    const c1 = b.add("const", 14, 0, { bitWidth: 3, value: 1 });
    const c2 = b.add("const", 14, 4, { bitWidth: 3, value: 2 });
    const inc = b.add("add", 16, 4, {});
    const mx = b.add("mux", 18, 0, { inputs: 2 });
    const pred = b.add("const", 14, 8, { value: 1 });
    const xor = b.add("xor", 16, 8, {});
    b.link([
      ["PC", "out", inc, "a"],
      [c1, "out", inc, "b"],
      [inc, "sum", mx, "i0"],
      [c2, "out", mx, "i1"],
      ["TAKEN", "out", mx, "sel"],
      [mx, "out", "NEXT", "in"],
      [pred, "out", xor, "i0"],
      ["TAKEN", "out", xor, "i1"],
      [xor, "out", "MISPRED", "in"],
    ]);
  }),
  "f2-3-bimodal": onRoot((b) => {
    /* 2-bit 饱和计数：load 始终 1；RST=1 时 d=0，否则 d = TAKEN?clamped+1:clamped-1 */
    const one = b.add("const", 24, 8, { value: 1 });
    const one2 = b.add("const", 22, 4, { bitWidth: 2, value: 1 });
    const zero = b.add("const", 24, 4, { bitWidth: 2 });
    const top = b.add("const", 24, 12, { bitWidth: 2, value: 3 });
    const st = b.add("reg", 18, 0, { bitWidth: 2 });
    const rstMux = b.add("mux", 22, 0, { inputs: 2 });
    const inc = b.add("add", 26, 0, {});
    const dec = b.add("sub", 26, 4, {});
    const incClamp = b.add("mux", 30, 0, { inputs: 2 });
    const decClamp = b.add("mux", 30, 4, { inputs: 2 });
    const updMux = b.add("mux", 34, 0, { inputs: 2 });
    const isThree = b.add("cmp", 38, 0, {});
    const isZero = b.add("cmp", 38, 4, {});
    const hi = b.add("cmp", 38, 8, {});
    b.link([
      [one, "out", st, "load"],
      ["CLK", "out", st, "clk"],
      [updMux, "out", rstMux, "i0"],
      [zero, "out", rstMux, "i1"],
      ["RST", "out", rstMux, "sel"],
      [st, "q", inc, "a"],
      [one2, "out", inc, "b"],
      [st, "q", dec, "a"],
      [one2, "out", dec, "b"],
      [inc, "sum", incClamp, "i0"],
      [top, "out", incClamp, "i1"],
      [st, "q", isThree, "a"],
      [top, "out", isThree, "b"],
      [isThree, "eq", incClamp, "sel"],
      [dec, "diff", decClamp, "i1"],
      [st, "q", decClamp, "i0"],
      [st, "q", isZero, "a"],
      [top, "out", isZero, "b"],
      [isZero, "eq", decClamp, "sel"],
      [decClamp, "out", updMux, "i0"],
      [incClamp, "out", updMux, "i1"],
      ["TAKEN", "out", updMux, "sel"],
      [rstMux, "out", st, "d"],
      [st, "q", "STATE", "in"],
      [st, "q", hi, "a"],
      [top, "out", hi, "b"],
      [hi, "eq", "PRED", "in"],
    ]);
  }),
  "f2-4-btb": onRoot((b) => {
    /* 直接映射 BTB：HIT = mem[PC] ≠ 0（0 视为未写入） */
    const btb = b.add("ram", 22, 0, { bitWidth: 3, addrBits: 3, data: "0 0 0 0 0 0 0 0" });
    const z = b.add("const", 18, 8, { bitWidth: 3 });
    const eq = b.add("cmp", 28, 4, {});
    const nt = b.add("not", 32, 4, { inputs: 1 });
    b.link([
      ["CLK", "out", btb, "clk"],
      ["PC", "out", btb, "addr"],
      ["WE", "out", btb, "wen"],
      ["TARGET", "out", btb, "din"],
      [btb, "dout", "PRED_PC", "in"],
      [btb, "dout", eq, "a"],
      [z, "out", eq, "b"],
      [eq, "eq", nt, "i0"],
      [nt, "out", "HIT", "in"],
    ]);
  }),
};
