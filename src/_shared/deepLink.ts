/**
 * zbiz:// 深链接的 **cpu 语义层**。
 *
 * ## 分工
 *
 * | 层 | 在哪 | 管什么 |
 * |----|----|--------|
 * | 协议 | `z-biz-tool-shared/protocol` | 字节级编解码（金标 = Rust `cap-hub`） |
 * | 机制 | `z-biz-tool-shared/protocol` 的 `startDeepLinkReceiver` | 冷启动补取、事件监听、不静默吞掉 |
 * | **语义** | **本文件** | **收到深链后 cpu 该做什么** |
 *
 * ## cpu 支持的动作
 *
 * | action | 含义 |
 * |--------|------|
 * | `open` | 进入/切换到本应用（缺省 action） |
 *
 * `open` 不带参数时只是把 cpu 唤到前台（no-op，不报错）；带参数时定位到具体内容。
 *
 * ## 支持的参数
 *
 * | 参数 | 作用 |
 * |------|------|
 * | `level` | 关卡 id（形如 `t1-gates` / `t2-alu4`），必须真实存在，否则 problem 说「没有这个关卡 X」 |
 * | `book`  | 切书：`logic` \| `memory` \| `fast` |
 * | `panel` | 切右侧面板：`inspector` \| `level` \| `asm` \| `cpu` \| `probe` \| `log` \| `help` \| `workshop` |
 * | `from`  | 发送方，仅用于日志与回执 |
 *
 * ## 路由怎么落
 *
 * 进入某个关卡必须同时把路由切到 `/lesson` —— 因为 cpu 的「书架页」与「课程页」是两条
 * 完全隔离的路由（见 `src/App.tsx` 的 `<Routes>`），URL 才是「现在该显示哪页」的真相。
 * 所以 `onEffect` 里先 `startLevel(id)`（写 store：levelId / mode / homeLevelId / panel），
 * 再 `navigate("/lesson")`。store 是全局的，即便 GamePage 还没挂载，路由切换后它读到的
 * 也是已设好的关卡状态，不会闪书架页。
 */

import { levelById } from "../challenges/levels.ts";
import type { BookKey, PanelKey } from "../editor/store.ts";
import type { Handoff } from "z-biz-tool-shared/protocol";

/** 可被深链定位的「书」白名单 */
export const BOOK_KEYS: readonly BookKey[] = ["logic", "memory", "fast"];

/** 可被深链切换的「面板」白名单 */
export const PANEL_KEYS: readonly PanelKey[] = [
  "inspector",
  "level",
  "asm",
  "cpu",
  "probe",
  "log",
  "help",
  "workshop",
];

/**
 * cpu 的深链结果。
 *
 * `level` / `book` / `panel` 非 null 表示要切到对应内容；
 * `problem` 非 null 表示接不住 —— 前端必须给可见提示（不静默吞掉）。
 */
export interface CpuDeepLinkOutcome {
  /** 要进入的关卡 id；null 表示不带关卡意图 */
  level: string | null;
  /** 要切换到的书；null 表示不带切书意图 */
  book: BookKey | null;
  /** 要切换到的面板；null 表示不带切面板意图 */
  panel: PanelKey | null;
  /** 发送方（from），仅用于提示与日志 */
  from: string | null;
  /** 无法适配时的原因 */
  problem: string | null;
}

/**
 * 把一条深链翻译成 cpu 内的动作。
 *
 * 纯函数 —— 不碰 store、不碰 Tauri、不碰 react-router，所以可以直接单测。
 *
 * @param item 深链
 */
export function resolveCpuDeepLink(item: Handoff): CpuDeepLinkOutcome {
  const outcome: CpuDeepLinkOutcome = {
    level: null,
    book: null,
    panel: null,
    from: item.params.from ?? null,
    problem: null,
  };

  const action = item.action.trim() || "open";
  if (action !== "open") {
    outcome.problem = `不认识的动作 ${action}`;
    return outcome;
  }

  const rawLevel = item.params.level?.trim() ?? "";
  const rawBook = item.params.book?.trim() ?? "";
  const rawPanel = item.params.panel?.trim() ?? "";

  // 关卡：给出来就必须真实存在，否则是「id 不存在」
  if (rawLevel) {
    if (levelById(rawLevel)) {
      outcome.level = rawLevel;
    } else {
      outcome.problem = `没有这个关卡 ${rawLevel}`;
      return outcome;
    }
  }

  // 书：白名单校验
  if (rawBook) {
    if ((BOOK_KEYS as readonly string[]).includes(rawBook)) {
      outcome.book = rawBook as BookKey;
    } else {
      outcome.problem = `不认识的书 ${rawBook}`;
      return outcome;
    }
  }

  // 面板：白名单校验
  if (rawPanel) {
    if ((PANEL_KEYS as readonly string[]).includes(rawPanel)) {
      outcome.panel = rawPanel as PanelKey;
    } else {
      outcome.problem = `不认识的面板 ${rawPanel}`;
      return outcome;
    }
  }

  return outcome;
}
