import type { Circuit } from "../../core/types.ts";

/* ------------------------------------------------------------------ *
 * 案例工坊的「一个案例」长什么样
 *
 * 约束只有三条，但每条都由自检器把关，写完就得能跑：
 *  1. src 用迷你网表写电路（见 workshop/dsl.ts），端口宽度写死在文本里；
 *  2. ports 必须把每个 in/out 都解释一遍 —— 工坊列表里点开就能看懂，
 *     不允许出现「id: n17 看不出是什么」的组件；
 *  3. 行为必须被**独立**验证：comb 给纯函数模型，seq 给时序脚本。
 *     模型是照着定义写的，不是照着电路抄的 —— 这才是对拍，而不是自证。
 * ------------------------------------------------------------------ */

export type PackKey = "logic" | "arith" | "seq" | "bus" | "mem" | "cpu" | "io" | "machine";

export interface SeqStep {
  /** 这一步要拨的输入（不含 clk，clk 由自检器打拍） */
  set?: Record<string, number>;
  /** 拨完输入、**打拍之前**的期望输出（用来观察组合旁路，如边沿脉冲） */
  at?: Record<string, number>;
  /** 打几拍；缺省 1 */
  ticks?: number;
  /** 打完拍之后的期望输出 */
  expect?: Record<string, number>;
}

export interface Example {
  id: string;
  name: string;
  pack: PackKey;
  /** 1 = 门级入门，2 = 组合进阶，3 = 时序/存储，4 = 部件/整机 */
  tier: 1 | 2 | 3 | 4;
  /** 一句话：它是什么 */
  blurb: string;
  /** 一段话：为什么值得存在（教学价值 / 工程价值） */
  why: string;
  /** 端口说明：端口名 → 这句端口是干什么的 */
  ports: Record<string, string>;
  src: string;
  /** 组合案例：参与向量的输入端口；缺省为全部 in 端口 */
  comb?: string[];
  /** 组合案例的行为模型：输入值 → 期望输出值 */
  model?: (v: Record<string, number>) => Record<string, number>;
  /** 时序案例：脚本化真值序列 */
  seq?: SeqStep[];
  /** 组合案例的显式用例（覆盖边界，与模型对拍互为补充） */
  cases?: { label?: string; set: Record<string, number>; expect: Record<string, number> }[];
  tags?: string[];
}

export interface Pack {
  key: PackKey;
  title: string;
  blurb: string;
  accent: string;
}

export const PACKS: Pack[] = [
  { key: "logic", title: "门级与组合逻辑", blurb: "从与非门到表决器：每一颗门怎么拼成一个能用的判断", accent: "#a78bfa" },
  { key: "arith", title: "算术与数据转换", blurb: "加法、乘法、比较、饱和、BCD：把数字算对的那一层", accent: "#60a5fa" },
  { key: "seq", title: "时序与状态", blurb: "时钟、锁存、分频、状态机：让电路记得住事情", accent: "#22d3ee" },
  { key: "bus", title: "总线与选择", blurb: "多路复用、扩展、移位、仲裁：宽线与窄线之间的调度", accent: "#34d399" },
  { key: "mem", title: "存储与介质", blurb: "RAM/ROM/FIFO/栈，以及电容、浮栅、盘片的物理模型", accent: "#fbbf24" },
  { key: "cpu", title: "CPU 部件", blurb: "PC、IR、译码、标志位、栈指针：一台处理器的每个螺丝", accent: "#fb923c" },
  { key: "io", title: "显示与协议", blurb: "把电平变成人能读的东西：数码管、字符、CRC、汉明码", accent: "#f472b6" },
  { key: "machine", title: "整机与数据通路", blurb: "把前面 90 个案例焊起来，跑出一条真正的指令", accent: "#e879f9" },
];

/** 一个案例的电路与端口声明（布局已排好） */
export interface Built {
  circuit: Circuit;
  ports: { name: string; dir: "in" | "out"; width: number }[];
}
