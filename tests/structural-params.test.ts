// 结构参数驱动的引脚展开 + ALU / RAM / ROM 的行为测试。
//
// 为什么补这层：上一批（component-eval.test.ts）把 36 个元件的 eval 逐个跑通了，
// 但它全部用 baseDef()——**不展开**的那份引脚表。expandInputs / expandBits 这条路径
// 决定了「引脚有几个、每个多宽、外形多大、成本多少」，此前一条测试都没有。
// 而这条路径的产物直接进 build.ts:65 参与连线和成本核算。
//
// 本轮实测结论（2026-10-04）：
//   1. ALU op=6（左移）的 carry **取错了位**——sh>=2 时取到的是 (bits-sh) 位而不是
//      最高位；sh>bits 时 (bits-sh) 为负，`>>>` 按 32 取模后读到完全无关的位。
//      该信号不是装饰：src/cpu/reference.ts:443 把 alu 的 carry 并进了标志寄存器，
//      所以 `shl` 指令的 C 标志是错的。
//   2. 结构参数（inputs / bitWidth）没有取整，导入一个写了 2.7 的电路 JSON
//      就会算出 cost=3.7、size.h=3.7 的元件。
//   3. mux 与 demux 对「sel 超出输入数」的处理不对称：mux 夹到最后一路，
//      demux 全输出 0。这是**设计选择**不是缺陷，这里只钉住不改。
//
// 运行：npm test（node --experimental-strip-types --test tests/*.test.ts）

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { baseDef, resolveDef, type CompDef } from "../src/core/registry.ts";
import type { EvalCtx } from "../src/core/types.ts";

/**
 * 搭一个求值上下文；params 原样返回（不走 sim 的 p() 转换，那是另一条路径）。
 *
 * w() **按引脚宽度掩码**——这一点必须和 sim.ts:483 的 c.w 一致，否则
 * `shift` 的算术右移（`toSignedLocal(a,bits) >> sh` 会写出负数）
 * 在测试里是 -64、在真实仿真里是 192，同一个元件两套数。
 * 第一版没掩，5 条 shift 断言全是假红。
 */
function harness(def: CompDef, inputs: Record<string, number>, opts: {
  params?: Record<string, number | string | boolean>;
  bits?: number;
  state?: Record<string, unknown>;
  /** 关掉 c.w 的掩码，用来分辨「eval 自己掩了」还是「sim 替它掩了」。 */
  maskWrites?: boolean;
} = {}) {
  const st: Record<string, number> = {};
  const s = opts.state ?? {};
  const bits = opts.bits ?? 1;
  // PinSpec.width 的类型是 number | "auto"。"auto" 要落回元件位宽 ——
  // 我第一版写成 `?? bits`，结果 allOnes("auto") = 1<<NaN = 0，
  // 于是**每一次写都被掩成 0**，35 条断言齐刷刷假红。
  const widthOf = (id: string): number => {
    const w = def.pins.find((q) => q.id === id)?.width;
    return typeof w === "number" ? w : bits;
  };
  const maskWrites = opts.maskWrites !== false;
  const ctx: EvalCtx = {
    r: (p) => inputs[p] ?? 0,
    w: (p, v) => { st[p] = maskWrites ? v & allOnes(widthOf(p)) : v; },
    rw: (p) => inputs[p] ?? st[p] ?? 0,
    p: <T,>(k: string) => opts.params?.[k] as T,
    bits,
    ins: def.pins.filter((p) => p.kind === "in").map((p) => p.id),
    outs: def.pins.filter((p) => p.kind === "out").map((p) => p.id),
    s: s as never,
    log: () => {},
  } as EvalCtx;
  return { ctx, out: st, s };
}

/** 求值并返回 {引脚id: 值}。用展开后的引脚表，所以能测到 inputs 参与的分支。 */
function evalExpanded(type: string, params: Record<string, number | string | boolean>,
                      inputs: Record<string, number>, bits: number) {
  const def = resolveDef(type, params)!;
  assert.ok(def, `元件 ${type} 不存在`);
  const h = harness(def, inputs, { params, bits });
  def.eval?.(h.ctx);
  return h.out;
}

const pinIds = (type: string, params: Record<string, number | string | boolean>) =>
  resolveDef(type, params)!.pins.map((p) => p.id);

const allOnes = (n: number) => (n >= 32 ? -1 : (1 << n) - 1);

// ---------------------------------------------------------------- 结构展开

