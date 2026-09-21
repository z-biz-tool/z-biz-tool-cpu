import { CONDS, OP, OPS, PORT_IN, PORT_OUT, REG_NAMES, SYS, SYSS, decodeOp, encode, opInfo } from "./isa.ts";

/* ------------------------------------------------------------------ *
 * Z16 汇编器 / 反汇编器
 * ------------------------------------------------------------------ */

export interface ListingLine {
  addr: number;
  word: number;
  text: string;
  src: string;
}

export interface AsmResult {
  words: number[];
  base: number;
  errors: string[];
  symbols: Record<string, number>;
  listing: ListingLine[];
}

interface Ctx {
  errors: string[];
  line: number;
  symbols: Record<string, number>;
}

function fail(ctx: Ctx, msg: string) {
  ctx.errors.push(`第 ${ctx.line} 行：${msg}`);
}

/* ------------------------- 表达式求值 ------------------------- */

type Tok = { t: "num" | "id" | "op" | "str"; v: string; n?: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\") {
          const esc = src[j + 1];
          s += esc === "n" ? "\n" : esc === "r" ? "\r" : esc === "t" ? "\t" : esc === "0" ? "\0" : esc;
          j += 2;
        } else s += src[j++];
      }
      out.push({ t: quote === "'" ? "num" : "str", v: s, n: quote === "'" ? s.charCodeAt(0) || 0 : undefined });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9a-fA-FxXbBoO._]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      out.push({ t: "num", v: raw, n: parseNum(raw) });
      i = j;
      continue;
    }
    if (/[A-Za-z_.#@]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<<", ">>", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    out.push({ t: "op", v: ch });
    i++;
  }
  return out;
}

export function parseNum(raw: string): number {
  const s = raw.trim().replace(/_/g, "");
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s.slice(2), 16);
  if (/^0b[01]+$/i.test(s)) return parseInt(s.slice(2), 2);
  if (/^0o[0-7]+$/i.test(s)) return parseInt(s.slice(2), 8);
  if (/^\$[0-9a-f]+$/i.test(s)) return parseInt(s.slice(1), 16);
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

class Expr {
  private pos = 0;
  private toks: Tok[];
  private ctx: Ctx;
  constructor(toks: Tok[], ctx: Ctx) {
    this.toks = toks;
    this.ctx = ctx;
  }

  eval(): number {
    const v = this.bitOr();
    if (this.pos < this.toks.length) fail(this.ctx, `表达式多余内容 "${this.toks[this.pos].v}"`);
    return v;
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private eatOp(...ops: string[]): string | undefined {
    const t = this.peek();
    if (t && t.t === "op" && ops.includes(t.v)) {
      this.pos++;
      return t.v;
    }
    return undefined;
  }

  private primary(): number {
    const t = this.peek();
    if (!t) {
      fail(this.ctx, "表达式不完整");
      return 0;
    }
    if (t.t === "num") {
      this.pos++;
      return t.n ?? 0;
    }
    if (t.t === "op" && (t.v === "-" || t.v === "~")) {
      this.pos++;
      const v = this.primary();
      return t.v === "-" ? -v : ~v;
    }
    if (t.t === "op" && t.v === "(") {
      this.pos++;
      const v = this.bitOr();
      if (!this.eatOp(")")) fail(this.ctx, "缺少右括号");
      return v;
    }
    if (t.t === "id") {
      this.pos++;
      const name = t.v.replace(/^#/, "");
      if (name in this.ctx.symbols) return this.ctx.symbols[name];
      const reg = parseReg(name);
      if (reg !== undefined) return reg;
      if (/^(z|c|n|v)$/i.test(name)) return 0;
      fail(this.ctx, `未定义的符号 "${name}"`);
      return 0;
    }
    this.pos++;
    fail(this.ctx, `无法解析 "${t.v}"`);
    return 0;
  }

  private binary(ops: string[], next: () => number): number {
    let v = next();
    for (;;) {
      const t = this.peek();
      if (t && t.t === "op" && ops.includes(t.v)) {
        this.pos++;
        const r = next();
        switch (t.v) {
          case "+":
            v = v + r;
            break;
          case "-":
            v = v - r;
            break;
          case "*":
            v = v * r;
            break;
          case "/":
            v = r === 0 ? 0 : Math.trunc(v / r);
            break;
          case "%":
            v = r === 0 ? 0 : v % r;
            break;
          case "&":
            v = (v | 0) & (r | 0);
            break;
          case "|":
            v = (v | 0) | (r | 0);
            break;
          case "^":
            v = (v | 0) ^ (r | 0);
            break;
          case "<<":
            v = (v | 0) << r;
            break;
          case ">>":
            v = (v | 0) >> r;
            break;
          case "&&":
            v = v && r ? 1 : 0;
            break;
          case "||":
            v = v || r ? 1 : 0;
            break;
        }
        continue;
      }
      break;
    }
    return v;
  }

  private bitOr(): number {
    return this.binary(["|", "^"], () => this.bitAnd());
  }
  private bitAnd(): number {
    return this.binary(["&", "<<", ">>"], () => this.additive());
  }
  private additive(): number {
    return this.binary(["+", "-"], () => this.multiplicative());
  }
  private multiplicative(): number {
    return this.binary(["*", "/", "%"], () => this.primary());
  }
}

function evaluate(src: string, ctx: Ctx): number {
  return new Expr(tokenize(src), ctx).eval();
}

/* ------------------------- 操作数解析 ------------------------- */

function parseReg(name: string): number | undefined {
  const n = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[0-7]$/.test(n)) return Number(n);
  if (/^R[0-7]$/.test(n)) return Number(n.slice(1));
  if (n === "SP") return 6;
  if (n === "LR" || n === "RA") return 7;
  if (n === "A") return 0;
  if (n === "B") return 1;
  if (n === "C") return 2;
  if (n === "D") return 3;
  return undefined;
}

function splitArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of src) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseMemRef(src: string, ctx: Ctx): number | undefined {
  const m = /^\[\s*([^]]+)\s*\]$/.exec(src.trim());
  const inner = (m ? m[1] : src).trim();
  const reg = parseReg(inner);
  if (reg !== undefined) return reg;
  const v = evaluate(inner, ctx);
  if (v >= 0 && v <= 7) return v;
  fail(ctx, `[操作数] 需要寄存器，得到 "${src}"`);
  return undefined;
}

