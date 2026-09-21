/* ------------------------------------------------------------------ *
 * M1 项目 schema — 按 05_项目存储与课程数据模型 §2 落地：
 *
 *   schemaVersion / kernelVersion / isaVersion / catalogVersion /
 *   levelRevision / revision 都是显式字段；不能用应用版本替代全部版本。
 *
 * ProjectFile.schemaVersion = 2 是首发新格式；旧 SaveFile（format=z-biz-tool-cpu/1）
 * 通过 serialize.ts 升级迁入，保持向后只读。
 * ------------------------------------------------------------------ */

import type { Design } from "../core/types.ts";

/** M1 默认内核/ISA/元件目录版本 — 后续实际发版时跟随 registry/isa 同步 */
export const KERNEL_VERSION = "0.2.0";
export const ISA_VERSION = "z16-v1";
export const CATALOG_VERSION = "catalog-v1";

/** 项目文件 schema 版本（首发为 2） */
export const PROJECT_SCHEMA_VERSION = 2 as const;

/** 单源版本 */
export interface ComponentLock {
  definitionId: string;
  componentId: string;
  version: number;
  contentHash: string;
}

/** 探针/观察配置 — 与 CPU 调试/波形绑定 */
export interface WatchConfig {
  signals: { instancePath: string[]; pinId: string; radix: "bin" | "hex" | "signed" }[];
  cpuAdapterId?: string;
  breakpoints: { sourceFile?: string; line?: number; address?: number }[];
}

/** 用户测试台；不允许 eval/任意 JS 执行，按 §5 仅声明式断言 */
export interface Testbench {
  id: string;
  revision: string;
  inputs: { name: string; events: { tick: number; value: number | string }[] }[];
  expectations: {
    outputs?: { name: string; equals: number | string }[];
    memory?: { name: string; at: number; equals: number | string }[];
    halt?: { at?: number };
    noDiagnostic?: boolean;
  }[];
  maxTicks: number;
  seed?: number;
}

/** 项目文件 — 旧 SaveFile 升级后纳入此结构 */
export interface ProjectFile {
  schemaVersion: 2;
  /** 稳定项目 ID（uuid） */
  id: string;
  title: string;
  /** 用户工程编辑版本，每次保存递增 */
  revision: number;
  kernelVersion: string;
  isaVersion: string;
  catalogVersion: string;
  design: Design;
  /** 源码文件：相对项目内的命名空间，不对应磁盘路径 */
  assemblyFiles: Record<string, string>;
  testbenches: Testbench[];
  watchConfig: WatchConfig;
  componentLocks: ComponentLock[];
  /** 进入关卡时存在；记录题目 id 与修订 */
  courseContext?: { levelId: string; revision: string };
}

/** §3 数据库表 - 类型定义（runtime 不依赖 Dexie） */
export interface ProjectsRow {
  id: string;
  title: string;
  headRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DraftsRow {
  projectId: string;
  revision: number;
  projectFile: ProjectFile;
  semanticHash: string;
  savedAt: string;
}

export interface AttemptsRow {
  id: string;
  projectId: string;
  levelId: string;
  levelRevision: string;
  designHash: string;
  frozenProjectFile: ProjectFile;
  inputEvents: { tick: number; value: number }[];
  seed?: number;
  result: "pass" | "fail" | "timeout" | "cancelled" | "error";
  assistance: { usedHintAt?: number[]; sawReference?: boolean };
  firstFailure?: { tick?: number; got: unknown; want: unknown; input?: number };
  medals?: string[];
  savedAt: string;
}

export interface ProgressRow {
  courseId: string;
  levelId: string;
  status: "in_progress" | "passed" | "released";
  medals: string[];
  masteryEvidence?: { taskId: string; passedAt: string }[];
  legacy?: boolean;
}

export interface ComponentRow {
  componentId: string;
  version: number;
  interface: { name: string; pins: { id: string; kind: "in" | "out"; width: number | "auto" }[] };
  design: Design;
  tests?: Testbench[];
  hash: string;
}

export interface SettingsRow {
  key: string;
  value: unknown;
}

export interface MigrationBackupsRow {
  sourceKey: string;
  raw: string;
  checksum: string;
  migrationVersion: number;
  status: "pending" | "ok" | "failed";
}

/** §6 资源预算 — 已是最大规模初始策略，可被课程覆盖，但不能超过 */
export const PROJECT_BUDGET = {
  importBytes: 10 * 1024 * 1024,        // 10 MiB
  assemblySourceBytes: 256 * 1024,      // 256 KiB
  defsDepth: 16,
  expandedComps: 10000,
  expandedWires: 50000,
  singleStorageWords: 65536,
  kernelRuntimeBytes: 128 * 1024 * 1024, // 128 MiB
  debugBytes: 64 * 1024 * 1024,          // 64 MiB
  courseOutputBytes: 1 * 1024 * 1024,    // 1 MiB
} as const;
