/* ------------------------------------------------------------------ *
 * Z16 指令集（本项目自研）
 *
 * 指令字 16 位：[15:12] 操作码  [11:8] A 字段  [7:4] B 字段  [3:0] 保留
 * 需要 16 位立即数的指令占两个字，第二个字就是立即数。
 * 寄存器：R0-R5 通用，R6 = SP（栈指针），R7 = LR（返回地址）
 * 标志位：Z 零、C 进位/借位、N 负、V 溢出（本实现提供 Z/C/N）
 * ------------------------------------------------------------------ */

export const WORD_BITS = 16;
export const REG_COUNT = 8;
export const REG_SP = 6;
export const REG_LR = 7;
/** 约定端口地址：OUT 写这里，IN 读这里 */
export const PORT_OUT = 0xf0;
export const PORT_IN = 0xf1;

export const OP = {
  NOP: 0x0,
  MOV: 0x1,
  LDI: 0x2,
  ADD: 0x3,
  SUB: 0x4,
  AND: 0x5,
  OR: 0x6,
  XOR: 0x7,
  NOT: 0x8,
  SHL: 0x9,
  SHR: 0xa,
  CMP: 0xb,
  LDA: 0xc,
  STA: 0xd,
  JMP: 0xe,
  SYS: 0xf,
} as const;

/** 跳转条件（JMP 的 B 字段） */
export const COND = {
  ALW: 0,
  EQ: 1,
  NE: 2,
  CS: 3,
  CC: 4,
  MI: 5,
  PL: 6,
} as const;

/** SYS 子命令（SYS 的 B 字段） */
export const SYS = {
  HLT: 0,
  CALL: 1,
  RET: 2,
  PUSH: 3,
  POP: 4,
  OUT: 5,
  IN: 6,
  LDS: 7,
} as const;

export interface OpInfo {
  op: number;
  /** 汇编助记符（含别名） */
  mnemonics: string[];
  /** 操作数写法 */
  args: string;
  /** 占几个字 */
  words: number;
  /** 该指令要求 ALU 执行的操作（ALU op 编码），undefined 表示不用 ALU */
  alu?: number;
  /** 微操作说明，用于指令集手册与关卡提示 */
  micro: string;
  group: "data" | "alu" | "mem" | "ctrl" | "sys";
  desc: string;
}

export const OPS: OpInfo[] = [
  { op: OP.NOP, mnemonics: ["nop"], args: "", words: 1, micro: "无操作", group: "ctrl", desc: "空操作" },
  { op: OP.MOV, mnemonics: ["mov"], args: "a, b", words: 1, alu: 4, micro: "R[a] ← R[b]", group: "data", desc: "寄存器传送" },
  {
    op: OP.LDI,
    mnemonics: ["ldi", "li"],
    args: "a, #imm",
    words: 2,
    alu: 4,
    micro: "R[a] ← imm（第二字）",
    group: "data",
    desc: "加载 16 位立即数",
  },
  { op: OP.ADD, mnemonics: ["add"], args: "a, b", words: 1, alu: 0, micro: "R[a] ← R[a]+R[b]，更新 Z/C/N", group: "alu", desc: "加法" },
  { op: OP.SUB, mnemonics: ["sub"], args: "a, b", words: 1, alu: 1, micro: "R[a] ← R[a]-R[b]，更新 Z/C/N", group: "alu", desc: "减法" },
  { op: OP.AND, mnemonics: ["and"], args: "a, b", words: 1, alu: 2, micro: "R[a] ← R[a]&R[b]，更新 Z/N", group: "alu", desc: "按位与" },
  { op: OP.OR, mnemonics: ["or"], args: "a, b", words: 1, alu: 3, micro: "R[a] ← R[a]|R[b]，更新 Z/N", group: "alu", desc: "按位或" },
  { op: OP.XOR, mnemonics: ["xor"], args: "a, b", words: 1, alu: 4, micro: "R[a] ← R[a]^R[b]，更新 Z/N", group: "alu", desc: "按位异或" },
  { op: OP.NOT, mnemonics: ["not"], args: "a", words: 1, alu: 5, micro: "R[a] ← ~R[a]，更新 Z/N", group: "alu", desc: "按位取反" },
  { op: OP.SHL, mnemonics: ["shl"], args: "a, b", words: 1, alu: 6, micro: "R[a] ← R[a]<<R[b]", group: "alu", desc: "左移" },
  { op: OP.SHR, mnemonics: ["shr"], args: "a, b", words: 1, alu: 7, micro: "R[a] ← R[a]>>R[b]", group: "alu", desc: "右移（逻辑）" },
  { op: OP.CMP, mnemonics: ["cmp"], args: "a, b", words: 1, alu: 1, micro: "R[a]-R[b] 只更新标志", group: "alu", desc: "比较" },
  { op: OP.LDA, mnemonics: ["lda", "ld"], args: "a, [b]", words: 1, micro: "R[a] ← MEM[R[b]]", group: "mem", desc: "间接读内存" },
  { op: OP.STA, mnemonics: ["sta", "st"], args: "a, [b]", words: 1, micro: "MEM[R[b]] ← R[a]", group: "mem", desc: "间接写内存" },
  {
    op: OP.JMP,
    mnemonics: ["jmp", "je", "jz", "jne", "jnz", "jc", "jnc", "jm", "jnp"],
    args: "label",
    words: 2,
    micro: "条件成立则 PC ← imm",
    group: "ctrl",
    desc: "条件跳转",
  },
  {
    op: OP.SYS,
    mnemonics: ["hlt", "call", "ret", "push", "pop", "out", "in", "lds"],
    args: "…",
    words: 1,
    micro: "见子命令表",
    group: "sys",
    desc: "系统调用族",
  },
];

