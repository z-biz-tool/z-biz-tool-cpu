import { CircuitBuilder } from "../core/build.ts";
import type { CompInstance, Design } from "../core/types.ts";

/* ------------------------------------------------------------------ *
 * 参考 CPU：微程序控制的 16 位 Z16 处理器
 *
 * 全部用库里的元件搭出来，没有任何「黑盒 CPU」：
 *   · 状态机 ST=0 取指 → ST=1 译码执行 →（需要立即数的指令再走 ST=2）
 *   · 控制存储器 CTRL 是一块 ROM，地址 = ST(3) | SUB(3) | OP(4)，
 *     输出 31 位控制字，数据通路上所有多路器都由这些位直接驱动
 *   · 寄存器堆 = 两块内容一致的 RAM（写入口共用，读出口各一），R6=SP、R7=LR
 *   · 端口：写 0xF0 打到终端，读 0xF1 作为输入
 * ------------------------------------------------------------------ */

export const CPU_WORD = 16;
export const PORT_OUT = 0xf0;
export const PORT_IN = 0xf1;

/** 单比特控制信号 → 控制字里的位号 */
export const SIG = {
  PC_WE: 0,
  IR_WE: 22,
  IMM_WE: 23,
  MEM_WE: 24,
  RF_WE: 25,
  FLAG_WE: 26,
  HALT: 27,
  BR_EN: 28,
  LAST: 29,
  PORT_SEL: 30,
} as const;

/** 两位选择域 → 起始位（各占 2 位） */
export const SEL = {
  PC_SEL: 1,
  A_SEL: 3,
  B_SEL: 5,
  ALU_A: 7,
  ALU_B: 9,
  RF_DST: 11,
  RF_SRC: 13,
  MEM_A: 15,
  MEM_D: 17,
} as const;

export const ALU_OP_POS = 19;
export const CTRL_BITS = 31;

export type CtrlField = keyof typeof SIG | keyof typeof SEL | "ALU_OP";
export type CtrlBits = Partial<Record<CtrlField, number>>;

const SIG_POS: Record<string, number> = SIG as unknown as Record<string, number>;
const SEL_POS: Record<string, number> = SEL as unknown as Record<string, number>;

export function ctrlWord(bits: CtrlBits): number {
  let v = 0;
  for (const [k, raw] of Object.entries(bits)) {
    if (!raw) continue;
    if (k in SIG_POS) v |= 1 << SIG_POS[k];
    else if (k === "ALU_OP") v |= (raw & 7) << ALU_OP_POS;
    else v |= (raw & 3) << SEL_POS[k];
  }
  return v >>> 0;
}

/** 控制字段的可读说明：指令集手册与 CPU 视图共用 */
export const CTRL_DOC: { name: string; bits: string; desc: string }[] = [
  { name: "PC_WE", bits: "0", desc: "允许写 PC（还要与 taken、~halted 相与）" },
  { name: "PC_SEL", bits: "1-2", desc: "PC 来源：0 PC+1、1 RA、2 IMM、3 RB" },
  { name: "A_SEL", bits: "3-4", desc: "读口 A 地址：0 A字段、1 B字段、2 R6(SP)、3 R7(LR)" },
  { name: "B_SEL", bits: "5-6", desc: "读口 B 地址，编码同 A_SEL" },
  { name: "ALU_A", bits: "7-8", desc: "ALU 左输入：0 RA、1 RB、2 IMM、3 PC" },
  { name: "ALU_B", bits: "9-10", desc: "ALU 右输入：0 RB、1 常数1、2 IMM、3 常数0" },
  { name: "RF_DST", bits: "11-12", desc: "寄存器堆写地址，编码同 A_SEL" },
  { name: "RF_SRC", bits: "13-14", desc: "寄存器堆写数据：0 ALU、1 MEM、2 IMM、3 PC" },
  { name: "MEM_A", bits: "15-16", desc: "存储器地址：0 PC、1 RA、2 RB、3 端口" },
  { name: "MEM_D", bits: "17-18", desc: "存储器写数据：0 ALU、1 RA、2 RB、3 IMM" },
  { name: "ALU_OP", bits: "19-21", desc: "ALU 操作：0加 1减 2与 3或 4异或 5非 6左移 7右移" },
  { name: "IR_WE", bits: "22", desc: "锁存指令寄存器 IR" },
  { name: "IMM_WE", bits: "23", desc: "锁存立即数寄存器 IMM" },
  { name: "MEM_WE", bits: "24", desc: "存储器写使能" },
  { name: "RF_WE", bits: "25", desc: "寄存器堆写使能" },
  { name: "FLAG_WE", bits: "26", desc: "更新 Z/C/N 标志" },
  { name: "HALT", bits: "27", desc: "停机：DONE 拉高并封锁所有写使能" },
  { name: "BR_EN", bits: "28", desc: "条件转移：PC 写入还要与 taken 相与" },
  { name: "LAST", bits: "29", desc: "本指令最后一拍，状态机回 0" },
  { name: "PORT_SEL", bits: "30", desc: "端口：0 输出 0xF0、1 输入 0xF1" },
];

