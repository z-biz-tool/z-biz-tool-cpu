import { Simulator } from "../core/sim.ts";
import type { CpuHandles } from "./reference.ts";
import { ISA_VERSION } from "../asm/isa.ts";

/* ------------------------------------------------------------------ *
 * DBG-02 / IMP-12: CPU 调试适配器
 *
 * 把电路里的 PC/IR/寄存器/标志/retire/halted/memory 实例路径映射成
 * 统一接口，调试器和判题器按信号引用读取，不直接耦合 Simulator 内部。
 * 参考 CPU 通过 handles 自动绑定；用户 CPU 通过向导显式绑定。
 * ------------------------------------------------------------------ */

export interface SignalRef {
  /** 完整实例路径或简化 ID，例如 "root/dataPath/ALU-A" 或 "pc" */
  compId: string;
  pin: string;
}

export interface CpuDebugAdapter {
  id: string;
  isaVersion: string;
  binding: {
    pc: SignalRef;
    ir?: SignalRef;
    registers: SignalRef[];
    flags: Record<"z" | "c" | "n" | "v", SignalRef | undefined>;
    retire?: SignalRef;
    halted: SignalRef;
    memoryInstancePath: string[];
  };
}

/** 从 Simulator 读出当前 PC/寄存器/标志；用于差分验证与 UI 显示 */
export function readArchitecture(adapter: CpuDebugAdapter, sim: Simulator): {
  pc: number;
  regs: number[];
  flags: number;
  halted: boolean;
} {
  const v = (ref: SignalRef | undefined): number => {
    if (!ref) return 0;
    const pv = sim.valueOf({ comp: ref.compId, pin: ref.pin });
    return pv ? pv.value : 0;
  };
  const regs = adapter.binding.registers.map((r) => v(r));
  const flags =
    (v(adapter.binding.flags.z) ? 1 : 0) |
    (v(adapter.binding.flags.n) ? 2 : 0) |
    (v(adapter.binding.flags.c) ? 4 : 0) |
    (v(adapter.binding.flags.v) ? 8 : 0);
  return {
    pc: v(adapter.binding.pc),
    regs,
    flags,
    halted: !!v(adapter.binding.halted),
  };
}

/** 参考 CPU 自动绑定：handles 直接提供 ID 与引脚 */
export function adapterForReference(handles: CpuHandles, memoryId: string): CpuDebugAdapter {
  return {
    id: "reference-z16",
    isaVersion: ISA_VERSION,
    binding: {
      pc: { compId: handles.pc, pin: "q" },
      ir: { compId: handles.ir, pin: "q" },
      registers: handles.regs.map((id) => ({ compId: id, pin: "q" })),
      flags: {
        z: { compId: handles.flags, pin: "q0" },
        c: { compId: handles.flags, pin: "q1" },
        n: { compId: handles.flags, pin: "q2" },
        v: undefined,
      },
      halted: { compId: handles.done, pin: "in" },
      memoryInstancePath: [memoryId],
    },
  };
}

/** 用户 CPU 向导 — 仅做基本校验；UI 调用方负责收集候选信号 */
export function validateUserAdapter(adapter: CpuDebugAdapter, sim: Simulator): string[] {
  const errs: string[] = [];
  if (adapter.isaVersion !== ISA_VERSION) {
    errs.push(`ISA 版本不匹配：适配器 ${adapter.isaVersion}，当前 ${ISA_VERSION}`);
  }
  const checkRef = (label: string, ref: SignalRef | undefined) => {
    if (!ref) {
      errs.push(`${label} 缺失`);
      return;
    }
    const pv = sim.valueOf({ comp: ref.compId, pin: ref.pin });
    if (!pv) errs.push(`${label} 指向 ${ref.compId}.${ref.pin} 不存在`);
  };
  checkRef("pc", adapter.binding.pc);
  checkRef("halted", adapter.binding.halted);
  if (adapter.binding.registers.length !== 8) {
    errs.push(`寄存器数量应为 8，实际 ${adapter.binding.registers.length}`);
  } else {
    adapter.binding.registers.forEach((r, i) => checkRef(`R${i}`, r));
  }
  return errs;
}

/** IMP-12: 检查一个实例路径是否在编译后的网表里存在 */
export function resolveInstancePath(sim: Simulator, path: string[]): string | undefined {
  if (!path.length) return undefined;
  const last = path[path.length - 1];
  // 简化：path 长度 1 时直接查 ID；多段时按 "/" 拼接
  if (path.length === 1) return sim.compById(last) ? last : undefined;
  return sim.compById(path.join("/")) ? path.join("/") : undefined;
}