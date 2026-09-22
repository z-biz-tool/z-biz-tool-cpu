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
}

export const DEBOUNCE_MS = 500;
export const MAX_QUEUE_MS = 2000;

/** doc 02 §5.3：保存状态的页面语言，顶栏独立显示，不能用运行成功代替保存成功 */
export const SAVE_STATE_TEXT: Record<SaveStateLabel, { label: string; detail: string; tone: "ok" | "info" | "warn" | "error" }> = {
  unsaved: { label: "未保存", detail: "还没有写入过本地草稿。", tone: "info" },
  pending: { label: "等待保存", detail: "有改动尚未落盘：停止编辑 0.5 秒后自动写入，连续编辑最长等 2 秒。", tone: "warn" },
  saving: { label: "保存中", detail: "正在写入浏览器本地存储。", tone: "info" },
  saved: { label: "已保存", detail: "改动已写入浏览器本地存储，刷新后能恢复到这一版。", tone: "ok" },
  failed: { label: "尚未写入本地", detail: "本地存储写入失败：内存里的草稿还在，可以重试，或先导出 JSON 保住成果。", tone: "error" },
  readonly: { label: "只读副本", detail: "另一个标签页正持有这份草稿，本副本不会覆盖它，可另存副本。", tone: "warn" },
};

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
    case "retry-success": {
      // 只确认已提交的那一版：写入期间又改了话，新修订仍然挂着待保存
      const currentRevision = Math.max(s.currentRevision, e.revision);
      return {
        ...s,
        label: currentRevision === e.revision ? "saved" : "pending",
        savedRevision: e.revision,
        currentRevision,
        error: undefined,
      };
    }
    case "flush-failed":
      return { ...s, label: "failed", error: e.error };
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