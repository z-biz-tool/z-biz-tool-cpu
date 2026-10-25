import type { Example, SeqStep } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 包七 · 显示与协议（10 个）
 * 把电平变成人能读的东西，把并行的位变成一根线上的串行流，
 * 以及两件「保证没传错」的工具：CRC 与汉明码。
 * ------------------------------------------------------------------ */

const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

/** 汉明(7,4)：p1=c0, p2=c1, d1=c2, p4=c3, d2=c4, d3=c5, d4=c6 */
function hamming(d: number): number {
  const d1 = d & 1;
  const d2 = (d >> 1) & 1;
  const d3 = (d >> 2) & 1;
  const d4 = (d >> 3) & 1;
  const p1 = d1 ^ d2 ^ d4;
  const p2 = d1 ^ d3 ^ d4;
  const p4 = d2 ^ d3 ^ d4;
  return p1 | (p2 << 1) | (d1 << 2) | (p4 << 3) | (d2 << 4) | (d3 << 5) | (d4 << 6);
}

/** CRC-8（poly 0x07）逐位模型 */
function crc8Step(crc: number, bit: number): number {
  const fb = (bit ^ ((crc >> 7) & 1)) & 1;
  return (((crc << 1) & 0xff) ^ (fb ? 0x07 : 0)) & 0xff;
}

/** 串口发送：LSB 先出，每拍移一位 */
const UART_SCRIPT: SeqStep[] = (() => {
  const byte = 0x41; // 'A' = 0b0100_0001
  const out: SeqStep[] = [{ set: { load: 1, din: byte }, expect: { tx: byte & 1 } }];
  for (let i = 1; i < 8; i++) {
    out.push({ set: { load: 0 }, expect: { tx: (byte >> i) & 1 } });
  }
  out.push({ expect: { tx: 0 } });
  return out;
})();

/** 动态扫描：一拍左位、一拍右位 */
const SCAN_SCRIPT: SeqStep[] = (() => {
  const out: SeqStep[] = [];
  let com = 0;
  for (let i = 0; i < 4; i++) {
    com = (com + 1) & 1;
    out.push({
      set: { d0: 3, d1: 7 },
      expect: { com, seg: SEG[com ? 7 : 3] },
    });
  }
  return out;
})();

/** 计数显示：0..9 循环，段码跟着走 */
const COUNT_SCRIPT: SeqStep[] = (() => {
  let c = 0;
  const out: SeqStep[] = [];
  for (let i = 0; i < 12; i++) {
    c = (c + 1) % 10;
    out.push({ expect: { cnt: c, seg: SEG[c] } });
  }
  return out;
})();

/** CRC-8 逐位喂 0x41 */
const CRC_SCRIPT: SeqStep[] = (() => {
  const out: SeqStep[] = [{ set: { rst: 1, bit_in: 0 }, expect: { crc: 0 } }];
  let crc = 0;
  const byte = 0x41;
  for (let i = 7; i >= 0; i--) {
    const bit = (byte >> i) & 1;
    crc = crc8Step(crc, bit);
    out.push({ set: { rst: 0, bit_in: bit }, expect: { crc } });
  }
  return out;
})();

