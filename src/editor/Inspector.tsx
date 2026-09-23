import { Select, Switch, Tooltip } from "antd";
import { useMemo, useState } from "react";
import { customDefOf, defOf } from "../core/custom.ts";
import { sortDiags } from "../core/netlist.ts";
import { bin, hex, type CompInstance, type ParamSpec } from "../core/types.ts";
import { componentInventory, emptyInventoryHint } from "./inventory.ts";
import { defCost, designCost, useEditor } from "./store.ts";

/* ------------------------------------------------------------------ *
 * 属性面板：元件参数、实时引脚值、子电路信息
 * ------------------------------------------------------------------ */

export default function Inspector() {
  const design = useEditor((s) => s.design);
  const view = useEditor((s) => s.view);
  const selection = useEditor((s) => s.selection);
  const sim = useEditor((s) => s.sim);
  const tick = useEditor((s) => s.tick);
  const st = useEditor.getState;

  const circuit = view === "root" ? design.root : design.defs.find((d) => d.id === view)?.circuit ?? design.root;
  const picked = selection.comps.map((id) => circuit.comps.find((c) => c.id === id)).filter(Boolean) as CompInstance[];

  void tick;
  if (!picked.length) return <EmptyInfo />;
  if (picked.length > 1) return <MultiInfo comps={picked} />;
  const comp = picked[0];
  const def = defOf(design, comp.type, comp.params);
  if (!def) return <EmptyInfo />;
  const custom = comp.type.startsWith("custom:") ? customDefOf(design, comp.type.slice(7)) : undefined;

  return (
    <div className="panel-body">
      <div className="head">
        <span className="title">{def.label}</span>
        <span className="tag">{def.category}</span>
        <span className="tag">花费 {def.free ? "—" : custom ? custom.cost : def.cost}</span>
      </div>
      {def.description && <p className="desc">{def.description}</p>}

      <label className="field">
        <span>名称</span>
        <input
          value={comp.name ?? ""}
          placeholder="给元件起个名字，便于探针观察"
          onChange={(e) => st().setCompName(comp.id, e.target.value)}
        />
      </label>

      {def.params?.length ? (
        <div className="params">
          {def.params.map((spec) => (
            <ParamField key={spec.key} spec={spec} value={comp.params[spec.key] ?? spec.default} onSet={(v) => st().setParam(comp.id, spec.key, v)} />
          ))}
        </div>
      ) : (
        <p className="hint">该元件没有可调参数。</p>
      )}

      <div className="pins">
        <h4>引脚实时值</h4>
        {def.pins.map((p) => {
          const v = sim.valueOf({ comp: comp.id, pin: p.id });
          // doc 02 §5.2：悬空输入读出来也是 0，看起来和"真的接地"一模一样，
          // 所以必须在引脚行上标出未驱动，不能只靠值本身让人猜。
          const floating = p.kind === "in" && v !== undefined && !v.driven;
          return (
            <div className="pin-row" key={p.id}>
              <span className={"dir " + p.kind}>{p.kind === "in" ? "→" : "←"}</span>
              <span className="pin-name">{p.label || p.id}</span>
              {floating && (
                <span className="undriven" title="没有输出或导线接到这个引脚，仿真按 0 读取">
                  未驱动
                </span>
              )}
              <span className="mono">{v ? (v.width > 4 ? hex(v.value, v.width) : bin(v.value, v.width)) : "—"}</span>
              <span className="bits mono">{v?.width ?? 0}b</span>
            </div>
          );
        })}
      </div>

      <div className="ops">
        <button className="btn" onClick={() => st().rotateSelection()}>
          旋转 R
        </button>
        <button className="btn" onClick={() => st().flipSelection()}>
          镜像 F
        </button>
        <button className="btn" onClick={() => st().duplicate()}>
          复制
        </button>
        <button className="btn danger" onClick={() => st().deleteSelection()}>
          删除
        </button>
        {custom && (
          <button className="btn" onClick={() => st().enterView(comp.type.slice(7))}>
            进入子电路（花费 {defCost(design, comp.type.slice(7))}）
          </button>
        )}
      </div>
    </div>
  );
}

