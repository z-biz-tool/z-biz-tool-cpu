import { deleteSlot, parse, readSlotText, serialize, slotLevelId, slotSavedAt, writeSlotText } from "./serialize.ts";
import type { Design } from "./types.ts";

/* ------------------------------------------------------------------ *
 * doc 02 §5.3 / doc 05 §3.2：自动存档草稿在多标签页之间的归属
 *
 * 两层，一层管「谁有权写」，一层管「写之前有没有踩到别人」：
 *  1. Web Locks 独占编辑权：先打开的标签页拿到锁，后来的直接只读；
 *     锁随标签页关闭自动释放，不设超时也不写锁标记 —— 那套东西在标签页
 *     崩掉时只会把用户锁在门外。浏览器不支持锁时这一层等于没有。
 *  2. 写前比对：本页记住读过的草稿原文，落盘前重读一次，原文变了说明期间
 *     有人写过 → 停写共享草稿，本页设计另存冲突副本并转入只读，绝不静默覆盖。
 *     这一层单独也成立，是锁缺失时的兜底。
 * ------------------------------------------------------------------ */

export const DRAFT_KEY = "autosave";
export const DRAFT_LOCK = "z-biz-tool-cpu:draft";

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
  | { kind: "no-right" }
  | ({ kind: "conflict" | "blocked" } & ConflictInfo);

function copyName(design: Design): string {
  const base = design.name.replace(/（冲突副本[^）]*）$/, "").trim() || "未命名设计";
  return `${base}（冲突副本 ${new Date().toISOString().slice(5, 16).replace("T", " ")}）`;
}

export class DraftWriter {
  /** 本页最后读到 / 写出的草稿原文，null = 当时是空的 */
  private seen: string | null = null;
  /** 最近一次 load／commit 时草稿挂靠的关卡 */
  private loadedLevel = "";
  private conflict: ConflictInfo | null = null;
  private readonly key: string;
  /** 没有编辑权就不碰共享草稿；缺省为一直有权（不支持 Web Locks 的环境） */
  private mayWrite: () => boolean = () => true;
  readonly tabId = Math.random().toString(36).slice(2, 8);

  constructor(key: string = DRAFT_KEY) {
    // 不用构造参数属性：node --experimental-strip-types 只剥类型，遇到会直接崩
    this.key = key;
  }

  setGate(mayWrite: () => boolean) {
    this.mayWrite = mayWrite;
  }

  /** 读出草稿，同时把原文记为写入权的比对基准 */
  load(): Design | undefined {
    const text = readSlotText(this.key);
    this.seen = text;
    this.loadedLevel = text ? slotLevelId(text) : "";
    return text ? parse(text).design : undefined;
  }

  /** 这份草稿属于哪一关（老草稿／沙盒草稿为空串）；开机回到关卡靠它 */
  get loadedLevelId() {
    return this.loadedLevel;
  }

  conflictInfo(): ConflictInfo | null {
    return this.conflict;
  }

