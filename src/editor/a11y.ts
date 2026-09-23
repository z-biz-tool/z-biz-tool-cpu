import type { Circuit, CompDef, CompInstance, Design } from "../core/types.ts";
import { defOf } from "../core/custom.ts";
import { buildNetlist, pinSpecWidth, type SimComp } from "../core/netlist.ts";
import type { Simulator } from "../core/sim.ts";
import type { HitResult } from "./hitIndex.ts";

/* ------------------------------------------------------------------ *
 * IMP-14: 无障碍替代品 — Canvas 配套的 a11y 模型
 *
 * 设计要点：
 *  - 元件列表 (非画布替代)：按 id 顺序列出全部元件及其引脚状态
 *  - 连线表：按 id 列起点/终点，便于读屏
 *  - 键盘选择：方向键在元件间移动焦点
 *  - 当前焦点元件的引脚数值播报（不打断读屏）
 * ------------------------------------------------------------------ */

export interface CompSummary {
  id: string;
  name?: string;
  /** 画布、属性面板、端口清单与播报对同一个元件的共用叫法（见 compLabel） */
  label: string;
  type: string;
  pins: { id: string; dir: "in" | "out"; width: number }[];
}

export interface WireSummary {
  id: string;
  from: string;
  to: string;
}

export interface A11yModel {
  comps: CompSummary[];
  wires: WireSummary[];
}

/**
 * 叫法只有一处定义：用户起了名字就叫名字，没起就叫元件类型标题（和属性面板的
 * chip 一致）。内部 id 谁都对不上，读屏念出 "co0n2995us2" 等于什么也没说 ——
 * 浏览器实测过：放置一个未命名输入端后，选区播报整句都是这串 id。
 */
export function compLabel(design: Design, inst: CompInstance): string {
  return inst.name || defOf(design, inst.type, inst.params)?.label || inst.type;
}

/** "元件内部 id.引脚" 这种端点引用念给用户听时的样子：叫得出名字就叫名字 */
export function endName(ref: string, labels: Map<string, string>): string {
  const i = ref.lastIndexOf(".");
  return `${labels.get(ref.slice(0, i)) ?? ref.slice(0, i)}.${ref.slice(i + 1)}`;
}

/**
 * 端口位宽：固定值 / 跟随元件位宽 / 按参数算，三种写法都可能出现。
 * 早先这里把 "auto" 一律记成 1 位，读屏听到的"1 位总线"和画布上完全对不上，
 * 所以改用 netlist 的同一套规则；手上有仿真器时直接取网络上的真实位宽。
 */
function portWidth(
  inst: CompInstance,
  def: CompDef,
  pinIndex: number,
  sim?: Simulator,
  bits?: Map<string, number>,
): number {
  const spec = def.pins[pinIndex];
  const live = sim?.valueOf({ comp: inst.id, pin: spec.id });
  if (live) return live.width;
  const guessed = bits?.get(inst.id) ?? (Number(inst.params.bitWidth) || 1);
  return pinSpecWidth({ inst, def, bits: Math.max(1, guessed) } as unknown as SimComp, spec);
}

/** 没有实时仿真器时（新建骨架、headless 校验）退回 netlist 自己的位宽推断 */
function inferredBits(design: Design, c: Circuit): Map<string, number> {
  const out = new Map<string, number>();
  for (const sc of buildNetlist(design, c).comps) out.set(sc.id, sc.bits);
  return out;
}

export function buildA11y(c: Circuit, design: Design, sim?: Simulator): A11yModel {
  const comps: CompSummary[] = [];
  const bits = sim ? undefined : inferredBits(design, c);
  for (const inst of c.comps) {
    const def = defOf(design, inst.type, inst.params);
    comps.push({
      id: inst.id,
      name: inst.name,
      label: compLabel(design, inst),
      type: inst.type,
      pins: def ? def.pins.map((p, pi) => ({ id: p.id, dir: p.kind, width: portWidth(inst, def, pi, sim, bits) })) : [],
    });
  }
  const wires: WireSummary[] = c.wires.map((w) => ({ id: w.id, from: `${w.a.comp}.${w.a.pin}`, to: `${w.b.comp}.${w.b.pin}` }));
  return { comps, wires };
}

