import type { LevelPublishMeta } from "./buildCatalog.ts";
import type { TaskInterface, TestbenchCase, HintStep } from "./manifest.ts";

/* ------------------------------------------------------------------ *
 * 课程元数据：31 关 + 3 序章的接口契约、验证用例、分级提示、评分规则
 *
 * 每个关卡都按 doc 03 §6 样例的格式补齐：
 * - interfaceContract（端口固定、位宽、修改范围）
 * - validationCases（变式验证用例）
 * - hints（4 级提示：概念→区域→观察→局部解法）
 * - rubric（pass / engineering / mastery）
 *
 * 公共测试 publicTests 用现有 Level.tests 的语义复用。
 * ------------------------------------------------------------------ */

const PIN = (id: string, name: string, direction: "in" | "out", width: number, required = true): TaskInterface["pins"][number] => ({
  id, name, direction, width, required,
});

const HINT = (level: 1 | 2 | 3 | 4, body: string): HintStep => ({ level, body });

function iface(pins: TaskInterface["pins"], options: Partial<TaskInterface> = {}): TaskInterface {
  return {
    pins,
    mutable: options.mutable ?? "none",
    requiredDefs: options.requiredDefs ?? [],
    initData: options.initData,
    cpuObservation: options.cpuObservation,
  };
}

function caseBasic(id: string, name: string, inputs: { target: string; tick: number; value: number }[], asserts: TestbenchCase["assertions"], maxTicks = 16): TestbenchCase {
  return { id, name, inputs, assertions: asserts, maxTicks };
}

const EQ = (target: string, value: number): TestbenchCase["assertions"][number] => ({
  kind: "signalEquals",
  target,
  equals: value,
});

/* ---------------- 序章 ---------------- */

const prologueLight: LevelPublishMeta = {
  displayOrder: 1,
  prerequisites: [],
  objectives: [{ knowledgeId: "signal-direct", description: "直接组合：输入值决定输出值" }],
  interfaceContract: iface([PIN("in-S", "S", "in", 1), PIN("out-L", "L", "out", 1)]),
  publicTests: [
    caseBasic("light-on", "S=1 时 L=1", [{ target: "in-S", tick: 0, value: 1 }], [EQ("out-L", 1)], 4),
    caseBasic("light-off", "S=0 时 L=0", [{ target: "in-S", tick: 0, value: 0 }], [EQ("out-L", 0)], 4),
  ],
  validationCases: [
    caseBasic("light-switch", "切换 0→1→0", [
      { target: "in-S", tick: 0, value: 0 },
      { target: "in-S", tick: 1, value: 1 },
      { target: "in-S", tick: 2, value: 0 },
    ], [EQ("out-L", 0)], 4),
  ],
  hints: [
    HINT(1, "组合电路没有时钟。L 的当前值就是 S 的当前值。"),
    HINT(2, "找到 S 的输出端和 L 的输入端，看看连线表。"),
    HINT(3, "把 S 从 0 切到 1，盯一下 L 的数值变化。"),
    HINT(4, "已经在骨架里准备好了连线；只是让你确认预测和观察一致。"),
  ],
};

const prologueWire: LevelPublishMeta = {
  displayOrder: 2,
  prerequisites: ["signal-direct"],
  objectives: [{ knowledgeId: "wire-connect", description: "断线时输出为 0；建立一条有效连接让信号通过" }],
  interfaceContract: iface([PIN("in-S", "S", "in", 1), PIN("out-L", "L", "out", 1)]),
  publicTests: [
    caseBasic("wire-on", "S=1 时 L=1", [{ target: "in-S", tick: 0, value: 1 }], [EQ("out-L", 1)], 4),
    caseBasic("wire-off", "S=0 时 L=0", [{ target: "in-S", tick: 0, value: 0 }], [EQ("out-L", 0)], 4),
  ],
  validationCases: [
    caseBasic("wire-toggle", "切换保持一致", [
      { target: "in-S", tick: 0, value: 0 },
      { target: "in-S", tick: 1, value: 1 },
    ], [EQ("out-L", 1)], 4),
  ],
  hints: [
    HINT(1, "L 没亮通常不是「坏了」，而是线没有连通。"),
    HINT(2, "在画布上找到 S 的输出端（标 out 的小圆点）和 L 的输入端（标 in 的小三角）。"),
    HINT(3, "看一下连线表里的 S→L 条目状态。"),
    HINT(4, "点 S 的输出，再点 L 的输入即可；Esc 取消未提交的连线。"),
  ],
};

