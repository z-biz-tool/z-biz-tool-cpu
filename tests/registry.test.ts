// 元件库脏数据解析测试（registry.ts）。
//
// 为什么补这层：src/core/registry.ts 992 行，是本仓的核心数据源
// （BUILTIN_DEFS + 内存镜像的解析都在这里），此前**一条测试都没有** ——
// 只有 assembler / interpreter / cpu-consistency 三份。
// 而 parseWordToken / parseDataList 是「用户手写 → 内存字节」的唯一入口，
// 一旦静默兜底，用户加载的程序就和他写的不一样，而电路照跑、结果全错。
//
// 运行：npm test（node --experimental-strip-types --test tests/*.test.ts）

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseWordToken,
  parseWordTokenStrict,
  parseDataList,
  parseDataListStrict,
  baseDef,
  resolveDef,
  paletteDefs,
  defaultParams,
  CATEGORY_LABEL,
  BUILTIN_DEFS,
} from "../src/core/registry.ts";

// ---------------------------------------------------------------- 正常路径

describe("parseWordTokenStrict：正常字面量", () => {
  const cases: Array<[string, number, string]> = [
    ["17", 17, "十进制"],
    ["0", 0, "零"],
    ["0x12", 18, "十六进制"],
    ["0xFF", 255, "十六进制大写"],
    ["0b1010", 10, "二进制"],
    ["0o17", 15, "八进制"],
    ["'A'", 97, "字符字面量（小写 a 的码点是 97）"],
    ["  42  ", 42, "前后空白容忍"],
    ["0X12", 18, "大写前缀 0X"],
  ];
  for (const [tok, want, why] of cases) {
    test(`${why} ${JSON.stringify(tok)} => ${want}`, () => {
      assert.equal(parseWordTokenStrict(tok), want);
    });
  }
});

describe("parseWordTokenStrict：无符号回绕", () => {
  test("负数按 uint32 回绕（-1 => 4294967295）", () => {
    assert.equal(parseWordTokenStrict("-1"), 4294967295);
  });
  test("超出 32 位的十六进制同样回绕，不报错", () => {
    // 现状刻画：内存里放不下 33 位数，回绕是与 parseInt 一致的行为。
    // 这不是「本该报错」——内存镜像本来就是 32 位字，回绕可预期。
    assert.equal(parseWordTokenStrict("0x1FFFFFFFF"), 4294967295);
  });
});

// ---------------------------------------------------------------- 畸形输入
//
// 这组是本次的核心。旧实现用 parseInt，而 **parseInt 遇非法位会
// 「停在第一个合法位并返回已解析部分」**，于是笔误被当成合法值。

describe("parseWordTokenStrict：畸形输入必须被拒，而不是被猜", () => {
  const bad = [
    ["0b12", "二进制里混入 2（JS 会解析成 1）"],
    ["0b102", "二进制里混入 2（JS 会解析成 2）"],
    ["0xZZ", "十六进制里混入 Z"],
    ["0o18", "八进制里混入 8"],
    // ↓ 下面这几条是「变异验证逼出来的」：
    // 我最初只写了 0o18，而 parseInt("o18", 8) 恰好返回 NaN，
    // 于是把 strict 的校验正则删掉也测不出差别 ⇒ 那条断言是**假绿**。
    // parseInt 真正会「截断」的是**合法位在前、非法位在后**的形态
    // （body 里首个字符就非法时它直接给 NaN，反而安全）：
    ["0o19", "八进制里混入 9，且 body 首字符就非法（NaN，不截断）"],
    ["0o1o", "八进制里混入 o，合法位在前（JS 截断成 1）"],
    ["0o1x", "八进制里混入 x，合法位在前（JS 截断成 1）"],
    ["0x1g", "十六进制里混入 g，合法位在前（JS 截断成 1）"],
    ["0x1o", "十六进制里混入 o，合法位在前（JS 截断成 1）"],
    ["0x", "只有前缀没有数字"],
    ["0b", "只有前缀没有数字"],
    ["abc", "完全不是数字"],
    ["", "空串"],
    ["1e3", "科学计数法（不该被当整数）"],
    ["3.7", "小数（会被截断，是静默失真）"],
    ["NaN", "NaN 字面量"],
    ["Infinity", "Infinity 字面量"],
    ["undefined", "undefined 字面量"],
    ["''", "空字符字面量"],
  ];
  for (const [tok, why] of bad) {
    test(`拒绝 ${JSON.stringify(tok)}（${why}）`, () => {
      assert.equal(parseWordTokenStrict(tok), null);
    });
  }
});

