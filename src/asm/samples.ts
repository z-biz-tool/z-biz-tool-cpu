import { Simulator } from "../core/sim.ts";
import type { AsmResult } from "./assembler.ts";

/* ------------------------------------------------------------------ *
 * 示例程序 + 程序装载
 * ------------------------------------------------------------------ */

export interface Sample {
  key: string;
  name: string;
  desc: string;
  source: string;
  /** 在参考 CPU 上跑完后，端口 0xF0 应打印出的值（终端为十进制模式） */
  expect: number[];
}

export const SAMPLES: Sample[] = [
  {
    key: "count",
    name: "计数 1→10",
    desc: "最小程序：从 1 递增到 10，逐个送到输出端口",
    expect: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    source: `; 计数 1 → 10，每次 out 到端口 0xF0
      ldi  r3, 1
      ldi  r0, 0
      ldi  r1, 10
loop: add  r0, r3
      out  r0
      cmp  r0, r1
      jne  loop
      hlt
`,
  },
  {
    key: "fib",
    name: "斐波那契",
    desc: "输出前 12 项斐波那契数",
    expect: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
    source: `; 前 12 项斐波那契数：0 1 1 2 3 5 8 13 21 ...
      ldi  r4, 12
      xor  r5, r5
      ldi  r0, 0
      ldi  r1, 1
      ldi  r3, 1
loop: out  r0
      mov  r2, r0
      add  r2, r1
      mov  r0, r1
      mov  r1, r2
      sub  r4, r3
      cmp  r4, r5
      jne  loop
      hlt
`,
  },
  {
    key: "sum",
    name: "累加 1..100",
    desc: "求 1+2+…+100 并输出结果（5050）",
    expect: [5050],
    source: `; 1 + 2 + ... + 100 = 5050
      ldi  r0, 100
      ldi  r3, 1
      xor  r5, r5
      mov  r1, r5
loop: add  r1, r0
      sub  r0, r3
      cmp  r0, r5
      jne  loop
      out  r1
      hlt
`,
  },
  {
    key: "gcd",
    name: "辗转相除",
    desc: "用子程序 + 栈求 gcd(1071, 462) = 21",
    expect: [21],
    source: `; gcd(1071, 462) —— 演示 call / ret / push / pop
      lds  0xE0
      ldi  r0, 1071
      ldi  r1, 462
      call gcd
      out  r0
      hlt

; r0 = gcd(r0, r1)，用减法实现取余
gcd:  push r1
      push r2
      push r3
      xor  r5, r5
again:
      cmp  r1, r5
      je   done
      mov  r2, r0
mod:  cmp  r2, r1
      jc   fitted
      sub  r2, r1
      jmp  mod
fitted:
      mov  r0, r1
      mov  r1, r2
      jmp  again
done:
      pop  r3
      pop  r2
      pop  r1
      ret
`,
  },
  {
    key: "sort",
    name: "冒泡排序",
    desc: "对内存里的 8 个数排序后依次输出：1 2 3 4 5 7 8 9",
    expect: [1, 2, 3, 4, 5, 7, 8, 9],
    source: `; 冒泡排序 0x80 起的 8 个数，然后输出
      ldi  r3, 1
      xor  r4, r4
      ldi  r0, 7
outer:
      ldi  r2, 0x80
      mov  r1, r0
inner:
      lda  r5, [r2]
      add  r2, r3
      lda  r7, [r2]
      cmp  r5, r7
      jc   noswap
      sta  r5, [r2]
      sub  r2, r3
      sta  r7, [r2]
      add  r2, r3
noswap:
      sub  r1, r3
      cmp  r1, r4
      jne  inner
      sub  r0, r3
      cmp  r0, r4
      jne  outer

      ldi  r2, 0x80
      ldi  r0, 8
emit: lda  r5, [r2]
      out  r5
      add  r2, r3
      sub  r0, r3
      cmp  r0, r4
      jne  emit
      hlt

      .org 0x80
      .word 5, 3, 9, 1, 7, 2, 8, 4
`,
  },
  {
    key: "stack",
    name: "栈逆序",
    desc: "顺序压栈再弹出，输出变成逆序：5 4 3 2 1",
    expect: [5, 4, 3, 2, 1],
    source: `; 演示 push / pop：正序入栈，出栈即逆序
      lds  0xE0
      ldi  r3, 1
      xor  r4, r4
      ldi  r0, 5
      ldi  r2, 0x80
pushl:
      lda  r5, [r2]
      push r5
      add  r2, r3
      sub  r0, r3
      cmp  r0, r4
      jne  pushl
      ldi  r0, 5
pull:
      pop  r5
      out  r5
      sub  r0, r3
      cmp  r0, r4
      jne  pull
      hlt

      .org 0x80
      .word 1, 2, 3, 4, 5
`,
  },
  {
    key: "hello",
    name: "字符输出",
    desc: "把一串字符常量逐个送到端口（终端元件切到字符模式即可看到文字）",
    expect: [72, 101, 108, 108, 111],
    source: `; 逐个输出字符 "Hello"
      ldi  r3, 1
      ldi  r2, 0x90
      ldi  r0, 0x95
loop: lda  r5, [r2]
      out  r5
      add  r2, r3
      cmp  r2, r0
      jc   loop
      hlt

      .org 0x90
      .word 'H', 'e', 'l', 'l', 'o'
`,
  },
];