/** 在 a11y 模型里查找下一个/上一个元件 id，用于键盘导航 */
export function neighbour(model: A11yModel, current: string | null, dir: "next" | "prev"): string | null {
  if (!model.comps.length) return null;
  if (!current) return model.comps[0].id;
  const i = model.comps.findIndex((c) => c.id === current);
  if (i < 0) return model.comps[0].id;
  const j = dir === "next" ? Math.min(model.comps.length - 1, i + 1) : Math.max(0, i - 1);
  return model.comps[j].id;
}

/**
 * 把模型摊成读屏能直接念的两份清单：每个元件的端口一句话，再加一份"哪些脚没接线"。
 * 坐标在这里没有意义，所以只讲名称、方向、位宽与是否连上——缺线必须能被念出来。
 */
/**
 * 一个没接线的端口。text 是念给用户听的那句话，comp/pin 是"从这个端口开始连线"
 * 要交给连线的落点 —— 只有文案的清单读屏能听却改不动，等于没替代鼠标。
 */
export interface OpenPort {
  comp: string;
  pin: string;
  dir: "in" | "out";
  width: number;
  text: string;
}

export function portStructure(model: A11yModel): {
  labels: Map<string, string>;
  pins: Map<string, string>;
  openPorts: OpenPort[];
} {
  const labels = new Map(model.comps.map((c) => [c.id, c.label]));
  const linked = new Set<string>();
  for (const w of model.wires) {
    linked.add(w.from);
    linked.add(w.to);
  }
  const pins = new Map<string, string>();
  const openPorts: OpenPort[] = [];
  for (const c of model.comps) {
    const label = labels.get(c.id) ?? c.id;
    const parts = c.pins.map((p) => {
      const dir = p.dir === "in" ? "输入" : "输出";
      if (!linked.has(`${c.id}.${p.id}`))
        openPorts.push({
          comp: c.id,
          pin: p.id,
          dir: p.dir,
          width: p.width,
          text: `${label} 的${dir}脚 ${p.id}（${p.width} 位）未连接`,
        });
      return `${p.id} ${dir} ${p.width} 位`;
    });
    pins.set(c.id, parts.join("、") || "无引脚");
  }
  return { labels, pins, openPorts };
}

/** 命中测试 + a11y 模型：返回焦点元件的引脚状态文本 */
export function describeFocus(model: A11yModel, hit: HitResult | undefined): string {
  if (!hit) return "当前画布没有命中元件";
  /* 说明句里出现的每个元件都走同一套叫法：连线的两个端点原本直接是 "c0.x → c1.y"，
     读屏用户听到的是两个内部 id，跟画布上看到的对不上。 */
  const labels = new Map(model.comps.map((c) => [c.id, c.label]));
  if (hit.type === "comp" && hit.comp) {
    const meta = model.comps.find((c) => c.id === hit.comp!.id);
    if (!meta) return hit.comp.id;
    return `${meta.label} 类型 ${meta.type} 引脚 ${meta.pins.length} 个`;
  }
  if (hit.type === "pin" && hit.pin) {
    const meta = model.comps.find((c) => c.id === hit.pin!.comp);
    const ps = meta?.pins.find((p) => p.id === hit.pin!.pin);
    return `${labels.get(hit.pin.comp) ?? hit.pin.comp} 引脚 ${ps?.id ?? hit.pin.pin} 方向 ${ps?.dir ?? "?"} 位宽 ${ps?.width ?? "?"}`;
  }
  if (hit.type === "wire" && hit.wire) {
    const w = model.wires.find((x) => x.id === hit.wire!.id);
    return w ? `连线 ${endName(w.from, labels)} → ${endName(w.to, labels)}` : `连线 ${hit.wire.id} 已不在连接表里`;
  }
  return "";
}
