/* ------------------------------------------------------------------ *
 * doc 02 §5.3 保存状态机 + doc 05 §3.1 保存协议
 *
 * 状态：未保存 / 等待保存 / 保存中 / 已保存·修订 N / 保存失败 / 只读副本
 * 500ms debounce，连续操作最长 2s 触发保存；保存期间又发生编辑时，
 * 只确认已提交修订，新修订仍显示待保存；手动保存要求刷写当前修订。
 *
 * 失败时：常驻错误提示，保留内存草稿，提供重试、导出 JSON、取消离开。
 * ------------------------------------------------------------------ */

export type SaveStateLabel =
  | "unsaved"
  | "pending"
  | "saving"
  | "saved"
  | "failed"
  | "readonly";

export interface SaveState {
  label: SaveStateLabel;
  /** 已确认写入本地的 revision；与待写入的 revision 可能不一致 */
  savedRevision: number;
  /** 当前正在编辑的 revision */
  currentRevision: number;
  /** 保存失败时的错误信息（label=failed 时显示） */
  error?: string;
  /** 失败时可触发的动作 */
  retry?: () => Promise<void>;
  exportJson?: () => string;
  cancelLeave?: () => void;
}

export const DEBOUNCE_MS = 500;
export const MAX_QUEUE_MS = 2000;

/** 状态机输入事件 */
export type SaveEvent =
  | { type: "edit"; delta: number }
  | { type: "flush-start" }
  | { type: "flush-success"; revision: number }
  | { type: "flush-failed"; error: string }
  | { type: "retry-success"; revision: number }
  | { type: "readonly" };

export function nextSaveState(s: SaveState, e: SaveEvent): SaveState {
  switch (e.type) {
    case "edit":
      return { ...s, currentRevision: s.currentRevision + e.delta, label: s.savedRevision === s.currentRevision + e.delta ? "saved" : "pending" };
    case "flush-start":
      return { ...s, label: "saving" };
    case "flush-success":
      return { ...s, label: "saved", savedRevision: e.revision, currentRevision: e.revision, error: undefined };
    case "flush-failed":
      return { ...s, label: "failed", error: e.error };
    case "retry-success":
      return { ...s, label: "saved", savedRevision: e.revision, currentRevision: e.revision, error: undefined };
    case "readonly":
      return { ...s, label: "readonly" };
  }
}

/** 等待触发 flush 的 debouncer */
export class DebouncedSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEditAt = 0;
  private pendingFlush = false;
  private readonly onFlush: () => Promise<void>;
  private readonly debounce: number;
  private readonly maxWait: number;

  constructor(onFlush: () => Promise<void>, debounce = DEBOUNCE_MS, maxWait = MAX_QUEUE_MS) {
    this.onFlush = onFlush;
    this.debounce = debounce;
    this.maxWait = maxWait;
  }

  /** 编辑触发：500ms 内没新编辑就 flush；连续编辑最长 2s 必须 flush */
  trigger() {
    this.pendingFlush = true;
    const now = Date.now();
    if (this.lastEditAt === 0) this.lastEditAt = now;
    if (this.timer) return;
    const remaining = Math.min(this.debounce, this.maxWait - (now - this.lastEditAt));
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pendingFlush) {
        this.pendingFlush = false;
        this.lastEditAt = 0;
        this.onFlush();
      }
    }, Math.max(0, remaining));
  }

  /** 强制立即 flush（手动保存按钮） */
  flushNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingFlush) {
      this.pendingFlush = false;
      this.lastEditAt = 0;
      return this.onFlush();
    }
    return Promise.resolve();
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingFlush = false;
    this.lastEditAt = 0;
  }
}