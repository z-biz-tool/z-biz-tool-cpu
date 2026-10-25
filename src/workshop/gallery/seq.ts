import type { Example, SeqStep } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 包三 · 时序与状态（16 个）
 *
 * 这一包全部靠 `clk` 端口打拍验证：脚本用**规格模型**生成（不是抄电路结果），
 * 每个案例都要在第 N 拍给出第 N 拍的答案。
 * ------------------------------------------------------------------ */

/** 2 分频：每次打拍翻转 */
const DIV2_SCRIPT: SeqStep[] = [1, 0, 1, 0, 1].map((q) => ({ expect: { q } }));

/** 4 分频：2 位计数器，输出高位 */
const DIV4_SCRIPT: SeqStep[] = (() => {
  let c = 0;
  return [0, 1, 2, 3, 4, 5].map(() => {
    c = (c + 1) & 3;
    return { expect: { q: (c >> 1) & 1 } };
  });
})();

/** 环形计数器：独热位跟着计数走 */
const RING_SCRIPT: SeqStep[] = (() => {
  let c = 0;
  return [0, 0, 0, 0, 0].map(() => {
    c = (c + 1) & 3;
    return { expect: { o0: c === 0 ? 1 : 0, o1: c === 1 ? 1 : 0, o2: c === 2 ? 1 : 0, o3: c === 3 ? 1 : 0 } };
  });
})();

/** 约翰逊计数器：d0 = ~d3，其余左移 */
const JOHNSON_SCRIPT: SeqStep[] = (() => {
  let s = [0, 0, 0, 0];
  const out: SeqStep[] = [];
  for (let i = 0; i < 9; i++) {
    s = [s[3] ^ 1, s[0], s[1], s[2]];
    out.push({ expect: { q0: s[0], q1: s[1], q2: s[2], q3: s[3] } });
  }
  return out;
})();

/** 模 10 计数器 */
const MOD10_SCRIPT: SeqStep[] = (() => {
  let c = 0;
  const out: SeqStep[] = [];
  for (let i = 0; i < 12; i++) {
    c = (c + 1) % 10;
    out.push({ expect: { out: c } });
  }
  return out;
})();

/** PWM：4 位计数器，count < duty 时输出高 */
const PWM_SCRIPT: SeqStep[] = (() => {
  let c = 0;
  const out: SeqStep[] = [];
  const duties = [4, 4, 4, 4, 14, 14, 14, 14, 0, 0];
  for (const duty of duties) {
    c = (c + 1) & 15;
    out.push({ set: { duty }, expect: { out: c < duty ? 1 : 0, cnt: c } });
  }
  return out;
})();

/** 序列检测器 1011：移位寄存器逐位比对 */
const SEQ1011_SCRIPT: SeqStep[] = (() => {
  const hist = [0, 0, 0, 0]; // [din(t-3), din(t-2), din(t-1), din(t)]
  const out: SeqStep[] = [];
  const stream = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1];
  for (const din of stream) {
    hist.shift();
    hist.push(din);
    // 打拍之后，寄存器里剩下的是 hist[0..2] + 当前 din 已经进 d0
    const hit = hist[0] === 1 && hist[1] === 0 && hist[2] === 1 && hist[3] === 1 ? 1 : 0;
    out.push({ set: { din }, expect: { hit } });
  }
  return out;
})();

/** 交通灯：三状态循环，en=0 时保持 */
const TRAFFIC_SCRIPT: SeqStep[] = (() => {
  let s = 0;
  const out: SeqStep[] = [];
  const plan: (number | null)[] = [1, 1, 1, 1, 1, 1, 0, 0, 1];
  for (const en of plan) {
    if (en) s = (s + 1) % 3;
    out.push({
      set: { en: en ?? 0 },
      expect: { red: s === 0 ? 1 : 0, green: s === 1 ? 1 : 0, yellow: s === 2 ? 1 : 0 },
    });
  }
  return out;
})();

/** 两级同步器：两级延迟 */
const SYNC2_SCRIPT: SeqStep[] = (() => {
  let f1 = 0;
  let f2 = 0;
  const out: SeqStep[] = [];
  for (const v of [1, 1, 0, 1, 0, 0, 1]) {
    const nextF1 = v;
    const nextF2 = f1;
    f1 = nextF1;
    f2 = nextF2;
    out.push({ set: { async_in: v }, expect: { sync: f2 } });
  }
  return out;
})();

