/// <reference lib="webworker" />
/* ------------------------------------------------------------------ *
 * IMP-08 Worker 仿真运行时 — 把 Simulator 包成可被消息驱动的服务。
 *
 * 设计要点（04_§4）：
 *  - 一次只激活一个交互运行对象；sessionId 区分多 inspector
 *  - 协作式取消：每 N 拍让出，检查 cancelled 标记
 *  - 主线程维护 requestId/revision/sequence；过期请求直接 ignore
 *  - UI 增量刷新 ≤ 30Hz；每 N 拍推送一次 delta
 *
 * 这个模块同时提供"同进程模拟器"（用于 node verify）与可选的
 * WebWorker 适配入口（用于浏览器）。所有类型与状态机同源。
 * ------------------------------------------------------------------ */

import { Simulator, type SimLog } from "../core/sim.ts";
import type { Design } from "../core/types.ts";
import {
  WORKER_PROTOCOL,
  isAdvancePayload,
  isCompilePayload,
  isRestorePayload,
  isSetInputPayload,
  isSubscribeTracePayload,
  validateCommand,
  validateResponse,
  type AdvancePayload,
  type CompilePayload,
  type ErrorPayload,
  type ResultPayload,
  type SubscribeTracePayload,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol.ts";

/** 单次批处理最大拍数；超过则让出事件循环 */
const BATCH_BUDGET = 1000;
/** 帧间让出最大时间（毫秒），防止单批过久 */
const BATCH_YIELD_MS = 8;

export interface SimRuntimeOptions {
  /** tick 让出预算 */
  batchTicks?: number;
  /** 时间让出预算 */
  batchMs?: number;
}

/** 仿真运行时的最小抽象 — 真实 Worker 与 node-side SimBackend 都实现它 */
export interface SimBackend {
  postResponse(resp: WorkerResponse): void;
  onMessage(handler: (req: WorkerRequest) => void): void;
  onResponse(handler: (resp: WorkerResponse) => void): void;
  start?(): void;
}

/** 仿真会话状态 */
export class SimSession {
  readonly id: string;
  designRevision = 0;
  sim: Simulator | null = null;
  /** 当前请求序号 */
  sequence = 0;
  /** 已订阅的 trace 信号 */
  subscribedCompIds: string[] | null = null;
  /** 是否进入 wildcard（全部采样） */
  wildcard = true;

  constructor(id: string) {
    this.id = id;
  }

  dispose() {
    this.sim = null;
  }
}

/** 同进程模拟器 — 把 SimSession 当成 Worker 内部状态；message 即调用 */
export class SimWorkerRuntime {
  readonly session: SimSession;
  private backend: SimBackend;
  private cancelled = false;
  private opts: Required<SimRuntimeOptions>;
  /** 增量事件缓冲：每批推到 UI */
  private eventBuffer: { tick: number; delta: number; compId: string; pin: string; value: number; width: number; driven: boolean }[] = [];

  constructor(session: SimSession, backend: SimBackend, opts: SimRuntimeOptions = {}) {
    this.session = session;
    this.backend = backend;
    this.opts = {
      batchTicks: opts.batchTicks ?? BATCH_BUDGET,
      batchMs: opts.batchMs ?? BATCH_YIELD_MS,
    };
    this.backend.onMessage((req) => this.handle(req));
  }

  start() {
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
  }

  private async handle(req: WorkerRequest) {
    const cmd = req.command;
    try {
      switch (cmd) {
        case "compile": {
          const p = req.payload;
          if (!isCompilePayload(p)) throw new Error("compile payload 缺失 design");
          await this.doCompile(req, p);
          break;
        }
        case "setInput": {
          const p = req.payload;
          if (!isSetInputPayload(p)) throw new Error("setInput payload 非法");
          this.doSetInput(req, p);
          break;
        }
        case "step":
        case "run": {
          const p = req.payload;
          if (!isAdvancePayload(p)) throw new Error("advance payload 非法");
          await this.doAdvance(req, p);
          break;
        }
        case "pause": {
          this.cancelled = true;
          this.respond(req, "ack", { message: "paused" });
          this.sendResult(req);
          break;
        }
        case "reset": {
          this.session.sim?.reset();
          this.respond(req, "ack", { message: "reset" });
          this.sendResult(req);
          break;
        }
        case "snapshot": {
          const snap = this.session.sim?.snapshot();
          this.respond(req, "result", { snapshot: snap });
          break;
        }
        case "restore": {
          const p = req.payload;
          if (!isRestorePayload(p)) throw new Error("restore payload 非法");
          const ok = this.session.sim?.restore(p.snapshot) ?? false;
          this.respond(req, "ack", { restored: ok });
          this.sendResult(req);
          break;
        }
        case "subscribeTrace": {
          if (!isSubscribeTracePayload(req.payload)) throw new Error("subscribe payload 非法");
          this.applySubscribe(req.payload as SubscribeTracePayload);
          this.respond(req, "ack", { message: "subscribed" });
          break;
        }
        case "dispose": {
          this.session.dispose();
          this.respond(req, "ack", { message: "disposed" });
          break;
        }
        default:
          throw new Error("未知命令：" + cmd);
      }
    } catch (e) {
      const ep: ErrorPayload = { message: (e as Error).message, fatal: false };
      this.respond(req, "error", ep);
    }
  }

  private async doCompile(req: WorkerRequest, p: CompilePayload) {
    const design: Design = p.design;
    this.session.designRevision = req.designRevision;
    const sim = new Simulator(design, design.root);
    if (p.keepState && this.session.sim) {
      const prev = this.session.sim.dumpState();
      sim.restoreState(prev);
    }
    this.session.sim = sim;
    this.respond(req, "ack", { message: "compiled" });
    this.sendResult(req);
  }

  private doSetInput(req: WorkerRequest, p: { compId: string; value: number }) {
    if (!this.session.sim) throw new Error("simulator 未编译");
    this.session.sim.setInput(p.compId, p.value);
    this.respond(req, "ack", { compId: p.compId, value: p.value });
    this.sendResult(req);
  }

  private async doAdvance(req: WorkerRequest, p: AdvancePayload) {
    if (!this.session.sim) throw new Error("simulator 未编译");
    this.cancelled = false;
    const start = Date.now();
    let done = false;
    for (let i = 0; i < p.steps; i++) {
      if (this.cancelled) break;
      const ticked = this.session.sim.step();
      if (!ticked) {
        this.respond(req, "ack", { message: "blocked by compile error" });
        this.sendResult(req, "blocked");
        return;
      }
      const halted = !!this.session.sim.valueOf({ comp: findHaltRef(this.session.sim), pin: "in" })?.value;
      if (halted) {
        done = true;
        // 多让一帧让 IO 写入完成
        this.session.sim.step();
        this.flushEvents();
        this.respond(req, "ack", { message: "halted" });
        this.sendResult(req, "halted");
        return;
      }
      if (i > 0 && i % this.opts.batchTicks === 0 && Date.now() - start > this.opts.batchMs) {
        // 让出事件循环 — 模拟器仍处于 ready，可继续处理新请求
        this.flushEvents();
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }
    this.flushEvents();
    this.respond(req, "ack", { message: done ? "halted" : "advanced" });
    this.sendResult(req);
  }

  private applySubscribe(p: SubscribeTracePayload) {
    if (Array.isArray(p.comps)) {
      this.session.subscribedCompIds = p.comps.slice();
      this.session.wildcard = false;
    }
    if (p.wildcard !== undefined) this.session.wildcard = !!p.wildcard;
    if (this.session.sim) {
      this.session.sim.trace.reset();
      this.session.sim.trace.setMode({
        wildcard: this.session.wildcard,
        subscribe: this.session.wildcard ? undefined : this.session.subscribedCompIds?.map((id) => ({ compId: id, pin: "out" })),
      });
    }
  }

  private flushEvents() {
    if (!this.eventBuffer.length) return;
    const events = this.eventBuffer.slice();
    this.eventBuffer = [];
    this.backend.postResponse({
      requestId: "tick",
      sessionId: this.session.id,
      designRevision: this.session.designRevision,
      sequence: ++this.session.sequence,
      type: "delta",
      payload: { events },
    });
  }

  private respond(req: WorkerRequest, type: WorkerResponse["type"], payload?: unknown) {
    this.backend.postResponse({
      requestId: req.requestId,
      sessionId: this.session.id,
      designRevision: this.session.designRevision,
      sequence: ++this.session.sequence,
      type,
      payload,
    });
  }

  private sendResult(req: WorkerRequest, reason?: string) {
    if (!this.session.sim) return;
    const sim = this.session.sim;
    const rp: ResultPayload & { reason?: string } = {
      done: reason === "halted" || reason === "blocked",
      halted: reason === "halted",
      tick: sim.time,
      unstable: sim.unstable,
      hasBlockingError: sim.hasBlockingError,
      probes: sim.probes().map((p) => ({ id: p.id, name: p.name, label: p.label, value: p.value })),
      logs: sim.logs.slice(-200) as SimLog[],
      reason,
    };
    this.backend.postResponse({
      requestId: req.requestId,
      sessionId: this.session.id,
      designRevision: this.session.designRevision,
      sequence: ++this.session.sequence,
      type: "result",
      payload: rp,
    });
  }
}

/** 在没有 done 引脚的电路中，advance 不会因 halt 退出 — 用 fixed N 步 */
function findHaltRef(sim: Simulator): string {
  for (const c of sim.rootComps()) {
    const cn = sim.compById(c.id);
    if (!cn) continue;
    if (cn.inst.name === "DONE" || cn.def.label.includes("DONE")) return c.id;
  }
  return "__none__";
}

/** 同进程 in-memory backend — 用于 node verify */
export class InMemoryBackend implements SimBackend {
  private respHandler: ((r: WorkerResponse) => void) | null = null;
  private msgHandler: ((r: WorkerRequest) => void) | null = null;
  /** 已发出的响应历史，便于 verify 断言 */
  public sent: WorkerResponse[] = [];

  onMessage(handler: (req: WorkerRequest) => void): void {
    this.msgHandler = handler;
  }
  onResponse(handler: (resp: WorkerResponse) => void): void {
    this.respHandler = handler;
  }
  postResponse(resp: WorkerResponse): void {
    this.sent.push(resp);
    if (validateResponse(resp)) this.respHandler?.(resp);
  }
  /** 由 verify 主动投递命令 */
  deliver(req: WorkerRequest): void {
    if (validateCommand(req)) this.msgHandler?.(req);
  }
}

/** Worker 入口：在浏览器里 new Worker(...) 时用此入口调用 */
export function bootWorker(self: DedicatedWorkerGlobalScope & { __session?: SimSession; __runtime?: SimWorkerRuntime }) {
  const backend: SimBackend = {
    onMessage(h) {
      self.onmessage = (ev: MessageEvent<unknown>) => {
        const req = validateCommand(ev.data);
        if (req) h(req);
      };
    },
    onResponse(_h) {
      // 实际不在 bootWorker 直接挂 — runtime 内部直接调用 postResponse
    },
    postResponse(resp) {
      self.postMessage(resp);
    },
  };
  const session = new SimSession("worker");
  const runtime = new SimWorkerRuntime(session, backend);
  self.__session = session;
  self.__runtime = runtime;
  self.postMessage({ protocol: WORKER_PROTOCOL, ready: true });
}
