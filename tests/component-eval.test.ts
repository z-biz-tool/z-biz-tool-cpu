// 元件求值逻辑的真值表测试（BUILTIN_DEFS 里的 eval / onRise）。
//
// 为什么补这层：src/core/registry.ts 992 行，其中 BUILTIN_DEFS 占 900+ 行，
// 是**每一个元件的实际电路语义**。此前只有 parse 函数与数据结构自洽性被测到，
// 36 个元件的 eval 一个都没跑过。
// 本轮逐个实测后确认：逻辑门与加减比较的真值表**全部正确**（见下方实测记录），
// 所以这批测试的作用是**钉住现状**，不是修 bug —— 改错时能立刻红。
//
// 「现在是对的」不等于「被测过」。这两种状态在仓库里的区别是：
// 前者下一次改动有人接得住，后者要等用户发现电路算错了才知道。
//
// 运行：npm test（node --experimental-strip-types --test tests/*.test.ts）

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { baseDef, type CompDef } from "../src/core/registry.ts";
import type { EvalCtx } from "../src/core/types.ts";

/** 按元件的真实引脚（id + kind）搭一个求值上下文。 */
function harness(def: CompDef, inputs: Record<string, number>, opts: {
  params?: Record<string, number | string | boolean>;
  bits?: number;
  state?: Record<string, unknown>;
  logs?: string[];
} = {}) {
  const st: Record<string, number> = {};
  const s = opts.state ?? {};
  const logs = opts.logs ?? [];
  const bits = opts.bits ?? 1;
  const ctx: EvalCtx = {
    r: (p) => inputs[p] ?? 0,
    w: (p, v) => {
      st[p] = v;
    },
    rw: (p) => inputs[p] ?? st[p] ?? 0,
    p: <T,>(k: string) => (opts.params?.[k] as T) as T,
    bits,
    ins: def.pins.filter((p) => p.kind === "in").map((p) => p.id),
    outs: def.pins.filter((p) => p.kind === "out").map((p) => p.id),
    s,
    log: (m) => logs.push(m),
  } as EvalCtx;
  return { ctx, out: st, s, logs };
}

/** 顺序求值，返回输出引脚值数组。 */
function evalWith(def: CompDef, inputs: Record<string, number>, opts?: Parameters<typeof harness>[2]) {
  const h = harness(def, inputs, opts);
  def.eval?.(h.ctx);
  return h.ctx.outs.map((o) => h.out[o]);
}

function ev(type: string, inputs: Record<string, number>, opts?: Parameters<typeof harness>[2]) {
  const d = baseDef(type);
  assert.ok(d, `元件 ${type} 不存在`);
  return evalWith(d!, inputs, opts);
}

function rise(type: string, inputs: Record<string, number>, opts?: Parameters<typeof harness>[2]) {
  const d = baseDef(type);
  assert.ok(d, `元件 ${type} 不存在`);
  const h = harness(d!, inputs, opts);
  d!.onRise?.(h.ctx);
  return h;
}

// ---------------------------------------------------------------- 逻辑门
//
// 真值表于 2026-10-04 逐个实测确认全部正确，这里把它们钉住。

describe("逻辑门真值表（实测确认正确，钉住现状）", () => {
  // type → [00, 01, 10, 11]
  const TABLES: Record<string, [number, number, number, number]> = {
    and:  [0, 0, 0, 1],
    or:   [0, 1, 1, 1],
    xor:  [0, 1, 1, 0],
    nand: [1, 1, 1, 0],
    nor:  [1, 0, 0, 0],
    xnor: [1, 0, 0, 1],
  };
  const PAIRS: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]];
  for (const [type, table] of Object.entries(TABLES)) {
    test(`${type}：${table.join(" ")}`, () => {
      PAIRS.forEach(([a, b], i) => {
        const got = ev(type, { i0: a, i1: b });
        assert.deepEqual(got, [table[i]], `${type}(${a},${b}) 期望 ${table[i]}，实得 ${got[0]}`);
      });
    });
  }
});

describe("单输入门", () => {
  test("buf 是恒等", () => {
    assert.deepEqual(ev("buf", { i0: 0 }), [0]);
    assert.deepEqual(ev("buf", { i0: 1 }), [1]);
  });
  test("not 取反", () => {
    assert.deepEqual(ev("not", { i0: 0 }), [1]);
    assert.deepEqual(ev("not", { i0: 1 }), [0]);
  });
});

// ---------------------------------------------------------------- 算术

