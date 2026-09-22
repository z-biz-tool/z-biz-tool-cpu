import { Tooltip } from "antd";
import { useMemo, useState } from "react";
import { CATEGORY_LABEL, paletteDefs } from "../core/registry.ts";
import type { CompCategory, CompDef } from "../core/types.ts";
import { defCost, useEditor } from "./store.ts";

/* ------------------------------------------------------------------ *
 * 元件库：分类折叠 + 搜索，点击后进入放置模式
 * ------------------------------------------------------------------ */

const ORDER: CompCategory[] = ["io", "gate", "math", "mux", "bus", "seq", "mem", "util"];

export default function Palette() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ gate: true });
  const placing = useEditor((s) => s.placing);
  const setPlacing = useEditor((s) => s.setPlacing);
  const design = useEditor((s) => s.design);
  const view = useEditor((s) => s.view);
  const enterView = useEditor((s) => s.enterView);
  const deleteDef = useEditor((s) => s.deleteDef);
  const renameDef = useEditor((s) => s.renameDef);

  const groups = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const hit = (d: CompDef) =>
      !kw || d.label.toLowerCase().includes(kw) || d.type.toLowerCase().includes(kw) || (d.symbol ?? "").toLowerCase().includes(kw);
    const map = new Map<CompCategory, CompDef[]>();
    for (const def of paletteDefs(true)) {
      if (def.boundary && def.category !== "io") continue;
      if (!hit(def)) continue;
      const list = map.get(def.category) ?? [];
      list.push(def);
      map.set(def.category, list);
    }
    return ORDER.filter((c) => map.has(c)).map((c) => ({ category: c, defs: map.get(c)! }));
  }, [q]);

  const defs = design.defs;

  return (
    <div className="palette">
      <input className="search" placeholder="搜索元件…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="palette-scroll">
        {groups.map(({ category, defs: list }) => {
          const key = category;
          const shown = open[key] !== false;
          return (
            <section key={key} className="pal-group">
              <button
                className="pal-head"
                onClick={() => setOpen((o) => ({ ...o, [key]: !shown }))}
              >
                <span className="caret">{shown ? "▾" : "▸"}</span>
                {CATEGORY_LABEL[category] ?? category}
                <em>{list.length}</em>
              </button>
              {shown && (
                <div className="pal-items">
                  {list.map((def) => (
                    <Tooltip key={def.type} title={def.description ?? def.label} placement="right">
                      <button
                        className={"pal-item" + (placing?.type === def.type ? " on" : "")}
                        onClick={() => setPlacing(placing?.type === def.type ? null : def.type)}
                      >
                        <span className="pal-glyph">{def.symbol ?? def.label.slice(0, 2)}</span>
                        <span className="pal-label">{def.label}</span>
                        <span className="pal-cost">{def.free ? "—" : def.cost}</span>
                      </button>
                    </Tooltip>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        <section className="pal-group">
          <button className="pal-head" onClick={() => setOpen((o) => ({ ...o, custom: !(o.custom !== false) }))}>
            <span className="caret">{open.custom !== false ? "▾" : "▸"}</span>
            子电路
            <em>{defs.length}</em>
          </button>
          {open.custom !== false && (
            <div className="pal-items">
              {defs.length === 0 && <p className="hint">选中若干元件后按 G 或点「封装」，即可打包成可复用的子电路。</p>}
              {defs.map((d) => {
                const type = "custom:" + d.id;
                return (
                  <div key={d.id} className={"pal-item row" + (placing?.type === type ? " on" : "")}>
                    <button
                      className="grow"
                      onClick={() => setPlacing(placing?.type === type ? null : type)}
                      title="点击后可在画布放置该子电路"
                    >
                      <span className="pal-glyph">{d.name.slice(0, 2)}</span>
                      <span className="pal-label">{d.name}</span>
                      <span className="pal-cost">{defCost(design, d.id)}</span>
                    </button>
                    <button className="mini" onClick={() => enterView(d.id)} title="进入子电路编辑">
                      {view === d.id ? "●" : "✎"}
                    </button>
                    <button
                      className="mini"
                      onClick={() => {
                        const name = window.prompt("子电路名称", d.name);
                        if (name) renameDef(d.id, name);
                      }}
                      title="重命名"
                    >
                      A
                    </button>
                    <button className="mini danger" onClick={() => deleteDef(d.id)} title="删除子电路">
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <div className="pal-foot">
        <button className="btn" onClick={() => useEditor.getState().newDesign()}>
          新建
        </button>
        <button className="btn" onClick={() => useEditor.getState().saveTo("slot")} title="存到浏览器本地">
          存档
        </button>
        <button className="btn" onClick={() => useEditor.getState().loadFrom("slot")} title="读回上次的存档">
          读档
        </button>
        <Tooltip title="把当前设计导出成 JSON 文本">
          <button className="btn" onClick={() => exportJson(useEditor.getState().exportText())}>
            导出
          </button>
        </Tooltip>
        <label className="btn file">
          导入
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const report = useEditor.getState().importText(await file.text());
              if (report.length) window.alert(report.join("\n"));
            }}
          />
        </label>
      </div>
    </div>
  );
}

/** 触发一次浏览器下载 */
function exportJson(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "cpu-design.json";
  a.click();
  URL.revokeObjectURL(url);
}
