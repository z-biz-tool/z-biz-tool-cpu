// 内容哈希的口径钉子。
//
// 背景：仓内曾有四份各自抄写的 FNV-1a（core/sim.ts、courses/judging.ts、
// workshop/index.ts、courses/manifest.ts），常量相同、细节各异。
// 2026-11-01 收口到 `z-biz-tool-shared/hash`（Rust cap-hash 金标，golden 夹具
// 双向对账），本仓本地实现删除。哈希值进了三处持久化数据：
//   · workshop 的 contentHash（组件版本判定）
//   · judging 的 designHash / attemptId（通关记录；只写不回查）
//   · courses 的 catalogHash（内容包一致性校验；只写不比对）
// 口径注意：旧实现按 UTF-16 码元混入，新口径按 **UTF-8 字节**（家族统一标准）。
// ASCII 输入两者相同；含非 ASCII 的输入一次性漂移 —— 已知口径变更，不是 bug。
// 中文用例「你好」= 86938da3 由 shared 的 golden 夹具钉死，防止退回码元口径。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fnv1a32Str, fnv1a32StrHex } from "z-biz-tool-shared/hash";
import { hashComponent } from "../src/workshop/index.ts";
import { catalogHash } from "../src/courses/manifest.ts";

describe("FNV-1a 口径（shared/hash 同源）", () => {
  test("标准 FNV-1a 32 位参考值", () => {
    assert.equal(fnv1a32Str(""), 0x811c9dc5);
    assert.equal(fnv1a32Str("a"), 0xe40c292c);
    assert.equal(fnv1a32Str("abc"), 0x1a47e90b);
  });

  test("中文按 UTF-8 字节混入（golden 夹具同值；退回 UTF-16 码元会红）", () => {
    assert.equal(fnv1a32StrHex("你好"), "86938da3");
  });

  test("hex 输出补齐 8 位", () => {
    assert.match(fnv1a32StrHex("x"), /^[0-9a-f]{8}$/);
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