const prologueClock: LevelPublishMeta = {
  displayOrder: 3,
  prerequisites: ["wire-connect"],
  objectives: [{ knowledgeId: "edge-sample", description: "时序器件在时钟上升沿采样 D；平时保持旧值" }],
  interfaceContract: iface([PIN("in-D", "D", "in", 1), PIN("in-CLK", "CLK", "in", 1), PIN("out-Q", "Q", "out", 1)]),
  publicTests: [
    caseBasic("clk-low-hold", "CLK=0 时 D 变化 Q 不变", [{ target: "in-D", tick: 0, value: 1 }, { target: "in-CLK", tick: 0, value: 0 }], [EQ("out-Q", 0)], 4),
    caseBasic("rise-update", "上升沿后 Q=D", [
      { target: "in-D", tick: 0, value: 1 },
      { target: "in-CLK", tick: 0, value: 0 },
      { target: "in-CLK", tick: 1, value: 1 },
    ], [EQ("out-Q", 1)], 4),
  ],
  validationCases: [
    caseBasic("fall-hold", "下降沿 D 变 0 Q 仍 1", [
      { target: "in-D", tick: 0, value: 0 },
      { target: "in-CLK", tick: 0, value: 0 },
    ], [EQ("out-Q", 1)], 4),
    caseBasic("rise-zero", "再次上升沿 D=0 后 Q=0", [
      { target: "in-D", tick: 0, value: 0 },
      { target: "in-CLK", tick: 0, value: 1 },
    ], [EQ("out-Q", 0)], 4),
  ],
  hints: [
    HINT(1, "记忆器件和直通线不同：它只在约定时刻采样数据。"),
    HINT(2, "请看 CLK 和 Q 的旧值。"),
    HINT(3, "对比沿前和沿后的数值。"),
    HINT(4, "先让 D=1 但 CLK=0；产生一次上升沿观察 Q 的变化；下降沿不会更新 Q。"),
  ],
};

/* ---------------- 五世界 31 关（精修版，按 doc 03 §6 / §7） ---------------- */

function publishFor(
  id: string,
  displayOrder: number,
  prereqs: string[],
  pins: TaskInterface["pins"],
  options: { notes?: Partial<TaskInterface>; cases?: TestbenchCase[]; hints?: HintStep[] } = {},
): LevelPublishMeta {
  return {
    displayOrder,
    prerequisites: prereqs,
    objectives: [{ knowledgeId: id, description: id }],
    interfaceContract: iface(pins, options.notes ?? {}),
    publicTests: options.cases ?? [],
    validationCases: options.cases ?? [],
    hints: options.hints ?? [
      HINT(1, "先识别每个输入/输出端口和它的位宽。"),
      HINT(2, "用真值表枚举所有输入组合，标出每一项的预期输出。"),
      HINT(3, "对比你观察到的输出与预期，找出第一条差异。"),
      HINT(4, "回到画布，按差异定位是哪个门或哪条线错了。"),
    ],
  };
}

/* doc 03 §6.1 t1-mux2 精修样例 */
const mux2Hints: HintStep[] = [
  HINT(1, "选择信号决定哪一路有效：S=0 选 A，S=1 选 B。"),
  HINT(2, "检查 S 与反向选择支路是否对齐。"),
  HINT(3, "固定 A=1、B=0，只切 S 观察 Y。"),
  HINT(4, "先把「非S与A」一支搭好；S=0 时这条线为 1，B 支路被 S=1 屏蔽。"),
];
const mux2Cases: TestbenchCase[] = [
  caseBasic("mux-s0a0", "S=0 A=0 → 0", [{ target: "s", tick: 0, value: 0 }, { target: "a", tick: 0, value: 0 }], [EQ("y", 0)], 2),
  caseBasic("mux-s0a1", "S=0 A=1 → 1", [{ target: "s", tick: 0, value: 0 }, { target: "a", tick: 0, value: 1 }], [EQ("y", 1)], 2),
  caseBasic("mux-s1b0", "S=1 B=0 → 0", [{ target: "s", tick: 0, value: 1 }, { target: "b", tick: 0, value: 0 }], [EQ("y", 0)], 2),
  caseBasic("mux-s1b1", "S=1 B=1 → 1", [{ target: "s", tick: 0, value: 1 }, { target: "b", tick: 0, value: 1 }], [EQ("y", 1)], 2),
  caseBasic("mux-swap", "未演示组合：A=0 B=1", [{ target: "s", tick: 0, value: 0 }, { target: "a", tick: 0, value: 0 }, { target: "b", tick: 0, value: 1 }], [EQ("y", 0)], 2),
];

