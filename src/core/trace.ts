/* ------------------------------------------------------------------ *
 * FIX-07: 增量事件 TraceStore — 记录 simulator 每拍的信号值变化，
 * 用于波形绘制、失败回放与历史浏览（04_仿真内核与调试设计 §5）
 *
 * TraceEvent 字段对应设计文档：
 *   sessionId、tick、delta、sequence、signalId、value、width、driven
 * signalId 由 comp.id '.' pin 构成（与 dbg-01 一致）；sequence 用于排序同一拍多个变化。
 * ------------------------------------------------------------------ */

export interface SignalRef {
  /** 完整实例路径，例如 "root/dataPath/ALU-A"；简写用 comp.id */
  compId: string;
  pin: string;
}

export interface TraceEvent {
  /** 仿真器实例标识（多 Inspector 时区分） */
  sessionId: string;
  /** 逻辑时间 tick */
  tick: number;
  /** 同 tick 内的 delta 编号；0=组合结算前，1..N=时序采样后 */
  delta: number;
  /** 同 tick/delta 内的递增序列号 */
  sequence: number;
  /** 信号 */
  signal: SignalRef;
  value: number;
  /** 位宽（信号净宽） */
  width: number;
  /** 是否被驱动；false 表示悬空读零 */
  driven: boolean;
}

export const TRACE_FORMAT = "trace/1";

/** 每信号保留多少条历史；超过后淘汰最旧（按 tick 升序裁剪） */
export const TRACE_LIMIT = 4096;

/** 用户可见的"最近 N 拍"窗口大小（UI 默认） */
export const TRACE_WINDOW_DEFAULT = 64;

/** 把完整实例路径拍平成字符串；以 "/" 分隔 */
export function signalIdOf(ref: SignalRef): string {
  return ref.compId + "." + ref.pin;
}

export class TraceStore {
  readonly sessionId: string;
  /** 按信号分桶的事件 */
  private bySignal = new Map<string, TraceEvent[]>();
  /** 全局按写入顺序 */
  private all: TraceEvent[] = [];
  /** 全局递增序号（每个事件唯一） */
  private seq = 0;
  /** 当前 tick / delta，每条事件会带着它们快照 */
  private tick = 0;
  private delta = 0;
  /** 是否正在采样 */
  private capturing = false;
  /** 已订阅的 signal；空表示全部 */
  private subscribed = new Set<string>();
  /** 简单订阅模式：true = 跟踪全部已命名信号；false = 只跟踪 subscribed 中的 */
  private wildcard = true;

  constructor(sessionId = "session") {
    this.sessionId = sessionId;
  }

  /** 切换"全信号采样"或"只采样订阅集合" */
  setMode(opts: { wildcard?: boolean; subscribe?: SignalRef[] }) {
    if (opts.subscribe) {
      this.subscribed.clear();
      for (const s of opts.subscribe) this.subscribed.add(signalIdOf(s));
      this.wildcard = false;
    }
    if (opts.wildcard !== undefined) this.wildcard = opts.wildcard;
  }

  beginTick(tick: number) {
    this.tick = tick;
    this.delta = 0;
    this.capturing = true;
  }

  beginDelta(delta: number) {
    this.delta = delta;
  }

  /** 添加一条信号事件；自动去重（同 tick/delta 内同信号只保留最后值） */
  record(signal: SignalRef, value: number, width: number, driven: boolean) {
    if (!this.capturing) return;
    const id = signalIdOf(signal);
    if (!this.wildcard && !this.subscribed.has(id)) return;
    let bucket = this.bySignal.get(id);
    if (!bucket) {
      bucket = [];
      this.bySignal.set(id, bucket);
    }
    const last = bucket[bucket.length - 1];
    if (last && last.tick === this.tick && last.delta === this.delta && last.sequence === this.seq) {
      last.value = value;
      last.width = width;
      last.driven = driven;
      return;
    }
    const ev: TraceEvent = {
      sessionId: this.sessionId,
      tick: this.tick,
      delta: this.delta,
      sequence: this.seq++,
      signal,
      value: mask32(value, width),
      width,
      driven,
    };
    bucket.push(ev);
    this.all.push(ev);
    if (this.all.length > TRACE_LIMIT) this.evictOldest();
  }

  /** 主动结束一个 tick（保留接口语义；当前实现仅作切换） */
  endTick() {
    this.capturing = true; // 持续捕捉
  }

  reset() {
    this.bySignal.clear();
    this.all = [];
    this.seq = 0;
    this.tick = 0;
    this.delta = 0;
  }

  /** 拿某信号的最后 N 条事件，按时间正序 */
  historyOf(signal: SignalRef, last = TRACE_WINDOW_DEFAULT): TraceEvent[] {
    const bucket = this.bySignal.get(signalIdOf(signal)) ?? [];
    return bucket.slice(-last);
  }

  /** 拿全部事件（按写入顺序） */
  events(): readonly TraceEvent[] {
    return this.all;
  }

  /** 列出已采样的信号 */
  signals(): SignalRef[] {
    return Array.from(this.bySignal.keys()).map((id) => {
      const i = id.lastIndexOf(".");
      return { compId: id.slice(0, i), pin: id.slice(i + 1) };
    });
  }

  private evictOldest() {
    // FIFO：移除全队列最旧的事件，再同步对应信号桶
    const drop = this.all.shift();
    if (!drop) return;
    const id = signalIdOf(drop.signal);
    const bucket = this.bySignal.get(id);
    if (!bucket) return;
    if (bucket[0] === drop) bucket.shift();
    else {
      // 不同引用：找匹配项移除
      const i = bucket.indexOf(drop);
      if (i >= 0) bucket.splice(i, 1);
    }
  }
}

function mask32(v: number, w: number): number {
  if (w <= 0) return 0;
  if (w >= 32) return v | 0;
  return (v >>> 0) & ((1 << w) - 1);
}
