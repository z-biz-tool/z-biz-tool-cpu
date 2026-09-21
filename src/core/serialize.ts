import { baseDef } from "./registry.ts";
import type { Circuit, CompInstance, Design, Wire } from "./types.ts";

/* ------------------------------------------------------------------ *
 * 存档 / 导入导出
 * ------------------------------------------------------------------ */

export const FORMAT = "z-biz-tool-cpu/1";
export const STORAGE_PREFIX = "z-biz-tool-cpu:";

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
}

/** 宽松解析：丢弃未知元件与悬空导线，保证旧存档不至于打不开 */
export function parse(text: string): ParseResult {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { errors: ["JSON 解析失败：" + (e as Error).message] };
  }
  const obj = raw as Partial<SaveFile> & Partial<Design>;
  const design = obj.design ?? (obj.root ? obj : undefined);
  if (!design || !design.root) return { errors: ["缺少 root 电路，可能不是本工具的设计文件"] };
  const known = new Set<string>((design.defs ?? []).map((d) => "custom:" + d.id));
  const cleaned: Design = {
    name: String(design.name ?? "未命名设计"),
    root: sanitizeCircuit(design.root, known, errors, "主电路"),
    defs: (design.defs ?? []).map((d) => ({
      id: String(d.id),
      name: String(d.name ?? "子电路"),
      circuit: sanitizeCircuit(d.circuit, known, errors, d.name ?? d.id),
    })),
  };
  for (const d of cleaned.defs) known.add("custom:" + d.id);
  return { design: cleaned, errors };
}

function sanitizeCircuit(
  circuit: Partial<Circuit> | undefined,
  known: Set<string>,
  errors: string[],
  where: string
): Circuit {
  const comps: CompInstance[] = [];
  const ids = new Set<string>();
  for (const c of circuit?.comps ?? []) {
    if (!c || typeof c.id !== "string" || typeof c.type !== "string") continue;
    if (!baseDef(c.type) && !known.has(c.type) && !c.type.startsWith("custom:")) {
      errors.push(`${where}：忽略未知元件 ${c.type}`);
      continue;
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
    if (!w?.a || !w?.b) continue;
    if (!ids.has(w.a.comp) || !ids.has(w.b.comp)) {
      errors.push(`${where}：忽略悬空导线`);
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