/* 选择域取值：每块多路器的输入编号不同，按总线分开定义，别混用 */
const F = { A: 0, B: 1, SP: 2, LR: 3 } as const;
/** 读口 A / 读口 B / 写地址（三者共用同一套编号） */
const PC_SEL = { NEXT: 0, RA: 1, IMM: 2, RB: 3 } as const;
const ALU_A = { RA: 0, RB: 1, IMM: 2, PC: 3 } as const;
const ALU_B = { RB: 0, ONE: 1, IMM: 2, ZERO: 3 } as const;
const RF_SRC = { ALU: 0, MEM: 1, IMM: 2, PC: 3 } as const;
const MEM_A = { PC: 0, RA: 1, RB: 2, PORT: 3 } as const;
const MEM_D = { ALU: 0, RA: 1, RB: 2, IMM: 3 } as const;

const Y = { HLT: 0, CALL: 1, RET: 2, PUSH: 3, POP: 4, OUT: 5, IN: 6, LDS: 7 } as const;

/* ---------------- 微程序 ---------------- */

/** 取指拍：所有指令一致（此刻 IR 还是上一条，所以整行必须统一） */
const FETCH = ctrlWord({ PC_WE: 1, PC_SEL: PC_SEL.NEXT, IR_WE: 1, MEM_A: MEM_A.PC });
/** 双字指令第一拍：把第二个字作为立即数取进来，PC 再前进一格 */
const IMM_FETCH = ctrlWord({ PC_WE: 1, PC_SEL: PC_SEL.NEXT, IMM_WE: 1, MEM_A: MEM_A.PC });
/** 不该到达的状态：把状态机拉回 0 */
const RECOVER = ctrlWord({ LAST: 1 });

/** 寄存器写回（ALU 结果）：默认 A 口读 A 字段、B 口读 B 字段 */
function wrAlu(extra: CtrlBits): number {
  return ctrlWord({ LAST: 1, RF_WE: 1, RF_DST: F.A, A_SEL: F.A, B_SEL: F.B, ...extra });
}

const ALU_OF: Record<number, number> = { 3: 0, 4: 1, 5: 2, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7 };
const ARITH: Record<number, boolean> = { 3: true, 4: true }; // 只有加/减更新标志

