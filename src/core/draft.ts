import { deleteSlot, parse, readSlotText, serialize, slotSavedAt, writeSlotText } from "./serialize.ts";
import type { Design } from "./types.ts";

/* ------------------------------------------------------------------ *
 * doc 02 §5.3：自动存档草稿在多标签页之间的写入权
 *
 * 不用「localStorage 锁标记 + 定时器」假装互斥：标签页崩了会把用户锁在门外，
 * 时钟一漂又会两边同时写。这里只做一件诚实的事 —— 写前比对：
 *  1. 载入草稿时记住读到的原文
 *  2. 每次要写之前重读一次，原文没变才写
 *  3. 原文变了 = 期间有别的标签页写过 → 立即停写共享草稿：本页设计另存为
 *     冲突副本、转入只读，绝不静默覆盖别人那一版
 * ------------------------------------------------------------------ */

export const DRAFT_KEY = "autosave";

export interface ConflictInfo {
  /** 冲突副本所在存档位；副本也没写进去时为空串 */
  copyKey: string;
  /** 副本的设计名，给用户看的 */
  copyName: string;
  /** 对方那一版草稿的保存时间，解析不出来时为空串 */
  by: string;
}

export type DraftWrite =
  | { kind: "written" }
  | { kind: "failed"; error: string }
  | ({ kind: "conflict" | "blocked" } & ConflictInfo);

function copyName(design: Design): string {
  const base = design.name.replace(/（冲突副本[^）]*）$/, "").trim() || "未命名设计";
  return `${base}（冲突副本 ${new Date().toISOString().slice(5, 16).replace("T", " ")}）`;
}

export class DraftWriter {
  /** 本页最后读到 / 写出的草稿原文，null = 当时是空的 */
  private seen: string | null = null;
  private conflict: ConflictInfo | null = null;
  private readonly key: string;
  readonly tabId = Math.random().toString(36).slice(2, 8);

  constructor(key: string = DRAFT_KEY) {
    // 不用构造参数属性：node --experimental-strip-types 只剥类型，遇到会直接崩
    this.key = key;
  }

  /** 读出草稿，同时把原文记为写入权的比对基准 */
  load(): Design | undefined {
    const text = readSlotText(this.key);
    this.seen = text;
    return text ? parse(text).design : undefined;
  }

  conflictInfo(): ConflictInfo | null {
    return this.conflict;
  }

  commit(design: Design): DraftWrite {
    if (this.conflict) return { kind: "blocked", ...this.conflict };
    const cur = readSlotText(this.key);
    if (cur !== this.seen) {
      const name = copyName(design);
      const info: ConflictInfo = { copyKey: "conflict-" + this.tabId, copyName: name, by: cur ? slotSavedAt(cur) : "" };
      const saved = writeSlotText(info.copyKey, serialize({ ...design, name }));
      this.conflict = saved ? info : { ...info, copyKey: "", copyName: "" };
      return { kind: "conflict", ...this.conflict };
    }
    const text = serialize(design);
    if (!writeSlotText(this.key, text)) return { kind: "failed", error: "浏览器本地存储写入失败（配额已满或被禁用）" };
    this.seen = text;
    return { kind: "written" };
  }

  /** 用户显式「以本页为准」：接受对方那一版作为新基线并重拿写入权；
   *  本页的冲突副本此刻已经不需要了（内容就在内存里，且即将写进草稿） */
  resume(): ConflictInfo | null {
    const was = this.conflict;
    this.conflict = null;
    this.seen = readSlotText(this.key);
    if (was?.copyKey) deleteSlot(was.copyKey);
    return was;
  }
}
