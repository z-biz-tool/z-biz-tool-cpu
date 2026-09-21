/* ------------------------------------------------------------------ *
 * M1 ProjectFile 校验与迁移 — 不依赖 zod；纯手工 validator 返回 issues 数组。
 * 配合 05_§6 资源预算；不允许的输入结构以 errors[] 形式回到调用方。
 * ------------------------------------------------------------------ */

import type { Design, CompInstance, Wire } from "../core/types.ts";
import { baseDef } from "../core/registry.ts";
import {
  CATALOG_VERSION,
  ISA_VERSION,
  KERNEL_VERSION,
  PROJECT_SCHEMA_VERSION,
  PROJECT_BUDGET,
  type ComponentLock,
  type ProjectFile,
  type Testbench,
  type WatchConfig,
} from "./types.ts";

/** 校验结果：errors 阻断使用，warnings 仅提示 */
export interface ValidationIssue {
  level: "error" | "warning";
  path: string;
  msg: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** 规范化后的 ProjectFile — 必要时把缺省字段补齐 */
  project?: ProjectFile;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isArr = Array.isArray;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/** 入口：把任意 JSON 对象尝试解析为 ProjectFile */
export function validateProjectFile(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  try {
    const proj = walkProject(raw, "$", issues);
    if (issues.some((i) => i.level === "error")) return { ok: false, issues };
    return { ok: true, issues, project: proj };
  } catch (e) {
    // WalkAbort 表示 walker 主动终止；其它错误向上抛
    if (e instanceof WalkAbort) return { ok: false, issues };
    throw e;
  }
}

function walkProject(raw: unknown, path: string, issues: ValidationIssue[]): ProjectFile {
  if (!isObj(raw)) {
    issues.push({ level: "error", path, msg: "项目必须是对象" });
    throw new WalkAbort();
  }
  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== PROJECT_SCHEMA_VERSION) {
    issues.push({
      level: "error",
      path: path + ".schemaVersion",
      msg: `不支持的 schemaVersion=${String(schemaVersion)}，当前为 ${PROJECT_SCHEMA_VERSION}`,
    });
    throw new WalkAbort();
  }
  const id = ensureStr(raw.id, path + ".id", issues);
  const title = ensureStr(raw.title, path + ".title", issues) || "未命名项目";
  const revision = ensureInt(raw.revision, path + ".revision", issues, { min: 0 }) ?? 0;
  const kernelVersion = ensureStr(raw.kernelVersion, path + ".kernelVersion", issues) || KERNEL_VERSION;
  const isaVersion = ensureStr(raw.isaVersion, path + ".isaVersion", issues) || ISA_VERSION;
  const catalogVersion = ensureStr(raw.catalogVersion, path + ".catalogVersion", issues) || CATALOG_VERSION;

  const design = walkDesign(raw.design, path + ".design", issues);
  const assemblyFiles = walkAssemblyFiles(raw.assemblyFiles, path + ".assemblyFiles", issues);
  const testbenches = walkTestbenches(raw.testbenches, path + ".testbenches", issues);
  const watchConfig = walkWatchConfig(raw.watchConfig, path + ".watchConfig", issues);
  const componentLocks = walkComponentLocks(raw.componentLocks, path + ".componentLocks", issues);
  const courseContext = raw.courseContext
    ? walkCourseContext(raw.courseContext, path + ".courseContext", issues)
    : undefined;

  if (issues.some((i) => i.level === "error")) throw new WalkAbort();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    title,
    revision,
    kernelVersion,
    isaVersion,
    catalogVersion,
    design,
    assemblyFiles,
    testbenches,
    watchConfig,
    componentLocks,
    courseContext,
  };
}

