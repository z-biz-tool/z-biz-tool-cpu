import {
  COND,
  CONDS,
  FLAG_POLICY,
  ISA_VERSION,
  OP,
  PORT_IN,
  PORT_OUT,
  REG_COUNT,
  REG_LR,
  REG_SP,
  SYS,
  SYSS,
  WORD_BITS,
  decodeOp,
} from "../asm/isa.ts";

/* ------------------------------------------------------------------ *
 * IMP-05: Z16 独立参考解释器
 *
 * 与电路实现的 CPU 完全独立：单独维护 PC/寄存器/标志/内存/输出，
 * 在每条指令 retire 事件（即指令完成）后与电路架构状态对齐。
 * 用于差分验证、课程 CPU Boss 与失败回放（AT-10）。
 * ------------------------------------------------------------------ */

/** 标志位 8 位掩码（Z=1, N=2, C=4, V=8），便于序列化 */
const FLAG_Z = 1;
const FLAG_N = 2;
const FLAG_C = 4;
// V = 8 保留：Z16 首发不实现溢出标志

export interface InterpreterState {
  pc: number;
  regs: Uint16Array;
  flags: number;
  /** 16 位地址空间；只保存写过的位置 */
  mem: Map<number, number>;
  /** 终端输出按产生顺序 */
  output: number[];
  /** 输入队列（被 IN 消耗） */
  input: number[];
  /** 当前已执行指令计数 */
  retired: number;
  /** 是否已停机 */
  halted: boolean;
  /** 异常原因 */
  fault?: string;
}

export interface InterpreterStep {
  /** retire 事件的指令地址 */
  pc: number;
  /** 操作码字段 */
  op: number;
  /** A 字段 */
  a: number;
  /** B 字段 */
  b: number;
  /** 立即数字（双字指令） */
  imm?: number;
  /** 这一拍产生的输出 */
  output?: number[];
}

const MASK16 = (1 << WORD_BITS) - 1;
const SIGN16 = 1 << (WORD_BITS - 1);

function toSigned(v: number): number {
  return (v & SIGN16) ? v - (1 << WORD_BITS) : v;
}

// 引用以保持位运算辅助函数在共享 API 中可用
export const _internalToSigned = toSigned;

/** 把 c 语言风格的 ALU 运算收敛到一个有符号 16 位结果 */
function aluEval(op: number, a: number, b: number): { result: number; c: number } {
  switch (op) {
    case 0: {
      const r = (a + b) >>> 0;
      return { result: r & MASK16, c: (r > MASK16) ? 1 : 0 };
    }
    case 1: {
      const r = (a - b) >>> 0;
      // 借位：当 a < b 时，C=1
      return { result: r & MASK16, c: a < b ? 1 : 0 };
    }
    case 2:
      return { result: a & b & MASK16, c: 0 };
    case 3:
      return { result: a | b & MASK16, c: 0 };
    case 4:
      return { result: a ^ b & MASK16, c: 0 };
    case 5:
      return { result: (~a) & MASK16, c: 0 };
    case 6: {
      const sh = b & 15;
      const r = (a << sh) >>> 0;
      return { result: r & MASK16, c: sh > 0 && sh <= WORD_BITS && ((a >> (WORD_BITS - sh)) & 1) ? 1 : 0 };
    }
    case 7: {
      const sh = b & 15;
      return { result: (a >>> sh) & MASK16, c: 0 };
    }
    default:
      return { result: 0, c: 0 };
  }
}

function takeWord(mem: Map<number, number>, addr: number): number {
  return mem.get(addr & MASK16) ?? 0;
}

function storeWord(mem: Map<number, number>, addr: number, value: number) {
  mem.set(addr & MASK16, value & MASK16);
}

function checkCond(cond: number, flags: number): boolean {
  const z = (flags & FLAG_Z) !== 0;
  const c = (flags & FLAG_C) !== 0;
  const n = (flags & FLAG_N) !== 0;
  switch (cond) {
    case COND.ALW: return true;
    case COND.EQ: return z;
    case COND.NE: return !z;
    case COND.CS: return c;
    case COND.CC: return !c;
    case COND.MI: return n;
    case COND.PL: return !n;
    default: return false;
  }
}

export function newInterpreter(initial: { input?: number[] } = {}): InterpreterState {
  const regs = new Uint16Array(REG_COUNT);
  return {
    pc: 0,
    regs,
    flags: 0,
    mem: new Map(),
    output: [],
    input: initial.input ? initial.input.slice() : [],
    retired: 0,
    halted: false,
  };
}

