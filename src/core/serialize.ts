import { pinProblemOf } from "./custom.ts";
import { baseDef } from "./registry.ts";
import type { Circuit, CompInstance, Design, Wire } from "./types.ts";

/* ------------------------------------------------------------------ *
 * 存档 / 导入导出
 * ------------------------------------------------------------------ */

export const FORMAT = "z-biz-tool-cpu/1";
export const STORAGE_PREFIX = "z-biz-tool-cpu:";

// FIX-05: 输入校验预算（教学项目规模初始上限，对应 05_项目存储与课程数据模型 §6）。
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_DEFS = 64;
export const MAX_COMPS_PER_CIRCUIT = 1000;
export const MAX_WIRES_PER_CIRCUIT = 5000;

export interface SaveFile {
  format: string;
  savedAt: string;
  design: Design;
}

export function serialize(design: Design): string {
  const file: SaveFile = { format: FORMAT, savedAt: new Date().toISOString(), design };
  return JSON.stringify(file, null, 1);
}

export interface ParseResult {
  design?: Design;
  errors: string[];
  warnings: string[];
}

/** FIX-05: 解析前预先校验大小与格式，避免被超大或非 JSON 输入直接吃光内存。 */
export function parse(text: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof text !== "string") return { errors: ["输入不是文本"], warnings };
  if (text.length === 0) return { errors: ["输入为空"], warnings };
  if (text.length > MAX_IMPORT_BYTES) {
    return {
      errors: [`输入超过 ${MAX_IMPORT_BYTES} 字节上限（${text.length}），拒绝解析`],
      warnings,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { errors: ["JSON 解析失败：" + (e as Error).message], warnings };
  }
  if (!raw || typeof raw !== "object") {
    return { errors: ["JSON 顶层不是对象"], warnings };
  }
  const obj = raw as Partial<SaveFile> & Partial<Design>;
  const design = obj.design ?? (obj.root ? obj : undefined);
  if (!design || !design.root) return { errors: ["缺少 root 电路，可能不是本工具的设计文件"], warnings };

  // 数据规模预算
  const rawDefs = (design.defs ?? []) as unknown[];
  if (rawDefs.length > MAX_DEFS) {
    return { errors: [`子电路定义数 ${rawDefs.length} 超过上限 ${MAX_DEFS}`], warnings };
  }
  // 预算要盖住每一个电路：子电路里的海量元件同样会进仿真和渲染，只查主电路等于没查
  const circuits: { where: string; circuit: Partial<Circuit> | undefined }[] = [
    { where: "主电路", circuit: design.root },
    ...rawDefs.map((d, i) => {
      const def = d as { name?: string; id?: string; circuit?: Partial<Circuit> };
      return { where: `子电路 ${def?.name || def?.id || i}`, circuit: def?.circuit };
    }),
  ];
  for (const { where, circuit } of circuits) {
    const comps = (circuit?.comps ?? []) as unknown[];
    if (comps.length > MAX_COMPS_PER_CIRCUIT) {
      return { errors: [`${where}元件数 ${comps.length} 超过上限 ${MAX_COMPS_PER_CIRCUIT}`], warnings };
    }
    const wires = (circuit?.wires ?? []) as unknown[];
    if (wires.length > MAX_WIRES_PER_CIRCUIT) {
      return { errors: [`${where}导线数 ${wires.length} 超过上限 ${MAX_WIRES_PER_CIRCUIT}`], warnings };
    }
  }

  const known = new Set<string>(rawDefs.map((d) => "custom:" + String((d as { id: unknown }).id ?? "")));
  const cleaned: Design = {
    name: String(design.name ?? "未命名设计"),
    root: sanitizeCircuit(design.root, known, errors, warnings, "主电路"),
    defs: (design.defs ?? []).map((d: any) => ({
      id: String(d.id),
      name: String(d.name ?? "子电路"),
      circuit: sanitizeCircuit(d.circuit, known, errors, warnings, d.name ?? d.id),
    })),
  };
  for (const d of cleaned.defs) known.add("custom:" + d.id);
  // 后置扫描：禁止循环引用、禁止极端数值、引用校验
  checkForNaN(cleaned, errors);
  checkRefs(cleaned, warnings);
  return { design: cleaned, errors, warnings };
}

/**
 * doc 05 §3.3：导入顺序里的「引用校验」。
 * 导线端点必须落到元件真实存在的引脚上——悬空引脚会让打包子电路等下游流程直接抛错，
 * 而编辑器内已经用 pinProblem 拦住了这类连线，导入路径不能再放行。
 * 修不掉的引用丢弃，但必须写进报告（不静默丢弃后当作正常工程保存）。
 */
function checkRefs(design: Design, warnings: string[]) {
  const scan = (circuit: Circuit, where: string) => {
    if (!circuit.wires.length) return;
    const byId = new Map(circuit.comps.map((c) => [c.id, c]));
    const kept: Wire[] = [];
    for (const w of circuit.wires) {
      const a = byId.get(w.a.comp);
      const b = byId.get(w.b.comp);
      if (!a || !b) continue;
      const bad = pinProblemOf(design, a, w.a) ?? pinProblemOf(design, b, w.b);
      if (bad) {
        warnings.push(`${where}：导线 ${w.a.comp}.${w.a.pin} → ${w.b.comp}.${w.b.pin} 接不上引脚，已忽略（${bad}）`);
        continue;
      }
      kept.push(w);
    }
    circuit.wires = kept;
  };
  scan(design.root, "主电路");
  for (const d of design.defs) scan(d.circuit, `子电路 ${d.name}`);
}

