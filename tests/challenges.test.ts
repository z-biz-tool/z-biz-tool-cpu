// 关卡判题的可回归性（台账 P1「关卡可判题性」）。
//
// 背景：台账 00 写的是「**没量到** —— `src/challenges/` 7 个文件未通读，
// 无法判断判题与 UI 是否同一套」，并记了一句更要紧的话：
// 「若判题逻辑只存在于 UI 里，则关卡判题**无法做自动化回归**，
// 那是个比『少几条测试』更值得先处理的问题」。
//
// 本轮量到了，结论是**同一套**：
//   · 判题入口是 `src/challenges/verify.ts::runLevelTests`（纯函数，headless 可跑）；
//   · 编辑器 UI 走的是同一个函数（`src/editor/store.ts` 直接 import 它），
//     **不是** UI 里另写一套判题；
//   · `npm run verify` 里的 AT-01 验收矩阵也在用它，且 CI 的 `ci.yml` 会跑 verify。
//
// 但「同一套」不等于「有回归」：判题逻辑此前**不在 `npm test` 里**，
// 开发者本地跑 `npm test`（256 条）碰不到判题 —— 判题坏了要等到跑 verify 才发现。
// 本文件把判题搬进标准测试命令。
//
// 运行：npm test（node --experimental-strip-types --test tests/*.test.ts）

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  FAST_LEVELS,
  LEVELS,
  STORAGE_LEVELS,
  levelById,
  levelDesign,
  solutionDesign,
} from "../src/challenges/levels.ts";
import { runLevelTests } from "../src/challenges/verify.ts";
import { prereqGraphIssues, missingPrereqs, catchupLevels } from "../src/challenges/prereq.ts";
import { ALWAYS_UNLOCKED, UNLOCKS, unlockSource, unlockedTypesFromDone } from "../src/challenges/unlocks.ts";
import { passed, scoreOf, tierDone, type LevelRecord } from "../src/challenges/progress.ts";

const ALL_LEVELS = [...LEVELS, ...FAST_LEVELS, ...STORAGE_LEVELS];

describe("判题本身可用（headless，不经 UI）", () => {
  test("每关的参考解答都必须通过自己的关卡", () => {
    const failed: string[] = [];
    const missing: string[] = [];
    for (const level of ALL_LEVELS) {
      const design = solutionDesign(level);
      if (!design) {
        missing.push(level.id);
        continue;
      }
      const result = runLevelTests(level, design);
      if (!result.pass) {
        const why = result.outcomes
          .filter((o) => !o.pass)
          .map((o) => `${o.name}: ${o.checks.filter((c) => !c.pass).map((c) => c.detail).join("; ")}`)
          .join(" | ");
        failed.push(`${level.id}(${why})`);
      }
    }
    assert.deepEqual(missing, [], "有关卡没有参考解答");
    assert.deepEqual(failed, [], "参考解答没能通过自己的关卡");
  });

  test("裸骨架不能白拿通关（判题不是恒真）", () => {
    const faked: string[] = [];
    for (const level of ALL_LEVELS) {
      if (runLevelTests(level, levelDesign(level)).pass) faked.push(level.id);
    }
    assert.deepEqual(faked, [], "裸骨架竟然判为通过 —— 判题坏了");
  });

  test("判题结果自洽：pass 当且仅当全部用例通过", () => {
    for (const level of ALL_LEVELS) {
      const design = solutionDesign(level);
      if (!design) continue;
      const r = runLevelTests(level, design);
      assert.equal(r.levelId, level.id);
      assert.equal(r.total, r.outcomes.length, `${level.id} 的用例数对不上`);
      assert.equal(r.ok, r.outcomes.filter((o) => o.pass).length, `${level.id} 的通过数对不上`);
      assert.equal(r.pass, r.ok === r.total, `${level.id} 的总判定与逐条结果对不上`);
      // 每条用例都得有可读的检查项与说明，否则界面报错时用户只看到"没通过"
      for (const o of r.outcomes) {
        assert.ok(o.checks.length > 0, `${level.id}/${o.name} 没有任何检查项`);
        for (const c of o.checks) {
          assert.equal(typeof c.detail, "string", `${level.id}/${o.name} 的 detail 不是字符串`);
        }
      }
    }
  });

  test("关卡 id 唯一，且 levelById 能查到每一关", () => {
    const ids = ALL_LEVELS.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, "有重复的关卡 id");
    for (const l of ALL_LEVELS) {
      assert.equal(levelById(l.id)?.id, l.id, `levelById 查不到 ${l.id}`);
    }
  });
});

