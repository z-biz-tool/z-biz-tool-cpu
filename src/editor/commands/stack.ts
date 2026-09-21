/* ------------------------------------------------------------------ *
 * IMP-07 编辑命令栈 — 可撤销/重做的命令模型，包裹 mutate/mutateLayout。
 *
 * 设计要点：
 *  1. 一个用户动作（一次拖动、一次参数编辑）只产生一条撤销记录。
 *  2. 拓扑变更与纯布局变更分别打标记：拓扑 undo 后，测试结果标记"旧版本"。
 *  3. 拖动过程中支持 beginTransaction / endTransaction；中途 Esc 触发 cancel
 *     把已积累的 mutation 整体回滚到 pre-tx 快照。
 *  4. 命令仅作用于当前 view 的 Circuit；不接触 simulator，由上层 store 决定
 *     是否重建。
 * ------------------------------------------------------------------ */

import type { Circuit, Design } from "../../core/types.ts";
import { cloneDesign } from "../../core/serialize.ts";

/** 命令类别 — 用于上层决定 rebuild sim / 标记测试陈旧 */
export type CommandKind = "topology" | "layout" | "param-non-structural";

/** 命令接口：把 Circuit 操作包成一个可重放的 (undo/redo) 单元 */
export interface Command {
  label: string;
  kind: CommandKind;
  /** 在当前电路上执行的回调 */
  apply: (c: Circuit) => void;
  /** 反向撤销的回调；如省略则用前后快照代替 */
  revert?: (c: Circuit) => void;
  /** 命令携带的语义哈希，用于课程判定"旧版本" */
  semanticHash?: number;
}

interface HistoryEntry {
  label: string;
  kind: CommandKind;
  /** 命令执行前的设计引用 */
  prev: Design;
  /** 命令执行后的设计引用 */
  next: Design;
  semanticHash?: number;
}

const MAX_HISTORY = 60;

export class CommandStack {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** 事务模式：累积命令，最后 commit / rollback */
  private txBuffer: HistoryEntry[] = [];
  private txPrev: Design | null = null;
  private txLabel = "";
  private txKind: CommandKind = "topology";

  size() {
    return this.undoStack.length;
  }

  /** 不参与事务的命令 — 立即执行并入栈 */
  exec(design: Design, cmd: Command): Design {
    const next = cloneDesign(design);
    cmd.apply(this.circuitOf(next));
    this.push({
      label: cmd.label,
      kind: cmd.kind,
      prev: design,
      next,
      semanticHash: cmd.semanticHash,
    });
    return next;
  }

  /** 事务入口：记录起点 */
  beginTransaction(label: string, kind: CommandKind, design: Design) {
    if (this.txPrev) this.commitTransaction();
    this.txLabel = label;
    this.txKind = kind;
    this.txPrev = cloneDesign(design);
    this.txBuffer = [];
  }

  /** 把命令应用并暂存到事务缓冲；事务未开启时退化为 exec */
  execInTx(design: Design, cmd: Command): Design {
    if (!this.txPrev) return this.exec(design, cmd);
    const next = cloneDesign(design);
    cmd.apply(this.circuitOf(next));
    this.txBuffer.push({
      label: cmd.label,
      kind: cmd.kind,
      prev: design,
      next,
      semanticHash: cmd.semanticHash,
    });
    return next;
  }

  /** 事务结束 — 把累积的命令合并成一条 undo 记录 */
  commitTransaction(): Design | null {
    if (!this.txPrev || this.txBuffer.length === 0) {
      this.txPrev = null;
      return null;
    }
    const first = this.txBuffer[0].prev;
    const last = this.txBuffer[this.txBuffer.length - 1].next;
    const label = this.txLabel + ` (×${this.txBuffer.length})`;
    this.push({
      label,
      kind: this.txKind,
      prev: first,
      next: last,
    });
    this.txPrev = null;
    this.txBuffer = [];
    return last;
  }

  /** 回滚事务：丢弃所有缓冲；调用方应把 design 还原到 txPrev */
  rollbackTransaction(): Design | null {
    const prev = this.txPrev;
    this.txPrev = null;
    this.txBuffer = [];
    return prev;
  }

  /** 重做：从 redo 栈拉一条重做；返回新 design 或 null */
  redoLast(_design: Design): Design | null {
    const last = this.redoStack[this.redoStack.length - 1];
    if (!last) return null;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack.push(last);
    return last.next;
  }

  /** 撤销：从 undo 栈拉一条；返回新 design 与陈旧标记 */
  undoOne(design: Design): { prev: Design; kind: CommandKind; semanticHash?: number } | null {
    const last = this.undoStack[this.undoStack.length - 1];
    if (!last) return null;
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack.push({ label: last.label + "（重做）", kind: last.kind, prev: design, next: last.prev, semanticHash: last.semanticHash });
    return { prev: last.prev, kind: last.kind, semanticHash: last.semanticHash };
  }

  private push(entry: HistoryEntry) {
    this.undoStack = [...this.undoStack.slice(-MAX_HISTORY + 1), entry];
    this.redoStack = [];
  }

  /** 取目标 view 的 Circuit 引用，view 不识别时退回 root */
  private circuitOf(design: Design): Circuit {
    return design.root;
  }
}
