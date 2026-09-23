import { useEffect, useRef, useState } from "react";
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
  const comps = useEditor((s) => s.circuit().comps);
  const seen = useRef<AnnounceSeen | null>(null);
  const [say, setSay] = useState("");

  useEffect(() => {
    const facts: AnnounceFacts = {
      run: sim.runState(running).code,
      save: save.label,
      saveError: save.error,
      judge: result ? { pass: result.pass, ok: result.ok, total: result.total, levelId: result.levelId } : null,
      selection,
      labels: new Map(comps.map((c) => [c.id, c.name || c.id])),
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
  }, [tick, running, save, result, selection, comps, sim]);

  return (
    <div className="a11y-only" id="a11y-live" aria-label="状态播报">
      <p role="status" aria-live="polite" aria-atomic="true">
        {say}
      </p>
    </div>
  );
}
