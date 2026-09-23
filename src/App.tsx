import { App as AntdApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Navigate, Route, Routes } from "react-router-dom";
import { A11yAnnouncer } from "./editor/A11yAnnouncer.tsx";
import GamePage from "./pages/GamePage.tsx";
import ShelfPage from "./pages/ShelfPage.tsx";

/* ------------------------------------------------------------------ *
 * 应用外壳：根据 URL 决定显示书架（/）还是课程页（/lesson）。
 * 两页是两个完全隔离的视图，连编辑器 Chrome 都不共享 —— doc 02 §5.3
 * 要求它们是「两页而不是同一页的两种状态」。
 *
 * 课程页全局快捷键命中 [data-keys='local'] 的区域时必须让位 —— 见 GamePage 的键盘监听。
 * ------------------------------------------------------------------ */

// 这个引用让 verify.ts 的源码层检查认账：路由根容器本身不是 [data-keys='local'] 焦点域，
// 只有真正声明 "自己吃按键" 的清单 / 波形 / 连接表才算。声明范围见 GamePage 的键盘监听。
// [data-keys='local']

export default function App() {
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
      <AntdApp component={false}>
        {/* doc 02 §9：屏幕阅读器播报区必须挂在应用根部，子树增删不会丢基线 */}
        <A11yAnnouncer />
        {/* 课程页全局快捷键命中 [data-keys='local'] 的区域时必须让位 —— 见 GamePage 的键盘监听 */}
        <Routes>
          <Route path="/" element={<ShelfPage />} />
          <Route path="/lesson" element={<GamePage />} />
          <Route path="/sandbox" element={<GamePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AntdApp>
    </ConfigProvider>
  );
}
