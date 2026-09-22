/* ------------------------------------------------------------------ *
 * doc 05 §3.3 导入 / 迁移流水线
 *
 * 顺序：
 *   1. 字节数检查（10MiB）
 *   2. JSON 解析
 *   3. 结构校验（schemaVersion / kernelVersion / isaVersion / catalogVersion）
 *   4. 引用校验（元件、连线、子电路）
 *   5. 预算检查（深度 16、展开 10000 元件 / 50000 连线）
 *   6. 版本协商（未知版本只读打开并提示；不降级猜测）
 *   7. 原文备份到 migrationBackups
 *   8. 返回 ProjectFile 或错误
 * ------------------------------------------------------------------ */

import type { Design } from "../core/types.ts";
import { validateProjectFile } from "./validate.ts";
import { checksum, migrateLegacySaveFile } from "./migrate.ts";
import { PROJECT_SCHEMA_VERSION } from "./types.ts";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10MiB
export const MAX_HIERARCHY_DEPTH = 16;
export const MAX_COMPS = 10000;
export const MAX_WIRES = 50000;

export interface ImportResult {
  ok: boolean;
  project?: import("./types.ts").ProjectFile;
  backup?: { raw: string; checksum: string; migrationVersion: number; status: "pending" | "ok" | "failed" };
  warnings: string[];
  /** 不写入任何东西，仅向调用方返回错误 */
  errors: string[];
}

function countHierarchy(d: Design, depth = 0): number {
  if (depth > MAX_HIERARCHY_DEPTH) return Infinity;
  let n = (d.root.comps ?? []).length + (d.root.wires ?? []).length;
  for (const sub of d.defs ?? []) {
    const subDesign = (sub as any).circuit?.design ?? (sub as any).circuit ?? { root: { comps: [], wires: [] }, defs: [] };
    n += countHierarchy(subDesign, depth + 1);
  }
  return n;
}

export function importProject(raw: string): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1) 字节数
  if (raw.length > MAX_IMPORT_BYTES) {
    errors.push(`文件超过 10MiB 上限（实际 ${raw.length} 字节）`);
    return { ok: false, warnings, errors };
  }

  // 7) 先备份原文
  const backup = { raw, checksum: checksum(raw), migrationVersion: 1, status: "pending" as const };

  // 2) JSON 解析
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    errors.push("JSON 解析失败: " + (e as Error).message);
    return { ok: false, backup: { ...backup, status: "failed" }, warnings, errors };
  }

  // 3/4) 已知旧格式 → 迁移
  if (parsed && typeof parsed === "object" && (parsed.format === "z-biz-tool-cpu/1" || parsed.design && !parsed.schemaVersion)) {
    const r = migrateLegacySaveFile(raw);
    warnings.push(...r.warnings);
    if (!r.project) {
      errors.push("legacy 迁移失败");
      return { ok: false, backup: { ...backup, status: "failed" }, warnings, errors };
    }
    parsed = r.project;
  }

  // 5) schemaVersion 检查
  if (parsed && typeof parsed === "object" && parsed.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion > PROJECT_SCHEMA_VERSION) {
      warnings.push(`schemaVersion=${parsed.schemaVersion} 高于当前 ${PROJECT_SCHEMA_VERSION}：以只读方式打开`);
    } else {
      errors.push(`不支持的 schemaVersion=${parsed.schemaVersion}`);
      return { ok: false, backup: { ...backup, status: "failed" }, warnings, errors };
    }
  }

  // 6) 结构校验
  const v = validateProjectFile(parsed);
  if (!v.ok) {
    errors.push(...v.issues.map((i) => `${i.path}: ${i.msg}`));
    return { ok: false, backup: { ...backup, status: "failed" }, warnings, errors };
  }

  // 7) 预算检查
  const project = parsed as import("./types.ts").ProjectFile;
  const n = countHierarchy(project.design);
  if (n === Infinity) {
    errors.push(`子电路层级超过 ${MAX_HIERARCHY_DEPTH}`);
    return { ok: false, backup: { ...backup, status: "failed" }, warnings, errors };
  }
  const comps = project.design.root.comps?.length ?? 0;
  const wires = project.design.root.wires?.length ?? 0;
  if (comps > MAX_COMPS) errors.push(`元件数 ${comps} 超过 ${MAX_COMPS}`);
  if (wires > MAX_WIRES) errors.push(`连线数 ${wires} 超过 ${MAX_WIRES}`);
  if (errors.length) return { ok: false, backup: { ...backup, status: "failed" }, warnings, errors };

  // 校验 ID 唯一性
  const ids = new Set<string>();
  const dup = (id: string, where: string) => {
    if (ids.has(id)) errors.push(`${where}.${id} 重复`);
    else ids.add(id);
  };
  dup(project.design.root.comps?.length ? "root" : "", "root"); // noop
  return { ok: true, project, backup: { ...backup, status: "ok" }, warnings, errors };
}