/* ------------------------- 汇编 ------------------------- */

interface Line {
  src: string;
  label?: string;
  mnem?: string;
  args: string[];
  directive?: string;
  n: number;
}

function lexLines(text: string): Line[] {
  const lines: Line[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    let s = raw.replace(/;.*$/, "").replace(/\/\/.*$/, "").trim();
    if (!s) return;
    const label = /^([A-Za-z_.][\w.]*)\s*:\s*(.*)$/.exec(s);
    let lab: string | undefined;
    if (label) {
      lab = label[1];
      s = label[2].trim();
    }
    if (!s) {
      lines.push({ src: raw, label: lab, args: [], n: i + 1 });
      return;
    }
    const m = /^([.A-Za-z][\w.]*)(?:\s+(.*))?$/.exec(s);
    if (!m) {
      lines.push({ src: raw, label: lab, args: [], n: i + 1, mnem: undefined });
      return;
    }
    const head = m[1];
    const rest = m[2] ?? "";
    if (head.startsWith(".")) {
      lines.push({ src: raw, label: lab, directive: head.toLowerCase(), args: splitArgs(rest), n: i + 1 });
      return;
    }
    lines.push({ src: raw, label: lab, mnem: head.toLowerCase(), args: splitArgs(rest), n: i + 1 });
  });
  return lines;
}

/** 指令长度（字），未知按 1 */
function instrWords(mnem: string): number {
  switch (mnem) {
    case "ldi":
    case "li":
    case "call":
    case "lds":
      return 2;
    case "jmp":
    case "je":
    case "jz":
    case "jne":
    case "jnz":
    case "jc":
    case "jnc":
    case "jm":
    case "js":
    case "jnp":
    case "jns":
      return 2;
    default:
      return 1;
  }
}

function condOf(mnem: string): number | undefined {
  for (const c of CONDS) if (c.mnemonics.includes(mnem)) return c.code;
  return undefined;
}