function checkForNaN(design: Design, errors: string[]) {
  const bad = (n: unknown) => typeof n === "number" && !Number.isFinite(n);
  for (const c of design.root.comps) {
    if (bad(c.x) || bad(c.y)) errors.push(`元件 ${c.id} 坐标非有限数`);
    for (const [k, v] of Object.entries(c.params ?? {})) {
      if (bad(v)) errors.push(`元件 ${c.id} 参数 ${k} 非有限数`);
    }
  }
  for (const d of design.defs) {
    for (const c of d.circuit.comps) {
      if (bad(c.x) || bad(c.y)) errors.push(`子电路 ${d.id} 中元件 ${c.id} 坐标非有限数`);
    }
  }
}

function sanitizeCircuit(
  circuit: Partial<Circuit> | undefined,
  known: Set<string>,
  errors: string[],
  warnings: string[],
  where: string
): Circuit {
  const comps: CompInstance[] = [];
  const ids = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void errors;
  for (const c of circuit?.comps ?? []) {
    if (!c || typeof c.id !== "string" || typeof c.type !== "string") {
      warnings.push(`${where}：忽略形状不完整的元件`);
      continue;
    }
    if (!baseDef(c.type) && !known.has(c.type) && !c.type.startsWith("custom:")) {
      // FIX-05: 未知元件改为警告而非静默丢弃；保留在结果中由调用方决定如何处理。
      warnings.push(`${where}：未知元件 ${c.type}（保留但仿真可能受限）`);
    }
    if (c.type.startsWith("custom:") && !known.has(c.type) && !c.type.slice(7)) continue;
    if (ids.has(c.id)) c.id = c.id + "_" + ids.size;
    ids.add(c.id);
    comps.push({
      id: c.id,
      type: c.type,
      x: Number(c.x) || 0,
      y: Number(c.y) || 0,
      rot: ((Number(c.rot) || 0) % 4) as CompInstance["rot"],
      flip: !!c.flip,
      name: c.name ? String(c.name) : undefined,
      params: (c.params && typeof c.params === "object" ? c.params : {}) as Record<string, number | string | boolean>,
    });
  }
  const wires: Wire[] = [];
  for (const w of circuit?.wires ?? []) {
    if (!w?.a || !w?.b) {
      warnings.push(`${where}：忽略形状不完整的导线`);
      continue;
    }
    if (!ids.has(w.a.comp) || !ids.has(w.b.comp)) {
      warnings.push(`${where}：忽略悬空导线`);
      continue;
    }
    wires.push({
      id: typeof w.id === "string" && w.id ? w.id : "w" + wires.length,
      a: { comp: w.a.comp, pin: String(w.a.pin) },
      b: { comp: w.b.comp, pin: String(w.b.pin) },
      via: Array.isArray(w.via) ? w.via.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : undefined,
    });
  }
  return { comps, wires, view: circuit?.view };
}

export function emptyDesign(name = "未命名设计"): Design {
  return { name, root: { comps: [], wires: [] }, defs: [] };
}

export function cloneDesign(design: Design): Design {
  return JSON.parse(JSON.stringify(design)) as Design;
}

/* --------------------------- 本地存储 --------------------------- */

export interface SlotInfo {
  key: string;
  name: string;
  savedAt: string;
}

function hasStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function saveSlot(key: string, design: Design): boolean {
  if (!hasStorage()) return false;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + "slot:" + key, serialize(design));
    return true;
  } catch {
    return false;
  }
}

export function loadSlot(key: string): Design | undefined {
  if (!hasStorage()) return undefined;
  const text = window.localStorage.getItem(STORAGE_PREFIX + "slot:" + key);
  if (!text) return undefined;
  return parse(text).design;
}

export function deleteSlot(key: string) {
  if (!hasStorage()) return;
  window.localStorage.removeItem(STORAGE_PREFIX + "slot:" + key);
}

export function listSlots(): SlotInfo[] {
  if (!hasStorage()) return [];
  const prefix = STORAGE_PREFIX + "slot:";
  const out: SlotInfo[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    const raw = window.localStorage.getItem(k) ?? "";
    const file = JSON.parse(raw || "{}") as Partial<SaveFile>;
    out.push({
      key: k.slice(prefix.length),
      name: file.design?.name ?? k.slice(prefix.length),
      savedAt: file.savedAt ?? "",
    });
  }
  return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function pickTextFile(): Promise<{ name: string; text: string } | undefined> {
  if (!hasStorage()) return undefined;
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(undefined);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: f.name, text: String(reader.result ?? "") });
      reader.onerror = () => resolve(undefined);
      reader.readAsText(f);
    };
    input.click();
  });
}