/** 长按检测：连续 4 拍为 1 才算按住 */
const HOLD_SCRIPT: SeqStep[] = (() => {
  let c = 0;
  const out: SeqStep[] = [];
  for (const btn of [1, 1, 1, 1, 1, 0, 1, 1, 1, 1]) {
    if (btn === 0) c = 0;
    else c = Math.min(7, c + 1);
    out.push({ set: { btn }, expect: { held: c >= 4 ? 1 : 0, count: c } });
  }
  return out;
})();

/** 脉冲展宽：最近 4 拍内出现过 1 就一直为 1 */
const STRETCH_SCRIPT: SeqStep[] = (() => {
  const hist = [0, 0, 0, 0];
  const out: SeqStep[] = [];
  for (const trig of [1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]) {
    hist.shift();
    hist.push(trig);
    out.push({ set: { trig }, expect: { busy: hist.some((v) => v === 1) ? 1 : 0 } });
  }
  return out;
})();

/** 去抖：最近三拍取多数 */
const DEBOUNCE_SCRIPT: SeqStep[] = (() => {
  const hist = [0, 0, 0];
  const out: SeqStep[] = [];
  for (const raw of [0, 1, 0, 0, 1, 1, 1, 0, 0, 0]) {
    hist.shift();
    hist.push(raw);
    const maj = hist.filter((v) => v === 1).length >= 2 ? 1 : 0;
    out.push({ set: { raw }, expect: { stable: maj } });
  }
  return out;
})();