/* doc 03 §6.2 t3-reg4 精修样例 */
const reg4Hints: HintStep[] = [
  HINT(1, "保持必须记住旧值：LOAD=0 时 D 怎么变，Q 都不会立刻更新。"),
  HINT(2, "查看 LOAD 控制的数据选择：选 D 还是选自身旧 Q。"),
  HINT(3, "LOAD=0 时改 D 不推进时钟；Q 仍保持。"),
  HINT(4, "每位可选择外部 D 或自身旧 Q；把 LOAD 当 1 位选择信号即可。"),
];
const reg4Cases: TestbenchCase[] = [
  caseBasic("reg-load0", "LOAD=0 初值下 4 周期 Q 仍 0", [{ target: "load", tick: 0, value: 0 }, { target: "d", tick: 0, value: 5 }], [EQ("q", 0)], 8),
  caseBasic("reg-rise", "LOAD=1 上升沿 Q=D", [{ target: "load", tick: 0, value: 1 }, { target: "d", tick: 0, value: 5 }], [EQ("q", 5)], 4),
  caseBasic("reg-hold", "CLK 保持高 D 变不更新", [{ target: "load", tick: 0, value: 1 }, { target: "d", tick: 0, value: 9 }], [EQ("q", 5)], 6),
];

/* doc 03 §6.3 t2-alu4 世界 Boss 样例 */
const alu4Hints: HintStep[] = [
  HINT(1, "OP 决定选哪一路运算结果；4 位按回绕处理，Z 在 R=0 时为 1。"),
  HINT(2, "定位结果选择端：加/减/与/或 四路经过 mux 选 OP。"),
  HINT(3, "固定 A/B，只切 OP 观察 R 和 Z 的变化。"),
  HINT(4, "先接通一条运算路径到选择器的输入；再加第二条，再加 Z 判断。"),
];
const alu4Cases: TestbenchCase[] = [
  caseBasic("alu-add-overflow", "15+1 → 0, Z=1", [{ target: "a", tick: 0, value: 15 }, { target: "b", tick: 0, value: 1 }, { target: "op", tick: 0, value: 0 }], [EQ("r", 0), EQ("z", 1)], 2),
  caseBasic("alu-sub", "2-9 → 9, Z=0", [{ target: "a", tick: 0, value: 2 }, { target: "b", tick: 0, value: 9 }, { target: "op", tick: 0, value: 1 }], [EQ("r", 9), EQ("z", 0)], 2),
  caseBasic("alu-and", "5 and 3 → 1", [{ target: "a", tick: 0, value: 5 }, { target: "b", tick: 0, value: 3 }, { target: "op", tick: 0, value: 2 }], [EQ("r", 1), EQ("z", 0)], 2),
  caseBasic("alu-or", "5 or 3 → 7", [{ target: "a", tick: 0, value: 5 }, { target: "b", tick: 0, value: 3 }, { target: "op", tick: 0, value: 3 }], [EQ("r", 7), EQ("z", 0)], 2),
];

/* doc 03 §6.4 t4-machine CPU Boss 样例 */
const machineHints: HintStep[] = [
  HINT(1, "完整 Z16 CPU 必须支持不同程序改变同台机器的行为，而非仅跑单一计数程序。"),
  HINT(2, "回顾取指→执行→写回边界；先确认 PC 在每个指令后正确推进。"),
  HINT(3, "观察指令完成前后与输出使能；找到 retire 事件的边界。"),
  HINT(4, "用独立解释参考模型对照架构状态（PC/寄存器/标志/内存/输出），不靠参考机逐拍对照。"),
];
const machineCases: TestbenchCase[] = [
  caseBasic("machine-count", "count 程序打印 1..10", [], [{ kind: "outputSequence", target: "out", equals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }], 500),
  caseBasic("machine-sum", "sum 程序打印 5050", [], [{ kind: "outputSequence", target: "out", equals: [5050] }], 2000),
  caseBasic("machine-halt", "完成后 DONE=1", [], [{ kind: "halted" }], 4000),
];

/* doc 03 §7 Boss 改造 */
const enc4Hints: HintStep[] = [
  HINT(1, "D3 优先级最高；0000 时 Y=0, V=0；1011 时 Y=3, V=1；Y 固定 2 位。"),
  HINT(2, "看最高请求位置撤销后赢家是谁。"),
  HINT(3, "检查 V=1 与 Y 的对应关系，避免多个请求时 V 被错算。"),
  HINT(4, "用减法或大小比较逐位选赢家；先定 D3 是否有效。"),
];
const enc4Cases: TestbenchCase[] = [
  caseBasic("enc-0000", "0000 → Y=0 V=0", [{ target: "i", tick: 0, value: 0 }], [EQ("y", 0), EQ("v", 0)], 2),
  caseBasic("enc-0001", "0001 → Y=0 V=1", [{ target: "i", tick: 0, value: 1 }], [EQ("y", 0), EQ("v", 1)], 2),
  caseBasic("enc-1011", "1011 → Y=3 V=1", [{ target: "i", tick: 0, value: 11 }], [EQ("y", 3), EQ("v", 1)], 2),
];