describe("mux：引脚数量随 inputs 参数变化", () => {
  test("inputs=2 是基线形态", () => {
    assert.deepEqual(pinIds("mux", { inputs: 2 }), ["sel", "i0", "i1", "out"]);
  });

  test("inputs=4 展开出 4 路输入，sel 宽 2 位", () => {
    const d = resolveDef("mux", { inputs: 4 })!;
    assert.deepEqual(d.pins.map((p) => p.id), ["sel", "i0", "i1", "i2", "i3", "out"]);
    assert.equal(d.pins.find((p) => p.id === "sel")!.width, 2, "4 路要 2 位选通");
  });

  test("inputs=3 时 sel 宽 2 位（向上取整），不是 1 位", () => {
    // 3 路需要能表达 0/1/2，log2(3)=1.58 → 2 位。这类「不是 2 的幂」的宽度
    // 很容易被写成 Math.floor 而错成 1 位，所以单独钉一条。
    const d = resolveDef("mux", { inputs: 3 })!;
    assert.equal(d.pins.find((p) => p.id === "sel")!.width, 2);
    assert.equal(d.pins.filter((p) => /^i\d/.test(p.id)).length, 3);
  });

  test("inputs=5/8 时 sel 宽 3 位，成本随路数增长", () => {
    assert.equal(resolveDef("mux", { inputs: 5 })!.pins.find((p) => p.id === "sel")!.width, 3);
    assert.equal(resolveDef("mux", { inputs: 8 })!.pins.find((p) => p.id === "sel")!.width, 3);
    assert.equal(resolveDef("mux", { inputs: 2 })!.cost, 3);
    assert.equal(resolveDef("mux", { inputs: 4 })!.cost, 5);
    assert.equal(resolveDef("mux", { inputs: 8 })!.cost, 9);
  });

  test("外形高度 = 路数 + 1（sel 独占一行）", () => {
    for (const n of [2, 3, 4, 5, 8]) {
      assert.equal(resolveDef("mux", { inputs: n })!.size.h, n + 1, `inputs=${n}`);
    }
  });

  test("inputs 越界被夹到 1..8，不会生成 0 路或 9 路", () => {
    assert.equal(resolveDef("mux", { inputs: 9 })!.pins.filter((p) => /^i\d/.test(p.id)).length, 8);
    assert.equal(resolveDef("mux", { inputs: 999 })!.pins.filter((p) => /^i\d/.test(p.id)).length, 8);
    assert.equal(resolveDef("mux", { inputs: -3 })!.pins.filter((p) => /^i\d/.test(p.id)).length, 1);
  });

  test("inputs=0 / NaN / 非数字回落到基线的 2 路", () => {
    for (const bad of [0, NaN, "abc", undefined, ""]) {
      const ids = pinIds("mux", { inputs: bad as number });
      assert.deepEqual(ids, ["sel", "i0", "i1", "out"], `inputs=${JSON.stringify(bad)}`);
    }
  });

  test("inputs 是字符串数字时也能展开（参数存在 JSON 里就是字符串）", () => {
    assert.deepEqual(pinIds("mux", { inputs: "4" }), ["sel", "i0", "i1", "i2", "i3", "out"]);
  });

  test("展开出的引脚：输入路自上而下均匀分布，全部落在外形内", () => {
    const d = resolveDef("mux", { inputs: 4 })!;
    const ins = d.pins.filter((p) => p.kind === "in");
    const ys = ins.map((p) => p.y);
    for (let i = 1; i < ys.length; i++) {
      assert.ok(ys[i] > ys[i - 1], `第 ${i} 个输入引脚 y=${ys[i]} 未大于前一个 ${ys[i - 1]}`);
    }
    // 输出脚在垂直中点（h/2），所以它**不在**递增序列里，单独断言落在范围内。
    for (const p of d.pins) {
      assert.ok(p.y > 0 && p.y <= d.size.h, `引脚 ${p.id} 的 y=${p.y} 跑出外形 h=${d.size.h}`);
    }
    assert.equal(d.pins.find((p) => p.id === "out")!.y, d.size.h / 2);
  });
});

describe("demux：输出路数随 inputs 变化", () => {
  test("inputs=3 展开出 3 路输出，无 i 系列引脚", () => {
    const d = resolveDef("demux", { inputs: 3 })!;
    assert.deepEqual(d.pins.map((p) => p.id), ["sel", "o0", "o1", "o2"]);
    assert.equal(d.pins.filter((p) => /^i\d/.test(p.id)).length, 0, "demux 不该有输入路");
  });

  test("inputs 越界夹到 8，0 回落基线 2 路", () => {
    assert.equal(resolveDef("demux", { inputs: 12 })!.pins.filter((p) => /^o\d/.test(p.id)).length, 8);
    assert.deepEqual(pinIds("demux", { inputs: 0 }), ["sel", "o0", "o1"]);
  });
});

describe("逻辑门：inputs 展开成多输入", () => {
  for (const t of ["and", "or", "xor", "nand", "nor", "xnor"]) {
    test(`${t}：inputs=4 展开成 4 输入 1 输出，成本 4`, () => {
      const d = resolveDef(t, { inputs: 4 })!;
      assert.deepEqual(d.pins.map((p) => p.id), ["i0", "i1", "i2", "i3", "out"]);
      assert.equal(d.cost, 4);
    });
  }

  test("buf/not/const/input 不受 inputs 影响（它们没有该参数）", () => {
    for (const t of ["buf", "not", "const", "input", "output", "note"]) {
      assert.deepEqual(pinIds(t, { inputs: 4 }), pinIds(t, {}), `${t} 不该被 inputs 展开`);
    }
  });

  test("and 4 输入：全 1 才为 1（用展开后的引脚表求值）", () => {
    assert.equal(evalExpanded("and", { inputs: 4 }, { i0: 1, i1: 1, i2: 1, i3: 1 }, 1).out, 1);
    assert.equal(evalExpanded("and", { inputs: 4 }, { i0: 1, i1: 1, i2: 1, i3: 0 }, 1).out, 0);
  });
});

