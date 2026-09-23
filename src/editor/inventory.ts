import { defOf } from "../core/custom.ts";
import type { CompInstance, Design } from "../core/types.ts";

/* ------------------------------------------------------------------ *
 * 元件清单的账：画布上到底有些什么
 *
 * 原来只按 def.label 聚合，输入输出脚（boundary）和认不出定义的元件都被跳过，
 * 于是「一个只有输入脚和输出脚的半加器骨架」会被报成「画布还是空的」——
 * 而画布上明明有 4 个元件。三种「清单是空的」是不同的事，话得说得不一样。
 * ------------------------------------------------------------------ */

export interface Inventory {
  /** 普通元件按显示名聚合，数量多的在前，最多 12 项 */
  chips: [string, number][];
  /** 被 12 项上限挤掉、没显示出来的类别数 */
  hidden: number;
  /** 输入／输出脚这类边界元件：是元件，但不参与逻辑，也不计花费 */
  boundary: number;
  /** registry 里查不到定义的元件：导入的旧档、或被删掉的子电路 */
  unknown: number;
}

export function componentInventory(design: Design): Inventory {
  const byLabel = new Map<string, number>();
  let boundary = 0;
  let unknown = 0;
  const walk = (comps: CompInstance[] | undefined) => {
    for (const c of comps ?? []) {
      const def = defOf(design, c.type, c.params);
      if (!def) unknown++;
      else if (def.boundary) boundary++;
      else byLabel.set(def.label, (byLabel.get(def.label) ?? 0) + 1);
    }
  };
  walk(design?.root?.comps);
  for (const d of design?.defs ?? []) walk(d.circuit?.comps);
  const all = [...byLabel.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    chips: all.slice(0, 12),
    hidden: all.length - Math.min(all.length, 12),
    boundary,
    unknown,
  };
}

/** 聚合芯片为空时该说哪一句；还有认不出的元件时由芯片自己开口，这里不重复 */
export function emptyInventoryHint(inv: Inventory): string {
  if (inv.chips.length || inv.unknown) return "";
  return inv.boundary ? `只有 ${inv.boundary} 个输入／输出脚，还没有逻辑元件。` : "画布还是空的。";
}