export const CONDS: { code: number; mnemonics: string[]; desc: string; test: string }[] = [
  { code: COND.ALW, mnemonics: ["jmp"], desc: "无条件", test: "总是" },
  { code: COND.EQ, mnemonics: ["je", "jz"], desc: "相等/为零", test: "Z=1" },
  { code: COND.NE, mnemonics: ["jne", "jnz"], desc: "不等/非零", test: "Z=0" },
  { code: COND.CS, mnemonics: ["jc"], desc: "进位", test: "C=1" },
  { code: COND.CC, mnemonics: ["jnc"], desc: "无进位", test: "C=0" },
  { code: COND.MI, mnemonics: ["jm", "js"], desc: "为负", test: "N=1" },
  { code: COND.PL, mnemonics: ["jnp", "jns"], desc: "非负", test: "N=0" },
];

export const SYSS: { code: number; mnemonic: string; args: string; words: number; micro: string; desc: string }[] = [
  { code: SYS.HLT, mnemonic: "hlt", args: "", words: 1, micro: "停止取指", desc: "停机" },
  { code: SYS.CALL, mnemonic: "call", args: "label", words: 2, micro: "LR ← PC；PC ← imm", desc: "子程序调用" },
  { code: SYS.RET, mnemonic: "ret", args: "", words: 1, micro: "PC ← LR", desc: "子程序返回" },
  { code: SYS.PUSH, mnemonic: "push", args: "a", words: 1, micro: "MEM[SP] ← R[a]；SP ← SP-1", desc: "压栈" },
  { code: SYS.POP, mnemonic: "pop", args: "a", words: 1, micro: "SP ← SP+1；R[a] ← MEM[SP]", desc: "出栈" },
  { code: SYS.OUT, mnemonic: "out", args: "a", words: 1, micro: `MEM[${PORT_OUT.toString(16)}] ← R[a]`, desc: "输出到端口" },
  { code: SYS.IN, mnemonic: "in", args: "a", words: 1, micro: `R[a] ← MEM[${PORT_IN.toString(16)}]`, desc: "从端口读入" },
  { code: SYS.LDS, mnemonic: "lds", args: "#imm", words: 2, micro: "SP ← imm", desc: "设置栈指针" },
];

export function opInfo(op: number): OpInfo {
  return OPS[op & 15];
}

/** 编码一条指令 */
export function encode(op: number, a = 0, b = 0): number {
  return (((op & 15) << 12) | ((a & 15) << 8) | ((b & 15) << 4)) >>> 0;
}

export function decodeOp(word: number) {
  return {
    op: (word >>> 12) & 15,
    a: (word >>> 8) & 15,
    b: (word >>> 4) & 15,
    lo: word & 15,
  };
}

export const REG_NAMES = ["R0", "R1", "R2", "R3", "R4", "R5", "SP", "LR"];
