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
};
