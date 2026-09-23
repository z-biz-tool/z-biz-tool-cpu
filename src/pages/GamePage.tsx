import { Tabs, Tooltip } from "antd";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Canvas from "../editor/Canvas.tsx";
import Inspector from "../editor/Inspector.tsx";
import Palette from "../editor/Palette.tsx";
import Toolbar from "../editor/Toolbar.tsx";
import AsmPanel from "../editor/panels/AsmPanel.tsx";
import ChallengePanel from "../editor/panels/ChallengePanel.tsx";
import CpuPanel from "../editor/panels/CpuPanel.tsx";
import WorkshopPanel from "../editor/panels/WorkshopPanel.tsx";
import { HelpPanel, LogPanel, ProbePanel } from "../editor/panels/WatchPanels.tsx";
import { useEditor } from "../editor/store.ts";
import type { PanelKey } from "../editor/store.ts";
import { PackageMetaDialog } from "../editor/PackageMetaDialog.tsx";

/* ------------------------------------------------------------------ *
 * 课程页：编辑器的完整外壳 —— Toolbar + Palette + Canvas + 右侧多面板
 * 进入某本书（store.book）后，右侧默认展示「关卡」面板
 * ------------------------------------------------------------------ */

export default function GamePage() {
  const panel = useEditor((s) => s.panel);
  const workshop = useEditor((s) => s.workshop);
  const book = useEditor((s) => s.book);
  const setPanel = useEditor((s) => s.setPanel);
  const navigate = useNavigate();

  const named = useMemo(() => new Set(workshop.components.map((c) => c.id)).size, [workshop]);

  /* 进入本页时：默认把右侧指向「关卡」面板 */
  useEffect(() => {
    setPanel("level");
  }, [setPanel]);

  /* doc 02 §9：先分派焦点域，再决定操作对象。
   * 命中这几类区域时，按键归区域自己，不能打到背后的电路上：
   *  - 文本编辑区：⌘Z 撤销的是文字，Delete 删的是字符
   *  - 模态弹层（成就弹窗、Popconfirm）：空格/方向键不该偷偷推进仿真
   *  - [data-keys='local'] 是"这块区域自己吃按键"的声明：可访问视图的元件清单、
   *    连接表、波形用 ↑↓←→ 走位、空格/回车确认，不挡掉的话同一按键会同时被画布快捷键吃掉
   */
  useEffect(() => {
    const inFocusZone = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el?.closest?.(
        "input, textarea, [contenteditable='true'], .ant-select, .ant-modal-wrap, .ant-popover, [role='dialog'], [data-keys='local']",
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (inFocusZone(e)) return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redoAction();
        else st.undoAction();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        st.duplicate();
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          st.toggleRun();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (st.selection.comps.length) st.nudgeSelection(1, 0);
          else st.stepOnce();
          break;
        case "ArrowLeft":
          e.preventDefault();
          st.nudgeSelection(-1, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          st.nudgeSelection(0, -1);
          break;
        case "ArrowDown":
          e.preventDefault();
          st.nudgeSelection(0, 1);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          st.deleteSelection();
          break;
        case "Escape":
          st.setPlacing(null);
          st.cancelWire();
          st.clearSelection();
          break;
        case "r":
        case "R":
          st.rotateSelection();
          break;
        case "f":
        case "F":
          st.fitView();
          break;
        case "w":
        case "W":
          st.setTool(st.tool === "wire" ? "select" : "wire");
          break;
        case "g":
        case "G": {
          if (st.selection.comps.length < 2) break;
          st.groupSelection("未命名子电路");
          break;
        }
        case "i":
        case "I":
          st.setPanel("inspector");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const bookLabel =
    book === "logic"
      ? "CPU 书"
      : book === "memory"
        ? "存储书"
        : book === "fast"
          ? "优化书"
          : "全部书";

  return (
    <div className="app">
      <Toolbar />
      <div className="app-body">
        <Palette />
        <main className="stage">
          <Canvas />
        </main>
        <aside className="rail">
          <div className="rail-head">
            <button className="btn ghost small" onClick={() => navigate("/")} aria-label="返回书架">
              ← 书架
            </button>
            <span className="rail-title mono">{bookLabel}</span>
          </div>
          <Tabs
            size="small"
            activeKey={panel}
            onChange={(k) => useEditor.getState().setPanel(k as PanelKey)}
            items={[
              { key: "level", label: "关卡", children: panel === "level" ? <ChallengePanel /> : null },
              { key: "inspector", label: "属性", children: panel === "inspector" ? <Inspector /> : null },
              { key: "asm", label: "汇编", children: panel === "asm" ? <AsmPanel /> : null },
              { key: "cpu", label: "CPU", children: panel === "cpu" ? <CpuPanel /> : null },
              {
                key: "workshop",
                label: (
                  <Tooltip title="当前设计里的子电路数量，打包（G）后会自动登记进工坊">
                    <span>
                      工坊<b style={{ color: named ? "#a78bfa" : undefined }}> {named}</b>
                    </span>
                  </Tooltip>
                ),
                children: panel === "workshop" ? <WorkshopPanel /> : null,
              },
              { key: "probe", label: "探针", children: panel === "probe" ? <ProbePanel /> : null },
              { key: "log", label: "日志", children: panel === "log" ? <LogPanel /> : null },
              { key: "help", label: "手册", children: panel === "help" ? <HelpPanel /> : null },
            ]}
          />
        </aside>
      </div>
      <PackageMetaDialog />
    </div>
  );
}