export const IO: Example[] = [
  {
    id: "chardisp",
    name: "字符终端输出",
    pack: "io",
    tier: 2,
    blurb: "把 8 位 ASCII 码打印到运行日志，同时原样送出。",
    why: "「让程序说话」是调试的第一需要。这个案例把 print 元件当成 CPU 的一个外设：写一次就打印一个字符——串口、printf、日志系统的同一件事。",
    ports: { clk: "时钟", en: "使能（上升沿且 en=1 时打印）", code: "ASCII 码", d: "直通输出（可接到别处）" },
    src: `
      in clk 1
      in en 1
      in code 8
      out d 8
      p = print clk en code radix=char
      d <- code
    `,
    seq: [
      { set: { en: 1, code: 0x48 }, expect: { d: 0x48 } },
      { set: { en: 0, code: 0x69 }, expect: { d: 0x69 } },
    ],
    tags: ["print", "调试"],
  },
  {
    id: "hex-log",
    name: "十六进制日志",
    pack: "io",
    tier: 2,
    blurb: "把 4 位值按十六进制打到日志里。",
    why: "调试寄存器时人看的是 0x1F 而不是 11111。同一个值换一种进制，认知负担差十倍——这就是为什么每个调试器都提供 radix 切换。",
    ports: { clk: "时钟", en: "打印使能", v: "4 位值", d: "直通输出" },
    src: `
      in clk 1
      in en 1
      in v 4
      out d 4
      p = print clk en v radix=hex
      d <- v
    `,
    seq: [
      { set: { en: 1, v: 0xa }, expect: { d: 0xa } },
      { set: { en: 0, v: 0x3 }, expect: { d: 0x3 } },
    ],
    tags: ["print", "进制"],
  },
  {
    id: "led-chase",
    name: "流水灯",
    pack: "io",
    tier: 3,
    blurb: "一位亮着往前跑，跑到头再绕回来。",
    why: "循环左移 + 一个寄存器，是「把时钟变成可见的节奏」的最短路径。它也是移位寄存器最好的入门——你能一眼看出每一位去了哪里。",
    ports: { clk: "时钟", rst: "复位到只有最低位亮", led: "8 位灯带" },
    src: `
      in clk 1
      in rst 1
      out led 8
      r = reg clk one nxt width=8
      s = split r width=8
      rot = merge s.b7 s.b0 s.b1 s.b2 s.b3 s.b4 s.b5 s.b6 width=8
      one8 = const width=8 value=1
      nxt = mux rst rot one8
      one = const width=1 value=1
      led <- r
    `,
    seq: (() => {
      const out: SeqStep[] = [{ set: { rst: 1 }, expect: { led: 1 } }];
      let v = 1;
      for (let i = 0; i < 8; i++) {
        v = ((v << 1) | (v >> 7)) & 0xff;
        out.push({ set: { rst: 0 }, expect: { led: v } });
      }
      return out;
    })(),
    tags: ["移位", "灯效"],
  },
  {
    id: "led-bar",
    name: "电平条（掩码表）",
    pack: "io",
    tier: 2,
    blurb: "输入 0..8，输出「前 N 位亮」的掩码。",
    why: "音量条、进度条、电池格数全是这个查表。它的意义在于：人眼读「有几位亮」比读「二进制数」快得多。",
    ports: { n: "亮的格数 0..8", bar: "灯带掩码" },
    src: `
      in n 4
      out bar 8
      r = rom n width=8 addrBits=4 data="0 1 3 7 15 31 63 127 255 255 255 255 255 255 255 255"
      bar <- r
    `,
    model: ({ n }) => ({ bar: n >= 8 ? 255 : (1 << n) - 1 }),
    tags: ["查表", "显示"],
  },
  {
    id: "uart-tx",
    name: "串口发送（移位寄存器）",
    pack: "io",
    tier: 3,
    blurb: "8 位并行数据每拍右移一位，最低位从 tx 出去。",
    why: "「并行变串行」只需要一个移位寄存器。真实 UART 在它外面再包一层起始位和停止位，本质没变——所以看懂这 5 个元件，你就看懂了波特率、LSB-first、以及为什么串口要约定速率。",
    ports: { clk: "时钟", load: "装载新字节", din: "要发送的字节", tx: "串行输出（LSB 先出）" },
    src: `
      in clk 1
      in load 1
      in din 8
      out tx 1
      r = reg clk one nxt width=8
      one5 = const width=5 value=1
      sh = shift r one5 dir=right
      nxt = mux load sh din
      s = split r width=8
      one = const width=1 value=1
      tx <- s.b0
    `,
    seq: UART_SCRIPT,
    tags: ["串口", "移位寄存器"],
  },
  {
    id: "crc8",
    name: "CRC-8 校验",
    pack: "io",
    tier: 4,
    blurb: "每来一位：左移、溢出位回卷、按多项式异或。",
    why: "串口、以太网、ZIP、SSD 全在用 CRC。它比「求和校验」强的地方是：任何单比特错误一定能被发现，而加法校验对换位错误无能为力。",
    ports: { clk: "时钟", bit_in: "串行输入位", rst: "清零", crc: "当前 CRC（每拍更新）" },
    src: `
      in clk 1
      in bit_in 1
      in rst 1
      out crc 8
      r = reg clk one nxt2 width=8
      s = split r width=8
      let msb = s.b7
      fb = xor bit_in msb
      poly = const width=8 value=7
      z8 = const width=8 value=0
      mask = mux fb z8 poly
      one5 = const width=5 value=1
      sh = shift r one5 dir=left
      x = xor sh mask
      nxt2 = mux rst x z8
      one = const width=1 value=1
      crc <- r
    `,
    seq: CRC_SCRIPT,
    tags: ["CRC", "校验"],
  },
  {
    id: "hamming-encode",
    name: "汉明码编码（7,4）",
    pack: "io",
    tier: 4,
    blurb: "4 位数据 + 3 位校验，插在 1/2/4 三个位置上。",
    why: "CRC 能发现错误，汉明码还能**指出哪一位错了**并当场纠正。ECC 内存就是每个字节多存 5 位，换来「单位翻转自愈」。",
    ports: { d: "4 位数据", code: "7 位码字（c0..c6 依次为 p1 p2 d1 p4 d2 d3 d4）" },
    src: `
      in d 4
      out code 7
      sd = split d width=4
      p1 = xor sd.b0 sd.b1 sd.b3
      p2 = xor sd.b0 sd.b2 sd.b3
      p4 = xor sd.b1 sd.b2 sd.b3
      m = merge p1 p2 sd.b0 p4 sd.b1 sd.b2 sd.b3 width=7
      code <- m
    `,
    model: ({ d }) => ({ code: hamming(d) }),
    tags: ["汉明码", "ECC"],
  },
  {
    id: "hamming-check",
    name: "汉明码检错（定位错误位）",
    pack: "io",
    tier: 4,
    blurb: "三组校验各自算一次：哪个组合不对，错的就是第几位。",
    why: "这是「用 3 个比特编码 7 种可能」的经典设计：综合征的值直接就是出错位置的下标。硬件纠错之所以便宜，是因为它不需要搜索。",
    ports: { code: "7 位码字", err: "出错位号（0 = 没错）", ok: "无错" },
    src: `
      in code 7
      out err 3
      out ok 1
      sc = split code width=7
      s1 = xor sc.b0 sc.b2 sc.b4 sc.b6
      s2 = xor sc.b1 sc.b2 sc.b5 sc.b6
      s4 = xor sc.b3 sc.b4 sc.b5 sc.b6
      m = merge s1 s2 s4 width=3
      z = const width=3 value=0
      c = cmp m z
      err <- m
      ok <- c.eq
    `,
    model: ({ code }) => {
      const b = [0, 1, 2, 3, 4, 5, 6].map((i) => (code >> i) & 1);
      const s1 = b[0] ^ b[2] ^ b[4] ^ b[6];
      const s2 = b[1] ^ b[2] ^ b[5] ^ b[6];
      const s4 = b[3] ^ b[4] ^ b[5] ^ b[6];
      const err = s1 | (s2 << 1) | (s4 << 2);
      return { err, ok: err === 0 ? 1 : 0 };
    },
    tags: ["汉明码", "纠错"],
  },
  {
    id: "seg-scan",
    name: "数码管动态扫描",
    pack: "io",
    tier: 3,
    blurb: "两路数据轮流上同一组段码线，靠 com 快速切换。",
    why: "为什么要「扫描」？因为段码线太贵——8 位数码管若都直连要 64 根线，扫描只要 8 + 8 根。代价是每位数只能亮 1/8 时间，亮度靠人眼暂留补上。",
    ports: { clk: "时钟", d0: "左位数字", d1: "右位数字", seg: "七段码", com: "当前亮的是哪一位（0 左 / 1 右）" },
    src: `
      in clk 1
      in d0 4
      in d1 4
      out seg 7
      out com 1
      one = const width=1 value=1
      t = tff clk one
      v = mux t d0 d1
      r = rom v width=7 addrBits=4 data="0x3F 0x06 0x5B 0x4F 0x66 0x6D 0x7D 0x07 0x7F 0x6F 0x77 0x7C 0x39 0x5E 0x79 0x71"
      seg <- r
      com <- t
    `,
    seq: SCAN_SCRIPT,
    tags: ["数码管", "扫描"],
  },
  {
    id: "count-display",
    name: "计数显示器",
    pack: "io",
    tier: 3,
    blurb: "0..9 循环计数，直接译成七段码显示。",
    why: "计数器 + 译码器 + 显示器 = 一块秒表。把这三个模块连起来，你就有了第一个「自己会动的仪器」，也是所有实验箱上第一个做成的作品。",
    ports: { clk: "时钟", cnt: "当前数字 0..9", seg: "七段码" },
    src: `
      in clk 1
      out cnt 4
      out seg 7
      one = const width=1 value=1
      zero = const width=1 value=0
      nine = const width=4 value=9
      c = counter clk one rst width=4
      e = cmp c.out nine
      let rst = e.eq
      r = rom c.out width=7 addrBits=4 data="0x3F 0x06 0x5B 0x4F 0x66 0x6D 0x7D 0x07 0x7F 0x6F 0x77 0x7C 0x39 0x5E 0x79 0x71"
      cnt <- c.out
      seg <- r
    `,
    seq: COUNT_SCRIPT,
    tags: ["计数", "显示"],
  },
];