describe("split / merge：逐位引脚随 bitWidth 变化", () => {
  test("bitWidth=4 展开出 b0..b3", () => {
    assert.deepEqual(pinIds("split", { bitWidth: 4 }), ["in", "b0", "b1", "b2", "b3"]);
    // merge 的宽脚（out）在**前**、b 系列在后；split 的宽脚（in）也在前。
    // expandBits 是把宽脚 push 在循环之前，两边都这样，不是笔误。
    assert.deepEqual(pinIds("merge", { bitWidth: 4 }), ["out", "b0", "b1", "b2", "b3"]);
  });

  test("bitWidth=1 只有一位，bitWidth=32 有 32 位（上下界）", () => {
    assert.equal(resolveDef("split", { bitWidth: 1 })!.pins.filter((p) => /^b\d/.test(p.id)).length, 1);
    assert.equal(resolveDef("split", { bitWidth: 32 })!.pins.filter((p) => /^b\d/.test(p.id)).length, 32);
    assert.equal(resolveDef("split", { bitWidth: 33 })!.pins.filter((p) => /^b\d/.test(p.id)).length, 32);
    assert.equal(resolveDef("split", { bitWidth: 999 })!.pins.filter((p) => /^b\d/.test(p.id)).length, 32);
  });

  test("bitWidth=0 / 非法 / 缺省回落到默认 4 位", () => {
    for (const bad of [0, NaN, "x", undefined]) {
      assert.equal(
        resolveDef("split", { bitWidth: bad as number })!.pins.filter((p) => /^b\d/.test(p.id)).length,
        4, `bitWidth=${JSON.stringify(bad)}`
      );
    }
  });

  test("split 的 b 系列是输出、merge 的 b 系列是输入（方向不能弄反）", () => {
    // 上面那条只比引脚 **id**，方向反了照样通过。expandBits 里
    // `isSplit = def.type === "split"` 决定 b 引脚是 in 还是 out ——
    // 弄反的话连不上线，而所有 id 层面的断言都发现不了。
    const s = resolveDef("split", { bitWidth: 4 })!.pins;
    const m = resolveDef("merge", { bitWidth: 4 })!.pins;
    for (const p of s.filter((q) => /^b\d/.test(q.id))) {
      assert.equal(p.kind, "out", `split.${p.id} 必须是输出`);
      assert.equal(p.dir, "r", `split.${p.id} 必须在右侧`);
    }
    for (const p of m.filter((q) => /^b\d/.test(q.id))) {
      assert.equal(p.kind, "in", `merge.${p.id} 必须是输入`);
      assert.equal(p.dir, "l", `merge.${p.id} 必须在左侧`);
    }
    assert.equal(s.find((p) => p.id === "in")!.kind, "in");
    assert.equal(m.find((p) => p.id === "out")!.kind, "out");
  });

  test("split 逐位拆分正确（用展开后的引脚表）", () => {
    const out = evalExpanded("split", { bitWidth: 4 }, { in: 0b1011 }, 4);
    assert.equal(out.b0, 1);
    assert.equal(out.b1, 1);
    assert.equal(out.b2, 0);
    assert.equal(out.b3, 1);
  });

  test("merge 逐位合并正确", () => {
    const out = evalExpanded("merge", { bitWidth: 4 }, { b0: 1, b1: 1, b2: 0, b3: 1 }, 4);
    assert.equal(out.out, 0b1011);
  });

  test("split 与 merge 互为逆运算（8 位遍历 16 个样例）", () => {
    for (let v = 0; v < 16; v++) {
      const bits = evalExpanded("split", { bitWidth: 4 }, { in: v }, 4);
      const merged = evalExpanded("merge", { bitWidth: 4 }, bits, 4);
      assert.equal(merged.out, v, `v=${v}`);
    }
  });
});

describe("结构参数必须是整数（导入的电路 JSON 可以带小数）", () => {
  // serialize.ts:182 对 params 是裸 cast，import.ts 完全不校验 params，
  // 所以 `"inputs": 2.7` 能一路流到 expandInputs。实测原实现：
  //   inputs=2.7  → 3 个输入引脚（`i < 2.7` 取到上界），但 cost=3.7、size.h=3.7
  //   bitWidth=2.7 → 3 个 b 引脚，但 size.h=2.7
  // 同一份数据两套口径：引脚数按上界算，成本和尺寸按原值算。
  // 成本会进 build.ts 的成本核算，小数尺寸让画布上的元件高 3.7 格。
  //
  // 修法是**向下取整**（不是四舍五入、不是拒绝）：2.7 → 2。
  // 取整后引脚数也变 2，所以三条断言的期望值是 2 不是 3 —— 这是有意的，
  // 「引脚数 / 成本 / 尺寸三者一致」比「尽量保住原来的引脚数」更重要。
  test("inputs=2.7 向下取整成 2 路，成本与尺寸随之变整数", () => {
    const d = resolveDef("mux", { inputs: 2.7 })!;
    assert.equal(d.pins.filter((p) => /^i\d/.test(p.id)).length, 2);
    assert.equal(d.cost, 3);
    assert.equal(d.size.h, 3);
  });

  test("bitWidth=2.7 向下取整成 2 位", () => {
    const d = resolveDef("split", { bitWidth: 2.7 })!;
    assert.equal(d.pins.filter((p) => /^b\d/.test(p.id)).length, 2);
    assert.equal(d.size.h, 2, "2 位时高度取下限 2");
  });

  test("demux 与 gate 的 inputs 同样取整", () => {
    assert.equal(resolveDef("demux", { inputs: 2.7 })!.cost, 2);
    assert.equal(resolveDef("demux", { inputs: 2.7 })!.size.h, 2);
    assert.equal(resolveDef("and", { inputs: 2.7 })!.cost, 2);
    assert.equal(resolveDef("and", { inputs: 2.7 })!.size.h, 2);
  });

  test("小数落在上下界之外时先取整再夹（8.9 → 8，不是 9）", () => {
    assert.equal(resolveDef("mux", { inputs: 8.9 })!.pins.filter((p) => /^i\d/.test(p.id)).length, 8);
    assert.equal(resolveDef("split", { bitWidth: 32.9 })!.pins.filter((p) => /^b\d/.test(p.id)).length, 32);
    assert.equal(resolveDef("mux", { inputs: 0.9 })!.pins.filter((p) => /^i\d/.test(p.id)).length, 2, "0.9→0→回落到基线 2 路");
  });

  test("取整成 0 与本来就是 0，必须落到同一个缺省值", () => {
    // 修 expandBits 时踩到：先 `|| 4` 再取整的话，0 得 4 位、0.9 得 1 位。
    // 这条钉住「先取整、再当缺省」——顺序反过来就会红。
    assert.equal(resolveDef("split", { bitWidth: 0 })!.pins.filter((p) => /^b\d/.test(p.id)).length, 4);
    assert.equal(resolveDef("split", { bitWidth: 0.9 })!.pins.filter((p) => /^b\d/.test(p.id)).length, 4);
    assert.equal(resolveDef("mux", { inputs: 0 })!.pins.filter((p) => /^i\d/.test(p.id)).length, 2);
    assert.equal(resolveDef("mux", { inputs: 0.9 })!.pins.filter((p) => /^i\d/.test(p.id)).length, 2);
    assert.equal(resolveDef("split", { bitWidth: 0.4 })!.pins.filter((p) => /^b\d/.test(p.id)).length, 4);
  });

  test("任意小数输入下，成本和尺寸都必须是整数（不变量）", () => {
    for (const v of [1.1, 2.5, 3.9, 4.5, 7.99, -0.5, -7.3]) {
      for (const t of ["mux", "demux", "and", "or", "xor"]) {
        const d = resolveDef(t, { inputs: v })!;
        assert.ok(Number.isInteger(d.cost), `${t} inputs=${v} cost=${d.cost} 不是整数`);
        assert.ok(Number.isInteger(d.size.h), `${t} inputs=${v} size.h=${d.size.h} 不是整数`);
      }
      for (const t of ["split", "merge"]) {
        const d = resolveDef(t, { bitWidth: v })!;
        assert.ok(Number.isInteger(d.size.h), `${t} bitWidth=${v} size.h=${d.size.h} 不是整数`);
      }
    }
  });

  test("取整不影响整数输入（回归防护）", () => {
    for (const n of [2, 3, 4, 8]) {
      const d = resolveDef("mux", { inputs: n })!;
      assert.equal(d.pins.filter((p) => /^i\d/.test(p.id)).length, n);
      assert.equal(d.cost, n + 1);
      assert.equal(d.size.h, n + 1);
    }
  });
});

