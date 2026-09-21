/**
 * 电路数据模型（可序列化部分）。
 * 说明：core/ 与 asm/ 下的纯 TS 模块统一使用带 `.ts` 后缀的相对导入，
 * 这样同一份代码既能在浏览器里跑，也能被 node 直接执行用于 headless 校验。
 */

export interface Point {
  x: number;
  y: number;
}

/** 旋转步数，每步 90° 顺时针 */
export type Rot = 0 | 1 | 2 | 3;

export type PinKind = "in" | "out";

/** 引脚朝向（未旋转时），决定自动布线的出线方向 */
export type Dir = "l" | "r" | "u" | "d";

export interface PinRef {
  comp: string;
  pin: string;
}

export interface CompInstance {
  id: string;
  /** registry 中的 type，或 `custom:<defId>` */
  type: string;
  /** 元件原点（网格单位，未旋转包围盒左上角） */
  x: number;
  y: number;
  rot: Rot;
  /** 沿水平轴镜像（在旋转之前应用） */
  flip?: boolean;
  params: Record<string, number | string | boolean>;
  /** 用户命名：用于探针、寄存器命名等 */
  name?: string;
}

export interface Wire {
  id: string;
  a: PinRef;
  b: PinRef;
  /** 手工路径点；为空时由自动布线生成 */
  via?: Point[];
}

export interface Circuit {
  comps: CompInstance[];
  wires: Wire[];
  /** 视图状态 */
  view?: { x: number; y: number; zoom: number };
}

export interface CustomDef {
  id: string;
  name: string;
  circuit: Circuit;
}

export interface Design {
  name: string;
  root: Circuit;
  defs: CustomDef[];
}

/** 参数控件声明 */
export interface ParamSpec {
  key: string;
  label: string;
  kind: "int" | "bool" | "choice" | "hex" | "text" | "data";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
  default: number | string | boolean;
  /** 修改后是否需要重建网络（如位宽、引脚数量相关） */
  structural?: boolean;
}

export interface PinSpec {
  id: string;
  label?: string;
  /** 未旋转时相对元件原点的坐标（网格单位） */
  x: number;
  y: number;
  dir: Dir;
  kind: PinKind;
  /** 位宽：固定值、跟随元件位宽 "auto"、或按参数计算 */
  width: number | "auto";
  /** 由参数决定的位宽，如 split 的宽侧 */
  widthParam?: string;
  /** 选择端：位宽 = ceil(log2(该参数的值))，不参与元件位宽推断 */
  selParam?: string;
  bubble?: boolean;
  /** 该引脚是时钟输入（仿真器按上升沿触发） */
  clock?: boolean;
}

export interface EvalCtx {
  /** 读输入引脚值（已按引脚位宽掩码） */
  r(pin: string): number;
  /** 写输出引脚值 */
  w(pin: string, v: number): void;
  /** 读任意引脚（含输出，用于锁存类元件） */
  rw(pin: string): number;
  p<T extends number | string | boolean = number>(key: string): T;
  /** 元件位宽（auto 推断结果） */
  bits: number;
  /** 当前实例实际使用的输入/输出引脚 id（引脚数随参数变化） */
  ins: string[];
  outs: string[];
  /** 跨周期持久状态 */
  s: Record<string, any>;
  /** 输出运行日志（Display / Assert 类元件） */
  log?(msg: string, level?: "info" | "warn" | "error"): void;
}

export type CompCategory =
  | "io"
  | "gate"
  | "math"
  | "mux"
  | "bus"
  | "seq"
  | "mem"
  | "util";

export interface CompDef {
  type: string;
  label: string;
  category: CompCategory;
  /** 元件体尺寸（网格单位） */
  size: { w: number; h: number };
  pins: PinSpec[];
  cost: number;
  params?: ParamSpec[];
  /** 位宽模式：auto = 跟随输入最大位宽；param = 取 bitWidth 参数；1 = 恒为 1 */
  widthMode?: "auto" | "param" | "one";
  /** 组合逻辑求值 */
  eval?: (c: EvalCtx) => void;
  /** 时钟上升沿求值（时序元件） */
  onRise?: (c: EvalCtx) => void;
  /** 元件体绘制风格 */
  glyph?: "gate" | "box" | "mem" | "io" | "label";
  /** 符号文字（画在元件体中央） */
  symbol?: string;
  /** 不参与成本统计/关卡计数（注释、显示类） */
  free?: boolean;
  /** 内部元件（子电路边界），不出现在元件库 */
  boundary?: boolean;
  description?: string;
}

export const GRID = 20;

export function mask(v: number, bits: number): number {
  if (bits >= 32) return v >>> 0;
  return (v & ((1 << bits) - 1)) >>> 0;
}

export function bitCount(bits: number): number {
  return bits >= 32 ? 32 : bits;
}

export function toSigned(v: number, bits: number): number {
  const m = mask(v, bits);
  if (bits >= 32) return m | 0;
  const sign = 1 << (bits - 1);
  return (m ^ sign) - sign;
}

export function fromSigned(v: number, bits: number): number {
  return mask(v, bits);
}

export function hex(v: number, bits: number): string {
  const n = Math.max(1, Math.ceil(bits / 4));
  return "0x" + (v >>> 0).toString(16).toUpperCase().padStart(n, "0");
}

export function bin(v: number, bits: number): string {
  const out: string[] = [];
  for (let i = bits - 1; i >= 0; i--) out.push(((v >>> i) & 1).toString());
  return out.join("");
}

export function uid(prefix = "c"): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}
