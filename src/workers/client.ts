/* ------------------------------------------------------------------ *
 * IMP-08 主线程 SimClient — 维护 session / request / revision 跟踪，
 * 拒绝过期响应；UI 层通过 send*() 投递命令；收到 response 转发给回调。
 *
 * 后端抽象兼容两种实现：
 *  - Web Worker（浏览器中）
 *  - InMemoryBackend（node 中跑测试）
 *
 * AT-07 接受：旧版本响应无效、UI 可操作、Worker 异常不污染当前对象。
 * ------------------------------------------------------------------ */

import type { PinValue } from "../core/sim.ts";
import type {
  CompilePayload,
  ResultPayload,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.ts";
import { validateResponse } from "./protocol.ts";

export interface ClientOptions {
  sessionId?: string;
  /** 已知的最新 design revision；早于此值的响应会被拒绝 */
  revision: number;
}

export interface ClientEvents {
  onResult?: (r: ResultPayload) => void;
  onAck?: (r: WorkerResponse) => void;
  onError?: (e: { message: string; fatal?: boolean }) => void;
}

export interface SimClientBackend {
  post(req: WorkerRequest): void;
  onResponse(handler: (resp: WorkerResponse) => void): void;
}

/** Adapter: 把 SimBackend（runtime 用的接口）适配成 SimClientBackend（主线程 client 用的接口） */
export function clientBackendOf(b: {
  onMessage(handler: (req: WorkerRequest) => void): void;
  postResponse(resp: WorkerResponse): void;
  deliver(req: WorkerRequest): void;
  onResponse(handler: (resp: WorkerResponse) => void): void;
}): SimClientBackend {
  return {
    post: (req) => b.deliver(req),
    onResponse: (h) => b.onResponse(h),
  };
}

/** 主线程浏览器侧 backend — 包装 new Worker(...) */
export class WorkerBackend implements SimClientBackend {
  private worker: Worker;
  private handler: ((r: WorkerResponse) => void) | null = null;
  constructor(url: string) {
    this.worker = new Worker(url, { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<unknown>) => {
      const resp = validateResponse(ev.data);
      if (resp) this.handler?.(resp);
    };
  }
  post(req: WorkerRequest): void {
    this.worker.postMessage(req);
  }
  onResponse(handler: (resp: WorkerResponse) => void): void {
    this.handler = handler;
  }
  terminate() {
    this.worker.terminate();
  }
}

export class SimClient {
  private sessionId: string;
  private revision: number;
  private nextReqId = 1;
  /** inflight 请求 → 期望 response 的回调；过期响应丢弃 */
  private pending = new Map<string, (resp: WorkerResponse) => void>();
  private latestResult: ResultPayload | null = null;
  private events: ClientEvents = {};
  /** 已被该 session 拒绝的过期 revision；过期响应不会更新 latestResult */
  private revokedRevisions = new Set<number>();

  constructor(backend: SimClientBackend, opts: ClientOptions) {
    this.sessionId = opts.sessionId ?? "main";
    this.revision = opts.revision;
    backend.onResponse((resp) => this.onResponse(resp));
    this.backend = backend;
  }

  private backend: SimClientBackend;

  setEvents(e: ClientEvents) {
    this.events = e;
  }

  /** 接收 Worker 响应：核对 revision/requestId，拒绝过期 */
  private onResponse(resp: WorkerResponse) {
    if (resp.sessionId !== this.sessionId) return;
    if (this.revokedRevisions.has(resp.designRevision)) return;
    if (resp.designRevision !== this.revision) {
      // 旧版本的响应 — 不更新 latestResult，但允许 ack 通过
      if (resp.type === "ack") {
        const cb = this.pending.get(resp.requestId);
        cb?.(resp);
        this.pending.delete(resp.requestId);
      }
      return;
    }
    if (resp.type === "result" && resp.payload) {
      this.latestResult = resp.payload as ResultPayload;
      this.events.onResult?.(this.latestResult);
    } else if (resp.type === "ack") {
      const cb = this.pending.get(resp.requestId);
      cb?.(resp);
      this.pending.delete(resp.requestId);
      this.events.onAck?.(resp);
    } else if (resp.type === "error") {
      const payload = (resp.payload ?? {}) as { message?: string; fatal?: boolean };
      this.events.onError?.({ message: payload.message ?? "未知错误", fatal: payload.fatal });
    }
  }

  private send(command: WorkerRequest["command"], payload?: unknown): string {
    const requestId = "r" + this.nextReqId++;
    const req: WorkerRequest = { requestId, sessionId: this.sessionId, designRevision: this.revision, command, payload };
    this.backend.post(req);
    return requestId;
  }

  compile(design: CompilePayload["design"], keepState = false): string {
    return this.send("compile", { design, keepState } as CompilePayload);
  }

  setInput(compId: string, value: number): string {
    return this.send("setInput", { compId, value });
  }

  step(steps = 1): string {
    return this.send("step", { steps });
  }

  run(steps: number): string {
    return this.send("run", { steps });
  }

  pause(): string {
    return this.send("pause");
  }

  reset(): string {
    return this.send("reset");
  }

  snapshot(): string {
    return this.send("snapshot");
  }

  restore(snapshot: WorkerRequest["payload"]): string {
    return this.send("restore", snapshot);
  }

  subscribeTrace(comps: string[] | null): string {
    return this.send("subscribeTrace", { comps: comps ?? undefined, wildcard: comps === null });
  }

  dispose(): string {
    return this.send("dispose");
  }

  /** 切换到新版本（撤销旧版响应） */
  bumpRevision(next: number) {
    this.revokedRevisions.add(this.revision);
    this.revision = next;
  }

  /** 等待最新 result；返回 null 表示已超时 */
  async waitForResult(timeoutMs = 1000): Promise<ResultPayload | null> {
    if (this.latestResult) return this.latestResult;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.events.onResult = prev;
        resolve(null);
      }, timeoutMs);
      const prev = this.events.onResult;
      this.events.onResult = (r) => {
        clearTimeout(t);
        this.events.onResult = prev;
        resolve(r);
      };
    });
  }

  result(): ResultPayload | null {
    return this.latestResult;
  }
}

/** 友好工具：UI 显示探针值 */
export function probeValues(r: ResultPayload | null): { id: string; name: string; label: string; value?: PinValue }[] {
  return r?.probes ?? [];
}