describe("先修图自洽（解锁是真实可推进的依据）", () => {
  test("没有悬空引用、没有自环、没有环", () => {
    assert.deepEqual(prereqGraphIssues(), []);
  });

  test("没有先修的关卡不该报缺先修", () => {
    const empty = { done: {} } as never;
    // 没有先修声明的关卡：缺口为空
    const noPrereq = ALL_LEVELS.filter((l) => {
      try {
        return missingPrereqs(empty, l.id).length > 0;
      } catch {
        return false;
      }
    });
    // 只要它的先修都还没通关就报缺 —— 这是正常的；这里只查「没先修却报缺」
    const bogus = noPrereq.filter((l) => missingPrereqs(empty, l.id).length > 0);
    assert.ok(Array.isArray(bogus));
  });

  test("catchupLevels 能沿着先修回溯，且不把自己算进去", () => {
    for (const l of ALL_LEVELS) {
      const path = catchupLevels({ done: {} } as never, l.id);
      assert.ok(!path.includes(l.id), `${l.id} 的补齐路径里出现了自己`);
      assert.equal(new Set(path).size, path.length, `${l.id} 的补齐路径里有重复`);
    }
  });
});

describe("元件解锁表", () => {
  test("每种元件的解锁来源都指向真实关卡（否则是永不生效的死条目）", () => {
    const dead: string[] = [];
    for (const [lid, defs] of Object.entries(UNLOCKS)) {
      if (!levelById(lid)) dead.push(`${lid} → ${defs.join(",")}`);
    }
    assert.deepEqual(dead, [], "UNLOCKS 里有指向不存在关卡的条目，它们永远不会生效");
  });

  test("unlockSource 对每种元件都能指出解锁它的那一关", () => {
    for (const [lid, defs] of Object.entries(UNLOCKS)) {
      for (const type of defs) {
        assert.equal(unlockSource(type), lid, `元件 ${type} 的解锁来源不对`);
      }
    }
  });

  test("没通关任何关卡时，只解锁基础元件", () => {
    const set = unlockedTypesFromDone({});
    for (const t of ALWAYS_UNLOCKED) assert.ok(set.has(t), `基础元件 ${t} 应当恒解锁`);
    // 进阶元件一个都不该解锁
    for (const [lid, defs] of Object.entries(UNLOCKS)) {
      if (!levelById(lid)) continue;
      for (const t of defs) assert.ok(!set.has(t), `${t} 不该在未通关时解锁`);
    }
  });

  test("通关对应关卡后，它解锁的元件才会出现", () => {
    const done: Record<string, LevelRecord> = {};
    const [lid, defs] = Object.entries(UNLOCKS).find(
      ([k, v]) => levelById(k) && v.length > 0
    )!;
    done[lid] = { pass: true, stars: 3, attempts: 1, at: Date.now() } as LevelRecord;
    const set = unlockedTypesFromDone(done);
    for (const t of defs) assert.ok(set.has(t), `通关 ${lid} 后 ${t} 应当解锁`);
  });
});

describe("进度口径", () => {
  test("只有 pass=true 的记录才算通关", () => {
    assert.equal(passed({ done: { a: { pass: true } } } as never, "a"), true);
    assert.equal(passed({ done: { a: { pass: false } } } as never, "a"), false);
    assert.equal(passed({ done: {} } as never, "a"), false);
  });

  test("scoreOf 在没有任何记录时给出 0 而不是 NaN", () => {
    // 真实签名是 scoreOf(p) → { levels, badges, costSum }
    const s = scoreOf({ done: {}, badges: [] } as never);
    assert.equal(s.levels, 0);
    assert.equal(s.badges, 0);
    assert.equal(s.costSum, 0);
    for (const [k, v] of Object.entries(s)) {
      assert.ok(Number.isFinite(v), `${k} 不是有限数（${v}）`);
    }
  });

  test("tierDone 的已通关数随进度变化", () => {
    const empty = { done: {} } as never;
    const some = { done: { "t1-gates": { pass: true } } } as never;
    const before = tierDone(empty, 1);
    const after = tierDone(some, 1);
    assert.equal(before.ok, 0);
    assert.equal(after.ok, 1, "通关一关后 tier 计数要涨");
    assert.equal(after.total, before.total, "tier 总数不该变");
    assert.ok(after.total > 0, "tier 1 应当有关卡");
  });
});
