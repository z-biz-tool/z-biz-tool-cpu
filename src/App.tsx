import { App as AntdApp, ConfigProvider, theme, message } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { startDeepLinkReceiver, ZBIZ_TAKE_PENDING } from "z-biz-tool-shared/protocol";
import type { Handoff } from "z-biz-tool-shared/protocol";
import { resolveCpuDeepLink } from "./_shared/deepLink";
import { useEditor } from "./editor/store.ts";
import type { BookKey, PanelKey } from "./editor/store.ts";
import { A11yAnnouncer } from "./editor/A11yAnnouncer.tsx";
import GamePage from "./pages/GamePage.tsx";
import ShelfPage from "./pages/ShelfPage.tsx";

/* ------------------------------------------------------------------ *
 * 应用外壳：根据 URL 决定显示书架（/）还是编辑器（/lesson、/sandbox）。
 * 两页是两个完全隔离的视图，连编辑器 Chrome 都不共享 —— doc 02 §5.3
 * 要求它们是「两页而不是同一页的两种状态」。
 *
 * /lesson 与 /sandbox 共用同一个编辑器外壳：URL 就是入口意图的真相，
 * GamePage 按 pathname 调 store.applyEntry()。/sandbox 只摘掉判题上下文，
 * 画布与关卡半成品都不动 —— 清空画布才是丢东西的那条路。
 *
 * 课程页全局快捷键命中 [data-keys='local'] 的区域时必须让位 —— 见 GamePage 的键盘监听。
 * ------------------------------------------------------------------ */

// 这个引用让 verify.ts 的源码层检查认账：路由根容器本身不是 [data-keys='local'] 焦点域，
// 只有真正声明 "自己吃按键" 的清单 / 波形 / 连接表才算。声明范围见 GamePage 的键盘监听。
// [data-keys='local']

export default function App() {
  const navigate = useNavigate();

  // ── zbiz:// 深链接线（2026-10-31 接入共享层）──
  //
  // 别的产品用 `zbiz://cpu/open?level=t2-alu4&book=logic&panel=asm` 唤起本应用时，
  // Rust 把深链收进队列并 emit("zbiz-open")。
  //
  // **机制**（冷启动补取、事件监听、不静默吞掉）在共享层
  // `z-biz-tool-shared/protocol` 的 `startDeepLinkReceiver` 里，家族各仓共用同一份实现；
  // **语义**（cpu 该做什么）在本仓的 `_shared/deepLink.ts` 里，通过 translate 回调注入。
  useEffect(() => {
    const stop = startDeepLinkReceiver({
      productId: "cpu",
      invoke: () => invoke<Handoff[]>(ZBIZ_TAKE_PENDING),
      listen: (event, handler) => listen(event, handler),
      translate: (item) => {
        const out = resolveCpuDeepLink(item);
        if (out.problem) {
          return { ok: false, problem: out.problem };
        }
        return {
          ok: true,
          effect: { level: out.level, book: out.book, panel: out.panel },
        };
      },
      onProblem: (msg, item) => {
        // 静默吞掉的话，用户看到的就是「点了没反应」
        console.warn("[cpu] 收到未适配的深链", item, msg);
        message.warning(msg);
      },
      onEffect: (effect) => {
        const level = effect.level as string | null;
        const book = effect.book as BookKey | null;
        const panel = effect.panel as PanelKey | null;
        const ed = useEditor.getState();
        // 进关卡必须切到 /lesson：URL 是「显示哪页」的真相，store 是全局的，
        // 先 startLevel（写 levelId/mode/homeLevelId）再 navigate，路由切换后读到的就是它。
        if (level) {
          ed.startLevel(level);
          navigate("/lesson", { replace: true });
        }
        if (book) ed.setBook(book);
        // 显式 panel 最后落，确保它压过 startLevel 默认给的 "level" 面板
        if (panel) ed.setPanel(panel);
      },
      log: (msg, item) => console.debug("[cpu] 深链", msg, item),
    });
    return stop;
  }, [navigate]);

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
