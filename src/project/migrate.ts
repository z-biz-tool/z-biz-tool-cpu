/* ------------------------------------------------------------------ *
 * M1 项目迁移 — 把旧 SaveFile（format=z-biz-tool-cpu/1）升级到 ProjectFile schemaVersion=2。
 * 迁移只读，原文以 raw 串保留在 migrationBackups 中；不能成功迁移前不动用户数据。
 * ------------------------------------------------------------------ */

import type { Design } from "../core/types.ts";
import {
  CATALOG_VERSION,
  ISA_VERSION,
  KERNEL_VERSION,
  PROJECT_SCHEMA_VERSION,
  type ComponentLock,
  type ProjectFile,
  type Testbench,
  type WatchConfig,
} from "./types.ts";

interface LegacySaveFile {
  format: string;
  savedAt: string;
  design: Design;
}

/** §3.3 旧档迁移：从带 format 字段的旧 JSON 进入 ProjectFile */
export interface LegacyImport {
  project?: ProjectFile;
  backup: { raw: string; checksum: string; migrationVersion: number; status: "pending" | "ok" | "failed" };
  warnings: string[];
}

/** 简单校验和 — 用于 migrationBackups 校验，避免重复导入同一文件 */
export function checksum(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function migrateLegacySaveFile(raw: string): LegacyImport {
  const warnings: string[] = [];
  const backup = { raw, checksum: checksum(raw), migrationVersion: 1, status: "ok" as const };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { project: undefined, backup: { ...backup, status: "failed" }, warnings: ["legacy parse failed: " + (e as Error).message] };
  }
  if (!parsed || typeof parsed !== "object") {
    return { project: undefined, backup: { ...backup, status: "failed" }, warnings: ["legacy top-level 不是对象"] };
  }
  const obj = parsed as Partial<LegacySaveFile>;
  if (obj.format !== "z-biz-tool-cpu/1") {
    warnings.push("legacy format 不匹配，按 v2 直接解析");
  }
  const design = obj.design ?? ((obj as Partial<Design>).root ? (parsed as Design) : undefined);
  if (!design || !design.root) {
    return { project: undefined, backup: { ...backup, status: "failed" }, warnings: ["legacy 缺少 design.root"] };
  }
  const project: ProjectFile = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "migrated-" + backup.checksum,
    title: design.name || "迁移项目",
    revision: 1,
    kernelVersion: KERNEL_VERSION,
    isaVersion: ISA_VERSION,
    catalogVersion: CATALOG_VERSION,
    design,
    assemblyFiles: { count: "ldi r0, 1\n" }, // 旧档无 asm，给个最小示例避免空白
    testbenches: [] as Testbench[],
    watchConfig: { signals: [], breakpoints: [] } as WatchConfig,
    componentLocks: [] as ComponentLock[],
  };
  warnings.push("已从 legacy SaveFile 升级到 ProjectFile(v" + PROJECT_SCHEMA_VERSION + ")；asm/snapshots 未携带");
  return { project, backup, warnings };
}

/** 写盘格式 — 当前 ProjectFile 直接 JSON.stringify；下一步可加 minify 与内容哈希 */
export function serializeProject(p: ProjectFile): string {
  return JSON.stringify(p, null, 1);
}
