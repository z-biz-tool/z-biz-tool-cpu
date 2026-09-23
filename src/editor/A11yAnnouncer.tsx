import { useEffect, useRef, useState } from "react";
import { compLabel } from "./a11y.ts";
import { type AnnounceFacts, type AnnounceSeen, factsKey, nextAnnouncement } from "./announce.ts";
import { useEditor } from "./store.ts";

/* ------------------------------------------------------------------ *
 * doc 02 §10：非打断式状态播报的落地出口——一个视觉隐藏、辅助技术可见的
 * role=status 区域。文案怎么选（哪些状态算噪声、一次播几句）都在 announce.ts。
 * ------------------------------------------------------------------ */

export function A11yAnnouncer() {
  const sim = useEditor((s) => s.sim);
  const running = useEditor((s) => s.running);
  const tick = useEditor((s) => s.tick);
  const save = useEditor((s) => s.save);
  const result = useEditor((s) => s.result);
  const selection = useEditor((s) => s.selection);
  const pendingWire = useEditor((s) => s.pendingWire);
  const design = useEditor((s) => s.design);
  const comps = useEditor((s) => s.circuit().comps);
  const wires = useEditor((s) => s.circuit().wires);
  const seen = useRef<AnnounceSeen | null>(null);
  const [say, setSay] = useState("");
  /* 名字簿只增不减：断线那句要报出两端，可"删除元件"这一步恰好把名字一起删掉了。
     浏览器实测过：全选删除后播报成「已断开一根线：csu256zit53.out → cx35etegtwu.in」，
     一串对不上任何画面的 id。改完是「… → 输出灯.in」。改名会覆盖旧值，所以不会念错。 */
  const nameBook = useRef(new Map<string, string>());

  useEffect(() => {
    for (const c of comps) nameBook.current.set(c.id, compLabel(design, c));
    const facts: AnnounceFacts = {
      run: sim.runState(running).code,
      save: save.label,
      saveError: save.error,
      judge: result ? { pass: result.pass, ok: result.ok, total: result.total, levelId: result.levelId } : null,
      selection,
      /* 连线事实只由 wires/pendingWire 推出来：不在这儿建 a11y 模型，
         否则每仿真一拍都要重算一遍端口表，播报通道反倒成了性能坑。 */
      wire: {
        pending: pendingWire ? `${pendingWire.comp}.${pendingWire.pin}` : null,
        links: wires.map((w) => ({ from: `${w.a.comp}.${w.a.pin}`, to: `${w.b.comp}.${w.b.pin}` })),
      },
      labels: nameBook.current,
    };
    // 开机第一眼不算"变化"：否则读屏刚连上就被一句「已暂停」打断
    if (!seen.current) {
      seen.current = factsKey(facts);
      return;
    }
    const r = nextAnnouncement(facts, seen.current);
    if (!r) return;
    seen.current = r.seen;
    setSay(r.say);
  }, [tick, running, save, result, selection, pendingWire, comps, design, wires, sim]);

  return (
    <div className="a11y-only" id="a11y-live" aria-label="状态播报">
      <p role="status" aria-live="polite" aria-atomic="true">
        {say}
      </p>
    </div>
  );
}
