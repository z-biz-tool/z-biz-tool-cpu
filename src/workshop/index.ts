import type { CustomDef } from "../core/types.ts";

/* ------------------------------------------------------------------ *
 * PRJ-02 / IMP-13: 组件工坊（本地）
 *
 * 不建设在线市场，仅管理用户封装 + 课程奖励组件：
 * - 组件本地索引
 * - 版本不可变；升级要显式确认
 * - 旧项目可继续打开旧版本组件，新项目可使用新版本
 * - 升级预览：接口差异、运行测试
 * ------------------------------------------------------------------ */

export interface ComponentManifest {
  id: string;
  version: number;
  title: string;
  description: string;
  /** 顶层端口列表（名称、方向、位宽） */
  interface: { name: string; dir: "in" | "out"; width: number; description?: string }[];
  /** 内部 CustomDef 引用（不可变） */
  def: CustomDef;
  /** 内容哈希（拓扑 + 参数） */
  contentHash: string;
  /** 来源：用户自建 / 课程奖励 / 旧档导入 */
  source: "user" | "course" | "imported";
  createdAt: number;
  /** 升级来源：当 component 是升级版本时记录 */
  supersededBy?: number;
}

export interface WorkshopState {
  components: ComponentManifest[];
}

export function emptyWorkshop(): WorkshopState {
  return { components: [] };
}

function boundaryOf(def: CustomDef): { name: string; dir: "in" | "out"; width: number }[] {
  const sorted = def.circuit.comps
    .filter((c) => c.type === "input" || c.type === "output")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return sorted.map((c) => ({
    name: c.id,
    dir: c.type === "input" ? "in" : "out",
    width: Number(c.params.bitWidth) || 1,
  }));
}

/** 计算 CustomDef 的内容哈希（FNV-1a 风格），用于检测修改 */
export function hashComponent(def: CustomDef): string {
  let h = 2166136261 >>> 0;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  };
  mix(def.id);
  for (const c of def.circuit.comps ?? []) {
    mix(`${c.id}:${c.type}:${JSON.stringify(c.params ?? {})}`);
  }
  for (const w of def.circuit.wires ?? []) {
    mix(`${w.a.comp}.${w.a.pin}->${w.b.comp}.${w.b.pin}`);
  }
  for (const sub of def.circuit.comps.filter((c) => c.type === "custom")) {
    if (sub.params?.defId) mix(String(sub.params.defId));
  }
  return h.toString(16).padStart(8, "0");
}

export function addOrUpdate(state: WorkshopState, def: CustomDef, source: ComponentManifest["source"]): ComponentManifest {
  const hash = hashComponent(def);
  const existing = state.components.find((c) => c.id === def.id && c.contentHash === hash);
  if (existing) return existing;
  const same = state.components.filter((c) => c.id === def.id);
  const nextVersion = same.length ? Math.max(...same.map((c) => c.version)) + 1 : 1;
  const prev = same.find((c) => !c.supersededBy);
  if (prev) prev.supersededBy = nextVersion;
  const manifest: ComponentManifest = {
    id: def.id,
    version: nextVersion,
    title: def.name ?? def.id,
    description: "",
    interface: boundaryOf(def),
    def,
    contentHash: hash,
    source,
    createdAt: Date.now(),
  };
  state.components.push(manifest);
  return manifest;
}

export function findComponent(state: WorkshopState, id: string, version?: number): ComponentManifest | undefined {
  const same = state.components.filter((c) => c.id === id);
  if (!same.length) return undefined;
  if (version !== undefined) return same.find((c) => c.version === version);
  const cur = same.find((c) => !c.supersededBy);
  return cur ?? same[same.length - 1];
}

export interface InterfaceDiff {
  added: string[];
  removed: string[];
  changed: { name: string; reason: string }[];
}

export function diffInterface(prev: ComponentManifest, next: ComponentManifest): InterfaceDiff {
  const before = new Map(prev.interface.map((p) => [p.name, p]));
  const after = new Map(next.interface.map((p) => [p.name, p]));
  const out: InterfaceDiff = { added: [], removed: [], changed: [] };
  for (const [n, p] of before) {
    if (!after.has(n)) out.removed.push(n);
    else {
      const a = after.get(n)!;
      if (a.dir !== p.dir || a.width !== p.width) {
        out.changed.push({ name: n, reason: `${p.dir}/${p.width} → ${a.dir}/${a.width}` });
      }
    }
  }
  for (const n of after.keys()) if (!before.has(n)) out.added.push(n);
  return out;
}

