import { ConfigProvider, Tabs, Tooltip, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect, useMemo } from "react";
import Canvas from "./editor/Canvas.tsx";
import Inspector from "./editor/Inspector.tsx";
import Palette from "./editor/Palette.tsx";
import Toolbar from "./editor/Toolbar.tsx";
import AsmPanel from "./editor/panels/AsmPanel.tsx";
import ChallengePanel from "./editor/panels/ChallengePanel.tsx";
import CpuPanel from "./editor/panels/CpuPanel.tsx";
import WorkshopPanel from "./editor/panels/WorkshopPanel.tsx";
import { HelpPanel, LogPanel, ProbePanel } from "./editor/panels/WatchPanels.tsx";
import { useEditor } from "./editor/store.ts";
import type { PanelKey } from "./editor/store.ts";

/* ------------------------------------------------------------------ *
 * 应用外壳：顶栏 + 元件库 + 画布 + 右侧多面板
 * ------------------------------------------------------------------ */

const TABS: { key: PanelKey; label: string | ((i: TabInfo) => React.ReactNode); render: () => React.ReactNode }[] = [
  { key: "level", label: "关卡", render: () => <ChallengePanel /> },
  { key: "inspector", label: "属性", render: () => <Inspector /> },
  { key: "asm", label: "汇编", render: () => <AsmPanel /> },
  { key: "cpu", label: "CPU", render: () => <CpuPanel /> },
  {
    key: "workshop",
    label: (i) => (
      <Tooltip title="当前设计里的子电路数量，打包（G）后会自动登记进工坊">
        <span>
          工坊<b style={{ color: i.count ? "#a78bfa" : undefined }}> {i.count}</b>
        </span>
      </Tooltip>
    ),
    render: () => <WorkshopPanel />,
  },
  { key: "probe", label: "探针", render: () => <ProbePanel /> },
  { key: "log", label: "日志", render: () => <LogPanel /> },
  { key: "help", label: "手册", render: () => <HelpPanel /> },
];

/**
 * 焦点域判定（doc 02 §9：先分派焦点域，再决定操作对象）。
 * 命中这两类区域时，按键归区域自己，不能打到背后的电路上：
 *  - 文本编辑区：⌘Z 撤销的是文字，Delete 删的是字符
 *  - 模态弹层（成就弹窗、Popconfirm）：空格/方向键不该偷偷推进仿真
 */
function inFocusZone(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest(
    "input, textarea, [contenteditable='true'], .ant-select, .ant-modal-wrap, .ant-popover, [role='dialog']"
  );
}

interface TabInfo {
  /** 工坊里的组件数（按 id 去重） */
  count: number;
}

export default function App() {
  const panel = useEditor((s) => s.panel);
  const workshop = useEditor((s) => s.workshop);
  const named = useMemo(() => new Set(workshop.components.map((c) => c.id)).size, [workshop]);

  useEffect(() => {
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
              items={TABS.map((t) => ({
                key: t.key,
                label: typeof t.label === "function" ? t.label({ count: named }) : t.label,
                children: t.key === panel ? t.render() : null,
              }))}
            />
          </aside>
        </div>
      </div>
    </ConfigProvider>
  );
}