/** 单字指令在 ST=1 执行完；双字指令在 ST=2 执行完 */
function execRow(op: number, sub: number): { one: number; two: number } {
  if (op === 0) return { one: RECOVER, two: RECOVER }; // NOP
  if (op === 1)
    // MOV a,b：A 口去读 B 字段，ALU 异或 0 直通
    return { one: wrAlu({ ALU_OP: 4, ALU_A: ALU_A.RA, ALU_B: ALU_B.ZERO, A_SEL: F.B }), two: RECOVER };
  if (op === 2)
    // LDI a,#imm
    return { one: 0, two: ctrlWord({ LAST: 1, RF_WE: 1, RF_DST: F.A, RF_SRC: RF_SRC.IMM, A_SEL: F.A }) };
  if (op in ALU_OF) {
    const aluOp = ALU_OF[op];
    const flag = ARITH[op] ? 1 : 0;
    if (op === 8) return { one: wrAlu({ ALU_OP: 5, ALU_A: ALU_A.RA, ALU_B: ALU_B.ZERO, FLAG_WE: flag }), two: RECOVER };
    return { one: wrAlu({ ALU_OP: aluOp, ALU_A: ALU_A.RA, ALU_B: ALU_B.RB, FLAG_WE: flag }), two: RECOVER };
  }
  if (op === 11)
    // CMP：只更新标志
    return {
      one: ctrlWord({ LAST: 1, ALU_OP: 1, ALU_A: ALU_A.RA, ALU_B: ALU_B.RB, A_SEL: F.A, B_SEL: F.B, FLAG_WE: 1 }),
      two: RECOVER,
    };
  if (op === 12)
    // LDA a,[b]
    return {
      one: ctrlWord({ LAST: 1, MEM_A: MEM_A.RB, A_SEL: F.A, B_SEL: F.B, RF_WE: 1, RF_DST: F.A, RF_SRC: RF_SRC.MEM }),
      two: RECOVER,
    };
  if (op === 13)
    // STA a,[b]
    return {
      one: ctrlWord({ LAST: 1, MEM_WE: 1, MEM_A: MEM_A.RB, MEM_D: MEM_D.RA, A_SEL: F.A, B_SEL: F.B }),
      two: RECOVER,
    };
  if (op === 14)
    // JMP cond,#imm
    return { one: 0, two: ctrlWord({ LAST: 1, PC_WE: 1, PC_SEL: PC_SEL.IMM, BR_EN: 1 }) };
  if (op === 15) return sysRow(sub);
  return { one: RECOVER, two: RECOVER };
}

function sysRow(sub: number): { one: number; two: number } {
  switch (sub) {
    case Y.HLT:
      return { one: ctrlWord({ LAST: 1, HALT: 1 }), two: RECOVER };
    case Y.CALL:
      // LR ← PC（此时 PC 已是返回地址），PC ← IMM
      return {
        one: 0,
        two: ctrlWord({ LAST: 1, PC_WE: 1, PC_SEL: PC_SEL.IMM, RF_WE: 1, RF_DST: F.LR, RF_SRC: RF_SRC.PC }),
      };
    case Y.RET:
      return { one: ctrlWord({ LAST: 1, PC_WE: 1, PC_SEL: PC_SEL.RA, A_SEL: F.LR }), two: RECOVER };
    case Y.PUSH:
      // 写地址=SP，写数据=B 口读到的 R[a]，同时 SP ← SP-1
      return {
        one: ctrlWord({
          LAST: 1,
          MEM_WE: 1,
          MEM_A: MEM_A.RA,
          MEM_D: MEM_D.RB,
          A_SEL: F.SP,
          B_SEL: F.A,
          ALU_A: ALU_A.RA,
          ALU_B: ALU_B.ONE,
          ALU_OP: 1,
          RF_WE: 1,
          RF_DST: F.SP,
          RF_SRC: RF_SRC.ALU,
        }),
        two: RECOVER,
      };
    case Y.POP:
      // 第一拍 SP 自增，第二拍读新栈顶写回 A 字段
      return {
        one: ctrlWord({
          LAST: 0,
          A_SEL: F.SP,
          ALU_A: ALU_A.RA,
          ALU_B: ALU_B.ONE,
          ALU_OP: 0,
          RF_WE: 1,
          RF_DST: F.SP,
          RF_SRC: RF_SRC.ALU,
        }),
        two: ctrlWord({
          LAST: 1,
          MEM_A: MEM_A.RA,
          A_SEL: F.SP,
          B_SEL: F.A,
          RF_WE: 1,
          RF_DST: F.A,
          RF_SRC: RF_SRC.MEM,
        }),
      };
    case Y.OUT:
      return { one: ctrlWord({ LAST: 1, MEM_WE: 1, MEM_A: MEM_A.PORT, MEM_D: MEM_D.RA, A_SEL: F.A }), two: RECOVER };
    case Y.IN:
      return {
        one: ctrlWord({ LAST: 1, PORT_SEL: 1, MEM_A: MEM_A.PORT, RF_WE: 1, RF_DST: F.A, RF_SRC: RF_SRC.MEM, A_SEL: F.A }),
        two: RECOVER,
      };
    case Y.LDS:
      return { one: 0, two: ctrlWord({ LAST: 1, RF_WE: 1, RF_DST: F.SP, RF_SRC: RF_SRC.IMM }) };
    default:
      return { one: RECOVER, two: RECOVER };
  }
}

