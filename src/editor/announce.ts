import { RUN_STATE_TEXT, type RunStateCode } from "../core/sim.ts";
import { SAVE_STATE_TEXT, type SaveStateLabel } from "../project/saveState.ts";
import { endName } from "./a11y.ts";

/* ------------------------------------------------------------------ *
 * doc 02 §10：保存 / 运行 / 判题 / 连线都是"动态信息"，读屏要能听到，但不能
 * 追着波形逐拍念。所以这里只认「状态枚举变了」这一件事：一次只播一句最重要的
 * 话（判题 > 保存 > 运行 > 撤销 > 连线 > 选区），并且把 pending/saving 这种每敲
 * 一下就翻新的中间态静音掉。
 * ------------------------------------------------------------------ */

/** 连线这一块要念的是"意图 + 结果"：有没有线头挂在画布上、这轮相比上轮多/少了哪根 */
export interface WireFacts {
  /** 挂起的起点，形如 "comp.pin"；没有起点时 null */
  pending: string | null;
  links: { from: string; to: string }[];
}

export interface AnnounceFacts {
  run: RunStateCode;
  save: SaveStateLabel;
  saveError?: string;
  judge: { pass: boolean; ok: number; total: number; levelId: string } | null;
  selection: { comps: string[]; wires: string[] };
  wire: WireFacts;
  /** 最近一次撤销/重做：seq 变一次就播一句 */
  history: { seq: number; kind: "undo" | "redo"; label: string };
  labels: Map<string, string>;
}

export type AnnounceSeen = {
  run: string;
  save: string;
  judge: string;
  sel: string;
  wire: { pending: string | null; links: string[] };
  history: number;
};

/** 中间态念出来会把读屏淹掉：连续编辑时 pending→saving→saved 每半秒翻一次 */
const QUIET_SAVE: SaveStateLabel[] = ["unsaved", "pending", "saving"];

/** 需要解释的状态给全文，正常的开关机只给一句标题 */
const VERBOSE_RUN: RunStateCode[] = ["halted", "oscillating", "resource-limit", "error"];

export function factsKey(f: AnnounceFacts): AnnounceSeen {
  return {
    run: f.run,
    save: QUIET_SAVE.includes(f.save) ? "" : f.save,
    judge: f.judge ? `${f.judge.levelId}:${f.judge.ok}/${f.judge.total}` : "",
    sel: [...f.selection.comps, ...f.selection.wires].join(","),
    wire: { pending: f.wire.pending, links: f.wire.links.map(linkRef) },
    history: f.history.seq,
  };
}

const judgeLine = (f: AnnounceFacts) => {
  const j = f.judge;
  if (!j) return "判题结果已清空";
  return j.pass
    ? `判题通过：${j.ok} 项测试全部成功`
    : `判题未通过：${j.ok}/${j.total} 项通过，还差 ${j.total - j.ok} 项`;
};

const saveLine = (f: AnnounceFacts) => {
  const t = SAVE_STATE_TEXT[f.save];
  if (f.save === "saved") return t.label + "：" + t.detail;
  return t.label + (f.saveError ? "：" + f.saveError : "：" + t.detail);
};

const runLine = (f: AnnounceFacts) => {
  const t = RUN_STATE_TEXT[f.run];
  return VERBOSE_RUN.includes(f.run) ? t.label + "。" + t.detail : t.label;
};

function selLine(f: AnnounceFacts) {
  const { comps, wires } = f.selection;
  if (!comps.length && !wires.length) return "未选中任何元件";
  const heads = comps.slice(0, 4).map((id) => f.labels.get(id) ?? id).join("、");
  const more = comps.length > 4 ? `…共 ${comps.length} 个` : "";
  const parts = [];
  if (comps.length) parts.push(`${comps.length} 个元件：${heads}${more}`);
  if (wires.length) parts.push(`${wires.length} 根导线`);
  return "已选中 " + parts.join("、");
}

const linkRef = (l: { from: string; to: string }) => `${l.from}>${l.to}`;

/**
 * 撤销/重做这一路只念"哪个动作被撤掉了"，标签直接来自历史栈（pushHistory 传的
 * 就是动作名）。没有标签是老快照或历史被清空，那就只说撤了上一步，不编动作名。
 */
