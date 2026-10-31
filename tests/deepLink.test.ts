import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCpuDeepLink } from "../src/_shared/deepLink.ts";
import type { Handoff } from "z-biz-tool-shared/protocol";

/** 构造一条深链，默认 product=cpu / action=open */
function item(params: Record<string, string>, action = "open"): Handoff {
  return { product: "cpu", action, params };
}

test("正常路径：open + level 切到真实关卡", () => {
  const out = resolveCpuDeepLink(item({ level: "t2-alu4" }));
  assert.equal(out.problem, null);
  assert.equal(out.level, "t2-alu4");
  assert.equal(out.book, null);
  assert.equal(out.panel, null);
});

test("正常路径：open + book + panel", () => {
  const out = resolveCpuDeepLink(item({ book: "logic", panel: "asm" }));
  assert.equal(out.problem, null);
  assert.equal(out.book, "logic");
  assert.equal(out.panel, "asm");
  assert.equal(out.level, null);
});

test("正常路径：level + book + panel 同时给，全部生效", () => {
  const out = resolveCpuDeepLink(item({ level: "t1-gates", book: "fast", panel: "cpu" }));
  assert.equal(out.problem, null);
  assert.equal(out.level, "t1-gates");
  assert.equal(out.book, "fast");
  assert.equal(out.panel, "cpu");
});

test("缺参数：open 不带任何参数 → no-op，不报错", () => {
  const out = resolveCpuDeepLink(item({}));
  assert.equal(out.problem, null);
  assert.equal(out.level, null);
  assert.equal(out.book, null);
  assert.equal(out.panel, null);
});

test("不认识的动作：fly → problem", () => {
  const out = resolveCpuDeepLink(item({ level: "t2-alu4" }, "fly"));
  assert.equal(out.problem, "不认识的动作 fly");
  assert.equal(out.level, null);
});

test("对象 id 不存在：level 不是真实关卡 → problem，且 level 不被部分设置", () => {
  const out = resolveCpuDeepLink(item({ level: "t9-ghost" }));
  assert.equal(out.problem, "没有这个关卡 t9-ghost");
  assert.equal(out.level, null);
});

test("不认识的书：book=poetry → problem", () => {
  const out = resolveCpuDeepLink(item({ book: "poetry" }));
  assert.equal(out.problem, "不认识的书 poetry");
  assert.equal(out.book, null);
});

test("不认识的面板：panel=chat → problem", () => {
  const out = resolveCpuDeepLink(item({ panel: "chat" }));
  assert.equal(out.problem, "不认识的面板 chat");
  assert.equal(out.panel, null);
});

test("参数前后空格：level=' t2-alu4 ' 仍能命中", () => {
  const out = resolveCpuDeepLink(item({ level: "  t2-alu4  " }));
  assert.equal(out.problem, null);
  assert.equal(out.level, "t2-alu4");
});

test("空字符串参数：level='' → 视为未提供，不报错", () => {
  const out = resolveCpuDeepLink(item({ level: "" }));
  assert.equal(out.problem, null);
  assert.equal(out.level, null);
});

test("storage 书里的关卡也能被定位（m2-3-refresh）", () => {
  const out = resolveCpuDeepLink(item({ level: "m2-3-refresh" }));
  assert.equal(out.problem, null);
  assert.equal(out.level, "m2-3-refresh");
});

test("from 透传：仅用于日志，不参与路由", () => {
  const out = resolveCpuDeepLink(item({ level: "t1-gates", from: "box" }));
  assert.equal(out.problem, null);
  assert.equal(out.from, "box");
});