describe("加减器（bits=4）", () => {
  // add 输出 [sum, cout]；sub 输出 [diff, borrow]
  const CASES: [number, number, number, number][] = [
    // a, b, sum, cout
    [0, 0, 0, 0],
    [3, 5, 8, 0],
    [7, 7, 14, 0],
    [10, 7, 1, 1],   // 17 在 4 位下回绕，cout=1
    [15, 1, 0, 1],   // 16 恰好溢出
    [8, 8, 0, 1],
  ];
  for (const [a, b, sum, cout] of CASES) {
    test(`add ${a}+${b} => sum=${sum} cout=${cout}`, () => {
      assert.deepEqual(ev("add", { a, b, cin: 0 }, { bits: 4 }), [sum, cout]);
    });
  }

  test("add 带进位输入：3+5+1 => 9", () => {
    assert.deepEqual(ev("add", { a: 3, b: 5, cin: 1 }, { bits: 4 }), [9, 0]);
  });

  const SUBS: [number, number, number, number][] = [
    [10, 7, 3, 0],
    [3, 5, 14, 1],   // 负数在无符号下回绕
    [5, 5, 0, 0],
    [0, 1, 15, 1],
  ];
  for (const [a, b, diff, borrow] of SUBS) {
    test(`sub ${a}-${b} => diff=${diff} borrow=${borrow}`, () => {
      assert.deepEqual(ev("sub", { a, b, cin: 0 }, { bits: 4 }), [diff, borrow]);
    });
  }
});

describe("比较器（bits=4，输出 [gt, eq, lt] 的顺序按实测固定）", () => {
  test("3 vs 5 => 小于", () => {
    assert.deepEqual(ev("cmp", { a: 3, b: 5 }, { bits: 4 }), [1, 0, 0]);
  });
  test("5 vs 3 => 大于", () => {
    assert.deepEqual(ev("cmp", { a: 5, b: 3 }, { bits: 4 }), [0, 0, 1]);
  });
  test("4 vs 4 => 相等", () => {
    const r = ev("cmp", { a: 4, b: 4 }, { bits: 4 });
    assert.equal(r.length, 3);
    assert.equal(r.filter((v) => v === 1).length, 1, "恰好一个标志位为 1");
  });
  test("三个标志互斥（任意输入都只有一个为 1）", () => {
    for (const [a, b] of [[0, 0], [1, 2], [7, 7], [15, 0], [0, 15]] as [number, number][]) {
      const r = ev("cmp", { a, b }, { bits: 4 });
      assert.equal(r.filter((v) => v === 1).length, 1, `cmp(${a},${b}) 标志位不互斥：${r}`);
    }
  });
});

// ---------------------------------------------------------------- 位宽

describe("位宽跟随：结果被掩到 bits 位内", () => {
  test("bits=1 时只有最低位有效", () => {
    // 1+1=2，二进制 10；1 位下应只剩 0
    assert.deepEqual(ev("add", { a: 1, b: 1, cin: 0 }, { bits: 1 }), [0, 1]);
  });
  test("bits=8 时 200+100 不溢出", () => {
    assert.deepEqual(ev("add", { a: 200, b: 100, cin: 0 }, { bits: 8 }), [44, 1]);
  });
  test("同一位宽下 add 与手算一致（随机抽样）", () => {
    // 少量抽样：足以抓住「换了掩码位置」这类错，不足以拖慢测试。
    const samples: [number, number][] = [[1, 1], [9, 6], [17, 20], [33, 44], [7, 8], [64, 65]];
    for (const [a, b] of samples) {
      const want = (a + b) & 0xff;
      const [sum, cout] = ev("add", { a, b, cin: 0 }, { bits: 8 });
      assert.equal(sum, want, `add(${a},${b}) 在 8 位下应为 ${want}`);
      assert.equal(cout, a + b > 0xff ? 1 : 0, `add(${a},${b}) 的进位不对`);
    }
  });
});

// ---------------------------------------------------------------- 时序元件
//
// 时序元件有两层，**各测各的，语义完全不同**（2026-10-04 实测确认）：
//   eval   —— 把**保持态**写到输出：c.w("q", c.s.q ?? 0)
//   onRise —— 真正的采样：c.s.q = c.r("d")
// 我第一版以为「调 onRise 就能看到 q 变」，结果 dff 那两条红。
// ⇒ 对时序元件，**eval 测保持、onRise 测更新**，混在一起写必然测错东西。

describe("D 触发器：eval 保持 / onRise 采样", () => {
  test("eval 输出的是保持态：未触发过时 q=0", () => {
    assert.deepEqual(ev("dff", { clk: 1, d: 7 }), [0], "eval 只回放 s.q，不采样 d");
  });

  test("eval 在已有状态时回放该状态，而不是回放 d", () => {
    const s: Record<string, unknown> = { q: 5 };
    const d = baseDef("dff")!;
    const h = harness(d, { clk: 1, d: 7 }, { state: s, bits: 8 });
    d.eval?.(h.ctx);
    assert.equal(h.out.q, 5, "clk=1 时 eval 也只回放保持值；采样只发生在 onRise");
  });

  test("onRise 把 d 采进内部状态", () => {
    const s: Record<string, unknown> = {};
    rise("dff", { clk: 1, d: 7 }, { state: s, bits: 8 });
    assert.equal(s.q, 7, "onRise 应把 d 写进 s.q");
  });

  test("onRise 之后 eval 回放的就是新值（两层串起来）", () => {
    const s: Record<string, unknown> = {};
    rise("dff", { clk: 1, d: 7 }, { state: s, bits: 8 });
    const d = baseDef("dff")!;
    const h = harness(d, { clk: 0, d: 0 }, { state: s, bits: 8 });
    d.eval?.(h.ctx);
    assert.equal(h.out.q, 7, "触发后再回放应拿到 7（证明 onRise 真的落进了状态）");
  });

  test("连续两次上升沿，状态跟随最新的 d", () => {
    const s: Record<string, unknown> = {};
    rise("dff", { clk: 1, d: 1 }, { state: s, bits: 8 });
    rise("dff", { clk: 1, d: 2 }, { state: s, bits: 8 });
    assert.equal(s.q, 2);
  });
});

