// 发布态用例的真判题回归。
//
// 背景：courses/judging.ts 的 runCase 曾是空桩——恒返回 pass:true，
// 于是「发布内容包里的用例能不能跑」这件事从没被验证过：端口名写错、
// 断言自相矛盾、输入时序缺收尾，全都被假判题盖住了。
// 现在判题落到同一个仿真器上（challenges/verify.ts::runTestbenchCase），
// 这个文件把口径钉死：
//   1. 公开用例必须在参考解上通过（参考解 = 这一关的标准答案）；
//   2. 任何用例都不许出现「找不到元件」这类结构性失败；
//   3. 变式用例允许在参考解上不通过（那正是变式的意义），但必须能跑。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { levelById, solutionDesign } from "../src/challenges/levels.ts";
import { runTestbenchCase } from "../src/challenges/verify.ts";
import { META_BY_ID } from "../src/courses/publishMetadata.ts";
import { judge } from "../src/courses/judging.ts";
import type { TestbenchCase } from "../src/courses/manifest.ts";

/** 参考解存在的关卡：只有它们能用「参考解应当通过公开用例」这条来卡 */
const WITH_REFERENCE = Object.keys(META_BY_ID).filter((id) => !!solutionDesign(levelById(id)));

describe("发布态用例", () => {
  test("公开用例在参考解上必须全过", () => {
    const bad: string[] = [];
    for (const id of WITH_REFERENCE) {
      const level = levelById(id)!;
      const design = solutionDesign(level)!;
      for (const c of META_BY_ID[id].publicTests) {
        const r = runTestbenchCase(design, c);
        if (!r.pass) {
          bad.push(
            `${id}/${c.id}: ` + r.checks.filter((k) => !k.pass).map((k) => `${k.label} → ${k.detail}`).join(" | ")
          );
        }
      }
    }
    assert.deepEqual(bad, [], "发布态公开用例与参考解对不齐");
  });

  test("用例不许有结构性失败（端口名找不到）", () => {
    const bad: string[] = [];
    for (const [id, meta] of Object.entries(META_BY_ID)) {
      const level = levelById(id);
      if (!level) continue;
      const design = solutionDesign(level) ?? { root: level.skeleton(), defs: level.defs?.() ?? [] };
      for (const c of [...meta.publicTests, ...meta.validationCases]) {
        const r = runTestbenchCase(design, c);
        for (const k of r.checks) {
          if (!k.pass && k.detail.startsWith("找不到")) bad.push(`${id}/${c.id}: ${k.detail}`);
        }
      }
    }
    assert.deepEqual(bad, [], "用例里的端口名与关卡真实端口对不上");
  });

  test("用例都能跑起来（不是「没有任何断言」的占位）", () => {
    const bad: string[] = [];
    for (const [id, meta] of Object.entries(META_BY_ID)) {
      for (const c of [...meta.publicTests, ...meta.validationCases]) {
        if (!c.assertions.length) bad.push(`${id}/${c.id}`);
      }
    }
    assert.deepEqual(bad, [], "这些用例没有断言，判了等于没判");
  });
});

describe("发布态判题流水线", () => {
  test("judge 跑的是真用例，不再是恒过", () => {
    const level = levelById("t1-xor")!;
    const design = solutionDesign(level)!;
    const meta = META_BY_ID["t1-xor"];
    const ctx = {
      level: {
        id: "t1-xor",
        revision: "1",
        rubric: { pass: { requiredCases: meta.publicTests.map((c) => c.id) } },
      },
      design,
      seed: 0,
      engineVersion: "test",
      isaVersion: "test",
      maxTicks: 16,
    } as never;
    const result = judge(ctx, meta.publicTests as TestbenchCase[]);
    assert.equal(result.pass, true, "参考解应当判过");
    assert.equal(result.outcomes.length, meta.publicTests.length);
    assert.ok(result.outcomes.every((o) => o.pass));
  });

  test("坏设计判不通过（空桩会判过，这里必须判不过）", () => {
    const level = levelById("t1-xor")!;
    const empty = { root: level.skeleton(), defs: level.defs?.() ?? [] };
    const meta = META_BY_ID["t1-xor"];
    const ctx = {
      level: {
        id: "t1-xor",
        revision: "1",
        rubric: { pass: { requiredCases: meta.publicTests.map((c) => c.id) } },
      },
      design: empty,
      seed: 0,
      engineVersion: "test",
      isaVersion: "test",
      maxTicks: 16,
    } as never;
    const result = judge(ctx, meta.publicTests as TestbenchCase[]);
    assert.equal(result.pass, false, "空画布不该判过 —— 恒 pass 的空桩正是这个毛病");
    assert.ok(result.outcomes.some((o) => !o.pass));
  });
});
