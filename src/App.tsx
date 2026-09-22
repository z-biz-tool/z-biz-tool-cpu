import { ConfigProvider, Tabs, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect } from "react";
import Canvas from "./editor/Canvas.tsx";
import Inspector from "./editor/Inspector.tsx";
import Palette from "./editor/Palette.tsx";
import Toolbar from "./editor/Toolbar.tsx";
import AsmPanel from "./editor/panels/AsmPanel.tsx";
import ChallengePanel from "./editor/panels/ChallengePanel.tsx";
import CpuPanel from "./editor/panels/CpuPanel.tsx";
import WorkshopPanel from "./editor/panels/WorkshopPanel.tsx";
import { emptyWorkshop } from "./workshop/index.ts";
import { HelpPanel, LogPanel, ProbePanel } from "./editor/panels/WatchPanels.tsx";
import { useEditor } from "./editor/store.ts";
import type { PanelKey } from "./editor/store.ts";

/* ------------------------------------------------------------------ *
 * 应用外壳：顶栏 + 元件库 + 画布 + 右侧多面板
 * ------------------------------------------------------------------ */

const TABS: { key: PanelKey; label: string; render: () => React.ReactNode }[] = [
  { key: "level", label: "关卡", render: () => <ChallengePanel /> },
  { key: "inspector", label: "属性", render: () => <Inspector /> },
  { key: "asm", label: "汇编", render: () => <AsmPanel /> },
  { key: "cpu", label: "CPU", render: () => <CpuPanel /> },
  { key: "workshop", label: "工坊", render: () => <WorkshopPanel state={emptyWorkshop()} onChange={() => {}} /> },
  { key: "probe", label: "探针", render: () => <ProbePanel /> },
  { key: "log", label: "日志", render: () => <LogPanel /> },
  { key: "help", label: "手册", render: () => <HelpPanel /> },
];

/** 输入框里打字时不要触发快捷键 */
function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return !!el.closest("input, textarea, [contenteditable='true'], .ant-select");
}

export default function App() {
  const panel = useEditor((s) => s.panel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      if (mod && e.key === "Enter") return; // 汇编面板自己处理
      if (typing(e)) return;

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
          const name = window.prompt("子电路名称", "新子电路");
          if (name !== null) st.groupSelection(name.trim() || "子电路");
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

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#a78bfa",
          colorInfo: "#a78bfa",
          colorBgBase: "#0b0d14",
          colorBorder: "#2a3141",
          colorText: "#e5e7eb",
          borderRadius: 8,
          fontSize: 13,
          fontFamily:
            "system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Tabs: { horizontalItemPadding: "8px 10px" },
          Table: { cellPaddingBlockSM: 3, cellPaddingInlineSM: 6 },
        },
      }}
    >
      <div className="app">
        <Toolbar />
        <div className="app-body">
          <Palette />
          <main className="stage">
            <Canvas />
          </main>
          <aside className="rail">
            <Tabs
              size="small"
              activeKey={panel}
              onChange={(k) => useEditor.getState().setPanel(k as PanelKey)}
              items={TABS.map((t) => ({ key: t.key, label: t.label, children: t.key === panel ? t.render() : null }))}
            />
          </aside>
        </div>
      </div>
    </ConfigProvider>
  );
}