function ParamField({ spec, value, onSet }: { spec: ParamSpec; value: number | string | boolean; onSet: (v: number | string | boolean) => void }) {
  if (spec.kind === "bool")
    return (
      <label className="field row">
        <span>{spec.label}</span>
        <Switch size="small" checked={!!value} onChange={onSet} />
      </label>
    );
  if (spec.kind === "choice")
    return (
      <label className="field">
        <span>{spec.label}</span>
        <Select
          size="small"
          value={String(value)}
          options={(spec.options ?? []).map((o) => ({ value: String(o.value), label: o.label }))}
          onChange={(v) => {
            const hit = (spec.options ?? []).find((o) => String(o.value) === v);
            onSet(hit?.value ?? v);
          }}
        />
      </label>
    );
  if (spec.kind === "data" || spec.kind === "text")
    return (
      <label className="field">
        <span>{spec.label}</span>
        <textarea className={spec.kind === "data" ? "data-area" : ""} rows={spec.kind === "data" ? 4 : 2} value={String(value)} onChange={(e) => onSet(e.target.value)} />
      </label>
    );
  return (
    <label className="field">
      <span>{spec.label}</span>
      <input
        type="number"
        value={Number(value) || 0}
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        onChange={(e) => onSet(Number(e.target.value))}
      />
    </label>
  );
}

function EmptyInfo() {
  const design = useEditor((s) => s.design);
  const view = useEditor((s) => s.view);
  const errors = useEditor((s) => s.sim.errors);
  const diags = useMemo(() => sortDiags(errors), [errors]);
  const inv = useMemo(() => componentInventory(design), [design]);
  const hint = emptyInventoryHint(inv);

  return (
    <div className="panel-body">
      <div className="head">
        <span className="title">{view === "root" ? design.name || "未命名设计" : "子电路"}</span>
        <span className="tag">花费 {designCost(design)}</span>
      </div>
      <p className="hint">在画布上点选元件后这里可以改参数、看引脚值。按 G 可把选中元件封装成子电路。</p>
      <h4>元件清单</h4>
      <div className="chips">
        {hint && <span className="hint">{hint}</span>}
        {inv.chips.map(([k, n]) => (
          <span className="chip" key={k}>
            {k} <b>{n}</b>
          </span>
        ))}
        {!!inv.unknown && (
          <Tooltip title="这些元件在当前设计里找不到定义，多半来自旧存档或被子电路删过；仿真时它们不参与计算">
            <span className="chip">认不出定义 <b>{inv.unknown}</b></span>
          </Tooltip>
        )}
        {!!inv.hidden && <span className="hint">另有 {inv.hidden} 类未列出</span>}
      </div>
      {!!diags.length && (
        <>
          <h4>拓扑诊断</h4>
          <ul className="diag">
            {diags.slice(0, 12).map((e, i) => (
              <li key={i} className={e.level}>
                {e.msg}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MultiInfo({ comps }: { comps: CompInstance[] }) {
  const st = useEditor.getState;
  const design = useEditor((s) => s.design);
  const [name, setName] = useState("");
  const label = name.trim() || `子电路 ${comps.length}`;
  return (
    <div className="panel-body">
      <div className="head">
        <span className="title">已选 {comps.length} 个元件</span>
      </div>
      <div className="chips">
        {comps.slice(0, 24).map((c) => (
          <span className="chip" key={c.id}>
            {c.name || defOf(design, c.type, c.params)?.label || c.type}
          </span>
        ))}
      </div>
      <label className="field">
        <span>子电路名称</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：半加器" />
      </label>
      <div className="ops">
        <button className="btn primary" onClick={() => st().groupSelection(label)}>
          封装成子电路 (G)
        </button>
        <button className="btn" onClick={() => st().rotateSelection()}>
          整体旋转
        </button>
        <button className="btn" onClick={() => st().duplicate()}>
          复制
        </button>
        <button className="btn danger" onClick={() => st().deleteSelection()}>
          删除
        </button>
      </div>
      <p className="hint">封装后，内部连线被隐藏，跨界导线自动变成子电路的对外引脚，可反复复用。</p>
    </div>
  );
}
