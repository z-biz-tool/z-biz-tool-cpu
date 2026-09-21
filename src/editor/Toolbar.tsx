import { Segmented, Tooltip } from "antd";
import { designCost, useEditor } from "./store.ts";

/* ------------------------------------------------------------------ *
 * 顶栏：仿真控制 + 工具 + 视图路径 + 成本
 * ------------------------------------------------------------------ */

export default function Toolbar() {
  const running = useEditor((s) => s.running);
  const speed = useEditor((s) => s.speed);
  const simTime = useEditor((s) => s.sim.time);
  const tool = useEditor((s) => s.tool);
  const camera = useEditor((s) => s.camera);
  const view = useEditor((s) => s.view);
  const design = useEditor((s) => s.design);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const selection = useEditor((s) => s.selection);
  const st = useEditor.getState;

  const circuit = view === "root" ? design.root : design.defs.find((d) => d.id === view)?.circuit ?? design.root;
  const cost = designCost(design);

  return (
    <header className="toolbar">
      <div className="tb-group">
        <Tooltip title="运行 / 暂停（空格）">
          <button className={"btn big" + (running ? " active" : "")} onClick={() => st().toggleRun()}>
            {running ? "⏸" : "▶"}
          </button>
        </Tooltip>
        <Tooltip title="单步一时钟周期（→）">
          <button className="btn big" onClick={() => st().stepOnce()}>
            ⏭
          </button>
        </Tooltip>
        <Tooltip title="复位仿真状态">
          <button className="btn big" onClick={() => st().resetSim()}>
            ⟲
          </button>
        </Tooltip>
        <input
          className="speed"
          type="range"
          min={1}
          max={60}
          value={Math.min(60, speed)}
          onChange={(e) => st().setSpeed(Number(e.target.value))}
        />
        <span className="mono">{speed} Hz</span>
      </div>

      <div className="tb-group">
        <Segmented
          size="small"
          value={tool}
          onChange={(v) => st().setTool(v as "select" | "wire")}
          options={[
            { label: "选择", value: "select" },
            { label: "连线", value: "wire" },
          ]}
        />
        <Tooltip title="撤销 (⌘Z)">
          <button className="btn" disabled={!undo.length} onClick={() => st().undoAction()}>
            ↶
          </button>
        </Tooltip>
        <Tooltip title="重做 (⌘⇧Z)">
          <button className="btn" disabled={!redo.length} onClick={() => st().redoAction()}>
            ↷
          </button>
        </Tooltip>
      </div>

      <div className="tb-group grow">
        <button className="btn crumb" onClick={() => st().enterView("root")}>
          {design.name || "未命名设计"}
        </button>
        {view !== "root" &&
          (() => {
            const def = design.defs.find((d) => d.id === view);
            return <span className="crumb on">{def?.name ?? "子电路"}</span>;
          })()}
        <span className="sep" />
        <Tooltip title="适应窗口 (F)">
          <button className="btn" onClick={() => st().fitView()}>
            适应
          </button>
        </Tooltip>
        <span className="mono zoom">{Math.round(camera.zoom * 100)}%</span>
      </div>

      <div className="tb-group stats">
        <span className="stat">
          周期 <b className="mono">{simTime}</b>
        </span>
        <span className="stat">
          元件 <b className="mono">{circuit.comps.length}</b>
        </span>
        <span className="stat">
          导线 <b className="mono">{circuit.wires.length}</b>
        </span>
        <span className="stat">
          花费 <b className="mono cost">{cost}</b>
        </span>
        {!!design.defs.length && (
          <Tooltip title={design.defs.map((d) => d.name).join("、")}>
            <span className="stat">
              子电路 <b className="mono">{design.defs.length}</b>
            </span>
          </Tooltip>
        )}
        {selection.comps.length > 0 && (
          <span className="stat">
            已选 <b className="mono">{selection.comps.length}</b>
          </span>
        )}
      </div>
    </header>
  );
}