describe("mux / demux 求值：sel 超出输入数的两种不同处理（钉住现状）", () => {
  // 这是**不对称**的，但它是设计选择不是缺陷：mux 夹到最后一路，demux 全 0。
  // 改任何一边都会改变已有电路的行为，所以这里只记录并钉住。
  test("mux：inputs=3 时 sel=3 夹到 i2（不是悬空也不是 0）", () => {
    const out = evalExpanded("mux", { inputs: 3 }, { sel: 3, i0: 10, i1: 11, i2: 12 }, 8);
    assert.equal(out.out, 12);
  });

  test("demux：inputs=3 时 sel=3 全输出 0", () => {
    const out = evalExpanded("demux", { inputs: 3 }, { sel: 3 }, 8);
    assert.equal(out.o0, 0);
    assert.equal(out.o1, 0);
    assert.equal(out.o2, 0);
  });

  test("mux：sel 在 eval 里按 sel 宽度再取一次模", () => {
    // inputs=4 → sel 宽 2 位。真实 sim 的 c.r() 已按引脚宽掩过一道，
    // 但 eval 里那句 `& allOnes(selWidth)` 是**独立的一道**。
    // 本测试的 ctx.r() 是裸的（不做 sim 的掩码），所以喂超宽 sel 才测得到它 ——
    // 我第一版喂的是 sel=1（宽度内），测试名说「高位不参与选路」实际什么都没测，
    // 变异去掉那句掩码时全绿。测试名在说谎比没有测试更坏。
    const wide = evalExpanded("mux", { inputs: 4 }, { sel: 0b100, i0: 10, i1: 11, i2: 12, i3: 13 }, 8);
    assert.equal(wide.out, 10, "sel=0b100 应被掩成 0b00 → 选 i0");

    // 宽度内的取值不受影响（掩码必须是幂等的）
    for (let sel = 0; sel < 4; sel++) {
      const out = evalExpanded("mux", { inputs: 4 }, { sel, i0: 10, i1: 11, i2: 12, i3: 13 }, 8);
      assert.equal(out.out, 10 + sel, `sel=${sel}`);
    }
  });

  test("mux：inputs=1 时只有 i0 会被选中", () => {
    const out = evalExpanded("mux", { inputs: 1 }, { sel: 0 }, 8);
    assert.equal(out.out, 0);
  });

  test("demux：恰好一路为 1", () => {
    for (let sel = 0; sel < 3; sel++) {
      const out = evalExpanded("demux", { inputs: 3 }, { sel }, 8);
      const on = [0, 1, 2].filter((k) => out["o" + k] === 1);
      assert.deepEqual(on, [sel], `sel=${sel}`);
    }
  });

  test("demux：只写 o0..o{n-1}，不多写一路（这是防线，不是风格）", () => {
    // 变异把循环改成 `k < n + 1` 时会多写一个 o{n}。上面的「恰好一路为 1」
    // 只读 o0..o2，多出来的 o3 根本没人看 ⇒ 0 红。必须断言**被写的引脚集合**。
    for (const n of [2, 3, 5]) {
      const written = Object.keys(evalExpanded("demux", { inputs: n }, { sel: 0 }, 8)).sort();
      const expected = Array.from({ length: n }, (_, k) => "o" + k).sort();
      assert.deepEqual(written, expected, `inputs=${n} 写了不该写的引脚`);
    }
  });
});

// ---------------------------------------------------------------- ALU