const historyLine = (f: AnnounceFacts) => {
  const verb = f.history.kind === "undo" ? "已撤销" : "已重做";
  return f.history.label ? `${verb}：${f.history.label}` : `${verb}上一步操作`;
};

const pendingLine = (f: AnnounceFacts) =>
  `连线起点已选 ${endName(f.wire.pending!, f.labels)}：再点一个端口完成连线，按 Esc 取消`;

/**
 * 连线这一路要回答三个问题：线头现在在谁手上、这根线落下去没有、断掉的是哪根。
 * 起点→终点是在同一次操作里连续翻的（pending 消失 + 多出一根线），所以先看差集
 * 再看 pending，否则"接好了"会被念成"已取消"。
 */
function wireLine(f: AnnounceFacts, prev: { pending: string | null; links: string[] }) {
  const name = (ref: string) => endName(ref, f.labels);
  const spoken = (ref: string) => {
    const [a, b] = ref.split(">");
    return `${name(a)} → ${name(b)}`;
  };
  const next = f.wire.links.map(linkRef);
  const added = next.filter((r) => !prev.links.includes(r));
  const removed = prev.links.filter((r) => !next.includes(r));
  if (added.length === 1) return `已接好一根线：${spoken(added[0])}`;
  if (added.length > 1) return `已接好 ${added.length} 根线：${spoken(added[0])}`;
  /* 断线和一个新起点同时出现＝改接：只说"已断开"，用户不知道手上还攥着线头，
     下一口回车会把他以为已经拆掉的那一端接回去。两句并成一句先讲结果再讲下一步。 */
  if (removed.length === 1 && f.wire.pending) return `已拆下 ${spoken(removed[0])}；${pendingLine(f)}`;
  if (removed.length === 1) return `已断开一根线：${spoken(removed[0])}`;
  if (removed.length > 1) return `已断开 ${removed.length} 根线`;
  if (f.wire.pending) return pendingLine(f);
  /* 只清掉起点、线一根没多：可能是按了 Esc，也可能是这一接被拒（端点在这个电路里
     接不上，或这一对本来就有线）。三种情况对用户的结论相同——没有新线接上。 */
  if (prev.pending) return "连线已取消：没有新线接上";
  return `连线有变化：现在共 ${next.length} 根`;
}

/**
 * 状态变了就返回要播的那句 + 新的基线；没变返回 null（什么都不播）。
 * 一次只处理最高优先级的一条，剩下的下一轮再讲，避免叠成一句谁也听不清的话。
 */
export function nextAnnouncement(
  f: AnnounceFacts,
  seen: AnnounceSeen,
): { say: string; seen: AnnounceSeen } | null {
  const next = factsKey(f);
  const out: AnnounceSeen = { ...seen };
  if (next.judge !== seen.judge) return { say: judgeLine(f), seen: Object.assign(out, { judge: next.judge }) };
  /* 中间态这一路整个跳过（连基线都不动）：saved→pending→saving→saved 是一圈
   * 噪音，若按"键位变化"判断就会把刚被静音的那句又念出来。 */
  if (next.save && next.save !== seen.save) return { say: saveLine(f), seen: Object.assign(out, { save: next.save }) };
  if (next.run !== seen.run) return { say: runLine(f), seen: Object.assign(out, { run: next.run }) };
  /* 撤销/重做排在连线之前，并且要把由它派生的连线与选区增减一起消费掉：
     撤掉"接一根线"在状态里就是一次 wires 减少，不消费的话下一轮听到的是
     「已断开一根线：X → Y」，用户会以为软件替他按了删除。 */
  if (next.history !== seen.history) {
    return {
      say: historyLine(f),
      seen: Object.assign(out, { history: next.history, wire: next.wire, sel: next.sel }),
    };
  }
  /* 连线排在选区之前：删掉一段电路时"断了几根线"比"选中了什么"更是结论。 */
  const wireChanged =
    next.wire.pending !== seen.wire.pending || next.wire.links.join("|") !== seen.wire.links.join("|");
  if (wireChanged) return { say: wireLine(f, seen.wire), seen: Object.assign(out, { wire: next.wire }) };
  if (next.sel !== seen.sel) return { say: selLine(f), seen: Object.assign(out, { sel: next.sel }) };
  return null;
}