function walkDesign(raw: unknown, path: string, issues: ValidationIssue[]): Design {
  if (!isObj(raw)) {
    issues.push({ level: "error", path, msg: "design 必须是对象" });
    throw new WalkAbort();
  }
  if (!isObj(raw.root)) {
    issues.push({ level: "error", path: path + ".root", msg: "root 必须是对象" });
    throw new WalkAbort();
  }
  const comps: CompInstance[] = [];
  if (isArr(raw.root.comps)) {
    if (raw.root.comps.length > PROJECT_BUDGET.expandedComps) {
      issues.push({
        level: "error",
        path: path + ".root.comps",
        msg: `元件数 ${raw.root.comps.length} 超过 ${PROJECT_BUDGET.expandedComps}`,
      });
    }
    const ids = new Set<string>();
    raw.root.comps.forEach((c, i) => {
      const cp = path + ".root.comps[" + i + "]";
      if (!isObj(c)) {
        issues.push({ level: "error", path: cp, msg: "元件项不是对象" });
        return;
      }
      const id = isStr(c.id) ? c.id : "c" + i;
      const type = isStr(c.type) ? c.type : "";
      if (!type) {
        issues.push({ level: "error", path: cp + ".type", msg: "缺少 type" });
        return;
      }
      if (type.startsWith("custom:")) {
        issues.push({ level: "warning", path: cp + ".type", msg: "封装引用请同时在 defs 中提供定义" });
      } else if (!baseDef(type)) {
        issues.push({ level: "warning", path: cp + ".type", msg: "未知元件类型：" + type });
      }
      const uniq = ids.has(id) ? id + "_" + ids.size : id;
      ids.add(uniq);
      comps.push({
        id: uniq,
        type,
        x: Math.round(isNum(c.x) ? c.x : 0),
        y: Math.round(isNum(c.y) ? c.y : 0),
        rot: (((isInt(c.rot) ? c.rot : 0) % 4) + 4) % 4 as 0 | 1 | 2 | 3,
        flip: isBool(c.flip) ? c.flip : false,
        name: isStr(c.name) ? c.name : undefined,
        params: isObj(c.params)
          ? Object.fromEntries(
              Object.entries(c.params).filter(([, v]) => isNum(v) || isStr(v) || isBool(v)),
            ) as Record<string, string | number | boolean>
          : {},
      });
    });
  }
  const wires: Wire[] = [];
  if (isArr(raw.root.wires)) {
    if (raw.root.wires.length > PROJECT_BUDGET.expandedWires) {
      issues.push({
        level: "error",
        path: path + ".root.wires",
        msg: `导线数 ${raw.root.wires.length} 超过 ${PROJECT_BUDGET.expandedWires}`,
      });
    }
    raw.root.wires.forEach((w, i) => {
      const wp = path + ".root.wires[" + i + "]";
      if (!isObj(w) || !isObj(w.a) || !isObj(w.b)) {
        issues.push({ level: "error", path: wp, msg: "导线形状错误" });
        return;
      }
      wires.push({
        id: isStr(w.id) && w.id ? w.id : "w" + i,
        a: { comp: String(w.a.comp ?? ""), pin: String(w.a.pin ?? "") },
        b: { comp: String(w.b.comp ?? ""), pin: String(w.b.pin ?? "") },
        via: isArr(w.via)
          ? w.via
              .filter(
                (p): p is { x: number; y: number } =>
                  isObj(p) && isNum(p.x) && isNum(p.y),
              )
          : undefined,
      });
    });
  }
  return { name: isStr(raw.name) ? raw.name : "未命名设计", root: { comps, wires }, defs: [] };
}

function walkAssemblyFiles(raw: unknown, path: string, issues: ValidationIssue[]): Record<string, string> {
  if (raw === undefined) return {};
  if (!isObj(raw)) {
    issues.push({ level: "error", path, msg: "assemblyFiles 必须是对象" });
    throw new WalkAbort();
  }
  const out: Record<string, string> = {};
  let total = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!isStr(v)) {
      issues.push({ level: "error", path: `${path}.${k}`, msg: "源码项必须是字符串" });
      continue;
    }
    total += v.length;
    if (total > PROJECT_BUDGET.assemblySourceBytes) {
      issues.push({
        level: "error",
        path,
        msg: `源码总大小超过 ${PROJECT_BUDGET.assemblySourceBytes} 字节`,
      });
      continue;
    }
    out[k] = v;
  }
  return out;
}

