import type { Example } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 包四 · 总线与选择（10 个）
 * 宽线、窄线、多路、扩展、循环：数据在「一根线」和「一堆线」之间怎么搬。
 * ------------------------------------------------------------------ */

export const BUS: Example[] = [
  {
    id: "mux4x8",
    name: "四选一数据通路（8 位）",
    pack: "bus",
    tier: 2,
    blurb: "四路 8 位数据并排，两位选择码挑一路出去。",
    why: "总线上的数据永远是「多路来源、一个去处」。这一级选择器就是数据通路的十字路口——CPU 里寄存器读口、ALU 输入、写回通路各有一个。",
    ports: { s: "选择码 00..11", a: "第 0 路", b: "第 1 路", c: "第 2 路", d: "第 3 路", y: "选中的 8 位" },
    src: `
      in s 2
      in a 8
      in b 8
      in c 8
      in d 8
      out y 8
      m = mux s a b c d
      y <- m
    `,
    model: ({ s, a, b, c, d }) => ({ y: [a, b, c, d][s & 3] }),
    tags: ["数据通路"],
  },
  {
    id: "demux4x8",
    name: "一分四（未选中输出 0）",
    pack: "bus",
    tier: 2,
    blurb: "一路数据 + 两位目的地址：只有被选中的那一路拿到数据。",
    why: "写回通路就是这么工作的：ALU 结果只有一份，但要能写进 4 个不同的寄存器。没被选中的目的地必须拿到 0，而不是「保持旧值」——这里的门控就是这个语义。",
    ports: { s: "目的地址", d: "8 位数据", o0: "第 0 路输出", o1: "第 1 路输出", o2: "第 2 路输出", o3: "第 3 路输出" },
    src: `
      in s 2
      in d 8
      out o0 8
      out o1 8
      out o2 8
      out o3 8
      z = const width=8 value=0
      e = demux s n=4
      g0 = mux e.o0 z d
      g1 = mux e.o1 z d
      g2 = mux e.o2 z d
      g3 = mux e.o3 z d
      o0 <- g0
      o1 <- g1
      o2 <- g2
      o3 <- g3
    `,
    model: ({ s, d }) => ({
      o0: s === 0 ? d : 0,
      o1: s === 1 ? d : 0,
      o2: s === 2 ? d : 0,
      o3: s === 3 ? d : 0,
    }),
    tags: ["写回", "门控"],
  },
  {
    id: "byteswap",
    name: "字节交换",
    pack: "bus",
    tier: 2,
    blurb: "16 位里高字节和低字节对调。",
    why: "大端小端之争落到电路上就是这一行接线。网络协议用大端、x86 用小端，两边通话时必须有人做这件事——它便宜到只有一根线都不用，只需要换个接法。",
    ports: { w: "输入的 16 位", y: "高低字节互换后的 16 位" },
    src: `
      in w 16
      out y 16
      s = split w width=16
      m = merge s.b8 s.b9 s.b10 s.b11 s.b12 s.b13 s.b14 s.b15 s.b0 s.b1 s.b2 s.b3 s.b4 s.b5 s.b6 s.b7 width=16
      y <- m
    `,
    model: ({ w }) => ({ y: (((w & 0xff) << 8) | ((w >> 8) & 0xff)) & 0xffff }),
    tags: ["字节序"],
  },
  {
    id: "signext8-16",
    name: "符号扩展到 16 位",
    pack: "bus",
    tier: 2,
    blurb: "把 8 位的最高位复制 8 份填满高位：-1 还是 -1。",
    why: "有符号数变宽时必须做符号扩展，否则 -1（0xFF）会变成 255。处理器里的 lb/lh 指令就干这个，写错了就是那种「只有负数出错」的诡异 bug。",
    ports: { a: "8 位补码", y: "16 位补码，数值不变" },
    src: `
      in a 8
      out y 16
      s = split a width=8
      m = merge s.b0 s.b1 s.b2 s.b3 s.b4 s.b5 s.b6 s.b7 s.b7 s.b7 s.b7 s.b7 s.b7 s.b7 s.b7 s.b7 width=16
      y <- m
    `,
    model: ({ a }) => ({ y: (a & 0x80 ? 0xff00 | a : a) & 0xffff }),
    tags: ["符号扩展"],
  },
  {
    id: "zeroext8-16",
    name: "零扩展到 16 位",
    pack: "bus",
    tier: 2,
    blurb: "高位一律填 0：无符号数变宽。",
    why: "与符号扩展只差「填什么」，但对 0x80 以上的值结果完全不同。选错扩展方式，是汇编作业里最经典的一类错。",
    ports: { a: "8 位无符号数", y: "16 位无符号数" },
    src: `
      in a 8
      out y 16
      s = split a width=8
      z = const width=1 value=0
      m = merge s.b0 s.b1 s.b2 s.b3 s.b4 s.b5 s.b6 s.b7 z z z z z z z z width=16
      y <- m
    `,
    model: ({ a }) => ({ y: a & 0xffff }),
    tags: ["零扩展"],
  },
  {
    id: "shl4",
    name: "4 位移位器（0..3 位）",
    pack: "bus",
    tier: 3,
    blurb: "先算出三个「移好位」的候选值，再用一个四选一挑出来。",
    why: "这就是桶形移位器的全部思想：把移位量拆成「各移位一次」的候选，用选择器代替多次串行移位。4 位只要 2 级，32 位也只要 5 级。",
    ports: { a: "4 位输入", sh: "左移位数 0..3", y: "左移结果（低位补 0）" },
    src: `
      in a 4
      in sh 2
      out y 4
      s = split a width=4
      c0 = const width=1 value=0
      l1 = merge c0 s.b0 s.b1 s.b2 width=4
      l2 = merge c0 c0 s.b0 s.b1 width=4
      l3 = merge c0 c0 c0 s.b0 width=4
      m = mux sh a l1 l2 l3
      y <- m
    `,
    model: ({ a, sh }) => ({ y: (a << sh) & 15 }),
    tags: ["桶形移位"],
  },
  {
    id: "ror4",
    name: "4 位循环右移",
    pack: "bus",
    tier: 3,
    blurb: "移出去的那一位，从另一边补回来。",
    why: "循环移位在密码学里随处可见（AES、SHA 都在转）。它和普通右移只差「被移出的位去哪」——而这一点决定了信息不丢失。",
    ports: { a: "4 位输入", n: "循环右移位数 0..3", y: "结果" },
    src: `
      in a 4
      in n 2
      out y 4
      s = split a width=4
      r1 = merge s.b1 s.b2 s.b3 s.b0 width=4
      r2 = merge s.b2 s.b3 s.b0 s.b1 width=4
      r3 = merge s.b3 s.b0 s.b1 s.b2 width=4
      m = mux n a r1 r2 r3
      y <- m
    `,
    model: ({ a, n }) => {
      const k = n & 3;
      return { y: (((a >> k) | (a << (4 - k))) & 15) };
    },
    tags: ["循环移位", "密码学"],
  },
  {
    id: "bitselect8",
    name: "位选择器",
    pack: "bus",
    tier: 2,
    blurb: "8 位里按编号挑一位出来，编号 0..7。",
    why: "位图、标志寄存器、协议解析都要「取第 N 位」。它本质是一个 8 选 1，只不过每路只有 1 位宽——总线的宽度决定了选择器的形状。",
    ports: { a: "8 位数据", i: "位编号 0..7", bit: "被选中的那一位" },
    src: `
      in a 8
      in i 3
      out bit 1
      s = split a width=8
      m = mux i s.b0 s.b1 s.b2 s.b3 s.b4 s.b5 s.b6 s.b7
      bit <- m
    `,
    model: ({ a, i }) => ({ bit: (a >> (i & 7)) & 1 }),
    tags: ["位操作"],
  },
  {
    id: "arbiter4",
    name: "四路优先级仲裁",
    pack: "bus",
    tier: 3,
    blurb: "四路同时请求时，只授权编号最小的那一路。",
    why: "一条总线同一时刻只能有一个主人。仲裁器就是那个「谁先说话」的裁判。优先级仲裁是所有共享资源（内存总线、DMA、中断线）都必须有的公平性装置。",
    ports: { r0: "请求 0（最高优先级）", r1: "请求 1", r2: "请求 2", r3: "请求 3", g0: "授权 0", g1: "授权 1", g2: "授权 2", g3: "授权 3", any: "至少有一路在请求" },
    src: `
      in r0 1
      in r1 1
      in r2 1
      in r3 1
      out g0 1
      out g1 1
      out g2 1
      out g3 1
      out any 1
      n0 = not r0
      n1 = not r1
      n2 = not r2
      g0 <- r0
      a1 = and r1 n0
      g1 <- a1
      a2 = and r2 n0 n1
      g2 <- a2
      a3 = and r3 n0 n1 n2
      g3 <- a3
      o = or r0 r1 r2 r3
      any <- o
    `,
    cases: (() => {
      const out: { label: string; set: Record<string, number>; expect: Record<string, number> }[] = [];
      for (let v = 0; v < 16; v++) {
        const r = [v & 1, (v >> 1) & 1, (v >> 2) & 1, (v >> 3) & 1];
        const first = r.findIndex((x) => x === 1);
        out.push({
          label: `请求 ${r.join("")}`,
          set: { r0: r[0], r1: r[1], r2: r[2], r3: r[3] },
          expect: {
            g0: first === 0 ? 1 : 0,
            g1: first === 1 ? 1 : 0,
            g2: first === 2 ? 1 : 0,
            g3: first === 3 ? 1 : 0,
            any: first >= 0 ? 1 : 0,
          },
        });
      }
      return out;
    })(),
    tags: ["仲裁", "16 组穷举"],
  },
  {
    id: "addrmux",
    name: "下一地址多路",
    pack: "bus",
    tier: 3,
    blurb: "下一个取指地址：要么 PC+1，要么跳转目标。",
    why: "CPU 每拍都要回答「下一条指令在哪」。这个二选一就是取指阶段的核心决策点，也是所有分支预测硬件试图提前猜的那一位。",
    ports: { sel: "0 = 顺序执行（PC+1），1 = 跳转", pc: "顺序地址", tgt: "跳转目标", addr: "真正送进存储器的地址" },
    src: `
      in sel 1
      in pc 8
      in tgt 8
      out addr 8
      m = mux sel pc tgt
      addr <- m
    `,
    model: ({ sel, pc, tgt }) => ({ addr: sel ? tgt : pc }),
    tags: ["取指"],
  },
];
