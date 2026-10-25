import { circuit } from "../core/build.ts";
import { baseDef, resolveDef } from "../core/registry.ts";
import type { Circuit, CompInstance, Wire } from "../core/types.ts";

/* ------------------------------------------------------------------ *
 * 案例工坊的迷你网表语言
 *
 * 目的：把「一个能跑的电路」从 40 行 add/connect 压成 10 行可读文本，
 * 这样 100 个案例才有可能被人读完、改懂、再拆走。
 *
 * 语法（每行一条，`#` 起注释）：
 *
 *   in  a 8       # 声明对外输入端口，8 位；宽度必写
 *   out y 8       # 声明对外输出端口
 *   n1 = and a b  # 按引脚声明顺序喂位置参数
 *   n2 = mux sel n1 n3 n4 n5     # mux 第一个位置参数是 sel，其余是数据输入
 *   n3 = mux sel=a n=4 i0=x ...  # 也可以按引脚名点名，未点名的引脚悬空
 *   n4 = add a b width=8         # k=v 若不是引脚名，就是元件参数
 *   y  <- n4.sum                 # 端口绑定；`<-` 右边是网络名
 *
 * 位置参数与引脚名的判定规则只有一条：**k=v 的 k 命中该元件的引脚名就是连线，
 * 否则当参数**。这样 `alu` 这种 a/b/op 混排、`dff` 这种 clk 打头的元件都不需要
 * 特殊照顾，也不会出现「参数名与引脚名各写一套」的第二本账。
 * ------------------------------------------------------------------ */

export interface DslPort {
  name: string;
  dir: "in" | "out";
  width: number;
}

export interface DslNetlist {
  circuit: Circuit;
  ports: DslPort[];
}

export class DslError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`第 ${line} 行：${message}`);
    this.name = "DslError";
    this.line = line;
  }
}

/** 参数别名：写 width=8 比 bitWidth=8 顺手，但只此一张表，别处不再另立 */
const PARAM_ALIAS: Record<string, string> = {
  width: "bitWidth",
  bits: "bitWidth",
  n: "inputs",
  addr: "addrBits",
  data: "data",
};

interface NodeDecl {
  name: string;
  type: string;
  line: number;
  /** 位置参数（网络名），按元件输入引脚声明顺序落位 */
  args: string[];
  /** 点名的引脚 → 网络名 */
  pins: Record<string, string>;
  params: Record<string, number | string | boolean>;
}

/** 把一行拆成词元，支持 "..." 里的空格（data="0x1, 0x2"） */
function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === " " || ch === "\t" || ch === ",") {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = "";
      while (j < line.length && line[j] !== '"') s += line[j++];
      out.push(s);
      i = j + 1;
      continue;
    }
    let j = i;
    let s = "";
    while (j < line.length && !" \t,".includes(line[j])) {
      // 词元中间也可以带引号：data="0x1 0x2" 是一个词元，不是两个
      if (line[j] === '"') {
        let k = j + 1;
        while (k < line.length && line[k] !== '"') s += line[k++];
        j = k + 1;
        continue;
      }
      s += line[j++];
    }
    out.push(s);
    i = j;
  }
  return out;
}

function parseValue(raw: string): number | string | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== "" ? n : raw;
}

/** 网络名 → [元件名, 引脚名]；`x` 等价于 `x.<第一个输出脚>` */
function splitNet(net: string): { comp: string; pin?: string } {
  const dot = net.indexOf(".");
  if (dot < 0) return { comp: net };
  return { comp: net.slice(0, dot), pin: net.slice(dot + 1) };
}

function defaultOutPin(type: string, params: Record<string, number | string | boolean>): string {
  const def = resolveDef(type, params) ?? baseDef(type);
  const outs = def?.pins.filter((p) => p.kind === "out") ?? [];
  if (!outs.length) throw new Error(`${type} 没有输出引脚，不能当作网络源`);
  return outs[0].id;
}

/**
 * 把网表文本搭成电路。
 * 布局按拓扑深度分列、列内按行堆叠 —— 100 个案例放进画布时都是能看的，
 * 不是一团自动布线出来的毛线。
 */