export function assemble(text: string, opts: { base?: number } = {}): AsmResult {
  const errors: string[] = [];
  const symbols: Record<string, number> = {};
  const ctx: Ctx = { errors, line: 1, symbols };
  const lines = lexLines(text);
  let base = opts.base ?? 0;

  // pass 1：符号地址（跑两遍以解出前向引用的 .equ）
  let pc = base;
  for (let pass = 0; pass < 2; pass++) {
    pc = base;
    for (const l of lines) {
      ctx.line = l.n;
      if (l.label && !(l.label in symbols)) symbols[l.label] = pc;
      if (l.directive) {
        if (l.directive === ".org") pc = evaluate(l.args[0] ?? "0", ctx) | 0;
        else if (l.directive === ".equ") symbols[(l.args[0] ?? "").trim()] = evaluate(l.args[1] ?? "0", ctx) | 0;
        else if (l.directive === ".word") pc += l.args.length || 1;
        else if (l.directive === ".fill") pc += evaluate(l.args[0] ?? "0", ctx) | 0;
        else if (l.directive === ".str") for (const a of l.args) pc += Math.max(1, Math.ceil(unquote(a).length / 2));
        continue;
      }
      if (l.mnem) pc += instrWords(l.mnem);
    }
    errors.length = 0; // 第一遍的未定义符号不算错
  }

  // pass 2：生成
  const cells = new Map<number, number>();
  pc = base;
  const listing: ListingLine[] = [];
  const emit = (addr: number, word: number, src: string) => {
    if (cells.has(addr)) fail(ctx, `地址 0x${addr.toString(16)} 处冲突`);
    cells.set(addr, word & 0xffff);
    listing.push({ addr, word: word & 0xffff, text: src, src });
  };

  for (const l of lines) {
    ctx.line = l.n;
    if (l.directive) {
      try {
        if (l.directive === ".org") pc = evaluate(l.args[0] ?? "0", ctx) | 0;
        else if (l.directive === ".equ") {
          /* 已在 pass1 处理 */
        } else if (l.directive === ".word") {
          for (const a of l.args) {
            emit(pc, evaluate(a, ctx) | 0, `.word ${a}`);
            pc++;
          }
        } else if (l.directive === ".fill") {
          const n = evaluate(l.args[0] ?? "0", ctx) | 0;
          const v = evaluate(l.args[1] ?? "0", ctx) | 0;
          for (let i = 0; i < n; i++) {
            emit(pc, v, `.fill`);
            pc++;
          }
        } else if (l.directive === ".str") {
          for (const a of l.args) {
            const s = unquote(a);
            for (let i = 0; i < s.length; i += 2) {
              const lo = s.charCodeAt(i) & 255;
              const hi = i + 1 < s.length ? s.charCodeAt(i + 1) & 255 : 0;
              emit(pc, (hi << 8) | lo, `.str ${a}`);
              pc++;
            }
            if (!s.length) {
              emit(pc, 0, `.str ${a}`);
              pc++;
            }
          }
        } else if (l.directive !== ".end") {
          fail(ctx, `未知伪指令 ${l.directive}`);
        }
      } catch (e) {
        fail(ctx, (e as Error).message);
      }
      continue;
    }
    if (!l.mnem) continue;
    try {
      const w = encodeInstr(l.mnem, l.args, ctx);
      emit(pc, w.code, l.src.trim());
      pc++;
      if (w.imm !== undefined) {
        emit(pc, w.imm, l.src.trim());
        pc++;
      }
    } catch (e) {
      fail(ctx, (e as Error).message);
      pc += instrWords(l.mnem);
    }
  }

  if (!cells.size && !errors.length) errors.push("没有产生任何指令");

  let words: number[] = [];
  if (cells.size) {
    const min = Math.min(...cells.keys());
    const max = Math.max(...cells.keys());
    words = new Array(max - min + 1).fill(0);
    for (const [addr, w] of cells) words[addr - min] = w;
    base = min;
  } else base = opts.base ?? 0;

  return { words, base, errors, symbols, listing };
}

function unquote(a: string): string {
  const m = /^"([\s\S]*)"$/.exec(a.trim());
  return m ? m[1].replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\0/g, "\0") : a.trim();
}