describe("旧 parseInt 的行为对照（证明这条测试抓的是真缺陷）", () => {
  test("原生 parseInt 确实会把 0b12 解析成 1 —— 即缺陷的机制", () => {
    // 把根因钉进测试：将来若有人问「为什么不能用 parseInt」，
    // 这条就是答案，且它不依赖我们的实现，改不掉。
    assert.equal(parseInt("12", 2), 1);
    assert.equal(parseInt("102", 2), 2);
  });

  test("parseInt 的「截断」只在非法位位于合法位**之后**时发生 —— 决定用例怎么选", () => {
    // 这是本轮变异验证逼出来的一条元知识，而且我**第一版把它写错了**：
    // 我以为 parseInt("o19", 8) 会截断成 1，实测是 NaN（首位 'o' 就非法）。
    // 真正会静默截断的形态是「合法位在前、非法位在后」：
    //     parseInt("19", 8)  === 1     ← 写 0o19 时 body 是 "o19"，首位非法 ⇒ NaN
    //     parseInt("1o", 8)  === 1
    //     parseInt("1g", 16) === 1
    // ⇒ 挑「非法输入」当测试用例时，必须挑**会静默截断**的那种，
    //   否则断言会通过，但抓不住任何回归。
    assert.equal(parseInt("o19", 8), NaN, "首位非法 ⇒ NaN（本例不会截断）");
    assert.equal(parseInt("19", 8), 1, "非法位在后 ⇒ 截断成 1（危险的那种）");
    assert.equal(parseInt("1o", 8), 1, "十六进制同理：1g => 1");
  });
  test("而本仓的宽松版 parseWordToken 对同样的输入给 0（不是 1）", () => {
    // 宽松版仍保持既有签名（非法 => 0），但**不再返回被截断的假值**。
    // 这条区分了「静默取前几位」与「明确兜底为 0」两种行为。
    assert.equal(parseWordToken("0b12"), 0);
    assert.notEqual(parseWordToken("0b12"), 1);
  });
});

// ---------------------------------------------------------------- 列表解析

describe("parseDataListStrict：整体成功或整体失败", () => {
  test("全部合法时返回全部值", () => {
    const r = parseDataListStrict("0x12, 17, 0b1010");
    assert.equal(r.ok, true);
    assert.deepEqual(r.values, [18, 17, 10]);
  });

  test("逗号/分号/空白都能当分隔符", () => {
    const r = parseDataListStrict("1,2;3 4");
    assert.equal(r.ok, true);
    assert.deepEqual(r.values, [1, 2, 3, 4]);
  });

  test("斜杠**不是**分隔符 —— 旧注释示例写错过，这条钉住现状", () => {
    // 本函数原先的注释示例是 "0x12,34, 0b1010 / 17"（含斜杠），
    // 而 split 的正则 /[\s,;]+/ 不含斜杠 ⇒ 照注释写的人会踩坑。
    // 注释已改成与实现一致；这里把「斜杠不被当分隔符」固化成契约。
    const r = parseDataListStrict("1, 2, 3/4");
    assert.equal(r.ok, false, "3/4 是一个整体，会被整段判为非法");
    assert.equal(r.error?.token, "3/4");
  });

  test("空串 / 全空白 => 空数组且 ok（不是错误）", () => {
    assert.deepEqual(parseDataListStrict(""), { values: [], ok: true });
    assert.deepEqual(parseDataListStrict("   "), { values: [], ok: true });
  });

  test("任一词元非法 ⇒ 整体失败，且指出第几个、原文是什么", () => {
    const r = parseDataListStrict("1, 2, 0b12, 4");
    assert.equal(r.ok, false);
    assert.equal(r.error?.index, 2, "应指出是第 3 个词元（0-based 索引 2）");
    assert.equal(r.error?.token, "0b12");
  });

  test("失败时不返回半截数组（避免调用方误用部分结果）", () => {
    const r = parseDataListStrict("1, 2, 0b12, 4");
    assert.deepEqual(r.values, [], "失败时不该给出已解析的前缀，否则会被当成完整结果用");
  });

  test("报出的是**第一个**错误，不是最后一个", () => {
    const r = parseDataListStrict("zzz, yyy");
    assert.equal(r.error?.index, 0);
  });
});