  commit(design: Design, levelId?: string | null): DraftWrite {
    if (!this.mayWrite()) return { kind: "no-right" };
    if (this.conflict) return { kind: "blocked", ...this.conflict };
    const cur = readSlotText(this.key);
    if (cur !== this.seen) {
      const name = copyName(design);
      const info: ConflictInfo = { copyKey: "conflict-" + this.tabId, copyName: name, by: cur ? slotSavedAt(cur) : "" };
      const saved = writeSlotText(info.copyKey, serialize({ ...design, name }));
      this.conflict = saved ? info : { ...info, copyKey: "", copyName: "" };
      return { kind: "conflict", ...this.conflict };
    }
    const text = serialize(design, levelId);
    if (!writeSlotText(this.key, text)) return { kind: "failed", error: "浏览器本地存储写入失败（配额已满或被禁用）" };
    this.seen = text;
    this.loadedLevel = levelId ?? "";
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

/* TS 5.9 的 lib.dom 里 Lock 还没有 signal，而取消通知（被抢锁）全靠它 */
type LockWithSignal = Lock & { signal?: AbortSignal };

/**
 * 一份草稿一个 Web Lock。先拿到锁的标签页可写，后来的排队（期间本页只读）；
 * 标签页关闭时浏览器自己释放锁，所以不设超时、不写锁标记 —— 那套东西在标签页
 * 崩掉时只会把用户锁在门外。
 *
 * 关键前提是「不能因为锁不可用就把页面钉死」：平台没有 Web Locks，或者像某些运行时
 * 那样 request 兑现了却从不发放锁，都算锁不可用（且本页从未拿到过锁），此时
 * inControl 恒为 true，交由 DraftWriter 的写前比对兜底。拿到过锁之后的失败不算，
 * 那意味着编辑权已经给了别人。
 */
/** 一次 request() 的痕迹。平台撤回不了排队中的请求，所以只能自己标记作废：
 *  作废的请求真被发放时也立刻原样退回，绝不借它把已经让出去的编辑权捡回来。 */
interface LockReq {
  granted: boolean;
  dropped: boolean;
  release: () => void;
}

export class EditRight {
  private reqs = new Set<LockReq>();
  private locksReal = false;
  private readonly name: string;
  private readonly onChange: (canWrite: boolean) => void;

  constructor(name: string, onChange: (canWrite: boolean) => void) {
    this.name = name;
    this.onChange = onChange;
  }

  get held() {
    for (const r of this.reqs) if (r.granted) return true;
    return false;
  }

  /** 本页此刻能不能写共享草稿 */
  get inControl() {
    return !this.locksReal || this.held;
  }

  /** 返回 false 表示浏览器根本没有 Web Locks */
  acquire(steal = false): boolean {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks?.request) return false;
    this.locksReal = true;
    const req: LockReq = {
      granted: false,
      dropped: false,
      release: () => {},
    };
    const holding = new Promise<void>((res) => {
      req.release = res;
    });
    this.reqs.add(req);
    locks
      .request(this.name, { steal }, (lock) => {
        if (req.dropped) return Promise.resolve();
        req.granted = true;
        // cancel = 别人请求抢锁；abort = 已被强制收走。两种都意味着这一页立刻停笔
        const signal = (lock as LockWithSignal | null)?.signal;
        signal?.addEventListener("cancel", () => this.giveUp(req));
        signal?.addEventListener("abort", () => this.giveUp(req));
        this.notify(true);
        return holding;
      })
      .then(
        () => {
          if (!req.granted && !req.dropped) this.degrade();
        },
        /* 拿到过锁却以失败收场 = 锁被收走（规范里被抢/被 abort 时 request 就以此为信号），
         * 只能转入只读；这里若当成「锁不可用」而 degrade，等于把刚被夺走的写入权
         * 又偷偷还给这一页，两个标签页会同时写草稿。
         * 从没拿到过锁就失败才是真的不支持，退回写前比对。 */
        () => {
          if (req.dropped) return;
          if (req.granted) this.giveUp(req);
          else this.degrade();
        }
      );
    return true;
  }

  /** 「接管草稿」：把编辑权抢过来，对方随之转入只读 */
  claim(): boolean {
    if (this.held) return true;
    // 本页排队中的旧请求先作废：抢到手之后锁位空出来时，那个请求会被发放，
    // 于是这一页凭「本来在排队」又白捡一次编辑权
    for (const r of [...this.reqs]) this.drop(r);
    return this.acquire(true);
  }

  private drop(req: LockReq) {
    req.dropped = true;
    req.granted = false;
    this.reqs.delete(req);
  }

  /* 锁的发放回调可能在 request() 里同步执行（Node 的实现就是这样，浏览器随时可能
   * 改成这样），而调用方往往在这条语句之后才把自己建完（zustand 的 store 就是
   * 这样）。同步通知会踩到还没准备好的状态、异常还会被平台当成「本页放弃了这把锁」，
   * 于是首个标签页反倒变成只读。推迟一拍再报，语义不变。 */
  private notify(canWrite: boolean) {
    queueMicrotask(() => this.onChange(canWrite));
  }

  giveUp(req?: LockReq) {
    for (const r of req ? [req] : [...this.reqs]) {
      const wasHeld = r.granted;
      this.drop(r);
      if (wasHeld) r.release();
    }
    if (!this.held) this.notify(false);
  }

  /** 锁指望不上了：声明放弃这一层，重新允许写（仍有写前比对护着） */
  private degrade() {
    if (!this.locksReal) return;
    this.reqs.clear();
    this.locksReal = false;
    this.notify(true);
  }
}
