import type { Circuit } from "../core/types.ts";
import { circuit, comp, wire } from "../core/build.ts";
import type { Level, LevelTest } from "./levels.ts";

/* ------------------------------------------------------------------ *
 * EDU-01 / IMP-11: 三个序章微实验
 *
 * prologue-light: 输入开关直接控制灯（组合）
 * prologue-wire: 修复断开的连线（连接）
 * prologue-clock: D 触发器在时钟上升沿采样（时序）
 *
 * 每个序章使用稳定 ID，单独计数，不并入 31 关。
 * 通过电路（仅基本元件）+ 输入/输出断言验证。
 * ------------------------------------------------------------------ */

function prologueLightCircuit(): Circuit {
  const sw = comp("in-S", "input", 0, 0, { bitWidth: 1 }, { name: "S" });
  const led = comp("out-L", "output", 8, 0, { bitWidth: 1, radix: "bin" }, { name: "L" });
  const w = wire("w1", ["in-S", "out"], ["out-L", "in"]);
  return circuit([sw, led], [w]);
}

function prologueWireCircuit(): Circuit {
  // S 已经初始化为 1，但 L 没连接；学生需要自己接
  const sw = comp("in-S", "input", 0, 0, { bitWidth: 1, init: 1 }, { name: "S" });
  const led = comp("out-L", "output", 8, 0, { bitWidth: 1, radix: "bin" }, { name: "L" });
  return circuit([sw, led], []);
}

function prologueClockCircuit(): Circuit {
  const dIn = comp("in-D", "input", 0, 0, { bitWidth: 1 }, { name: "D" });
  const clkIn = comp("in-CLK", "input", 4, 0, { bitWidth: 1, init: 0 }, { name: "CLK" });
  const ff = comp("ff", "dff", 8, 0, {}, { name: "FF" });
  const qOut = comp("out-Q", "output", 16, 0, { bitWidth: 1, radix: "bin" }, { name: "Q" });
  const wires = [
    wire("w-clk", ["in-CLK", "out"], ["ff", "clk"]),
    wire("w-q", ["ff", "q"], ["out-Q", "in"]),
  ];
  return circuit([dIn, clkIn, ff, qOut], wires);
}

const prologueLightTests: LevelTest[] = [
  { name: "开关闭合时灯亮", inputs: { S: 1 }, steps: 1, outputs: { L: 1 } },
  { name: "开关断开时灯灭", inputs: { S: 0 }, steps: 1, outputs: { L: 0 } },
  {
    name: "切换 0→1→0 灯跟随",
    phases: [
      { inputs: { S: 0 }, steps: 1 },
      { inputs: { S: 1 }, steps: 1 },
      { inputs: { S: 0 }, steps: 1 },
    ],
    outputs: { L: 0 },
  },
];

const prologueWireTests: LevelTest[] = [
  { name: "未连前灯显示 0（兼容未驱动）", inputs: { S: 1 }, steps: 1, outputs: { L: 1 } },
  { name: "S=0 时 L=0", inputs: { S: 0 }, steps: 1, outputs: { L: 0 } },
  { name: "S=1 时 L=1", inputs: { S: 1 }, steps: 1, outputs: { L: 1 } },
];

const prologueClockTests: LevelTest[] = [
  { name: "CLK 保持 0，D 变化 Q 不变", inputs: { D: 1, CLK: 0 }, steps: 2, outputs: { Q: 0 } },
  {
    name: "上升沿采样 D=1 后 Q=1",
    phases: [
      { inputs: { D: 1, CLK: 0 }, steps: 2 },
      { inputs: { CLK: 1 }, steps: 2 },
    ],
    outputs: { Q: 1 },
  },
  { name: "下降沿 D 变 0，Q 仍 1", inputs: { D: 0, CLK: 0 }, steps: 2, outputs: { Q: 1 } },
  { name: "再次上升沿 D=0 后 Q=0", inputs: { D: 0, CLK: 1 }, steps: 2, outputs: { Q: 0 } },
];

export const PROLOGUE_LEVELS: Level[] = [
  {
    id: "prologue-light",
    tier: 0,
    name: "序章·点亮信号灯",
    brief: "工作台已经接好一根线，从开关 S 一直到灯 L。请先预测：把 S 切到 1 时，灯会怎样？",
    teach: "组合电路没有时钟，输入的当前值就是灯的当前值。这是最简单的电路：开关直接控制灯。",
    available: ["input", "output"],
    skeleton: prologueLightCircuit,
    tests: prologueLightTests,
    hint: "提示：S=0 时 L=?  S=1 时 L=?  切换顺序预测。",
    par: 1,
  },
  {
    id: "prologue-wire",
    tier: 0,
    name: "序章·修好断开的信号线",
    brief: "S 已经设为 1，但灯 L 还没有亮。请检查连线，把 S 的输出接到 L 的输入。",
    teach: "灯未亮通常不是「坏了」，而是线没有连通。请找到 S 的输出端和 L 的输入端，做一次有效连接。",
    available: ["input", "output"],
    skeleton: prologueWireCircuit,
    tests: prologueWireTests,
    hint: "提示：未连接时 L 显示 0 并带「未驱动」标记；交叉线不自动电气连接。",
    par: 1,
  },
  {
    id: "prologue-clock",
    tier: 0,
    name: "序章·记忆门只在约定时刻收件",
    brief: "D 触发器的 D 脚还没接好。请把 D 连到数据脚，并测试：CLK=0 时改变 D，Q 是否变化？",
    teach: "时序器件只在时钟有效沿采样，平时保持旧值。先 D=1 但 CLK=0，Q 不变；上升沿后 Q 才变 1。",
    available: ["input", "output", "dff"],
    skeleton: prologueClockCircuit,
    tests: prologueClockTests,
    hint: "提示：先看 CLK 与 Q 的旧值；按一次上升沿观察 Q；下降沿不更新。",
    par: 3,
  },
];

/** 序章独立计数与进度存储 */
export interface PrologueProgress {
  light: { passed: boolean; attempts: number };
  wire: { passed: boolean; attempts: number };
  clock: { passed: boolean; attempts: number };
}

export function emptyPrologueProgress(): PrologueProgress {
  return {
    light: { passed: false, attempts: 0 },
    wire: { passed: false, attempts: 0 },
    clock: { passed: false, attempts: 0 },
  };
}