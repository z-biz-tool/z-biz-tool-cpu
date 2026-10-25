import type { Example, SeqStep } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 包五 · 存储与介质（12 个）
 * 从 RAM/ROM 到电容、浮栅、盘片：这一包大多是「存储书的物理模型」。
 * 每个案例都把「代价」摆出来——漏电要刷新、写要脉宽、寻道要拍数。
 * ------------------------------------------------------------------ */

/** 磁盘读：磁头每拍转一格、step=1 时向目标磁道挪一道 */
const DISK_SCRIPT: SeqStep[] = (() => {
  const data = [
    0x11, 0x12, 0x13, 0x14, 0x21, 0x22, 0x23, 0x24, 0x31, 0x32, 0x33, 0x34, 0x41, 0x42, 0x43, 0x44,
  ];
  let trk = 0;
  let rot = 0;
  const out: SeqStep[] = [];
  const plan: { tgt: number; step: number; rd: number }[] = [
    { tgt: 2, step: 1, rd: 1 },
    { tgt: 2, step: 1, rd: 1 },
    { tgt: 2, step: 1, rd: 1 },
    { tgt: 2, step: 0, rd: 1 },
    { tgt: 0, step: 1, rd: 1 },
    { tgt: 0, step: 0, rd: 1 },
  ];
  for (const p of plan) {
    rot = (rot + 1) % 4;
    if (p.step) trk += Math.sign(p.tgt - trk);
    out.push({
      set: { tgt: p.tgt, step: p.step, rd: p.rd },
      expect: { trk, rot, q: p.rd ? data[trk * 4 + rot] : 0 },
    });
  }
  return out;
})();

/** 刷新控制器：每 window 拍走到下一行 */
const REFRESH_SCRIPT: SeqStep[] = (() => {
  let row = 0;
  let n = 0;
  const out: SeqStep[] = [];
  for (let i = 0; i < 8; i++) {
    n++;
    if (n >= 2) {
      n = 0;
      row = (row + 1) % 8;
    }
    out.push({ expect: { row } });
  }
  return out;
})();