/** 双字指令：LDI、JMP、SYS CALL、SYS LDS */
export function isTwoWord(op: number, sub: number) {
  return op === 2 || op === 14 || (op === 15 && (sub === Y.CALL || sub === Y.LDS));
}

/** CTRL ROM 内容：地址 = ST(0-2) | SUB(3-5) | OP(6-9) */
export function ctrlData(): string {
  const out: string[] = [];
  for (let op = 0; op < 16; op++) {
    for (let sub = 0; sub < 8; sub++) {
      const rows = [FETCH, RECOVER, RECOVER, RECOVER, RECOVER, RECOVER, RECOVER, RECOVER];
      const { one, two } = execRow(op, sub);
      if (isTwoWord(op, sub)) {
        rows[1] = IMM_FETCH;
        rows[2] = two;
      } else {
        // 单字指令在 ST=1 执行；POP 这类需要两拍的，第二拍放在 ST=2
        rows[1] = one;
        rows[2] = two;
      }
      for (const w of rows) out.push("0x" + w.toString(16).padStart(8, "0"));
    }
  }
  return out.join(",");
}

/* ---------------- 搭电路 ---------------- */

type Ref = [string, string];

export interface CpuHandles {
  mem: string;
  ir: string;
  imm: string;
  pc: string;
  flags: string;
  /** R0…R7 八个寄存器元件 id（下标即寄存器号） */
  regs: string[];
  ctrl: string;
  state: string;
  out: string;
  done: string;
}

function find(comps: CompInstance[], name: string, type: string) {
  return comps.find((c) => (c.name === name || c.id === name) && c.type === type)?.id;
}

/** 在已放好 CLK / MEM / OUT / DONE 的画布上搭出整台 CPU */
export function wireReferenceCpu(
  design: Design,
  opt: { clk?: string; mem?: string; out?: string; done?: string } = {}
): CpuHandles {
  const root = design.root;
  const b = new CircuitBuilder();
  b.seed(root);
  const clk = opt.clk ?? find(root.comps, "CLK", "clock") ?? "clk";
  const mem = opt.mem ?? find(root.comps, "MEM", "ram") ?? "MEM";
  const out = opt.out ?? find(root.comps, "OUT", "print") ?? "OUT";
  const done = opt.done ?? find(root.comps, "DONE", "output") ?? "out-DONE";
  const handles = build(b, { clk, mem, out, done });
  design.root = b.build();
  return handles;
}