describe("ALU：8 个操作的输出", () => {
  // out / zero / carry / neg
  const run = (a: number, b: number, op: number, bits: number) =>
    evalExpanded("alu", {}, { a, b, op }, bits);

  test("op=0 加法：正常不进位", () => {
    const r = run(5, 3, 0, 8);
    assert.equal(r.out, 8);
    assert.equal(r.carry, 0);
    assert.equal(r.zero, 0);
    assert.equal(r.neg, 0);
  });

  test("op=0 加法：溢出进位", () => {
    const r = run(200, 100, 0, 8);
    assert.equal(r.out, 44, "300 & 0xFF");
    assert.equal(r.carry, 1);
  });

  test("op=1 减法：a<b 时 carry=1（借位）", () => {
    assert.equal(run(3, 5, 1, 8).out, 254);
    assert.equal(run(3, 5, 1, 8).carry, 1);
    assert.equal(run(200, 100, 1, 8).carry, 0);
  });

  test("op=2/3/4 逻辑运算", () => {
    assert.equal(run(0b1100, 0b1010, 2, 4).out, 0b1000);
    assert.equal(run(0b1100, 0b1010, 3, 4).out, 0b1110);
    assert.equal(run(0b1100, 0b1010, 4, 4).out, 0b0110);
  });

  test("op=5 取反后受位宽限制", () => {
    assert.equal(run(0b0000, 0, 5, 4).out, 0b1111);
    assert.equal(run(0b1010, 0, 5, 4).out, 0b0101);
  });

  test("op 被掩到 3 位：op=9 等价于 op=1", () => {
    assert.equal(run(3, 5, 9, 8).out, run(3, 5, 1, 8).out);
  });

  test("zero 标志跟随 out", () => {
    assert.equal(run(0, 0, 0, 8).zero, 1);
    assert.equal(run(1, 0, 0, 8).zero, 0);
    assert.equal(run(0b0110, 0b0110, 4, 4).zero, 1, "0110^0110=0");
    assert.equal(run(0b0110, 0b1100, 4, 4).zero, 0, "0110^1100=1010");
  });

  test("neg 标志取 out 的最高位", () => {
    assert.equal(run(0b1000, 0b0001, 0, 4).out, 0b1001);
    assert.equal(run(0b1000, 0b0001, 0, 4).neg, 1);
    assert.equal(run(0b1000, 0b0000, 5, 4).out, 0b0111);
    assert.equal(run(0b1000, 0b0000, 5, 4).neg, 0, "取反后最高位变 0");
  });
});

describe("ALU 左移 op=6 的 carry —— 必须是「被移出的最高位」", () => {
  // 原实现：carry = (a >>> (bits - sh)) & 1
  // 左移 sh 位时被移出的是最高 sh 位，**最后移出的那一位恒是最高位**，
  // 与 sh 无关。写成 (bits - sh) 在 sh=1 时碰巧正确，sh>=2 就取到了更低的位。
  // 这条信号接进了参考 CPU 的标志寄存器（src/cpu/reference.ts:443），
  // 所以错了是 `shl` 指令的 C 标志错，不是死代码。
  //
  // 判别值必须稀疏：全 1 的 a 会让「最高位」和「次高位」都是 1，把差异盖住
  // （我第一版探针就栽在这，8 组全报 OK）。这里用 0b1000/0b10000000。
  test("bits=4 a=0b1000：sh=1 移出最高位，carry=1", () => {
    assert.equal(evalExpanded("alu", {}, { a: 0b1000, b: 1, op: 6 }, 4).carry, 1);
  });

  test("bits=4 a=0b1000：sh=2 移出的仍是最高位，carry=1", () => {
    const r = evalExpanded("alu", {}, { a: 0b1000, b: 2, op: 6 }, 4);
    assert.equal(r.out, 0, "1000<<2 截断到 4 位 = 0");
    assert.equal(r.carry, 1, "移出的是 0b10，最后一位是最高位 1");
  });

  test("bits=4 a=0b1000：sh=3 / sh=4 同样 carry=1", () => {
    assert.equal(evalExpanded("alu", {}, { a: 0b1000, b: 3, op: 6 }, 4).carry, 1);
    assert.equal(evalExpanded("alu", {}, { a: 0b1000, b: 4, op: 6 }, 4).carry, 1);
  });

  test("bits=8 a=0x80：sh=2..8 移出的都是最高位，carry 恒为 1", () => {
    for (const sh of [1, 2, 3, 4, 5, 8]) {
      assert.equal(evalExpanded("alu", {}, { a: 0x80, b: sh, op: 6 }, 8).carry, 1, `sh=${sh}`);
    }
  });

  test("最高位为 0 时 carry 恒为 0（与 sh 无关）", () => {
    for (const sh of [1, 2, 3, 7]) {
      assert.equal(evalExpanded("alu", {}, { a: 0b0111, b: sh, op: 6 }, 4).carry, 0, `sh=${sh}`);
    }
  });

  test("sh=0 不移位，carry=0", () => {
    assert.equal(evalExpanded("alu", {}, { a: 0x80, b: 0, op: 6 }, 8).carry, 0);
    assert.equal(evalExpanded("alu", {}, { a: 0x80, b: 0, op: 6 }, 8).out, 0x80);
  });

  test("sh 大于位宽不产生负移位读数（原实现 a >>> (bits-sh) 在这里取负数）", () => {
    // bits=4, sh=8 → bits-sh = -4，JS 的 >>> 会对 32 取模 → a >>> 28，
    // 读到的是完全无关的位。这里断言 carry 仍是最高位。
    for (const sh of [5, 6, 8, 31]) {
      assert.equal(evalExpanded("alu", {}, { a: 0b1000, b: sh, op: 6 }, 4).carry, 1, `sh=${sh}`);
    }
  });
});

