import { RUN_STATE_TEXT, type RunStateCode } from "../core/sim.ts";
import { SAVE_STATE_TEXT, type SaveStateLabel } from "../project/saveState.ts";

/* ------------------------------------------------------------------ *
 * doc 02 §10：保存 / 运行 / 判题都是"动态信息"，读屏要能听到，但不能追着
 * 波形逐拍念。所以这里只认「状态枚举变了」这一件事：一次只播一句最重要的
 * 话（判题 > 保存 > 运行 > 选区），并且把 pending/saving 这种每敲一下就
 * 翻新的中间态静音掉。
 * ------------------------------------------------------------------ */

export interface AnnounceFacts {
  run: RunStateCode;
  save: SaveStateLabel;
  saveError?: string;
  judge: { pass: boolean; ok: number; total: number; levelId: string } | null;
  selection: { comps: string[]; wires: string[] };
  labels: Map<string, string>;
}

export type AnnounceSeen = { run: string; save: string; judge: string; sel: string };

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
  if (next.sel !== seen.sel) return { say: selLine(f), seen: Object.assign(out, { sel: next.sel }) };
  return null;
}
