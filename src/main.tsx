import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { useEditor } from "./editor/store.ts";
import "./index.css";

if (import.meta.env.DEV) {
  // 开发期在控制台里直接读写编辑器状态，便于排查画布问题
  (window as unknown as { __cpu: typeof useEditor }).__cpu = useEditor;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