/** 把程序镜像装入内存（首地址 0） */
export function loadProgram(state: InterpreterState, program: number[]) {
  state.mem.clear();
  program.forEach((w, i) => storeWord(state.mem, i, w));
  state.pc = 0;
  state.retired = 0;
  state.halted = false;
  state.fault = undefined;
}

/** 提供输入端口（IN 指令会按顺序消耗） */
export function pushInput(state: InterpreterState, value: number) {
  state.input.push(value & 0xff);
}

/** 取一条指令并执行，直到发生 retire 事件；返回本次执行的事件 */
export function stepOnce(state: InterpreterState, program?: number[]): InterpreterStep | undefined {
  if (state.halted) return undefined;
  const fetch = program ? program[state.pc & MASK16] : takeWord(state.mem, state.pc);
  const dec = decodeOp(fetch);
  const basePc = state.pc;
  let pcAdvanced = 1;
  let out: number[] | undefined;

  switch (dec.op) {
    case OP.NOP: break;
    case OP.MOV: {
      state.regs[dec.a] = state.regs[dec.b];
      break;
    }
    case OP.LDI: {
      const imm = (program ? program[(state.pc + 1) & MASK16] : takeWord(state.mem, state.pc + 1));
      state.regs[dec.a] = imm & MASK16;
      pcAdvanced = 2;
      break;
    }
    case OP.ADD: case OP.SUB: case OP.AND: case OP.OR: case OP.XOR: {
      const aluMap: Record<number, number> = { 3: 0, 4: 1, 5: 2, 6: 3, 7: 4 };
      const aluOp = aluMap[dec.op];
      const { result, c } = aluEval(aluOp, state.regs[dec.a], state.regs[dec.b]);
      state.regs[dec.a] = result & MASK16;
      const pol = FLAG_POLICY[dec.op];
      let nf = state.flags;
      if (pol.z) nf = ((result & MASK16) === 0 ? FLAG_Z : 0) | (nf & ~FLAG_Z);
      if (pol.n) nf = ((result & SIGN16) ? FLAG_N : 0) | (nf & ~FLAG_N);
      if (pol.c) nf = (c ? FLAG_C : 0) | (nf & ~FLAG_C);
      state.flags = nf;
      break;
    }
    case OP.NOT: {
      const r = (~state.regs[dec.a]) & MASK16;
      state.regs[dec.a] = r;
      const pol = FLAG_POLICY[dec.op];
      let nf = state.flags;
      if (pol.z) nf = ((r & MASK16) === 0 ? FLAG_Z : 0) | (nf & ~FLAG_Z);
      if (pol.n) nf = ((r & SIGN16) ? FLAG_N : 0) | (nf & ~FLAG_N);
      state.flags = nf;
      break;
    }
    case OP.SHL: {
      const sh = state.regs[dec.b] & 15;
      const r = (state.regs[dec.a] << sh) & MASK16;
      state.regs[dec.a] = r;
      break;
    }
    case OP.SHR: {
      const sh = state.regs[dec.b] & 15;
      state.regs[dec.a] = (state.regs[dec.a] >>> sh) & MASK16;
      break;
    }
    case OP.CMP: {
      const a = state.regs[dec.a];
      const b = state.regs[dec.b];
      const { c } = aluEval(1, a, b);
      const r = (a - b) & MASK16;
      let nf = state.flags;
      nf = ((r & MASK16) === 0 ? FLAG_Z : 0) | (nf & ~FLAG_Z);
      nf = ((r & SIGN16) ? FLAG_N : 0) | (nf & ~FLAG_N);
      nf = (c ? FLAG_C : 0) | (nf & ~FLAG_C);
      state.flags = nf;
      break;
    }
    case OP.LDA: {
      const addr = state.regs[dec.b] & MASK16;
      state.regs[dec.a] = (program ? program[addr] : takeWord(state.mem, addr)) & MASK16;
      break;
    }
    case OP.STA: {
      const addr = state.regs[dec.b] & MASK16;
      storeWord(state.mem, addr, state.regs[dec.a]);
      break;
    }
    case OP.JMP: {
      const imm = (program ? program[(state.pc + 1) & MASK16] : takeWord(state.mem, state.pc + 1));
      pcAdvanced = 2;
      if (checkCond(dec.b, state.flags)) {
        state.pc = imm & MASK16;
        pcAdvanced = 0;
      }
      break;
    }
    case OP.SYS: {
      switch (dec.b) {
        case SYS.HLT:
          state.halted = true;
          break;
        case SYS.CALL: {
          const imm = (program ? program[(state.pc + 1) & MASK16] : takeWord(state.mem, state.pc + 1));
          state.regs[REG_LR] = ((state.pc + 2) & MASK16);
          state.pc = imm & MASK16;
          pcAdvanced = 0;
          break;
        }
        case SYS.RET:
          state.pc = state.regs[REG_LR] & MASK16;
          pcAdvanced = 0;
          break;
        case SYS.PUSH: {
          const sp = (state.regs[REG_SP] - 1) & MASK16;
          state.regs[REG_SP] = sp;
          storeWord(state.mem, sp, state.regs[dec.a]);
          break;
        }
        case SYS.POP: {
          const sp = (state.regs[REG_SP] + 1) & MASK16;
          state.regs[REG_SP] = sp;
          state.regs[dec.a] = takeWord(state.mem, sp);
          break;
        }
        case SYS.OUT: {
          const v = state.regs[dec.a] & 0xff;
          storeWord(state.mem, PORT_OUT, v);
          state.output.push(v);
          out = [v];
          break;
        }
        case SYS.IN: {
          const v = state.input.shift() ?? takeWord(state.mem, PORT_IN);
          state.regs[dec.a] = v & 0xff;
          break;
        }
        case SYS.LDS: {
          const imm = (program ? program[(state.pc + 1) & MASK16] : takeWord(state.mem, state.pc + 1));
          state.regs[REG_SP] = imm & MASK16;
          pcAdvanced = 2;
          break;
        }
        default:
          state.fault = `未知 SYS 子命令 ${dec.b}`;
      }
      break;
    }
    default:
      state.fault = `未实现操作码 0x${dec.op.toString(16)}`;
  }

  state.retired++;
  if (!state.halted && pcAdvanced > 0) state.pc = (state.pc + pcAdvanced) & MASK16;

  const step: InterpreterStep = {
    pc: basePc,
    op: dec.op,
    a: dec.a,
    b: dec.b,
    output: out,
  };
  if (pcAdvanced === 2 || dec.op === OP.LDI || dec.op === OP.JMP || dec.op === OP.SYS && (dec.b === SYS.CALL || dec.b === SYS.LDS)) {
    const imm = (program ? program[(basePc + 1) & MASK16] : takeWord(state.mem, basePc + 1));
    step.imm = imm & MASK16;
  }
  return step;
}

