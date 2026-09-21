import { assemble } from "../asm/assembler.ts";
import type { AsmResult } from "../asm/assembler.ts";
import { Simulator } from "../core/sim.ts";
import type { Design } from "../core/types.ts";
import { referenceCpu } from "./reference.ts";
import type { CpuHandles } from "./reference.ts";

/* ------------------------------------------------------------------ *
 * 把参考 CPU 跑起来：汇编 → 装机 → 逐拍仿真 → 收集端口输出
 * ------------------------------------------------------------------ */

export interface CpuRun {
  design: Design;
  sim: Simulator;
  handles: CpuHandles;
  /** 终端（端口 0xF0）打印出来的文本，按顺序 */
  prints: string[];
  /** 数值形式的打印结果，便于断言 */
  values: number[];
  /** 停机信号 */
  done: boolean;
  steps: number;
  /** 汇编或拓扑错误 */
  errors: string[];
}

/** 汇编结果摊平成「地址即下标」的程序镜像 */
export function programImage(res: AsmResult): number[] {
  const out = new Array(res.base + res.words.length).fill(0);
  res.words.forEach((w, i) => {
    out[res.base + i] = w;
  });
  return out;
}

export interface RunOptions {
  /** 最多跑多少拍，防止死循环 */
  maxSteps?: number;
  /** 已有的设计（关卡骨架上补好线）里跑，而不是新建参考 CPU */
  design?: Design;
  handles?: CpuHandles;
}

/** 在给定设计上跑一段程序；不传 design 时自动搭一台参考 CPU */
export function runProgram(source: string, opt: RunOptions = {}): CpuRun {
  const res = assemble(source, { base: 0 });
  const errors = res.errors.slice();
  let design = opt.design;
  let handles = opt.handles;
  if (!design) {
    const cpu = referenceCpu(programImage(res));
    design = cpu.design;
    handles = cpu.handles;
  }
  const sim = new Simulator(design, design.root);
  if (!handles) throw new Error("runProgram：传入 design 时必须同时给出 handles");
  for (const e of sim.errors) if (e.level === "error") errors.push(e.msg);

  const h = handles;
  const prints: string[] = [];
  const values: number[] = [];
  let seen = sim.logs.length;
  let steps = 0;
  const maxSteps = opt.maxSteps ?? 20000;
  for (; steps < maxSteps; steps++) {
    sim.step();
    for (; seen < sim.logs.length; seen++) {
      const l = sim.logs[seen];
      if (l.comp !== h.out || l.level !== "info") continue;
      prints.push(l.msg);
      const n = Number(l.msg);
      values.push(Number.isNaN(n) ? l.msg.charCodeAt(0) : n);
    }
    if (sim.valueOf({ comp: h.done, pin: "in" })?.value) {
      sim.step();
      steps++;
      break;
    }
  }
  return {
    design,
    sim,
    handles: h,
    prints,
    values,
    done: !!sim.valueOf({ comp: h.done, pin: "in" })?.value,
    steps,
    errors,
  };
}