export const SEQ: Example[] = [
  {
    id: "dlatch-gate",
    name: "门级 D 锁存器",
    pack: "seq",
    tier: 3,
    blurb: "两个与非门交叉反馈：clk 高时跟随 d，低时锁住。",
    why: "存储的第一性原理——把输出接回输入，电路就有了「记忆」。它也是「组合环」唯一合法的用法：仿真器会做不动点迭代，而这里恰好收敛。",
    ports: { clk: "门控：1 时透明，0 时保持", d: "数据输入", q: "锁存的值" },
    src: `
      in clk 1
      in d 1
      out q 1
      nd = not d
      s = nand d clk
      r = nand nd clk
      q1 = nand s q2
      q2 = nand r q1
      q <- q1
    `,
    seq: [
      { set: { d: 0 }, expect: { q: 0 } },
      { set: { d: 1 }, expect: { q: 1 } },
      { set: { d: 0 }, expect: { q: 0 } },
      { set: { d: 1 }, expect: { q: 1 } },
    ],
    tags: ["记忆", "组合环"],
  },
  {
    id: "edge-detect",
    name: "上升沿检测",
    pack: "seq",
    tier: 3,
    blurb: "当前是 1、上一拍是 0 → 这一拍就是上升沿。",
    why: "把「事件」从「电平」里筛出来，是所有按键、串口起始位、中断触发的前提。它只用一个 D 触发器，却解决了一个真实世界的麻烦：电平会持续，事件只有一瞬。",
    ports: { clk: "时钟", sig: "被观察的信号", pulse: "sig 刚刚由 0 变 1 时为 1（只维持到下一个时钟沿）" },
    src: `
      in clk 1
      in sig 1
      out pulse 1
      d1 = dff clk sig
      n1 = not d1
      p = and sig n1
      pulse <- p
    `,
    seq: [
      { set: { sig: 0 }, at: { pulse: 0 }, expect: { pulse: 0 } },
      { set: { sig: 1 }, at: { pulse: 1 }, expect: { pulse: 0 } },
      { set: { sig: 1 }, at: { pulse: 0 }, expect: { pulse: 0 } },
      { set: { sig: 0 }, at: { pulse: 0 }, expect: { pulse: 0 } },
      { set: { sig: 1 }, at: { pulse: 1 }, expect: { pulse: 0 } },
    ],
    tags: ["事件", "按键"],
  },
  {
    id: "one-shot",
    name: "单脉冲发生器",
    pack: "seq",
    tier: 3,
    blurb: "按键按下的下一拍出一次高，第二拍就落下去。",
    why: "按一下只算一次——长按不会连发。这是「边沿触发」在交互上的直接价值，也是键盘、菜单、计数器按钮必须做的处理。",
    ports: { clk: "时钟", btn: "按键电平", y: "上升沿之后的下一拍输出一个高电平" },
    src: `
      in clk 1
      in btn 1
      out y 1
      d1 = dff clk btn
      d2 = dff clk d1
      n2 = not d2
      o = and d1 n2
      y <- o
    `,
    seq: [
      { set: { btn: 0 }, expect: { y: 0 } },
      { set: { btn: 1 }, expect: { y: 1 } },
      { set: { btn: 1 }, expect: { y: 0 } },
      { set: { btn: 1 }, expect: { y: 0 } },
      { set: { btn: 0 }, expect: { y: 0 } },
    ],
    tags: ["按键", "防连发"],
  },
  {
    id: "div2",
    name: "二分频器",
    pack: "seq",
    tier: 3,
    blurb: "T 触发器 + 恒 1：每来一个时钟沿就翻转一次。",
    why: "时钟分频是「用一条时钟造出多条时钟」的最简手段。它也解释了为什么 T 触发器只需要一个输入：翻转本身就是信息。",
    ports: { clk: "输入时钟", q: "输出方波，周期是输入的两倍" },
    src: `
      in clk 1
      out q 1
      one = const width=1 value=1
      t = tff clk one
      q <- t
    `,
    seq: DIV2_SCRIPT,
    tags: ["分频", "T 触发器"],
  },
  {
    id: "div4",
    name: "四分频器",
    pack: "seq",
    tier: 3,
    blurb: "两位计数器取高位：每 4 个时钟沿一个周期。",
    why: "分频链是定时器的心跳。注意它用的是**计数器取位**而不是「触发器的时钟接前一级的输出」——后者叫纹波时钟，会出现毛刺，是现代同步设计要避开的做法。",
    ports: { clk: "输入时钟", q: "4 分频方波（计数器最高位）" },
    src: `
      in clk 1
      out q 1
      one = const width=1 value=1
      zero = const width=1 value=0
      c = counter clk one zero width=2
      s = split c.out width=2
      q <- s.b1
    `,
    seq: DIV4_SCRIPT,
    tags: ["分频", "计数器"],
  },
  {
    id: "ring4",
    name: "4 位环形计数器",
    pack: "seq",
    tier: 3,
    blurb: "独热码绕着圈走：0001 → 0010 → 0100 → 1000。",
    why: "独热状态机比二进制编码多用触发器，但每个状态的译码只有一根线、没有竞争。FPGA 里的状态机大量用这个结构。",
    ports: { clk: "时钟", o0: "第 0 拍亮", o1: "第 1 拍亮", o2: "第 2 拍亮", o3: "第 3 拍亮" },
    src: `
      in clk 1
      out o0 1
      out o1 1
      out o2 1
      out o3 1
      one = const width=1 value=1
      zero = const width=1 value=0
      c = counter clk one zero width=2
      d = demux c.out n=4
      o0 <- d.o0
      o1 <- d.o1
      o2 <- d.o2
      o3 <- d.o3
    `,
    seq: RING_SCRIPT,
    tags: ["独热", "状态机"],
  },
  {
    id: "johnson4",
    name: "约翰逊计数器",
    pack: "seq",
    tier: 3,
    blurb: "末位取反接回首位：4 个触发器跑出 8 个状态。",
    why: "N 个触发器能表示 2^N 个状态，但约翰逊只用 N 个就绕出 2N 个、且相邻状态只变一位。旧式接口电路里常拿它当时序发生器。",
    ports: {
      clk: "时钟",
      q0: "第 0 位（最新移入，取反于 q3）",
      q1: "第 1 位",
      q2: "第 2 位",
      q3: "第 3 位（最旧）",
    },
    src: `
      in clk 1
      out q0 1
      out q1 1
      out q2 1
      out q3 1
      fb = not d3
      d0 = dff clk fb
      d1 = dff clk d0
      d2 = dff clk d1
      d3 = dff clk d2
      q0 <- d0
      q1 <- d1
      q2 <- d2
      q3 <- d3
    `,
    seq: JOHNSON_SCRIPT,
    tags: ["移位寄存器"],
  },
  {
    id: "mod10",
    name: "模 10 计数器",
    pack: "seq",
    tier: 3,
    blurb: "数到 9 就回到 0：一个计数器 + 一个比较器。",
    why: "「数到 N 归零」是秒表、分频、波特率发生器的共同骨架。它的精髓在于：计数器本身只会溢出回绕，是**比较器 + 复位**给了它模数。",
    ports: { clk: "时钟", out: "当前计数值 0..9" },
    src: `
      in clk 1
      out out 4
      one = const width=1 value=1
      zero = const width=1 value=0
      nine = const width=4 value=9
      c = counter clk one eq width=4
      e = cmp c.out nine
      let eq = e.eq
      out <- c.out
    `,
    seq: MOD10_SCRIPT,
    tags: ["计数器", "模数"],
  },
  {
    id: "pwm",
    name: "PWM 占空比发生器",
    pack: "seq",
    tier: 3,
    blurb: "计数器爬升，和 duty 比大小：小于就输出高。",
    why: "数字电路怎么调亮度、调转速、调音量？不是调电压，而是调「高电平占多少比例」。PWM 是数字世界模拟连续量的标准桥。",
    ports: { clk: "时钟", duty: "占空比 0..15（每 16 拍里高电平的拍数）", out: "PWM 波形", cnt: "当前计数值（便于观察锯齿）" },
    src: `
      in clk 1
      in duty 4
      out out 1
      out cnt 4
      one = const width=1 value=1
      zero = const width=1 value=0
      c = counter clk one zero width=4
      lt = cmp c.out duty
      out <- lt.lt
      cnt <- c.out
    `,
    seq: PWM_SCRIPT,
    tags: ["PWM", "调光"],
  },
  {
    id: "seq1011",
    name: "序列检测器（1011）",
    pack: "seq",
    tier: 3,
    blurb: "移位寄存器存最近四位，等它们凑成 1011 就报警。",
    why: "这是状态机的「暴力版」：不压缩状态，直接把历史摊开比对。它好懂、好改、好验证，位宽小的时候完全够用——而真状态机的化简，本质就是把这张表压到最少状态。",
    ports: { clk: "时钟", din: "串行输入位", hit: "最近四位正好是 1011" },
    src: `
      in clk 1
      in din 1
      out hit 1
      f0 = dff clk din
      f1 = dff clk f0
      f2 = dff clk f1
      f3 = dff clk f2
      n2 = not f2
      a1 = and f3 n2
      a2 = and a1 f1
      a3 = and a2 f0
      hit <- a3
    `,
    seq: SEQ1011_SCRIPT,
    tags: ["序列检测", "模式匹配"],
  },
  {
    id: "traffic",
    name: "交通灯状态机",
    pack: "seq",
    tier: 3,
    blurb: "红 → 绿 → 黄循环，en=0 时停在当前灯。",
    why: "状态机的最小可用形态：一个计数器记状态、一个译码器把状态变成输出。加上 en 之后它还能「暂停」——这是所有控制器都有的使能语义。",
    ports: { clk: "时钟", en: "1 = 继续走，0 = 停在当前状态", red: "红灯", green: "绿灯", yellow: "黄灯" },
    src: `
      in clk 1
      in en 1
      out red 1
      out green 1
      out yellow 1
      zero = const width=1 value=0
      two = const width=2 value=2
      s = counter clk en rst width=2
      e = cmp s.out two
      let rst = e.eq
      d = demux s.out n=3
      red <- d.o0
      green <- d.o1
      yellow <- d.o2
    `,
    seq: TRAFFIC_SCRIPT,
    tags: ["状态机", "控制器"],
  },
  {
    id: "sync2",
    name: "两级同步器",
    pack: "seq",
    tier: 3,
    blurb: "外部来的信号先进两个触发器，才允许给本时钟域使用。",
    why: "异步信号直接进逻辑会出现亚稳态——触发器可能停在 0 和 1 之间。两级同步器把「可能出错」压缩成「可能慢一拍」。每个跨时钟域接口的第一行代码都是它。",
    ports: { clk: "本地时钟", async_in: "异步输入（来自别的时钟域）", sync: "同步化后的值（延迟两拍）" },
    src: `
      in clk 1
      in async_in 1
      out sync 1
      f1 = dff clk async_in
      f2 = dff clk f1
      sync <- f2
    `,
    seq: SYNC2_SCRIPT,
    tags: ["跨时钟域", "亚稳态"],
  },
  {
    id: "hold-detect",
    name: "长按检测",
    pack: "seq",
    tier: 3,
    blurb: "连续 4 拍都按着才算长按，松手立刻清零。",
    why: "短按、长按、双击的区分全靠计数。这个案例把「时间」变成了「拍数」——硬件里没有秒，只有时钟周期。",
    ports: { clk: "时钟", btn: "按键电平", held: "已连续按住 ≥4 拍", count: "当前连续按住的拍数（0..7）" },
    src: `
      in clk 1
      in btn 1
      out held 1
      out count 3
      one = const width=1 value=1
      nbtn = not btn
      n4 = const width=3 value=4
      c = counter clk btn nbtn width=3
      e = cmp c.out n4
      ge = or e.eq e.gt
      held <- ge
      count <- c.out
    `,
    seq: HOLD_SCRIPT,
    tags: ["按键", "计时"],
  },
  {
    id: "pulse-stretch",
    name: "脉冲展宽器",
    pack: "seq",
    tier: 3,
    blurb: "一个 1 拍的尖脉冲，被拉成 4 拍宽。",
    why: "很多外设只认「持续足够久」的电平，而 CPU 给出的是一个时钟周期的写脉冲。展宽器就是这两者之间的翻译，也是「用一个计数器把离散事件铺成时间窗」的入门。",
    ports: { clk: "时钟", trig: "触发脉冲（可以只有 1 拍）", busy: "最近 4 拍内触发过就为 1" },
    src: `
      in clk 1
      in trig 1
      out busy 1
      f1 = dff clk trig
      f2 = dff clk f1
      f3 = dff clk f2
      f4 = dff clk f3
      o1 = or trig f1
      o2 = or o1 f2
      o3 = or o2 f3
      o4 = or o3 f4
      busy <- o4
    `,
    seq: STRETCH_SCRIPT,
    tags: ["脉冲", "外设"],
  },
  {
    id: "debounce",
    name: "三拍多数去抖",
    pack: "seq",
    tier: 3,
    blurb: "最近三拍里两拍是 1 才认 1：抖动被多数票吃掉。",
    why: "机械按键按下去的几毫秒里会弹跳十几次。软件延时去抖会卡住 CPU，硬件多数表决不会。这个案例把「可靠性」写成电路，也只有 4 个元件。",
    ports: { clk: "时钟", raw: "原始按键信号（带抖动）", stable: "去抖后的稳定电平" },
    src: `
      in clk 1
      in raw 1
      out stable 1
      d1 = dff clk raw
      d2 = dff clk d1
      d3 = dff clk d2
      a1 = and d1 d2
      a2 = and d2 d3
      a3 = and d1 d3
      o1 = or a1 a2
      o2 = or o1 a3
      stable <- o2
    `,
    seq: DEBOUNCE_SCRIPT,
    tags: ["去抖", "多数表决"],
  },
  {
    id: "regfile-4x8",
    name: "4×8 寄存器堆（1 写 1 读）",
    pack: "seq",
    tier: 3,
    blurb: "写口在时钟沿写，读口组合输出——CPU 寄存器文件的最小版。",
    why: "「读要快、写要稳」是寄存器堆的全部设计目标：读走组合逻辑，一拍内出结果；写走时钟沿，不会被毛刺写坏。四个寄存器 + 一个写译码 + 一个读多路，就是 CPU 里那 8 个寄存器的同一套结构。",
    ports: {
      clk: "写时钟",
      we: "写使能",
      waddr: "写地址（2 位 = 4 个寄存器）",
      wdata: "写入数据（8 位）",
      raddr: "读地址",
      rdata: "读出的数据（组合输出）",
    },
    src: `
      in clk 1
      in we 1
      in waddr 2
      in wdata 8
      in raddr 2
      out rdata 8
      d = demux waddr n=4
      l0 = and we d.o0
      l1 = and we d.o1
      l2 = and we d.o2
      l3 = and we d.o3
      r0 = reg clk l0 wdata
      r1 = reg clk l1 wdata
      r2 = reg clk l2 wdata
      r3 = reg clk l3 wdata
      m = mux raddr r0 r1 r2 r3
      rdata <- m
    `,
    seq: [
      { set: { we: 1, waddr: 1, wdata: 0x42, raddr: 0 }, expect: { rdata: 0 } },
      { set: { we: 0, raddr: 1 }, expect: { rdata: 0x42 } },
      { set: { we: 1, waddr: 2, wdata: 0x7f, raddr: 2 }, expect: { rdata: 0x7f } },
      { set: { we: 0, raddr: 2 }, expect: { rdata: 0x7f } },
      { set: { we: 0, raddr: 0 }, expect: { rdata: 0 } },
    ],
    tags: ["寄存器堆", "RAM"],
  },
];