const stackHints: HintStep[] = [
  HINT(1, "新修订保留 5 位 SP，容量限定 31 项；空 pop 不动，满 push 拒绝。"),
  HINT(2, "push 写地址=SP，写完 SP 减 1；pop 先 SP 加 1 再读。"),
  HINT(3, "push5, push3, pop 后 SP=1，读出 3；不要误称读出剩余栈顶 5。"),
  HINT(4, "把 push/pop 当两个独立动作画时序图；满 / 空边界单独跑一遍。"),
];
const stackCases: TestbenchCase[] = [
  caseBasic("stack-push5", "PUSH 5 → 写入 MEM[SP]", [{ target: "d", tick: 0, value: 5 }, { target: "push", tick: 0, value: 1 }], [], 4),
  caseBasic("stack-pop3", "POP 后 SP=1, Q=3", [], [EQ("q", 3)], 8),
];

const harvardHints: HintStep[] = [
  HINT(1, "世界五 Boss：8 条地址取数，前 4 项 SUM=46，全部 SUM=108, DONE=1；RUN=0 保持；DONE 后不重复累加。"),
  HINT(2, "看每拍来源地址与累加路径，确认未写存储被保护。"),
  HINT(3, "中途暂停再恢复；更换 IROM 地址排列与 DRAM 值；8 位和按 256 回绕。"),
  HINT(4, "先接通地址计数到 SUM，再把 DONE 反馈给 RUN；保护未写存储需要片选。"),
];
const harvardCases: TestbenchCase[] = [
  caseBasic("harvard-sum", "完整运行 SUM=108 DONE=1", [{ target: "run", tick: 0, value: 1 }], [EQ("sum", 108), EQ("done", 1)], 800),
];

export const PROLOGUE_META: LevelPublishMeta[] = [prologueLight, prologueWire, prologueClock];