/** 一次执行直到 HLT 或达到上限；返回所有 retire 事件 */
export function runToHalt(state: InterpreterState, program?: number[], maxSteps = 20000): InterpreterStep[] {
  const events: InterpreterStep[] = [];
  for (let i = 0; i < maxSteps && !state.halted; i++) {
    const ev = stepOnce(state, program);
    if (!ev) break;
    events.push(ev);
  }
  return events;
}

/** IMP-05: 与电路架构状态比较；返回首个差异描述或 undefined 表示一致 */
export function diffWithCircuit(
  interp: InterpreterState,
  circuit: { pc: number; regs: number[]; flags: number; memReads?: Map<number, number>; memWrites?: Map<number, number>; output?: number[] }
): { what: string; pc: number; expected: unknown; actual: unknown } | undefined {
  if ((interp.pc & MASK16) !== (circuit.pc & MASK16)) {
    return { what: "pc", pc: interp.pc, expected: interp.pc, actual: circuit.pc };
  }
  for (let i = 0; i < REG_COUNT; i++) {
    if ((interp.regs[i] & MASK16) !== (circuit.regs[i] & MASK16)) {
      return { what: `reg[${i}]`, pc: interp.pc, expected: interp.regs[i], actual: circuit.regs[i] };
    }
  }
  if ((interp.flags & 0xf) !== (circuit.flags & 0xf)) {
    return { what: "flags", pc: interp.pc, expected: interp.flags, actual: circuit.flags };
  }
  if (circuit.output) {
    if (interp.output.length !== circuit.output.length) {
      return { what: "output.length", pc: interp.pc, expected: interp.output.length, actual: circuit.output.length };
    }
    for (let i = 0; i < interp.output.length; i++) {
      if (interp.output[i] !== circuit.output[i]) {
        return { what: `output[${i}]`, pc: interp.pc, expected: interp.output[i], actual: circuit.output[i] };
      }
    }
  }
  return undefined;
}

/** IMP-05: 取 ISA 版本号 */
export function isaVersion(): string {
  return ISA_VERSION;
}

// 兼容旧的导出
export { CONDS, SYSS };