export const MEM: Example[] = [
  {
    id: "ram16x8",
    name: "16×8 RAM（单口读写）",
    pack: "mem",
    tier: 3,
    blurb: "一个地址、一条数据线：写要时钟沿，读是组合的。",
    why: "单口 RAM 的读写抢同一个地址口——这正是真实存储器的形状。看懂「读快写慢、地址只有一个」，你就明白为什么 CPU 里要有独立的指令/数据通路，以及为什么 DMA 会和 CPU 抢总线。",
    ports: { clk: "写时钟", we: "写使能（1 = 在这个沿写入）", addr: "地址 0..15", din: "写入数据", dout: "该地址当前内容（组合读出）" },
    src: `
      in clk 1
      in we 1
      in addr 4
      in din 8
      out dout 8
      m = ram clk we addr din width=8 addrBits=4
      dout <- m.dout
    `,
    seq: [
      { set: { we: 1, addr: 3, din: 0x55 }, expect: { dout: 0x55 } },
      { set: { we: 0, addr: 3 }, expect: { dout: 0x55 } },
      { set: { we: 1, addr: 9, din: 0xaa }, expect: { dout: 0xaa } },
      { set: { we: 0, addr: 9 }, expect: { dout: 0xaa } },
      { set: { we: 0, addr: 3 }, expect: { dout: 0x55 } },
    ],
    tags: ["RAM", "单口"],
  },
  {
    id: "romlut",
    name: "查找表（统计 4 位里几个 1）",
    pack: "mem",
    tier: 3,
    blurb: "任意函数都可以烧成一张表：输入当地址，输出当数据。",
    why: "LUT 是 FPGA 的基本单元，也是「用存储实现计算」的通用办法。popcount 这种没有简洁布尔式的函数，查表反而最快。",
    ports: { a: "4 位输入", y: "其中 1 的个数（0..4）" },
    src: `
      in a 4
      out y 8
      r = rom a width=8 addrBits=4 data="0 1 1 2 1 2 2 3 1 2 2 3 2 3 3 4"
      y <- r
    `,
    model: ({ a }) => ({ y: [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4][a] }),
    tags: ["LUT", "popcount"],
  },
  {
    id: "romchars",
    name: "字符发生器 ROM",
    pack: "mem",
    tier: 3,
    blurb: "地址 0..9 对应 HELLO,Z16! 的 ASCII 码。",
    why: "「把字模/字符串烧进 ROM」是显示器的第一课。点阵字库本质就是同一个结构：地址是字符编号，数据是点阵行。",
    ports: { a: "字符编号 0..9", y: "该字符的 ASCII 码" },
    src: `
      in a 4
      out y 8
      r = rom a width=8 addrBits=4 data="0x48 0x45 0x4C 0x4C 0x4F 0x2C 0x5A 0x31 0x36 0x21 0x20 0x20 0x20 0x20 0x20 0x20"
      y <- r
    `,
    model: ({ a }) => ({ y: [0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x2c, 0x5a, 0x31, 0x36, 0x21, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20][a] }),
    tags: ["字符", "ROM"],
  },
  {
    id: "stack",
    name: "栈（栈指针 + RAM）",
    pack: "mem",
    tier: 3,
    blurb: "push 先写当前槽位再自增；pop 先自减，读出来的就是新栈顶。",
    why: "函数调用、局部变量、返回地址全靠它。注意 sp 指向「下一个空槽」——这个约定比「指向栈顶」少一次地址运算，也是很多真实 ISA 的选择。",
    ports: {
      clk: "时钟",
      push: "压栈（写 din 到 mem[sp]，然后 sp+1）",
      pop: "出栈（sp-1，dout 随即显示新栈顶）",
      din: "压入的数据",
      dout: "mem[sp] 的内容：pop 之后就是新栈顶",
      sp: "栈指针（= 已压入的元素个数）",
      empty: "栈空（sp = 0）",
    },
    src: `
      in clk 1
      in push 1
      in pop 1
      in din 8
      out dout 8
      out sp 4
      out empty 1
      one = const width=4 value=1
      inc = add sph one
      dec = sub sph one
      t1 = mux push sph inc.sum
      dn = mux pop t1 dec.diff
      load = or push pop
      sph = reg clk load dn width=4
      m = ram clk push sph din width=8 addrBits=4
      zero = const width=4 value=0
      e = cmp sph zero
      dout <- m.dout
      sp <- sph
      empty <- e.eq
    `,
    seq: [
      { set: { push: 1, pop: 0, din: 0x11 }, expect: { sp: 1, dout: 0, empty: 0 } },
      { set: { push: 1, pop: 0, din: 0x22 }, expect: { sp: 2, dout: 0, empty: 0 } },
      { set: { push: 0, pop: 1 }, expect: { sp: 1, dout: 0x22 } },
      { set: { push: 0, pop: 1 }, expect: { sp: 0, dout: 0x11, empty: 1 } },
      { set: { push: 0, pop: 0 }, expect: { sp: 0, dout: 0x11, empty: 1 } },
    ],
    tags: ["栈", "栈指针"],
  },
  {
    id: "dram-cell",
    name: "DRAM 单元（1T1C）",
    pack: "mem",
    tier: 4,
    blurb: "一个电容存一个电平：不刷新就会漏掉。",
    why: "内存不是「一直记得」，而是「一直在漏、一直在补」。把 leakN 改小，你能亲眼看到数据在几拍之内烂掉——这就是为什么 DRAM 必须每隔 64ms 把所有行刷一遍。",
    ports: { clk: "字线时钟", we: "写使能（EN=1 时在时钟沿采样位线）", d: "写入的位", q: "电容当前电平：0 / 1 / 2 对应 GND / VDD2 / VDD" },
    src: `
      in clk 1
      in we 1
      in d 1
      out q 2
      z = const width=1 value=0
      bl = merge z d width=2
      cell = CAPCELL we clk bl leakN=3
      q <- cell.Q
    `,
    seq: [
      { set: { we: 1, d: 1 }, expect: { q: 2 } },
      { set: { we: 0, d: 0 }, ticks: 2, expect: { q: 2 } },
      { ticks: 1, expect: { q: 1 } },
      { ticks: 3, expect: { q: 0 } },
      { set: { we: 1, d: 1 }, expect: { q: 2 } },
    ],
    tags: ["DRAM", "漏电"],
  },
  {
    id: "dram-sense",
    name: "感应放大器",
    pack: "mem",
    tier: 4,
    blurb: "位线上的半电平，被放大成满幅 0/1 才能被数字电路采信。",
    why: "电容只有几十飞法，读出来的信号只有几十毫伏。感应放大器把这点差别放大成满幅——它是 DRAM 里唯一「模拟」的那一环，也是读操作必须先预充电的原因。",
    ports: { clk: "时钟", bl: "位线电平 0/1/2（GND / VDD2 / VDD）", se: "感应使能", q: "放大后的电平（满幅 0 或 2）", half: "单元里的原始电平" },
    src: `
      in clk 1
      in bl 2
      in se 1
      out q 2
      out half 2
      one = const width=1 value=1
      cell = CAPCELL one clk bl leakN=16
      sa = SENSEAMP cell.Q se
      q <- sa.OUT
      half <- cell.Q
    `,
    seq: [
      { set: { bl: 1, se: 1 }, expect: { half: 1, q: 2 } },
      { set: { bl: 3, se: 1 }, expect: { half: 2, q: 2 } },
      { set: { bl: 0, se: 1 }, expect: { half: 0, q: 0 } },
      { set: { bl: 0, se: 0 }, expect: { q: 1 } },
    ],
    tags: ["DRAM", "模拟"],
  },
  {
    id: "dram-refresh",
    name: "刷新控制器",
    pack: "mem",
    tier: 4,
    blurb: "每 window 拍轮询到下一行，把 64ms 离散成拍数。",
    why: "8 行 8 个窗口，就是一个「行地址扫描器」。真实 DRAM 是 8192 行、64ms 扫完，于是每行 7.8µs 就得刷一次——这些数字决定了内存控制器的面积和功耗。",
    ports: { clk: "时钟", rst: "复位到第 0 行", row: "当前该刷新的行号" },
    src: `
      in clk 1
      in rst 1
      out row 3
      r = REFCTRL clk rst addrBits=3 window=2
      row <- r.ROW
    `,
    seq: REFRESH_SCRIPT,
    tags: ["DRAM", "刷新"],
  },
  {
    id: "flash-cell",
    name: "浮栅单元（写慢、擦成块、有寿命）",
    pack: "mem",
    tier: 4,
    blurb: "编程要连续 2 拍脉宽，擦除 1 拍就够，每次擦除记一次 P/E。",
    why: "为什么 SSD 写久了会坏？因为浮栅每次擦写都会在氧化层上留一道伤。P/E 超过上限，这个单元就废了——这不是软件抽象，是物理事实。",
    ports: { clk: "时钟", prog: "编程脉冲（要持续 programTicks 拍才置 0）", erase: "擦除（上升沿置 1，并计一次 P/E）", q: "存储位", pe: "已用 P/E 次数", bad: "P/E 超过寿命上限" },
    src: `
      in clk 1
      in prog 1
      in erase 1
      out q 1
      out pe 8
      out bad 1
      f = FGCELL clk prog erase programTicks=2 peLimit=3
      q <- f.Q
      pe <- f.PE
      bad <- f.STS
    `,
    seq: [
      { set: { erase: 1, prog: 0 }, expect: { q: 1, pe: 1, bad: 0 } },
      { set: { erase: 0, prog: 1 }, ticks: 1, expect: { q: 1 } },
      { ticks: 1, expect: { q: 0 } },
      { set: { prog: 0 }, expect: { q: 0 } },
      { set: { erase: 1 }, expect: { q: 1, pe: 2 } },
      { set: { erase: 0 }, expect: { q: 1 } },
      { set: { erase: 1 }, expect: { pe: 3, bad: 0 } },
      { set: { erase: 0 }, expect: { pe: 3 } },
      { set: { erase: 1 }, expect: { pe: 4, bad: 1 } },
    ],
    tags: ["Flash", "寿命"],
  },
  {
    id: "disk-seek",
    name: "磁盘寻道（磁头 + 盘面）",
    pack: "mem",
    tier: 4,
    blurb: "盘面每拍转一格，step=1 时磁头每拍挪一道。",
    why: "机械硬盘的延迟不是因为「数据难找」，而是因为物理运动：寻道要挪磁头、旋转要等扇区转过来。把延迟写成拍数，你就能算清楚为什么随机读比顺序读慢两个数量级。",
    ports: { clk: "时钟", tgt: "目标磁道", step: "磁头步进使能", trk: "当前磁道", rot: "当前扇区（每拍 +1）" },
    src: `
      in clk 1
      in tgt 2
      in step 1
      out trk 8
      out rot 8
      zero = const width=1 value=0
      p = PLATTER clk tgt step zero addrBits=2 sectors=4 data="0x11 0x12 0x13 0x14 0x21 0x22 0x23 0x24 0x31 0x32 0x33 0x34 0x41 0x42 0x43 0x44"
      trk <- p.TRK
      rot <- p.ROT
    `,
    seq: DISK_SCRIPT.map((s) => ({ set: s.set, expect: { trk: s.expect!.trk, rot: s.expect!.rot } })),
    tags: ["磁盘", "寻道"],
  },
  {
    id: "disk-read",
    name: "磁盘读扇区",
    pack: "mem",
    tier: 4,
    blurb: "磁头下压着什么就读什么：读到的值取决于磁道和扇区的当前相位。",
    why: "同一个逻辑地址，读两次可能拿到不同的中间结果——因为你没等到正确的时机。这就是「时序」在存储里的本色：数据不是被取出来的，是被「转过来」的。",
    ports: { clk: "时钟", tgt: "目标磁道", step: "磁头步进", rd: "读使能", q: "磁头下方扇区的内容", trk: "当前磁道", rot: "当前扇区" },
    src: `
      in clk 1
      in tgt 2
      in step 1
      in rd 1
      out q 8
      out trk 8
      out rot 8
      p = PLATTER clk tgt step rd addrBits=2 sectors=4 data="0x11 0x12 0x13 0x14 0x21 0x22 0x23 0x24 0x31 0x32 0x33 0x34 0x41 0x42 0x43 0x44"
      q <- p.Q
      trk <- p.TRK
      rot <- p.ROT
    `,
    seq: DISK_SCRIPT,
    tags: ["磁盘", "读扇区"],
  },
  {
    id: "cache-tag",
    name: "Cache 标签比较",
    pack: "mem",
    tier: 4,
    blurb: "写进去的标签 vs 这次要访存的标签：相等且有效才算命中。",
    why: "缓存的全部魔法就是「先比较，再决定要不要去主存取」。有效位是为了区分「空行」和「标签恰好是 0 的行」——少了它，冷启动第一次访问就会假命中。",
    ports: { clk: "时钟", we: "写入标签（同时把有效位置 1）", tag_in: "本次访问的标签", hit: "命中（有效且标签相等）", tag_out: "当前存着的标签" },
    src: `
      in clk 1
      in we 1
      in tag_in 4
      out hit 1
      out tag_out 4
      t = reg clk we tag_in width=4
      vs = or v we
      v = dff clk vs
      c = cmp tag_in t
      o = and v c.eq
      hit <- o
      tag_out <- t
    `,
    seq: [
      { set: { we: 0, tag_in: 5 }, expect: { hit: 0, tag_out: 0 } },
      { set: { we: 1, tag_in: 5 }, expect: { hit: 1, tag_out: 5 } },
      { set: { we: 0, tag_in: 5 }, expect: { hit: 1 } },
      { set: { we: 0, tag_in: 6 }, expect: { hit: 0 } },
      { set: { we: 1, tag_in: 9 }, expect: { hit: 1, tag_out: 9 } },
    ],
    tags: ["Cache", "命中"],
  },
  {
    id: "mem-map",
    name: "存储映射（RAM / ROM 二选一）",
    pack: "mem",
    tier: 3,
    blurb: "地址最高位当片选：高半区走 ROM，低半区走 RAM。",
    why: "「地址空间」不是抽象概念，而是最高几位接到哪个片选脚。看懂这一根线，你就懂为什么程序段放在 0x0000、栈放在高地址、以及为什么野指针会踩到别的设备。",
    ports: { addr: "8 位地址", ram_d: "RAM 的输出", rom_d: "ROM 的输出", d: "按地址选中的那一路数据", from_rom: "这次访问落在 ROM 区" },
    src: `
      in addr 8
      in ram_d 8
      in rom_d 8
      out d 8
      out from_rom 1
      s = split addr width=8
      m = mux s.b7 ram_d rom_d
      d <- m
      from_rom <- s.b7
    `,
    model: ({ addr, ram_d, rom_d }) => ({ d: addr & 0x80 ? rom_d : ram_d, from_rom: addr & 0x80 ? 1 : 0 }),
    tags: ["地址空间", "片选"],
  },
];
