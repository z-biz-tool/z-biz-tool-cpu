/* ------------------------------------------------------------------ *
 * IMP-08 / 04_§4 Worker 协议 — 命令 + 响应判别联合（discriminated union）。
 * 不依赖外部校验器；手写 `validateCommand` / `validateResponse` 拒绝 unknown
 * shape，避免让 `unknown` payload 进入内核。
 * ------------------------------------------------------------------ */

import type { Design } from "../core/types.ts";
import type { PinValue, SimLog, SimSnapshot } from "../core/sim.ts";

export const WORKER_PROTOCOL = "z-biz-tool-cpu/sim/1";

export type SimCommand =
  | "compile"
  | "setInput"
  | "step"
  | "run"
  | "pause"
  | "reset"
  | "snapshot"
  | "restore"
  | "subscribeTrace"
  | "dispose";

export interface WorkerRequest {
  requestId: string;
  sessionId: string;
  designRevision: number;
  command: SimCommand;
  payload?: unknown;
}

export type WorkerResponseType = "ack" | "delta" | "result" | "error";

export interface WorkerResponse {
  requestId: string;
  sessionId: string;
  designRevision: number;
  sequence: number;
  type: WorkerResponseType;
  payload?: unknown;
}

/** 编译命令 payload — 必须携带设计快照；运行实例独立维护 */
export interface CompilePayload {
  design: Design;
  keepState?: boolean;
}

/** setInput payload */
export interface SetInputPayload {
  compId: string;
  value: number;
}

/** step / run payload — 推进多少拍；run 还可以带 maxTicks 取消阈值 */
export interface AdvancePayload {
  steps: number;
  maxTicks?: number;
}

/** subscribeTrace payload — 列出要采集的信号；空表示全采样 */
export interface SubscribeTracePayload {
  comps?: string[];
  wildcard?: boolean;
}

/** restore payload */
export interface RestorePayload {
  snapshot: SimSnapshot;
}

/** delta 事件 payload — 单条仿真事件序列 */
export interface DeltaPayload {
  events: { tick: number; delta: number; compId: string; pin: string; value: number; width: number; driven: boolean }[];
}

/** result payload — 拍数 / 当前时间 / 输出 */
export interface ResultPayload {
  done: boolean;
  halted: boolean;
  tick: number;
  unstable: boolean;
  hasBlockingError: boolean;
  /** 当前选中一组输出探针的快照 */
  probes: { id: string; name: string; label: string; value?: PinValue }[];
  logs: SimLog[];
  errorMsg?: string;
}

/** error payload — 不可恢复的仿真错误 */
export interface ErrorPayload {
  message: string;
  /** 当前是不是 worker 内部崩溃 — 让上层可重建 */
  fatal?: boolean;
}

/** 给定对象判断是不是已知命令；返回规范化后的命令或 null */
export function validateCommand(raw: unknown): WorkerRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.requestId !== "string" || typeof r.sessionId !== "string") return null;
  if (typeof r.designRevision !== "number") return null;
  if (typeof r.command !== "string") return null;
  const valid: SimCommand[] = [
    "compile", "setInput", "step", "run", "pause", "reset", "snapshot", "restore", "subscribeTrace", "dispose",
  ];
  if (!valid.includes(r.command as SimCommand)) return null;
  return {
    requestId: r.requestId,
    sessionId: r.sessionId,
    designRevision: r.designRevision,
    command: r.command as SimCommand,
    payload: r.payload,
  };
}

/** 给定对象判断是不是已知响应；返回规范化后的响应或 null */
export function validateResponse(raw: unknown): WorkerResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.requestId !== "string" || typeof r.sessionId !== "string") return null;
  if (typeof r.designRevision !== "number") return null;
  if (typeof r.sequence !== "number") return null;
  if (typeof r.type !== "string") return null;
  const valid: WorkerResponseType[] = ["ack", "delta", "result", "error"];
  if (!valid.includes(r.type as WorkerResponseType)) return null;
  return {
    requestId: r.requestId,
    sessionId: r.sessionId,
    designRevision: r.designRevision,
    sequence: r.sequence,
    type: r.type as WorkerResponseType,
    payload: r.payload,
  };
}

/** payload 类型守卫 */
export function isCompilePayload(p: unknown): p is CompilePayload {
  return !!p && typeof p === "object" && (p as { design?: unknown }).design !== undefined;
}
export function isSetInputPayload(p: unknown): p is SetInputPayload {
  return !!p && typeof p === "object" && typeof (p as { compId?: unknown }).compId === "string" && typeof (p as { value?: unknown }).value === "number";
}
export function isAdvancePayload(p: unknown): p is AdvancePayload {
  return !!p && typeof p === "object" && typeof (p as { steps?: unknown }).steps === "number";
}
export function isRestorePayload(p: unknown): p is RestorePayload {
  return !!p && typeof p === "object" && typeof (p as { snapshot?: unknown }).snapshot === "object";
}
export function isSubscribeTracePayload(p: unknown): p is SubscribeTracePayload {
  if (!p || typeof p !== "object") return false;
  const pp = p as Record<string, unknown>;
  return pp.comps === undefined || Array.isArray(pp.comps);
}