describe("ALU 右移 op=7 的 carry —— 最后移出的那一位（对照，未改）", () => {
  // 右移 sh 位时移出的是 0..sh-1 位，最后移出的是第 sh-1 位。
  // 原实现的 (a >>> (sh-1)) & 1 正是这个意思，**这条是对的**，与左移对照读。
  test("a 的第 0 位为 1 时，sh<=1 carry=1，sh>=2 carry=0", () => {
    assert.equal(evalExpanded("alu", {}, { a: 1, b: 1, op: 7 }, 8).carry, 1);
    assert.equal(evalExpanded("alu", {}, { a: 1, b: 2, op: 7 }, 8).carry, 0);
  });

  test("a=0b0011：sh=2 移出 bit1 是最后一位，carry=1", () => {
    assert.equal(evalExpanded("alu", {}, { a: 0b0011, b: 2, op: 7 }, 4).carry, 1);
  });

  test("sh=0 carry=0，out 不变", () => {
    const r = evalExpanded("alu", {}, { a: 0x81, b: 0, op: 7 }, 8);
    assert.equal(r.carry, 0);
    assert.equal(r.out, 0x81);
  });

  test("右移是逻辑移位：最高位不补符号", () => {
    assert.equal(evalExpanded("alu", {}, { a: 0b1000, b: 1, op: 7 }, 4).out, 0b0100);
  });
});

describe("shift 元件：方向 / 逻辑 vs 算术", () => {
  const run = (a: number, sh: number, params: Record<string, number | string | boolean>) =>
    evalExpanded("shift", params, { a, sh }, 8).out!;

  test("左移按位宽截断", () => {
    assert.equal(run(0b10000001, 1, { dir: "left" }), 0b00000010);
    assert.equal(run(0b10000001, 7, { dir: "left" }), 0b10000000);
  });

  test("右移默认逻辑移位，高位补 0", () => {
    assert.equal(run(0b10000001, 1, { dir: "right" }), 0b01000000);
  });

  test("arith=true 时右移补符号位", () => {
    assert.equal(run(0b10000001, 1, { dir: "right", arith: true }), 0b11000000);
    assert.equal(run(0b01000001, 1, { dir: "right", arith: true }), 0b00100000);
  });

  test("移位量先按 5 位取模、再夹到位宽（两条钳位是串联的）", () => {
    // 实现是 Math.min(bits, sh & 31)。所以：
    //   sh=99 → 99&31=3 → 左移 3 位，不是全 0（我第一版写「超出即全 0」是错的）
    //   sh=12 → 12&31=12 → min(8,12)=8 → 移满 8 位才是全 0
    assert.equal(run(0b11111111, 99, { dir: "left" }), 0b11111000, "99 被 31 取模成 3");
    assert.equal(run(0b11111111, 12, { dir: "left" }), 0, "12 夹到位宽 8 → 移光");
    assert.equal(run(0b10000000, 12, { dir: "right", arith: true }), 0b11111111, "算术右移移光 = 全 1");
    // 0x80 是 -128，-128 >> 3 = -16，掩回 8 位 = 0xF0
    assert.equal(run(0b10000000, 99, { dir: "right", arith: true }), 0b11110000, "99 → 3 位");
  });

  test("左移忽略 arith 参数（只有右移有算术移位）", () => {
    assert.equal(run(0b10000001, 1, { dir: "left", arith: true }), 0b00000010);
  });

  test("shift 没有 carry 输出 —— 与 ALU 的 carry 是两套东西", () => {
    // 记一条边界：shift 组件只有 out，ALU 的 carry 语义不适用于它。
    const d = baseDef("shift")!;
    assert.deepEqual(d.pins.map((p) => p.id), ["a", "sh", "out"]);
  });

  test("算术右移写出的是无符号值，不会把负数留给下游", () => {
    // 场景：8 位 shift(arith) 的 out 接到一条网络上，而那条网络上还挂着
    // 16 位引脚 ⇒ netlist.ts:287 让网络宽度变成 16 ⇒ sim.ts:486 的 c.w
    // 按 16 掩码，不会把 8 位的 shift 收窄。原先这一支不自己掩码，
    // 于是 -64 以 0xFFC0 的形态留在总线上，右侧 8 位虽然对、整体是垃圾。
    // 左右两个分支都有 & m，只有算术右移漏了。
    const def = resolveDef("shift", { dir: "right", arith: true })!;
    const h = harness(def, { a: 0b10000000, sh: 1 }, { params: { dir: "right", arith: true }, bits: 8, maskWrites: false });
    def.eval!(h.ctx);
    assert.equal(h.out.out, 0b11000000, "应是 0xC0，不是 -64 / 0xFFC0");
  });
});

// ---------------------------------------------------------------- RAM / ROM