export function manifestToDef(m: ComponentManifest): CustomDef {
  return m.def;
}

/**
 * doc 05 §4：新封装要写名称与端口说明；旧档 / 跳过的先按「待完善元数据」用着，
 * 不阻塞打开，但界面上要如实标出来。
 */
export function lacksMeta(m: ComponentManifest): boolean {
  return !m.title?.trim() || !m.description?.trim() || m.interface.some((p) => !p.description?.trim());
}

/**
 * 删除某个版本并返回新状态（原状态不动）。
 * 若删掉的是该 id 唯一的「当前版」，把剩下的最新版重新指回当前，
 * 否则组件会从工坊里凭空消失。
 */
export function removeVersion(state: WorkshopState, id: string, version: number): WorkshopState | null {
  if (!state.components.some((c) => c.id === id && c.version === version)) return null;
  const rest = state.components.filter((c) => !(c.id === id && c.version === version)).map((c) => ({ ...c }));
  const same = rest.filter((c) => c.id === id).sort((a, b) => a.version - b.version);
  if (same.length && !same.some((c) => !c.supersededBy)) {
    same[same.length - 1].supersededBy = undefined;
  }
  return { components: rest };
}

/* ------------------------- 本地持久化（IMP-13） ------------------------- *
 * 工坊只保存在本机 localStorage；读写都吞掉异常，坏档按空工坊处理。
 * ---------------------------------------------------------------------- */

const LS_KEY = "cpu-workshop-v1";

/** 本地存储里的版本字段；不匹配的旧格式一律按空工坊处理 */
const LS_VERSION = 1;

/** 把存档 JSON 原样还原成工坊状态（保留 user/course 来源标记），结构不符返回 null */
export function hydrateWorkshop(json: string): WorkshopState | null {
  try {
    const obj = JSON.parse(json);
    if (!obj || obj.version !== LS_VERSION || !Array.isArray(obj.components)) return null;
    const components = obj.components
      .filter(
        (c: unknown): c is ComponentManifest =>
          !!c && typeof (c as ComponentManifest).id === "string" && !!(c as ComponentManifest).def
      )
      .map((c: ComponentManifest) => ({
        ...c,
        source: c.source === "course" || c.source === "imported" ? c.source : "user",
      }));
    return { components };
  } catch {
    return null;
  }
}

export function loadWorkshopLocal(): WorkshopState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return emptyWorkshop();
    return hydrateWorkshop(raw) ?? emptyWorkshop();
  } catch {
    return emptyWorkshop();
  }
}

export function saveWorkshopLocal(state: WorkshopState): void {
  try {
    localStorage.setItem(LS_KEY, exportWorkshop(state));
  } catch {
    /* 容量不足时静默：导出备份仍是兜底通道 */
  }
}

export function exportWorkshop(state: WorkshopState): string {
  return JSON.stringify({ version: 1, components: state.components }, null, 2);
}

export function importWorkshop(state: WorkshopState, json: string): { added: number; failed: number } {
  let added = 0,
    failed = 0;
  try {
    const obj = JSON.parse(json);
    if (!obj || !Array.isArray(obj.components)) return { added, failed };
    for (const c of obj.components) {
      if (!c || typeof c.id !== "string" || !c.def) {
        failed++;
        continue;
      }
      const dup = state.components.some((x) => x.id === c.id && x.version === c.version && x.contentHash === c.contentHash);
      if (dup) continue;
      state.components.push({
        id: c.id,
        version: c.version,
        title: c.title,
        description: c.description,
        interface: c.interface,
        def: c.def,
        contentHash: c.contentHash,
        source: "imported",
        createdAt: c.createdAt ?? Date.now(),
        supersededBy: c.supersededBy,
      });
      added++;
    }
  } catch {
    failed++;
  }
  return { added, failed };
}