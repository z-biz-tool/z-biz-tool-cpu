// Z16 汇编器 / 反汇编器的纯逻辑回归（无 React、无 Tauri）。
// 跑法：node --experimental-strip-types --test tests/*.test.ts
//
// 为什么这个文件优先：汇编器错了是**静默**的 —— 错的机器码照样能跑，
// 只是跑出别的程序，不会抛错。没有测试时这类 bug 只能靠人肉发现。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNum, assemble, disassemble } from "../src/asm/assembler.ts";

/* ------------------------------------------------------------------ *
 * parseNum：字面量解析
 * ------------------------------------------------------------------ */

test("parseNum：各进制前缀都认，且大小写不敏感", () => {
  assert.equal(parseNum("0xFF"), 255);
  assert.equal(parseNum("0xff"), 255);
  assert.equal(parseNum("0b1010"), 10);
  assert.equal(parseNum("0B1010"), 10);
  assert.equal(parseNum("0o17"), 15);
  assert.equal(parseNum("0O17"), 15);
  assert.equal(parseNum("$1f"), 31, "$ 前缀是汇编里常见的十六进制写法");
});

test("parseNum：十进制、下划线分隔与空白", () => {
  assert.equal(parseNum("42"), 42);
  assert.equal(parseNum("  7  "), 7, "前后空白要吃掉");
  assert.equal(parseNum("1_000"), 1000, "千分位下划线不是有效字符，须剥掉");
  assert.equal(parseNum("0x1_F"), 31);
});

test("parseNum：解析不出来的必须退化成 0 而不是 NaN", () => {
  // NaN 会顺着算术一路污染整条指令流，0 只是"值不对"但仍是数字，
  // 上层至少能继续走完并把错误报在语法层。
  assert.equal(parseNum("abc"), 0);
  assert.equal(parseNum(""), 0);
  assert.equal(parseNum("0x"), 0);
  assert.equal(parseNum("--"), 0);
  for (const raw of ["abc", "", "0x", "  "]) {
    assert.equal(Number.isFinite(parseNum(raw)), true, `${raw} 不该产出非有限数`);
  }
});

/* ------------------------------------------------------------------ *
 * assemble：正常路径
 * ------------------------------------------------------------------ */

test("assemble：最小程序无错误，base 如实", () => {
  const r = assemble("ldi r3, 1\nhlt\n");
  assert.deepEqual(r.errors, []);
  assert.equal(r.base, 0);
  // 注意：ldi 是**双字**指令（opcode 字 + 立即数字），hlt 是单字。
  // 别按"一行 = 一个机器字"来数 —— 这是本文件第一版的错误假设。
  assert.equal(r.words.length, 3);
});

test("assemble：指令字长符合 ISA（带立即数/跳转地址的占两个字）", () => {
  // 这条是编码层的骨架事实：字长一变，机器码布局就全错，而且错了照样能跑。
  const cases: [string, number][] = [
    ["ldi r3, 1", 2], // opcode + 立即数
    ["jmp 4", 2], // opcode + 目标地址
    ["add r0, r3", 1],
    ["out r0", 1],
    ["cmp r0, r1", 1],
    ["hlt", 1],
  ];
  for (const [src, want] of cases) {
    const r = assemble(`${src}\n`);
    assert.deepEqual(r.errors, [], `${src} 不该报错`);
    assert.equal(r.words.length, want, `${src} 应编码成 ${want} 个字，实际 ${r.words.length}`);
  }
});

test("assemble：注释与空行不占机器码", () => {
  const bare = assemble("ldi r3, 1\nhlt\n");
  const noisy = assemble("; 这是注释\nldi r3, 1\n\n   \nhlt   ; 行尾注释\n");
  assert.deepEqual(noisy.errors, []);
  assert.deepEqual(noisy.words, bare.words, "注释/空行不应改变编码结果");
});

test("assemble：标签解析到它的指令地址", () => {
  const r = assemble("ldi r3, 1\nldi r0, 0\nloop: out r0\nhlt\n");
  assert.deepEqual(r.errors, []);
  // ldi 占 2 字 ⇒ loop 前已有 4 个字，标签落在 4 而不是"第 3 条指令"。
  assert.equal(r.symbols.loop, 4);
});

test("assemble：前向引用可解析（标签定义在使用之后）", () => {
  // 单趟汇编若不做两遍，前向跳转会拿到未定义符号。
  const r = assemble("jmp later\nhlt\nlater: hlt\n");
  assert.deepEqual(r.errors, [], "前向引用不该报错");
  assert.equal(r.symbols.later, 3, "jmp 占 2 字、hlt 占 1 字 ⇒ later 在第 3 个字");
});