describe("eval 自己掩码，不是靠 sim 的 c.w 替它掩", () => {
  // 这组用 maskWrites:false 关掉 c.w 的掩码。
  // 为什么要有：sim.ts:483 的 c.w 会按**网络宽度**掩码，而网络宽度取自最宽的
  // 相连引脚，不一定是元件自己的位宽。所以 eval 里那句 `& m` 不是多余的 ——
  // 一旦 dout 接到一条更宽的总线上，c.w 就不会替 ram 收窄。
  // 用默认 harness 测的话，harness 把 "auto" 落回 bits，正好把 eval 自己那层
  // 掩码盖住，于是「去掉 `& m`」这个变异跑出来 0 红。
  const raw = (type: string, params: Record<string, number | string | boolean>,
               inputs: Record<string, number>, bits: number) => {
    const def = resolveDef(type, params)!;
    const h = harness(def, inputs, { params, bits, maskWrites: false });
    def.eval?.(h.ctx);
    return h.out;
  };

  test("shift 左移：eval 写出的值已经是位宽内的（不是靠 c.w 收窄）", () => {
    assert.equal(raw("shift", { dir: "left" }, { a: 0b11111111, sh: 3 }, 8).out, 0b11111000);
    assert.equal(raw("shift", { dir: "left" }, { a: 0b10000001, sh: 1 }, 8).out, 0b00000010);
  });

  test("shift 算术右移：负数结果在写出前就被掩回无符号", () => {
    // 0x80 在 8 位下是 -128，-128>>1 = -64。掩回 8 位应是 0xC0 = 192。
    const out = raw("shift", { dir: "right", arith: true }, { a: 0b10000000, sh: 1 }, 8).out;
    assert.equal(out, 0b11000000);
    assert.ok(out >= 0, "不该是负数");
  });

  test("ALU 的 out / neg：加法溢出前已按位宽截断", () => {
    const out = raw("alu", {}, { a: 200, b: 100, op: 0 }, 8);
    assert.equal(out.out, 44, "300 截回 8 位");
    assert.equal(out.carry, 1);
  });

  test("mux 的 out 也已经过 sel 宽度的下标夹取", () => {
    const out = raw("mux", { inputs: 3 }, { sel: 3, i0: 10, i1: 11, i2: 12 }, 8);
    assert.equal(out.out, 12);
  });
});

describe("RAM：深度来自 addrBits，写在上升沿", () => {
  test("读未写过的地址得 0", () => {
    const params = { bitWidth: 8, addrBits: 3, data: "" };
    const def = resolveDef("ram", params)!;
    const h = harness(def, { addr: 5 }, { params, bits: 8, state: {} });
    def.eval!(h.ctx);
    assert.equal(h.out.dout, 0);
  });

  test("上升沿写入后组合读能立刻拿到", () => {
    const params = { bitWidth: 8, addrBits: 3, data: "" };
    const def = resolveDef("ram", params)!;
    const s: Record<string, unknown> = {};

    const rd = (inputs: Record<string, number>) => {
      const h = harness(def, inputs, { params, bits: 8, state: s });
      def.eval!(h.ctx);
      return h.out.dout!;
    };
    const wr = (inputs: Record<string, number>) => {
      const h = harness(def, inputs, { params, bits: 8, state: s });
      def.onRise!(h.ctx);
    };

    assert.equal(rd({ addr: 5 }), 0, "写前");
    wr({ addr: 5, din: 0xab, wen: 1 });
    assert.equal(rd({ addr: 5 }), 0xab, "写后");
    assert.equal(rd({ addr: 6 }), 0, "别的地址没被动过");
  });

  test("wen=0 时不写", () => {
    const params = { bitWidth: 8, addrBits: 2, data: "" };
    const def = resolveDef("ram", params)!;
    const s: Record<string, unknown> = {};
    const h = harness(def, { addr: 1, din: 0xff, wen: 0 }, { params, bits: 8, state: s });
    def.onRise!(h.ctx);
    const h2 = harness(def, { addr: 1 }, { params, bits: 8, state: s });
    def.eval!(h2.ctx);
    assert.equal(h2.out.dout, 0);
  });

  test("data 内容按位宽掩码后装载", () => {
    const params = { bitWidth: 4, addrBits: 2, data: "0xFF 0x1 0x2 0x3" };
    const def = resolveDef("ram", params)!;
    const s: Record<string, unknown> = {};
    const at = (a: number) => {
      const h = harness(def, { addr: a }, { params, bits: 4, state: s });
      def.eval!(h.ctx);
      return h.out.dout!;
    };
    assert.equal(at(0), 0xf, "0xFF 在 4 位宽下截成 0xF");
    assert.equal(at(1), 1);
  });

  test("data 超出深度时多出来的被丢弃（addrBits 决定深度）", () => {
    const params = { bitWidth: 8, addrBits: 1, data: "0x11 0x22 0x33 0x44" };
    const def = resolveDef("rom", params)!;
    const s: Record<string, unknown> = {};
    const at = (a: number) => {
      const h = harness(def, { addr: a }, { params, bits: 8, state: s });
      def.eval!(h.ctx);
      return h.out.out!;
    };
    assert.equal(at(0), 0x11);
    assert.equal(at(1), 0x22);
  });

  test("改 data 参数会让内存缓存失效并重新装载", () => {
    let data = "0x11";
    const params = { bitWidth: 8, addrBits: 2, data };
    const def = resolveDef("rom", params)!;
    const s: Record<string, unknown> = {};
    const at = () => {
      const h = harness(def, { addr: 0 }, { params: { ...params, data }, bits: 8, state: s });
      def.eval!(h.ctx);
      return h.out.out!;
    };
    assert.equal(at(), 0x11);
    data = "0x99";
    assert.equal(at(), 0x99, "缓存键含 data，改了必须重新装载");
  });

  test("改 bitWidth / addrBits 也会让缓存失效", () => {
    const def = resolveDef("rom", {})!;
    const s: Record<string, unknown> = {};
    const at = (params: Record<string, number | string | boolean>) => {
      const h = harness(def, { addr: 0 }, { params, bits: Number(params.bitWidth), state: s });
      def.eval!(h.ctx);
      return h.out.out!;
    };
    assert.equal(at({ bitWidth: 8, addrBits: 2, data: "0xFF" }), 0xff);
    assert.equal(at({ bitWidth: 4, addrBits: 2, data: "0xFF" }), 0xf, "位宽变了要重新掩码");
    assert.equal(at({ bitWidth: 8, addrBits: 1, data: "0x1 0x2" }), 0x1, "深度变了要重新装载");
  });
});