function walkTestbenches(raw: unknown, path: string, issues: ValidationIssue[]): Testbench[] {
  if (raw === undefined) return [];
  if (!isArr(raw)) {
    issues.push({ level: "error", path, msg: "testbenches 必须是数组" });
    throw new WalkAbort();
  }
  return raw.map((t, i) => {
    if (!isObj(t)) {
      issues.push({ level: "error", path: `${path}[${i}]`, msg: "测试台项不是对象" });
      throw new WalkAbort();
    }
    const id = isStr(t.id) ? t.id : "tb" + i;
    const revision = isStr(t.revision) ? t.revision : "1";
    const inputs = isArr(t.inputs) ? t.inputs : [];
    const expectations = isArr(t.expectations) ? t.expectations : [];
    const maxTicks = ensureInt(t.maxTicks, `${path}[${i}].maxTicks`, issues, { min: 1 }) ?? 1000;
    return { id, revision, inputs, expectations, maxTicks, seed: isInt(t.seed) ? t.seed : undefined };
  });
}

function walkWatchConfig(raw: unknown, path: string, issues: ValidationIssue[]): WatchConfig {
  if (raw === undefined) return { signals: [], breakpoints: [] };
  if (!isObj(raw)) {
    issues.push({ level: "error", path, msg: "watchConfig 必须是对象" });
    throw new WalkAbort();
  }
  const signals = isArr(raw.signals)
    ? raw.signals.filter((s) => isObj(s) && isArr((s as Record<string, unknown>).instancePath) && isStr((s as Record<string, unknown>).pinId))
    : [];
  const breakpoints = isArr(raw.breakpoints)
    ? raw.breakpoints.filter((b) => isObj(b) && (isStr((b as Record<string, unknown>).sourceFile) || isInt((b as Record<string, unknown>).line) || isInt((b as Record<string, unknown>).address)))
    : [];
  return { signals: signals as WatchConfig["signals"], breakpoints: breakpoints as WatchConfig["breakpoints"] };
}

function walkComponentLocks(raw: unknown, path: string, issues: ValidationIssue[]): ComponentLock[] {
  if (raw === undefined) return [];
  if (!isArr(raw)) {
    issues.push({ level: "error", path, msg: "componentLocks 必须是数组" });
    throw new WalkAbort();
  }
  return raw.map((l, i) => {
    if (!isObj(l)) {
      issues.push({ level: "error", path: `${path}[${i}]`, msg: "锁项不是对象" });
      throw new WalkAbort();
    }
    return {
      definitionId: isStr(l.definitionId) ? l.definitionId : "",
      componentId: isStr(l.componentId) ? l.componentId : "",
      version: isInt(l.version) ? l.version : 1,
      contentHash: isStr(l.contentHash) ? l.contentHash : "",
    };
  });
}

function walkCourseContext(raw: unknown, path: string, issues: ValidationIssue[]): { levelId: string; revision: string } {
  if (!isObj(raw)) {
    issues.push({ level: "error", path, msg: "courseContext 必须是对象" });
    throw new WalkAbort();
  }
  return {
    levelId: isStr(raw.levelId) ? raw.levelId : "",
    revision: isStr(raw.revision) ? raw.revision : "1",
  };
}

function ensureStr(raw: unknown, path: string, issues: ValidationIssue[]): string {
  if (isStr(raw)) return raw;
  issues.push({ level: "error", path, msg: "必须是字符串" });
  return "";
}

function ensureInt(raw: unknown, path: string, issues: ValidationIssue[], opts: { min?: number } = {}): number | undefined {
  if (!isInt(raw)) {
    issues.push({ level: "error", path, msg: "必须是整数" });
    return undefined;
  }
  if (opts.min !== undefined && raw < opts.min) {
    issues.push({ level: "error", path, msg: `必须 ≥ ${opts.min}` });
    return undefined;
  }
  return raw;
}

class WalkAbort extends Error {
  constructor() {
    super("walk aborted");
  }
}