function build(b: CircuitBuilder, r: { clk: string; mem: string; out: string; done: string }): CpuHandles {
  let seq = 0;
  const pos = (d: number, i: number) => d + (i % 6) * 9;
  /** 若干根单线合成总线 */
  const mergeBits = (refs: Ref[], width: number, y: number): string => {
    const m = b.add("merge", 30 + seq * 3, y, { bitWidth: width });
    seq++;
    refs.forEach((x, i) => b.connect(x[0], x[1], m, "b" + i));
    return m;
  };
  const mux = (inputs: Ref[], sel: Ref, y: number): string => {
    const m = b.add("mux", 40 + seq * 3, y, { inputs: Math.max(2, inputs.length) });
    seq++;
    inputs.forEach((x, i) => b.connect(x[0], x[1], m, "i" + i));
    b.connect(sel[0], sel[1], m, "sel");
    return m;
  };
  const gate = (type: "and" | "or" | "xor", inputs: Ref[], y: number): string => {
    const g = b.add(type, 40 + seq * 3, y, { inputs: inputs.length });
    seq++;
    inputs.forEach((x, i) => b.connect(x[0], x[1], g, "i" + i));
    return g;
  };
  const invert = (src: Ref, y: number): string => {
    const g = b.add("not", 40 + seq * 3, y, {});
    seq++;
    b.connect(src[0], src[1], g, "i0");
    return g;
  };
  const cst = (value: number, bits: number, y: number) => {
    const c = b.add("const", 10, y, { bitWidth: bits, value });
    seq++;
    return c;
  };

  /* ---- 常量 ---- */
  const c0 = cst(0, 16, 120);
  const c1 = cst(1, 16, 124);
  const c4 = cst(6, 4, 128);
  const c5 = cst(7, 4, 132);
  const cF0 = cst(PORT_OUT, 16, 136);
  const cHi = cst(1, 1, 140);
  const cLo = cst(0, 1, 144);
  /** 端口选择只占 1 位，用独立的 1 位常量，避免把 16 位总线接到控制位上 */
  const cOne = cst(1, 1, 148);

  /* ---- 三个寄存器 ---- */
  const pc = b.add("reg", pos(20, 1), 20, {}, { name: "PC" });
  const ir = b.add("reg", pos(20, 2), 26, {}, { name: "IR" });
  const imm = b.add("reg", pos(20, 3), 32, {}, { name: "IMM" });
  const irSplit = b.add("split", pos(20, 4), 26, { bitWidth: 16 });
  b.connect(ir, "q", irSplit, "in");

  /* ---- 指令字段 ---- */
  const irBit = (i: number): Ref => [irSplit, "b" + i];
  const fA3 = mergeBits([irBit(8), irBit(9), irBit(10)], 4, 40);
  const fB3 = mergeBits([irBit(4), irBit(5), irBit(6)], 4, 44);

  /* ---- 状态机 + 停机锁 ---- */
  const st = b.add("counter", pos(20, 5), 8, { bitWidth: 4 }, { name: "ST" });
  const stSplit = b.add("split", pos(20, 6), 8, { bitWidth: 4 });
  b.connect(st, "out", stSplit, "in");
  const halted = b.add("dff", pos(20, 6), 14, {}, { name: "HALTED" });
  b.connect(r.clk, "out", halted, "clk");

  /* ---- 控制存储器 ---- */
  const ctrlAddr = mergeBits(
    [
      [stSplit, "b0"],
      [stSplit, "b1"],
      [stSplit, "b2"],
      irBit(4),
      irBit(5),
      irBit(6),
      irBit(12),
      irBit(13),
      irBit(14),
      irBit(15),
    ],
    16,
    4
  );
  const ctrl = b.add("rom", pos(20, 2), 2, { bitWidth: 32, addrBits: 10, data: ctrlData() }, { name: "CTRL" });
  b.connect(ctrlAddr, "out", ctrl, "addr");
  const ctrlSplit = b.add("split", pos(20, 3), 2, { bitWidth: 32 });
  b.connect(ctrl, "out", ctrlSplit, "in");
  const cb = (i: number): Ref => [ctrlSplit, "b" + i];
  const sig = (name: keyof typeof SIG): Ref => cb(SIG_POS[name]);
  const selBus = (name: keyof typeof SEL): Ref => {
    const p = SEL_POS[name];
    return [mergeBits([cb(p), cb(p + 1)], 2, 50 + p), "out"];
  };
  const aluOp = mergeBits([cb(ALU_OP_POS), cb(ALU_OP_POS + 1), cb(ALU_OP_POS + 2)], 3, 78);

  /* ---- 停机封锁与状态推进 ---- */
  const haltKeep = gate("or", [sig("HALT"), [halted, "q"]], 16);
  b.connect(haltKeep, "out", halted, "d");
  const running = invert([halted, "q"], 18);
  const stReset = gate("or", [sig("LAST"), [halted, "q"]], 10);
  b.connect(stReset, "out", st, "rst");
  b.connect(cHi, "out", st, "en");
  b.connect(r.clk, "out", st, "clk");

  /* ---- 寄存器堆：8 个 16 位寄存器 + 译码写使能 + 两个组合读口 ---- */
  const alu = b.add("alu", pos(20, 4), 84, {}, { name: "ALU" });
  const rfWe = gate("and", [sig("RF_WE"), [running, "out"]], 56);
  const rfSrc = mux([[alu, "out"], [r.mem, "dout"], [imm, "q"], [pc, "q"]], selBus("RF_SRC"), 60);
  const aSel = mux([[fA3, "out"], [fB3, "out"], [c4, "out"], [c5, "out"]], selBus("A_SEL"), 64);
  const bSel = mux([[fA3, "out"], [fB3, "out"], [c4, "out"], [c5, "out"]], selBus("B_SEL"), 68);
  const rfDst = mux([[fA3, "out"], [fB3, "out"], [c4, "out"], [c5, "out"]], selBus("RF_DST"), 72);
  const dstDec = b.add("demux", 46, 72, { inputs: 8 });
  seq++;
  b.connect(rfDst, "out", dstDec, "sel");
  const rfRegs: string[] = [];
  for (let i = 0; i < 8; i++) {
    const en = gate("and", [[dstDec, "o" + i], [rfWe, "out"]], 160 + i);
    const rg = b.add("reg", 54 + (i % 4) * 6, 160 + i, {}, { name: "R" + i });
    seq++;
    b.connect(en, "out", rg, "load");
    b.connect(rfSrc, "out", rg, "d");
    b.connect(r.clk, "out", rg, "clk");
    rfRegs.push(rg);
  }
  const regRefs: Ref[] = rfRegs.map((id): Ref => [id, "q"]);
  const ra: Ref = [mux(regRefs, [aSel, "out"], 76), "out"];
  const rb: Ref = [mux(regRefs, [bSel, "out"], 80), "out"];

  /* ---- ALU ---- */
  const aluA = mux([ra, rb, [imm, "q"], [pc, "q"]], selBus("ALU_A"), 84);
  const aluB = mux([rb, [c1, "out"], [imm, "q"], [c0, "out"]], selBus("ALU_B"), 90);
  b.connect(aluA, "out", alu, "a");
  b.connect(aluB, "out", alu, "b");
  b.connect(aluOp, "out", alu, "op");

  /* ---- 标志 ---- */
  const flagNew = mergeBits([[alu, "zero"], [alu, "carry"], [alu, "neg"]], 4, 96);
  const flags = b.add("reg", pos(20, 5), 96, {}, { name: "FLAGS" });
  const flagSplit = b.add("split", pos(20, 6), 96, { bitWidth: 4 });
  b.connect(flags, "q", flagSplit, "in");
  const flagHold = mux([[flags, "q"], [flagNew, "out"]], sig("FLAG_WE"), 102);
  b.connect(flagHold, "out", flags, "d");
  b.connect(cHi, "out", flags, "load");
  b.connect(r.clk, "out", flags, "clk");
  const FZ: Ref = [flagSplit, "b0"];
  const FC: Ref = [flagSplit, "b1"];
  const FN: Ref = [flagSplit, "b2"];

  /* ---- 条件转移 ---- */
  const nz = invert(FZ, 108);
  const nc = invert(FC, 110);
  const nn = invert(FN, 112);
  const cond = mux(
    [[cHi, "out"], FZ, [nz, "out"], FC, [nc, "out"], FN, [nn, "out"], [cLo, "out"]],
    [fB3, "out"],
    106
  );
  const noBr = invert(sig("BR_EN"), 114);
  const takenOr = gate("or", [[noBr, "out"], [cond, "out"]], 116);
  const pcGate1 = gate("and", [sig("PC_WE"), [running, "out"]], 118);
  const pcWe = gate("and", [[pcGate1, "out"], [takenOr, "out"]], 120);
  b.connect(pcWe, "out", pc, "load");
  b.connect(r.clk, "out", pc, "clk");

  /* ---- PC 来源 ---- */
  const pcInc = b.add("add", pos(20, 3), 20, {});
  b.connect(pc, "q", pcInc, "a");
  b.connect(c1, "out", pcInc, "b");
  const pcSrc = mux([[pcInc, "sum"], ra, [imm, "q"], rb], selBus("PC_SEL"), 24);
  b.connect(pcSrc, "out", pc, "d");

  /* ---- 取指 / 立即数锁存：都从存储器数据总线进来 ---- */
  const irWe = gate("and", [sig("IR_WE"), [running, "out"]], 34);
  const immWe = gate("and", [sig("IMM_WE"), [running, "out"]], 38);
  b.connect(irWe, "out", ir, "load");
  b.connect(immWe, "out", imm, "load");
  b.connect(r.mem, "dout", ir, "d");
  b.connect(r.mem, "dout", imm, "d");
  b.connect(r.clk, "out", ir, "clk");
  b.connect(r.clk, "out", imm, "clk");

  /* ---- 端口地址：0xF0 输出、0xF1 输入 ---- */
  const portStep = gate("and", [sig("PORT_SEL"), [cOne, "out"]], 140);
  const portX = gate("or", [[cF0, "out"], [portStep, "out"]], 142);
  const memAddr = mux([[pc, "q"], ra, rb, [portX, "out"]], selBus("MEM_A"), 130);
  const memData = mux([[alu, "out"], ra, rb, [imm, "q"]], selBus("MEM_D"), 134);
  const memWe = gate("and", [sig("MEM_WE"), [running, "out"]], 138);
  b.connect(memAddr, "out", r.mem, "addr");
  b.connect(memData, "out", r.mem, "din");
  b.connect(memWe, "out", r.mem, "wen");
  b.connect(r.clk, "out", r.mem, "clk");

  /* ---- 终端：写 0xF0 时打印 ---- */
  const portHit = b.add("cmp", pos(20, 4), 130, {});
  b.connect(memAddr, "out", portHit, "a");
  b.connect(cF0, "out", portHit, "b");
  const printEn = gate("and", [[memWe, "out"], [portHit, "eq"]], 136);
  b.connect(printEn, "out", r.out, "en");
  b.connect(memData, "out", r.out, "val");
  b.connect(r.clk, "out", r.out, "clk");

  /* ---- DONE ---- */
  b.connect(halted, "q", r.done, "in");

  return { mem: r.mem, ir, imm, pc, flags, regs: rfRegs, ctrl, state: st, out: r.out, done: r.done };
}

/** 一台自带时钟、程序与终端的完整参考 CPU */
export function referenceCpu(program: number[] = []): { design: Design; handles: CpuHandles } {
  const b = new CircuitBuilder();
  b.add("clock", 0, 0, { divide: 1, auto: true }, { id: "clk", name: "CLK" });
  b.add(
    "ram",
    16,
    4,
    { bitWidth: 16, addrBits: 16, data: program.map((w) => "0x" + w.toString(16)).join(",") },
    { id: "MEM", name: "MEM" }
  );
  b.add("print", 44, 4, { radix: "dec" }, { id: "OUT", name: "OUT" });
  b.add("output", 44, 0, { bitWidth: 1, radix: "bin" }, { id: "out-DONE", name: "DONE" });
  const design: Design = { name: "参考 CPU", root: b.build(), defs: [] };
  const handles = wireReferenceCpu(design);
  return { design, handles };
}

export function referenceCpuDesign(program: number[] = []): Design {
  return referenceCpu(program).design;
}