test("assemble：base 偏移同时进入字地址与标签", () => {
  const r = assemble("here: hlt\n", { base: 0x100 });
  assert.deepEqual(r.errors, []);
  assert.equal(r.base, 0x100);
  assert.equal(r.symbols.here, 0x100, "标签应落在 base 上而不是 0");
  assert.equal(r.listing[0].addr, 0x100);
});

test("assemble：数值可写成表达式", () => {
  const r = assemble("ldi r0, 2 + 3 * 4\nhlt\n");
  assert.deepEqual(r.errors, []);
  // 与 "ldi r0, 14" 逐字相同，才算表达式真的被求值了；
  // 只断言"没报错"会放过"表达式被当垃圾忽略、立即数取 0"这种坏实现。
  const direct = assemble("ldi r0, 14\nhlt\n");
  assert.deepEqual(r.words, direct.words, "2 + 3 * 4 应与直接写 14 编出同样的机器码");
});

/* ------------------------------------------------------------------ *
 * assemble：错误路径 —— 出错必须是具名错误，不是崩溃也不是静默通过
 * ------------------------------------------------------------------ */

test("assemble：未知指令报具名错误并带行号", () => {
  const r = assemble("hlt\nfoo bar baz\n");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /第 2 行/, "错误必须指出是哪一行");
  assert.match(r.errors[0], /未知指令/, "错误必须说清是什么问题");
});

test("assemble：立即数超 16 位被拦下", () => {
  const r = assemble("ldi r3, 99999999\n");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /16 位/);
});

test("assemble：未定义标签要报错，不能当成 0 悄悄跳过去", () => {
  const r = assemble("jmp nowhere\n");
  assert.ok(r.errors.length >= 1, "跳向不存在的标签必须报错");
});

test("assemble：空程序报错而不是静默产出空机器码", () => {
  // 装配出 0 个字却返回"成功"，上层会以为程序是对的 —— 所以这里必须报错。
  for (const src of ["", "   \n\n", "; 只有注释\n"]) {
    const r = assemble(src);
    assert.deepEqual(r.words, [], `${JSON.stringify(src)} 不该产出机器码`);
    assert.equal(r.errors.length, 1, `${JSON.stringify(src)} 应报一条"没有产生任何指令"`);
    assert.match(r.errors[0], /没有产生任何指令/);
  }
});

test("assemble：多条错误一次性全部报出，不是一条一条挤牙膏", () => {
  const r = assemble("foo\nldi r3, 99999999\nbar\n");
  assert.equal(r.errors.length, 3, `应报出 3 条，实际 ${r.errors.length}: ${r.errors}`);
});

/* ------------------------------------------------------------------ *
 * disassemble：反汇编往返
 * ------------------------------------------------------------------ */

test("disassemble：能还原成指令文本（按指令数，不是按机器字数）", () => {
  const a = assemble("ldi r3, 1\nhlt\n");
  const lines = disassemble(a.words, a.base);
  // ldi 双字、hlt 单字 ⇒ 3 个机器字只对应 2 条指令。
  assert.equal(lines.length, 2, `应还原出 2 条指令，实际 ${lines.length}`);
  assert.match(lines[0].text, /ldi/i);
  assert.match(lines[1].text, /hlt/i);
});

test("disassemble：还原出的地址落在原 listing 的地址集合里", () => {
  // listing 是**字级**（每个机器字一行），disassemble 是**指令级**，
  // 所以两者条数本就不该相等 —— 该比的是地址对得上、机器字对得上。
  const a = assemble("ldi r3, 1\nldi r0, 0\nloop: out r0\nhlt\n");
  const d = disassemble(a.words, a.base);
  const addrs = new Set(a.listing.map((l) => l.addr));
  for (const line of d) {
    assert.ok(addrs.has(line.addr), `反汇编出的地址 ${line.addr} 不在原 listing 里`);
  }
  const words = new Map(a.listing.map((l) => [l.addr, l.word]));
  for (const line of d) {
    assert.equal(line.word, words.get(line.addr), `地址 ${line.addr} 的机器字对不上`);
  }
});

test("disassemble：往返后重新汇编得到同样的机器码", () => {
  // 最强的一条：编 → 反编 → 再编，字对字一致。
  const a = assemble("ldi r3, 1\nldi r0, 0\nloop: out r0\nhlt\n");
  const text = disassemble(a.words, a.base)
    .map((l) => l.text.replace(/R(\d+)/gi, "r$1"))
    .join("\n");
  const again = assemble(`${text}\n`);
  assert.deepEqual(again.errors, [], `重新汇编不该报错: ${again.errors}`);
  assert.deepEqual(again.words, a.words, "往返后机器码应逐字一致");
});

test("disassemble：空输入返回空列表", () => {
  assert.deepEqual(disassemble([], 0), []);
});