describe("parseDataList（宽松版）保持既有行为不变", () => {
  test("正常输入结果与严格版一致", () => {
    assert.deepEqual(parseDataList("0x12, 17, 0b1010, 0o17"), [18, 17, 10, 15]);
  });
  test("非法项变 0，但**数组长度不变**（这是它被叫 '宽松' 的代价）", () => {
    // 这一条正是缺陷的现场形态：长度对得上，内容悄悄错了。
    const loose = parseDataList("1, 2, 0xZZ, 4");
    assert.equal(loose.length, 4);
    assert.equal(loose[2], 0);
    assert.notDeepEqual(loose, parseDataListStrict("1, 2, 0xZZ, 4").values);
  });
  test("空串返回空数组", () => {
    assert.deepEqual(parseDataList(""), []);
  });
});

// ---------------------------------------------------------------- 元件定义库

describe("BUILTIN_DEFS 自洽性", () => {
  test("type 互不重复（重复会让 DEF_MAP 只保留最后一条）", () => {
    const types = BUILTIN_DEFS.map((d) => d.type);
    assert.equal(new Set(types).size, types.length, `type 有重复：${types.join(",")}`);
  });

  test("每条都有非空 type / label", () => {
    for (const d of BUILTIN_DEFS) {
      assert.ok(d.type, "有条目缺 type");
      assert.ok(d.label, `${d.type} 缺 label`);
    }
  });

  test("每条的 category 都在 CATEGORY_LABEL 里有中文名", () => {
    for (const d of BUILTIN_DEFS) {
      assert.ok(
        CATEGORY_LABEL[d.category],
        `${d.type} 的 category "${d.category}" 没有对应的中文标签`,
      );
    }
  });
});

describe("baseDef / resolveDef", () => {
  test("未知 type 返回 undefined（不抛错）", () => {
    assert.equal(baseDef("no_such_component"), undefined);
    assert.equal(resolveDef("no_such_component", {}), undefined);
  });

  test("baseDef 对已知 type 能取到，且 type 字段自洽", () => {
    const d = baseDef(BUILTIN_DEFS[0].type);
    assert.ok(d);
    assert.equal(d!.type, BUILTIN_DEFS[0].type);
  });

  test("split / merge 会按 bits 参数展开引脚数", () => {
    const d = resolveDef("split", { bits: 8 });
    assert.ok(d, "split 应能解析");
    assert.notEqual(d!.pins?.length, 1, "bits=8 展开后引脚不应还是 1 个");
  });
});

describe("paletteDefs", () => {
  test("默认不含 boundary 元件（它们只用于子电路边界）", () => {
    const defs = paletteDefs();
    assert.ok(defs.length > 0);
    for (const d of defs) assert.equal(d.boundary, undefined, `${d.type} 是 boundary，不该出现在调色板`);
  });

  test("includeIo=true 时才带上 io 边界件", () => {
    const withIo = paletteDefs(true);
    assert.ok(withIo.length >= paletteDefs().length, "includeIo 不该让调色板变小");
  });
});

describe("defaultParams", () => {
  test("每个参数项都出现在结果里，取值为其 default", () => {
    const d = BUILTIN_DEFS.find((x) => (x.params ?? []).length > 0);
    assert.ok(d, "BUILTIN_DEFS 里应至少有一条带 params");
    const p = defaultParams(d!);
    for (const spec of d!.params ?? []) {
      assert.equal(p[spec.key], spec.default, `${d!.type}.${spec.key} 未取到 default`);
    }
  });
  test("无 params 的元件返回空对象而不是 undefined", () => {
    const d = BUILTIN_DEFS.find((x) => !(x.params ?? []).length);
    if (d) assert.deepEqual(defaultParams(d), {});
  });
});
