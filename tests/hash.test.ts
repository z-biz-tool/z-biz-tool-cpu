// 内容哈希的口径钉子。
//
// 背景：仓内曾有四份各自抄写的 FNV-1a（core/sim.ts、courses/judging.ts、
// workshop/index.ts、courses/manifest.ts），常量相同、细节各异。
// 收口到 core/hash.ts 后，哈希值进了三处持久化数据：
//   · workshop 的 contentHash（组件版本判定）
//   · judging 的 designHash / attemptId（通关记录）
//   · courses 的 catalogHash（内容包一致性校验）
// 口径一变，这些历史记录就对不上，所以这里把数值钉死。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Fnv1a32, fnv1a32 } from "../src/core/hash.ts";
import { hashComponent } from "../src/workshop/index.ts";
import { catalogHash } from "../src/courses/manifest.ts";

describe("FNV-1a 口径", () => {
  test("标准 FNV-1a 32 位参考值", () => {
    assert.equal(fnv1a32(""), 0x811c9dc5);
    assert.equal(fnv1a32("a"), 0xe40c292c);
    assert.equal(fnv1a32("abc"), 0x1a47e90b);
  });

  test("混值顺序不同 → 哈希不同", () => {
    const a = new Fnv1a32().mixString("ab").mixString("c").digest();
    const b = new Fnv1a32().mixString("abc").digest();
    assert.equal(a, b, "逐段混入与整串混入应当等价");
    const c = new Fnv1a32().mixString("ac").mixString("b").digest();
    assert.notEqual(a, c);
  });

  test("hex 输出补齐 8 位", () => {
    assert.match(new Fnv1a32().mixString("x").hex(), /^[0-9a-f]{8}$/);
  });
});

describe("收口后的内容哈希", () => {
  test("组件内容哈希落在 8 位十六进制里", () => {
    const hash = hashComponent({
      id: "d1",
      name: "d1",
      circuit: { comps: [], wires: [] },
    } as never);
    assert.match(hash, /^[0-9a-f]{8}$/);
  });

  test("组件内容哈希对改动敏感", () => {
    const base = { id: "d1", name: "d1", circuit: { comps: [], wires: [] } } as never;
    const changed = {
      id: "d1",
      name: "d1",
      circuit: {
        comps: [{ id: "c1", type: "and", x: 0, y: 0, rot: 0, params: {} }],
        wires: [],
      },
    } as never;
    assert.notEqual(hashComponent(base), hashComponent(changed));
  });

  test("catalog 哈希随关卡清单变化", () => {
    const m = {
      catalogId: "main",
      levels: [{ id: "a" }, { id: "b" }],
      prologues: [{ id: "p" }],
    } as never;
    const other = {
      catalogId: "main",
      levels: [{ id: "a" }, { id: "c" }],
      prologues: [{ id: "p" }],
    } as never;
    assert.notEqual(catalogHash(m), catalogHash(other));
    assert.match(catalogHash(m), /^[0-9a-f]+$/);
  });
});