export function buildNetlist(src: string): DslNetlist {
  const ins: { name: string; width: number; line: number }[] = [];
  const outs: { name: string; width: number; line: number }[] = [];
  const nodes: NodeDecl[] = [];
  const binds: { port: string; net: string; line: number }[] = [];
  /** 网络别名（`let 名字 = 网络`） */
  const aliases = new Map<string, string>();

  const lines = src.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const lineNo = li + 1;
    const raw = lines[li];
    const stripped = raw.split("#")[0].trim();
    if (!stripped) continue;
    const t = tokenize(stripped);
    if (!t.length) continue;

    // `port <- net` 必须排在 in/out 之前：端口本身也可能叫 out
    if (t[1] === "<-") {
      const port = t[0];
      const net = t[2];
      if (!port || !net) throw new DslError("端口绑定要写成 port <- net", lineNo);
      binds.push({ port, net, line: lineNo });
      continue;
    }

    if (t[0] === "in" || t[0] === "out") {
      const [, name, widthRaw] = t;
      if (!name) throw new DslError(`${t[0]} 缺少端口名`, lineNo);
      const width = Number(widthRaw);
      if (!Number.isInteger(width) || width < 1 || width > 32) {
        throw new DslError(`端口 ${name} 的宽度必须是 1..32 的整数（拿到 ${widthRaw ?? "空"}）`, lineNo);
      }
      (t[0] === "in" ? ins : outs).push({ name, width, line: lineNo });
      continue;
    }

    if (t[1] === "<-") {
      const port = t[0];
      const net = t[2];
      if (!port || !net) throw new DslError("端口绑定要写成 port <- net", lineNo);
      binds.push({ port, net, line: lineNo });
      continue;
    }

    // `let 名字 = 网络` 只起别名，不新增元件：
    // 子电路的某个输出脚常常要喂给好几个地方，给它起个名字比到处写 x.sum 好读
    if (t[0] === "let") {
      const aliasName = t[1];
      const realNet = t[3];
      if (!aliasName || t[2] !== "=" || !realNet) throw new DslError("别名要写成：let 名字 = 网络", lineNo);
      aliases.set(aliasName, realNet);
      continue;
    }

    if (t[1] !== "=") throw new DslError(`无法识别的语句「${stripped}」`, lineNo);
    const name = t[0];
    const type = t[2];
    if (!type) throw new DslError(`元件 ${name} 缺少类型`, lineNo);
    if (!baseDef(type)) throw new DslError(`没有类型为 ${type} 的元件`, lineNo);

    const decl: NodeDecl = { name, type, line: lineNo, args: [], pins: {}, params: {} };
    for (const tok of t.slice(3)) {
      const eq = tok.indexOf("=");
      if (eq > 0) {
        const k = tok.slice(0, eq);
        const v = parseValue(tok.slice(eq + 1));
        const pins = baseDef(type)!.pins.map((p) => p.id);
        if (pins.includes(k)) decl.pins[k] = String(v);
        else decl.params[PARAM_ALIAS[k] ?? k] = v;
      } else {
        decl.args.push(tok);
      }
    }
    nodes.push(decl);
  }

  /* -------- 端口重名 / 未知端口 早报，省得画布上找半天 -------- */
  const portNames = new Set<string>();
  for (const p of [...ins, ...outs]) {
    if (portNames.has(p.name)) throw new DslError(`端口 ${p.name} 重复声明`, p.line);
    portNames.add(p.name);
  }
  const outNames = new Set(outs.map((o) => o.name));
  for (const b of binds) {
    if (!outNames.has(b.port)) throw new DslError(`绑定到了未声明的输出端口 ${b.port}`, b.line);
  }
  const nodeNames = new Set<string>();
  for (const n of nodes) {
    if (nodeNames.has(n.name)) throw new DslError(`元件名 ${n.name} 重复`, n.line);
    if (portNames.has(n.name)) throw new DslError(`元件名 ${n.name} 与端口重名`, n.line);
    nodeNames.add(n.name);
  }

  /* -------- 先定参数（位置参数个数会改写 inputs），再连线 -------- */
  const comps: CompInstance[] = [];
  const wires: Wire[] = [];
  let seq = 0;
  const w = (a: string, ap: string, b: string, bp: string) => {
    wires.push({ id: "w" + ++seq, a: { comp: a, pin: ap }, b: { comp: b, pin: bp } });
  };

  for (const p of ins) {
    comps.push({
      id: p.name,
      type: "input",
      x: 0,
      y: 0,
      rot: 0,
      params: { bitWidth: p.width, init: 0 },
      name: p.name.toUpperCase(),
    });
  }
  for (const p of outs) {
    comps.push({
      id: p.name,
      type: "output",
      x: 0,
      y: 0,
      rot: 0,
      params: { bitWidth: p.width, radix: "bin" },
      name: p.name.toUpperCase(),
    });
  }

  /* 第一遍：先把所有元件落进 comps。
     必须先全量落地再连线 —— 门级锁存器（nor 交叉反馈）是**前向引用**，
     边建边连的话 q 引用 qbar、qbar 又引用 q，谁先谁死。 */
  const pinsOf = new Map<string, string[]>();
  for (const n of nodes) {
    const params: Record<string, number | string | boolean> = { ...n.params };
    const base = baseDef(n.type)!;
    if (n.type === "mux") {
      if (n.args.length && params.inputs === undefined) params.inputs = n.args.length - 1;
    } else if (base.category === "gate") {
      if (n.args.length && params.inputs === undefined) params.inputs = n.args.length;
    }
    const def = resolveDef(n.type, params) ?? base;
    const inPins = def.pins.filter((p) => p.kind === "in");
    if (n.args.length > inPins.length) {
      throw new DslError(
        `${n.name}(${n.type}) 只接受 ${inPins.length} 个输入引脚，收到 ${n.args.length} 个位置参数`,
        n.line
      );
    }
    pinsOf.set(n.name, def.pins.map((p) => p.id));
    // 回写：第二遍连线用的就是这份最终参数（否则 inputs=3 这种自动推导会在第二遍丢）
    n.params = params;
    comps.push({ id: n.name, type: n.type, x: 0, y: 0, rot: 0, params, name: n.name });
  }

  /* 第二遍：连线 */
  for (const n of nodes) {
    const inPins = pinsOf.get(n.name)!;
    const def = resolveDef(n.type, nodes.find((x) => x.name === n.name)!.params) ?? baseDef(n.type)!;
    const argPins = def.pins.filter((p) => p.kind === "in");
    n.args.forEach((net, i) => {
      const pin = argPins[i];
      if (!pin) return;
      connectNet(net, n.name, pin.id, n.line);
    });
    for (const [pin, net] of Object.entries(n.pins)) {
      if (!inPins.includes(pin)) throw new DslError(`${n.name}(${n.type}) 没有引脚 ${pin}`, n.line);
      connectNet(net, n.name, pin, n.line);
    }
  }

  function connectNet(rawNet: string, compId: string, pin: string, line: number) {
    let net = rawNet;
    for (let guard = 0; aliases.has(net) && guard < 16; guard++) net = aliases.get(net)!;
    const ref = splitNet(net);
    if (portNames.has(ref.comp) && !nodeNames.has(ref.comp)) {
      const isOutPort = outNames.has(ref.comp);
      if (isOutPort) throw new DslError(`输出端口 ${ref.comp} 不能作为信号源`, line);
      if (ref.pin && ref.pin !== "out") throw new DslError(`输入端口 ${ref.comp} 只有 out 脚`, line);
      w(ref.comp, "out", compId, pin);
      return;
    }
    if (!nodeNames.has(ref.comp)) throw new DslError(`引用了不存在的元件 ${ref.comp}`, line);
    w(ref.comp, ref.pin ?? defaultOutPin(typeOf(ref.comp), paramsOf(ref.comp)), compId, pin);
  }

  function typeOf(name: string): string {
    return nodes.find((n) => n.name === name)!.type;
  }
  function paramsOf(name: string): Record<string, number | string | boolean> {
    const c = comps.find((x) => x.id === name)!;
    return c.params;
  }

  for (const b of binds) {
    connectNet(b.net, b.port, "in", b.line);
  }

  /* -------- 拓扑分层布局：深度 = 从输入到它的最长路径 -------- */
  const depth = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const wire of wires) {
    const list = incoming.get(wire.b.comp) ?? [];
    list.push(wire.a.comp);
    incoming.set(wire.b.comp, list);
  }
  const depthOf = (id: string, seen: Set<string> = new Set()): number => {
    const hit = depth.get(id);
    if (hit !== undefined) return hit;
    if (seen.has(id)) return 0; // 环路（锁存器反馈）按 0 处理，布局不追环
    seen.add(id);
    const from = incoming.get(id) ?? [];
    let d = 0;
    for (const p of from) d = Math.max(d, depthOf(p, seen) + 1);
    depth.set(id, d);
    return d;
  };
  for (const c of comps) depthOf(c.id);

  const cols = new Map<number, CompInstance[]>();
  for (const c of comps) {
    const d = depth.get(c.id) ?? 0;
    const list = cols.get(d) ?? [];
    list.push(c);
    cols.set(d, list);
  }
  let x = 0;
  for (const d of [...cols.keys()].sort((a, b) => a - b)) {
    const list = cols.get(d)!;
    let colW = 0;
    let y = 0;
    for (const c of list) {
      const def = resolveDef(c.type, c.params) ?? baseDef(c.type)!;
      c.x = x;
      c.y = y;
      y += def.size.h + 2;
      colW = Math.max(colW, def.size.w);
    }
    x += colW + 4;
  }

  return {
    circuit: circuit(comps, wires),
    ports: [
      ...ins.map((p) => ({ name: p.name, dir: "in" as const, width: p.width })),
      ...outs.map((p) => ({ name: p.name, dir: "out" as const, width: p.width })),
    ],
  };
}