/** 兼容旧命名：按 key 取示例源码 */
export function assemblesSample(key: string): string {
  const hit = SAMPLES.find((s) => s.key === key) ?? SAMPLES[0];
  return hit.source;
}

/** 把汇编结果写入 RAM 元件的 params.data（按绝对地址对齐） */
export function applyProgram(sim: Simulator, compId: string, res: AsmResult, clear = false): { ok: boolean; reason?: string } {
  const comp = sim.compById(compId);
  if (!comp) return { ok: false, reason: `找不到 RAM 元件 ${compId}` };
  const depth = 2 ** (Number(comp.inst.params.addrBits) || 8);
  const bits = Math.max(1, Number(comp.inst.params.bitWidth) || 16);
  // doc 04 §6.2：装载前先按地址范围校验；越界 / 位宽不匹配拒绝，不静默丢弃尾部
  for (let i = 0; i < res.words.length; i++) {
    const addr = res.base + i;
    if (addr < 0 || addr >= depth) {
      return { ok: false, reason: `装载地址 0x${addr.toString(16)} 超出 RAM 范围 [0..${depth - 1}]` };
    }
    // 用无符号掩码（>>> 0）防 JavaScript 位运算溢出
    const mask = bits >= 32 ? 0xffffffff : ((1 << bits) - 1) >>> 0;
    const orig = (res.words[i] | 0) >>> 0;
    if ((orig & mask) !== orig) {
      return { ok: false, reason: `字 0x${orig.toString(16)} 位宽超过 RAM ${bits} 位` };
    }
  }
  const current = clear ? new Array<number>(depth).fill(0) : sim.readMemory(compId).slice();
  while (current.length < depth) current.push(0);
  res.words.forEach((w, i) => {
    const addr = res.base + i;
    if (addr >= 0 && addr < depth) current[addr] = w;
  });
  sim.writeMemory(compId, current);
  return { ok: true };
}

/** 显式装载函数：直接接受地址数组，绕开 assemble 的 .org 处理
 *  用于 doc 04 §6.2 验证：装载越界 / 位宽超限返回 {ok: false, reason} */
export function loadProgramDirect(sim: Simulator, compId: string, words: number[], baseAddr: number): { ok: boolean; reason?: string } {
  return applyProgram(sim, compId, { words, base: baseAddr, errors: [], symbols: {}, listing: [] } as AsmResult, true);
}