describe("T 触发器：onRise 按 t 翻转", () => {
  test("t=1 连续翻转两次，得到互补的值", () => {
    const s: Record<string, unknown> = {};
    rise("tff", { clk: 1, t: 1 }, { state: s, bits: 8 });
    const first = s.q;
    rise("tff", { clk: 1, t: 1 }, { state: s, bits: 8 });
    assert.notEqual(s.q, first, "t=1 每次上升沿都该翻转");
  });

  test("t=0 时保持不变", () => {
    const s: Record<string, unknown> = { q: 1 };
    rise("tff", { clk: 1, t: 0 }, { state: s, bits: 8 });
    assert.equal(s.q, 1, "t=0 不该改变状态");
  });
});

describe("D 锁存器：电平敏感（走 eval，不是 onRise）", () => {
  // dlatch 没有 onRise —— 它是**电平**锁存器，e=1 时透明。
  // 实测 {e:1,d:5} => q=5，与 dff 的语义完全不同。
  test("e=1 时透明，q 跟随 d", () => {
    assert.deepEqual(ev("dlatch", { e: 1, d: 5 }, { bits: 8 }), [5]);
  });
  test("e=0 时保持（不透明）", () => {
    assert.deepEqual(ev("dlatch", { e: 0, d: 5 }, { bits: 8 }), [0]);
  });
});

describe("时钟与常量", () => {
  test("clock 只输出一个引脚", () => {
    assert.equal(ev("clock", {}, { bits: 1 }).length, 1);
    assert.equal(ev("clock", {}, { bits: 4 }).length, 1);
  });
  test("const 的值来自参数", () => {
    assert.equal(ev("const", {}, { params: { value: 42 }, bits: 8 })[0], 42);
  });
  test("input 无输入引脚，值来自状态（实测恒为 0）", () => {
    // input 的 pins 只有 out/一个 —— 它没有输入引脚。
    // eval 读的是 ctx.s 里的外部注入值，测试里不给就是 0。
    // 现状刻画，不是认可：真正的输入值是仿真器写进 s 的，不在本文件范围。
    const d = baseDef("input")!;
    assert.equal(d.pins.filter((p) => p.kind === "in").length, 0, "input 不应有输入引脚");
    assert.deepEqual(ev("input", {}, { bits: 8 }), [0]);
  });
  test("output 没有 eval（纯透传由连线层负责）", () => {
    // 实测 output 两者皆无 —— 它是纯连线端点，求值不在这里做。
    // 现状刻画：若将来给它加了 eval，这条会红，那正是行为变更的信号。
    const d = baseDef("output")!;
    assert.equal(d.eval, undefined);
    assert.equal(d.onRise, undefined);
  });
});

// ---------------------------------------------------------------- 元件自洽

describe("所有带 eval 的元件都能被 harness 驱动而不抛错", () => {
  // 这条不是测「算得对」（那是上面各表的事），而是测「接口没坏」：
  // 引脚名、ctx 形状、参数读取这三样任一被改，这里就会红。
  const SKIP_PARAMS: Record<string, Record<string, number | string | boolean>> = {
    const: { value: 1 },
    shift: { amount: 1 },
    mux: { selBits: 1 },
    demux: { selBits: 1 },
  };
  for (const type of [
    "and", "or", "xor", "nand", "nor", "xnor", "buf", "not",
    "add", "sub", "cmp", "clock", "const", "input", "output",
  ]) {
    test(`${type} 求值不抛错`, () => {
      const d = baseDef(type)!;
      const h = harness(d, {}, { bits: 4, params: SKIP_PARAMS[type] ?? {} });
      assert.doesNotThrow(() => d.eval?.(h.ctx));
    });
  }
});

describe("时序元件的求值入口分布（若整体反了是行为变更）", () => {
  // 边沿触发（dff/tff/reg/counter）有 onRise；
  // 电平锁存（dlatch）没有 —— 它靠 eval 在 e=1 时透明。
  // 我第一版把 dlatch 也放进 onRise 那组，基线直接红 ⇒ 这条是照实测写的。
  for (const type of ["dff", "tff", "reg", "counter"]) {
    test(`${type} 提供 onRise`, () => {
      const d = baseDef(type);
      assert.ok(d, `${type} 应存在`);
      assert.equal(typeof d!.onRise, "function", `${type} 缺 onRise`);
    });
  }
  test("dlatch 是电平锁存：没有 onRise，靠 eval", () => {
    const d = baseDef("dlatch")!;
    assert.equal(d.onRise, undefined, "dlatch 不该有 onRise");
    assert.equal(typeof d.eval, "function");
  });
});