function encodeInstr(mnem: string, args: string[], ctx: Ctx): { code: number; imm?: number } {
  const reg = (s: string, i: number): number => {
    const r = parseReg(s ?? "");
    if (r === undefined) {
      fail(ctx, `第 ${i + 1} 个操作数需要寄存器，得到 "${s}"`);
      return 0;
    }
    return r;
  };
  const imm = (s: string): number => {
    const v = evaluate((s ?? "").replace(/^#/, ""), ctx) | 0;
    if (v < -32768 || v > 65535) fail(ctx, `立即数超出 16 位：${v}`);
    return v & 0xffff;
  };

  switch (mnem) {
    case "nop":
      return { code: encode(OP.NOP) };
    case "mov":
      return { code: encode(OP.MOV, reg(args[0], 0), reg(args[1], 1)) };
    case "ldi":
    case "li":
      return { code: encode(OP.LDI, reg(args[0], 0)), imm: imm(args[1]) };
    case "add":
      return { code: encode(OP.ADD, reg(args[0], 0), reg(args[1], 1)) };
    case "sub":
      return { code: encode(OP.SUB, reg(args[0], 0), reg(args[1], 1)) };
    case "and":
      return { code: encode(OP.AND, reg(args[0], 0), reg(args[1], 1)) };
    case "or":
      return { code: encode(OP.OR, reg(args[0], 0), reg(args[1], 1)) };
    case "xor":
      return { code: encode(OP.XOR, reg(args[0], 0), reg(args[1], 1)) };
    case "not":
      return { code: encode(OP.NOT, reg(args[0], 0)) };
    case "shl":
      return { code: encode(OP.SHL, reg(args[0], 0), reg(args[1], 1)) };
    case "shr":
      return { code: encode(OP.SHR, reg(args[0], 0), reg(args[1], 1)) };
    case "cmp":
      return { code: encode(OP.CMP, reg(args[0], 0), reg(args[1], 1)) };
    case "lda":
    case "ld":
      return { code: encode(OP.LDA, reg(args[0], 0), parseMemRef(args[1] ?? "", ctx) ?? 0) };
    case "sta":
    case "st":
      return { code: encode(OP.STA, reg(args[0], 0), parseMemRef(args[1] ?? "", ctx) ?? 0) };
    case "hlt":
      return { code: encode(OP.SYS, 0, SYS.HLT) };
    case "ret":
      return { code: encode(OP.SYS, 0, SYS.RET) };
    case "call":
      return { code: encode(OP.SYS, 0, SYS.CALL), imm: imm(args[0]) };
    case "lds":
      return { code: encode(OP.SYS, 0, SYS.LDS), imm: imm(args[0]) };
    case "push":
      return { code: encode(OP.SYS, reg(args[0], 0), SYS.PUSH) };
    case "pop":
      return { code: encode(OP.SYS, reg(args[0], 0), SYS.POP) };
    case "out":
      return { code: encode(OP.SYS, reg(args[0], 0), SYS.OUT) };
    case "in":
      return { code: encode(OP.SYS, reg(args[0], 0), SYS.IN) };
    default: {
      const cond = condOf(mnem);
      if (cond !== undefined) return { code: encode(OP.JMP, 0, cond), imm: imm(args[0]) };
      throw new Error(`未知指令 "${mnem}"`);
    }
  }
}

/* ------------------------- 反汇编 ------------------------- */

export function disassemble(words: number[], base = 0): ListingLine[] {
  const out: ListingLine[] = [];
  for (let i = 0; i < words.length; i++) {
    const addr = base + i;
    const word = words[i] & 0xffff;
    const { op, a, b } = decodeOp(word);
    const info = opInfo(op);
    let text = "";
    if (op === OP.JMP) {
      const c = CONDS.find((x) => x.code === b) ?? CONDS[0];
      const next = words[++i] ?? 0;
      text = `${c.mnemonics[0]} 0x${next.toString(16)}`;
    } else if (op === OP.SYS) {
      const s = SYSS[b] ?? SYSS[0];
      if (s.words === 2) {
        const next = words[++i] ?? 0;
        text = `${s.mnemonic} ${s.mnemonic === "call" ? "0x" + next.toString(16) : "0x" + next.toString(16)}`;
      } else if (s.args.includes("a")) text = `${s.mnemonic} ${REG_NAMES[a]}`;
      else text = s.mnemonic;
    } else if (info.words === 2) {
      const next = words[++i] ?? 0;
      text = `${info.mnemonics[0]} ${REG_NAMES[a]}, 0x${next.toString(16)}`;
    } else if (op === OP.NOP) text = "nop";
    else if (op === OP.NOT) text = `not ${REG_NAMES[a]}`;
    else if (op === OP.LDA || op === OP.STA) text = `${info.mnemonics[0]} ${REG_NAMES[a]}, [${REG_NAMES[b]}]`;
    else if (info.args === "a, b") text = `${info.mnemonics[0]} ${REG_NAMES[a]}, ${REG_NAMES[b]}`;
    else text = `.word 0x${word.toString(16)}`;
    out.push({ addr, word, text, src: text });
  }
  return out;
}

/** 指令集手册（面板展示用） */
export function isaDoc() {
  return OPS.map((o) => ({
    op: "0x" + o.op.toString(16),
    mnemonic: o.mnemonics.join(" / "),
    args: o.args,
    words: o.words,
    micro: o.micro,
    desc: o.desc,
    group: o.group,
  }));
}

export { PORT_IN, PORT_OUT };