export const LEVEL_META: LevelPublishMeta[] = [
  publishFor("t1-gates", 1, ["signal-direct"], [PIN("a", "A", "in", 1), PIN("b", "B", "in", 1), PIN("out", "OUT", "out", 1)], {
    cases: [
      caseBasic("g-00", "00 → 1", [{ target: "a", tick: 0, value: 0 }, { target: "b", tick: 0, value: 0 }], [EQ("out", 1)], 2),
      caseBasic("g-01", "01 → 1", [{ target: "a", tick: 0, value: 0 }, { target: "b", tick: 0, value: 1 }], [EQ("out", 1)], 2),
      caseBasic("g-10", "10 → 1", [{ target: "a", tick: 0, value: 1 }, { target: "b", tick: 0, value: 0 }], [EQ("out", 1)], 2),
      caseBasic("g-11", "11 → 0", [{ target: "a", tick: 0, value: 1 }, { target: "b", tick: 0, value: 1 }], [EQ("out", 0)], 2),
    ],
    hints: [
      HINT(1, "NAND 是通用门：先看 00→1, 11→0 这两个组合的差异。"),
      HINT(2, "想想 NA = NAND(A,A) 之后如何继续构造 OR。"),
      HINT(3, "对比 01 vs 10，两种都是「只一个为 1」，结果都应该是 1。"),
      HINT(4, "NA = NAND(A,A)；再用一次 NAND 把 A、B 各自取反的结果合并。"),
    ],
  }),
  publishFor("t1-xor", 2, ["t1-gates"], [PIN("a", "A", "in", 1), PIN("b", "B", "in", 1), PIN("out", "OUT", "out", 1)], {
    cases: [
      caseBasic("x-00", "00 → 0", [{ target: "a", tick: 0, value: 0 }, { target: "b", tick: 0, value: 0 }], [EQ("out", 0)], 2),
      caseBasic("x-01", "01 → 1", [{ target: "a", tick: 0, value: 0 }, { target: "b", tick: 0, value: 1 }], [EQ("out", 1)], 2),
      caseBasic("x-10", "10 → 1", [{ target: "a", tick: 0, value: 1 }, { target: "b", tick: 0, value: 0 }], [EQ("out", 1)], 2),
      caseBasic("x-11", "11 → 0", [{ target: "a", tick: 0, value: 1 }, { target: "b", tick: 0, value: 1 }], [EQ("out", 0)], 2),
    ],
    hints: [
      HINT(1, "异或 = 「不同为真」；对比 OR 的反例。"),
      HINT(2, "两者都为 1 时要输出 0 — 跟 OR 的区别。"),
      HINT(3, "列出 4 种组合，看哪两种 OR=1 但 XOR=0。"),
      HINT(4, "OR 再 NAND 一份「两者都为 1」的中间信号。"),
    ],
  }),
  publishFor("t1-mux2", 3, ["t1-xor"], [PIN("s", "S", "in", 1), PIN("a", "A", "in", 1), PIN("b", "B", "in", 1), PIN("y", "Y", "out", 1)], {
    cases: mux2Cases,
    hints: mux2Hints,
  }),
  publishFor("t1-halfadd", 4, ["t1-mux2"], [PIN("a", "A", "in", 1), PIN("b", "B", "in", 1), PIN("s", "S", "out", 1), PIN("c", "C", "out", 1)], {
    hints: [
      HINT(1, "和 S 与进位 C 是两类信号；AND 给进位，XOR 给本位和。"),
      HINT(2, "回想 t1-xor 与 t1-gates 的输出分别对应 S 和 C。"),
      HINT(3, "枚举 4 种组合，把 S 和 C 各自写下来。"),
      HINT(4, "C = A AND B；S = A XOR B。"),
    ],
  }),
  publishFor("t1-fulladd", 5, ["t1-halfadd"], [PIN("a", "A", "in", 1), PIN("b", "B", "in", 1), PIN("ci", "CI", "in", 1), PIN("s", "S", "out", 1), PIN("co", "CO", "out", 1)], {
    hints: [
      HINT(1, "三输入 8 组；本质上是两个半加器串起来。"),
      HINT(2, "先把 A、B 加一次，再把结果加上 CI。"),
      HINT(3, "进位来源有两条：AB 进位 与 (A⊕B)CI 进位。"),
      HINT(4, "S = A ⊕ B ⊕ CI；CO = (A AND B) OR ((A XOR B) AND CI)。"),
    ],
  }),
  publishFor("t1-dec24", 6, ["t1-mux2"], [PIN("i", "I", "in", 2), PIN("y", "Y", "out", 4)], {
    hints: [
      HINT(1, "独热选择：输入 4 选 1，对应输出位拉高。"),
      HINT(2, "把 I 拆成两根单线分别译 0/1 位置。"),
      HINT(3, "检查 4 种输入组合，确认「唯一有效」成立。"),
      HINT(4, "每位用 AND 门：Y[k] = NOT(I[k]) 或对应 NOT 组合。"),
    ],
  }),
  publishFor("t1-enc4", 7, ["t1-dec24"], [PIN("i", "I", "in", 4), PIN("y", "Y", "out", 2), PIN("v", "V", "out", 1)], {
    cases: enc4Cases,
    hints: enc4Hints,
  }),
  publishFor("t2-add4", 1, ["t1-fulladd"], [PIN("a", "A", "in", 4), PIN("b", "B", "in", 4), PIN("s", "S", "out", 4), PIN("co", "CO", "out", 1)], {
    hints: [
      HINT(1, "总线、进位链；4 级全加器串行级联。"),
      HINT(2, "展开每一级进位：从 A₄、C₀ 算到 CO。"),
      HINT(3, "递归禁止现成加法器绕过目标，必须 4 个全加器。"),
      HINT(4, "把 A、B 各自拆成 4 根单线，逐位相加，再合并 S。"),
    ],
  }),
  publishFor("t2-addsub", 2, ["t2-add4"], [PIN("a", "A", "in", 4), PIN("b", "B", "in", 4), PIN("op", "OP", "in", 1), PIN("s", "S", "out", 4), PIN("co", "CO", "out", 1)], {
    hints: [
      HINT(1, "补码与溢出；OP=0 加，OP=1 减（A + ~B + 1）。"),
      HINT(2, "对比无符号回绕和有符号溢出，不混同进位。"),
      HINT(3, "B 取反由 OP 同时控制：OP=1 时按位 NOT。"),
      HINT(4, "复用 t2-add4，加一级 XOR 与 cin=OP。"),
    ],
  }),
  publishFor("t2-cmp4", 3, ["t2-add4"], [PIN("a", "A", "in", 4), PIN("b", "B", "in", 4), PIN("eq", "EQ", "out", 1), PIN("gt", "GT", "out", 1), PIN("lt", "LT", "out", 1)], {
    hints: [
      HINT(1, "高位优先；从最高位向低位逐级比较。"),
      HINT(2, "递归禁止现成比较器绕过目标。"),
      HINT(3, "先把 EQ 写成每位 NOT XOR 的与；GT 在 EQ 失败时由高位决定。"),
      HINT(4, "EQ = AND(NOT(A XOR B))；GT = 高位 A>B 或 EQ 且低位 A>B。"),
    ],
  }),
  publishFor("t2-shift4", 4, ["t2-add4"], [PIN("a", "A", "in", 4), PIN("sh", "SH", "in", 2), PIN("y", "Y", "out", 4)], {
    hints: [
      HINT(1, "组合移位；SH 选 0/1/2/3 位。"),
      HINT(2, "追踪位来源、补零和被截掉的高位。"),
      HINT(3, "MUX 链按位移逐级右移一位。"),
      HINT(4, "把 A 拆成 4 根单线，分别走 4 个 MUX；最末位接 0。"),
    ],
  }),
  publishFor("t2-mux8", 5, ["t1-mux2"], [PIN("s", "S", "in", 3), PIN("y", "Y", "out", 1)], {
    hints: [
      HINT(1, "多路总线选择；8 个输入由 S 三位选一。"),
      HINT(2, "覆盖全部选择值，交换数据检验非硬编码。"),
      HINT(3, "把 t1-mux2 多级串联：S[2] 选上半/下半，S[1:0] 在半内选一。"),
      HINT(4, "建一棵 3 层的 MUX 树。"),
    ],
  }),
  publishFor("t2-parity", 6, ["t1-xor"], [PIN("a", "A", "in", 4), PIN("y", "Y", "out", 1)], {
    hints: [
      HINT(1, "异或归约；偶数个 1 时 Y=0。"),
      HINT(2, "偶数个比特翻转可漏检 — 不能宣称所有错误都检出。"),
      HINT(3, "把 4 位两两 XOR，再 XOR。"),
      HINT(4, "Y = ((A0 XOR A1) XOR (A2 XOR A3))。"),
    ],
  }),
  publishFor("t2-alu4", 7, ["t2-addsub", "t2-cmp4", "t2-mux8"], [PIN("a", "A", "in", 4), PIN("b", "B", "in", 4), PIN("op", "OP", "in", 2), PIN("r", "R", "out", 4), PIN("z", "Z", "out", 1)], {
    cases: alu4Cases,
    hints: alu4Hints,
  }),
  publishFor("t3-reg4", 1, ["edge-sample"], [PIN("clk", "CLK", "in", 1), PIN("d", "D", "in", 4), PIN("load", "LOAD", "in", 1), PIN("q", "Q", "out", 4)], {
    cases: reg4Cases,
    hints: reg4Hints,
  }),
  publishFor("t3-count", 2, ["t3-reg4"], [PIN("clk", "CLK", "in", 1), PIN("rst", "RST", "in", 1), PIN("en", "EN", "in", 1), PIN("q", "Q", "out", 4)], {
    hints: [
      HINT(1, "使能、复位、回绕；优先级：RST > EN。"),
      HINT(2, "加暂停/复位优先级的时间预测：先 RST 再 EN 还是先 EN 再 RST。"),
      HINT(3, "用寄存器 + 加法器组合；EN 控制 clk 是否被屏蔽。"),
      HINT(4, "Q_next = (Q + 1) AND EN；RST=1 时直接清零。"),
    ],
  }),
  publishFor("t3-mod6", 3, ["t3-count"], [PIN("clk", "CLK", "in", 1), PIN("rst", "RST", "in", 1), PIN("q", "Q", "out", 3)], {
    hints: [
      HINT(1, "状态反馈；ROLL 表示「当前正好数到 5」。"),
      HINT(2, "对比数到 5 与数到 6 才复位，回放差一拍。"),
      HINT(3, "用比较器等于 5 直接给 ROLL；ROLL 触发时下一拍复位。"),
      HINT(4, "Q_next = (Q == 5) ? 0 : Q+1。"),
    ],
  }),
  publishFor("t3-shiftreg", 4, ["t3-reg4"], [PIN("clk", "CLK", "in", 1), PIN("d", "D", "in", 1), PIN("q", "Q", "out", 4)], {
    hints: [
      HINT(1, "同沿旧状态；P0 是第一采样级。"),
      HINT(2, "给位打时间标签：明确 P0 取的是 D 的旧值。"),
      HINT(3, "4 个 DFF 串行级联：Q[0]=D；Q[k]=Q[k-1] 旧。"),
      HINT(4, "别忘了把 CLK 接到每个触发器的 clk 脚。"),
    ],
  }),
  publishFor("t3-edge", 5, ["t3-reg4"], [PIN("clk", "CLK", "in", 1), PIN("btn", "BTN", "in", 1), PIN("p", "P", "out", 1)], {
    hints: [
      HINT(1, "历史与脉冲；连续高只产生一拍 P=1。"),
      HINT(2, "P = BTN AND NOT(prev_BTN)；pre_BTN 是上一拍 BTN 的寄存器值。"),
      HINT(3, "新契约：第 n 次采样后 P = 本次 BTN 与非上次 BTN。"),
      HINT(4, "加一个 DFF 记 BTN 旧值；P = BTN AND NOT(BTN_旧)。"),
    ],
  }),
  publishFor("t3-ram", 6, ["t3-reg4"], [PIN("clk", "CLK", "in", 1), PIN("addr", "ADDR", "in", 4), PIN("din", "DIN", "in", 8), PIN("wen", "WEN", "in", 1), PIN("dout", "DOUT", "out", 8)], {
    hints: [
      HINT(1, "组合读、沿写；同沿器件读旧状态。"),
      HINT(2, "WEN=1 上升沿时把 DIN 写到 ADDR；其他时刻 dout=mem[ADDR]。"),
      HINT(3, "固定 8 位数据 / 4 位地址；写前与写后分开观察。"),
      HINT(4, "dout = wen ? mem[addr] : mem[addr_old]（CLK 沿后再更新 mem）。"),
    ],
  }),
  publishFor("t3-file", 7, ["t3-ram"], [PIN("clk", "CLK", "in", 1), PIN("ra", "RA", "in", 3), PIN("rb", "RB", "in", 3), PIN("wa", "WA", "in", 3), PIN("wen", "WEN", "in", 1), PIN("din", "DIN", "in", 8), PIN("qa", "QA", "out", 8), PIN("qb", "QB", "out", 8)], {
    hints: [
      HINT(1, "双读单写；QA 和 QB 互相独立。"),
      HINT(2, "追踪独立读口和写选择，不宣称双读即流水线。"),
      HINT(3, "两个 RAM 同时写、读口选不同地址。"),
      HINT(4, "WA 由 wen&clk 写入；QA = mem[RA]、QB = mem[RB] 同时组合读出。"),
    ],
  }),
  publishFor("t3-stack", 8, ["t3-ram"], [PIN("clk", "CLK", "in", 1), PIN("d", "D", "in", 8), PIN("push", "PUSH", "in", 1), PIN("pop", "POP", "in", 1), PIN("q", "Q", "out", 8)], {
    cases: stackCases,
    hints: stackHints,
  }),
  publishFor("t4-alu8", 1, ["t2-alu4"], [PIN("a", "A", "in", 8), PIN("b", "B", "in", 8), PIN("op", "OP", "in", 3), PIN("r", "R", "out", 8), PIN("z", "Z", "out", 1)], {
    hints: [
      HINT(1, "封装与八类运算；只计算实际使用的有效定义。"),
      HINT(2, "增加 16 位迁移桥：从 4 位 ALU 迁移到 8 位。"),
      HINT(3, "复用 t2-alu4 的 8 个运算；高 4 位与低 4 位独立运算后再合并。"),
      HINT(4, "两路 4 位 ALU 共享 OP；R = (ALU_hi << 4) | ALU_lo。"),
    ],
  }),
  publishFor("t4-instdec", 2, ["t1-dec24"], [PIN("inst", "INST", "in", 16), PIN("op", "OP", "out", 4), PIN("a", "A", "out", 4), PIN("b", "B", "out", 4), PIN("imm", "IMM", "out", 16)], {
    hints: [
      HINT(1, "字段切片：16 位指令字拆为 OP/A/B/IMM。"),
      HINT(2, "指令字与立即数字分开，不把切片等同执行。"),
      HINT(3, "用 split 元件把 inst 切成 16 根单线，按位选。"),
      HINT(4, "OP = inst[15:12]；A = inst[11:8]；B = inst[7:4]；IMM = inst。"),
    ],
  }),
  publishFor("t4-pc", 3, ["t3-reg4"], [PIN("clk", "CLK", "in", 1), PIN("load", "LOAD", "in", 1), PIN("inc", "INC", "in", 1), PIN("d", "D", "in", 16), PIN("q", "Q", "out", 16)], {
    hints: [
      HINT(1, "顺序、加载、保持；固定加载优先级。"),
      HINT(2, "移去本关不需要的流水线气泡叙述。"),
      HINT(3, "Q_next = LOAD ? D : (INC ? Q+1 : Q)。"),
      HINT(4, "三个输入优先级：LOAD > INC > 保持。"),
    ],
  }),
  publishFor("t4-progmem", 4, ["t3-ram"], [PIN("clk", "CLK", "in", 1), PIN("addr", "ADDR", "in", 16), PIN("wen", "WEN", "in", 1), PIN("din", "DIN", "in", 16), PIN("dout", "DOUT", "out", 16)], {
    hints: [
      HINT(1, "程序映像、变长指令；查看每字地址。"),
      HINT(2, "区别读存储、取指与执行。"),
      HINT(3, "在装载阶段把整个程序镜像写入 RAM。"),
      HINT(4, "装载时 WEN=1，地址按 base+i 顺序写；运行时只读。"),
    ],
  }),
  publishFor("t4-machine", 5, ["t4-alu8", "t4-instdec", "t4-pc", "t4-progmem"], [PIN("clk", "CLK", "in", 1), PIN("mem", "MEM", "in", 16, false), PIN("out", "OUT", "in", 16, false), PIN("done", "DONE", "out", 1)], {
    cases: machineCases,
    hints: machineHints,
    notes: { cpuObservation: { pcRef: "pc", irRef: "ir", memInstancePath: ["MEM"] } },
  }),
  publishFor("t5-bank", 1, ["t3-ram"], [PIN("clk", "CLK", "in", 1), PIN("addr", "ADDR", "in", 16), PIN("sel", "SEL", "in", 2), PIN("din", "DIN", "in", 16), PIN("wen", "WEN", "in", 1), PIN("dout", "DOUT", "out", 16)], {
    hints: [
      HINT(1, "跨片读写及未选中片保护；二态 MUX 代替三态假设。"),
      HINT(2, "地址拆分：高 2 位 SEL 选片，低位选片内地址。"),
      HINT(3, "每片 WEN = SEL_match AND wen；DOUT = MUX 选中片读口。"),
      HINT(4, "未选中片 WEN=0 禁止写入；首发用 MUX 代替三态总线。"),
    ],
  }),
  publishFor("t5-charrom", 2, ["t4-instdec"], [PIN("addr", "ADDR", "in", 8), PIN("dout", "DOUT", "out", 8)], {
    hints: [
      HINT(1, "查表、输出事件；区分当前字符与已打印字符。"),
      HINT(2, "更换字模并追踪日志。"),
      HINT(3, "用 ROM 元件装载 ASCII 表。"),
      HINT(4, "ROM.data = '0x48,0x65,...'; dout = rom[addr]。"),
    ],
  }),
  publishFor("t5-micro", 3, ["t4-pc"], [PIN("st", "ST", "in", 3), PIN("sub", "SUB", "in", 3), PIN("op", "OP", "in", 4), PIN("ctrl", "CTRL", "out", 32)], {
    hints: [
      HINT(1, "控制字位域；HALT 和 PC_EN 可能同为 1。"),
      HINT(2, "控制优先级必须由使用方定义，不据此谎称已有整机。"),
      HINT(3, "用 ROM 装载控制表；addr = ST|SUB|OP。"),
      HINT(4, "高 3 位 ST、中 3 位 SUB、低 4 位 OP；地址共 10 位。"),
    ],
  }),
  publishFor("t5-harvard", 4, ["t4-machine", "t5-bank"], [PIN("clk", "CLK", "in", 1), PIN("run", "RUN", "in", 1), PIN("sum", "SUM", "out", 16), PIN("done", "DONE", "out", 1)], {
    cases: harvardCases,
    hints: harvardHints,
  }),
];

export const ALL_META: LevelPublishMeta[] = [...PROLOGUE_META, ...LEVEL_META];

export function metaByLevelMap(): Map<string, LevelPublishMeta> {
  const m = new Map<string, LevelPublishMeta>();
  for (const x of ALL_META) m.set(idForWorld(x), x);
  return m;
}

function idForWorld(_m: LevelPublishMeta): string {
  return "";
}

export const META_BY_ID: Record<string, LevelPublishMeta> = (() => {
  const out: Record<string, LevelPublishMeta> = {};
  for (const m of PROLOGUE_META) out[`prologue-${prologueIdOf(m)}`] = m;
  for (const m of LEVEL_META) out[m.objectives[0]?.knowledgeId ?? ""] = m;
  return out;
})();

function prologueIdOf(m: LevelPublishMeta): string {
  switch (m.objectives[0]?.knowledgeId) {
    case "signal-direct": return "light";
    case "wire-connect": return "wire";
    case "edge-sample": return "clock";
    default: return "";
  }
}