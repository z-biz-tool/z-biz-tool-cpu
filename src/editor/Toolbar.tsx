import { Segmented, Tooltip } from "antd";
import { RUN_STATE_TEXT, type RunStateCode } from "../core/sim.ts";
import { SAVE_STATE_TEXT } from "../project/saveState.ts";
import { designCost, useEditor } from "./store.ts";

/* ------------------------------------------------------------------ *
 * 顶栏：仿真控制 + 工具 + 视图路径 + 成本
 * ------------------------------------------------------------------ */

export default function Toolbar() {
  const running = useEditor((s) => s.running);
  const speed = useEditor((s) => s.speed);
  const simTime = useEditor((s) => s.sim.time);
  /** doc 02 §5.2：顶栏常驻运行状态。选择器只返回 code 这个原始值，
   *  这样任何状态变化（含 pressButton 这类只动仿真不动 design 的）都会刷新徽标 */
  const runCode = useEditor((s) => s.sim.runState(s.running).code);
  const tool = useEditor((s) => s.tool);
  const camera = useEditor((s) => s.camera);
  const view = useEditor((s) => s.view);
  const design = useEditor((s) => s.design);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const selection = useEditor((s) => s.selection);
  /** doc 02 §5.3：保存状态独立于运行状态常驻顶栏 */
  const save = useEditor((s) => s.save);
  const st = useEditor.getState;

  const runInfo = { code: runCode as RunStateCode, ...RUN_STATE_TEXT[runCode as RunStateCode] };

  const circuit = view === "root" ? design.root : design.defs.find((d) => d.id === view)?.circuit ?? design.root;
  const cost = designCost(design);
  /* 快照的 label 记的就是那一步做了什么（pushHistory 传进来的），撤到空栈时
     按钮得说清"没得撤"而不是只变灰。 */
  const undoTip = undo.length ? `撤销：${undo[undo.length - 1].label} (⌘Z)` : "没有可撤销的操作 (⌘Z)";
  const redoTip = redo.length ? `重做：${redo[redo.length - 1].label} (⌘⇧Z)` : "没有可重做的操作 (⌘⇧Z)";

  return (
    <header className="toolbar">
      <div className="tb-group">
        <Tooltip title="返回书架（CPU/存储/优化）">
        <button
          className="tb-btn"
          onClick={() => {
            const s = st();
            s.setPanel("level");
            /* 通知 ChallengePanel 跳到「全部」视图——通过在 window 上挂个提示 */
            (window as { __resetBookTo?: () => void }).__resetBookTo?.();
          }}
        >
          书架
        </button>
      </Tooltip>
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
        {/* 按钮里只有一个箭头符号，鼠标停在上面、读屏走到上面都得说出撤的是哪一步；
            空栈时也得解释为什么按不动，否则只像个坏掉的按钮。 */}
        <Tooltip title={undoTip}>
          <button className="btn" aria-label={undoTip} disabled={!undo.length} onClick={() => st().undoAction()}>
            ↶
          </button>
        </Tooltip>
        <Tooltip title={redoTip}>
          <button className="btn" aria-label={redoTip} disabled={!redo.length} onClick={() => st().redoAction()}>
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
        <Tooltip title={runInfo.detail}>
          <span
            className={"run-state tone-" + runInfo.tone}
            data-run-state={runInfo.code}
            role="status"
          >
            {runInfo.label}
          </span>
        </Tooltip>
        {(() => {
          const info = SAVE_STATE_TEXT[save.label];
          return (
            <>
              <Tooltip title={save.error ? `${info.detail}（${save.error}）` : info.detail}>
                <span className={"run-state tone-" + info.tone} data-save-state={save.label} role="status">
                  {info.label}
                  {save.label === "saved" && save.savedRevision > 0 ? ` · 修订 ${save.savedRevision}` : ""}
                </span>
              </Tooltip>
              {save.label === "failed" && (
                <Tooltip title="内存里的草稿还在，再试一次写入本地">
                  <button className="btn" onClick={() => st().retrySave()}>
                    重试保存
                  </button>
                </Tooltip>
              )}
              {save.label === "readonly" && (
                <>
                  <Tooltip title="以本页为准：把另一个标签页的草稿当作新基线，本页重新自动存档（此后对方那一版会被本页覆盖）">
                    <button className="btn" onClick={() => st().takeOverDraft()}>
                      接管草稿
                    </button>
                  </Tooltip>
                  <Tooltip title="先看看本页停写时另存的冲突副本再决定，打开它不会改动对方的草稿">
                    <button className="btn" disabled={!st().hasConflictCopy()} onClick={() => st().openConflictCopy()}>
                      打开冲突副本
                    </button>
                  </Tooltip>
                </>
              )}
            </>
          );
        })()}
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