describe("内存装载的内部状态（白盒：只看 dout 看不出这三件事）", () => {
  // memOf 把数组缓存在 c.s._mem 上。前面的测试只看 dout，
  // 于是「装载时掩码」「深度按 addrBits」「缓存键含位宽」这三条全是惰性的 ——
  // 因为读出时还有一层 c.w 掩码兜着。变异去掉它们一律 0 红。
  // 这里直接读 c.s._mem，把惰性变成可观测。
  const memOf = (type: "ram" | "rom", params: Record<string, number | string | boolean>,
                 bits: number, touch = true) => {
    const def = resolveDef(type, params)!;
    const s: Record<string, unknown> = {};
    const h = harness(def, { addr: 0 }, { params, bits, state: s, maskWrites: false });
    def.eval!(h.ctx);
    return s._mem as number[];
  };

  test("装载时就按 bitWidth 掩码，不是等到读出时才掩", () => {
    const m = memOf("rom", { bitWidth: 4, addrBits: 2, data: "0xFF 0x1" }, 4);
    assert.equal(m[0], 0xf, "存进去就该是 0xF；0xFF 留在数组里说明装载时没掩");
  });

  test("数组长度 = 2 ** addrBits", () => {
    assert.equal(memOf("rom", { bitWidth: 8, addrBits: 1, data: "" }, 8).length, 2);
    assert.equal(memOf("rom", { bitWidth: 8, addrBits: 3, data: "" }, 8).length, 8);
    assert.equal(memOf("ram", { bitWidth: 8, addrBits: 4, data: "" }, 8).length, 16);
  });

  test("data 长于深度时只装前 depth 个", () => {
    const m = memOf("rom", { bitWidth: 8, addrBits: 1, data: "0x11 0x22 0x33 0x44" }, 8);
    assert.equal(m.length, 2);
    assert.deepEqual(m, [0x11, 0x22]);
  });

  test("缓存键含位宽与深度：改了参数会重建数组（引用都换）", () => {
    const def = resolveDef("ram", {})!;
    const s: Record<string, unknown> = {};
    const hit = (params: Record<string, number | string | boolean>, bits: number) => {
      const h = harness(def, { addr: 0 }, { params, bits, state: s, maskWrites: false });
      def.eval!(h.ctx);
      return s._mem as number[];
    };
    const a = hit({ bitWidth: 8, addrBits: 2, data: "0xFF" }, 8);
    assert.equal(a[0], 0xff);
    const b = hit({ bitWidth: 8, addrBits: 2, data: "0xFF" }, 8);
    assert.equal(b, a, "参数没变时应复用同一块数组");

    const c = hit({ bitWidth: 4, addrBits: 2, data: "0xFF" }, 4);
    assert.notEqual(c, a, "位宽变了必须重建（缓存键里要含 bits）");
    assert.equal(c[0], 0xf);

    const d = hit({ bitWidth: 4, addrBits: 3, data: "0xFF" }, 4);
    assert.notEqual(d, c, "地址线变了必须重建");
    assert.equal(d.length, 8);
  });

  test("运行期写入的内容会在位宽变化时被丢弃（参数变 → 整块内存重建）", () => {
    const params = { bitWidth: 8, addrBits: 2, data: "" };
    const def = resolveDef("ram", params)!;
    const s: Record<string, unknown> = {};
    const w = harness(def, { addr: 0, din: 0xff, wen: 1 }, { params, bits: 8, state: s, maskWrites: false });
    def.onRise!(w.ctx);
    assert.equal((s._mem as number[])[0], 0xff, "运行期写入成功");

    // 位宽一变，缓存键就变 → memOf 用 data 参数（这里是空）重建 → 写入被清掉。
    // 这不是 bug，是「结构参数一变内存重置」的既定行为，钉住它免得以后被当成回归。
    const r = harness(def, { addr: 0 }, { params: { bitWidth: 4, addrBits: 2, data: "" }, bits: 4, state: s, maskWrites: false });
    def.eval!(r.ctx);
    assert.equal((s._mem as number[])[0], 0, "重建后是 data 参数的内容（空 → 0），不是旧值 0xFF");
  });
});

describe("ROM：只读，不响应任何写入", () => {
  test("rom 没有 onRise", () => {
    assert.equal(baseDef("rom")!.onRise, undefined);
  });

  test("地址越界（高于深度）读出 0 而不是 undefined", () => {
    const params = { bitWidth: 8, addrBits: 3, data: "0xAA" };
    const def = resolveDef("rom", params)!;
    const h = harness(def, { addr: 200 }, { params, bits: 8, state: {} });
    def.eval!(h.ctx);
    assert.equal(h.out.out, 0);
  });

  test("RAM 同样对越界地址返回 0", () => {
    const params = { bitWidth: 8, addrBits: 2, data: "0x11 0x22 0x33 0x44" };
    const def = resolveDef("ram", params)!;
    const h = harness(def, { addr: 7 }, { params, bits: 8, state: {} });
    def.eval!(h.ctx);
    assert.equal(h.out.dout, 0, "深度 4，地址 7 读出 0");
  });

  test("空 data 是合法的全 0 存储（不是错误）", () => {
    const params = { bitWidth: 8, addrBits: 2, data: "" };
    const def = resolveDef("rom", params)!;
    const h = harness(def, { addr: 3 }, { params, bits: 8, state: {} });
    def.eval!(h.ctx);
    assert.equal(h.out.out, 0);
  });
});
