import { App, Empty, Input, Modal, Tooltip } from "antd";
import { useMemo, useRef, useState } from "react";
import { CATEGORY_LABEL, paletteDefs } from "../core/registry.ts";
import type { CompCategory, CompDef, CustomDef } from "../core/types.ts";
import { MAX_POINTS } from "../core/recovery.ts";
import { downloadText } from "../core/serialize.ts";
import { defCost, useEditor } from "./store.ts";

/* ------------------------------------------------------------------ *
 * 元件库：分类折叠 + 搜索，点击后进入放置模式
 *
 * 底部这一排是工程动作。它们分两类，处理方式不同：
 *  - 「新建 / 读档 / 导入 / 进沙盒 / 切关 / 载入参考」整盘换掉设计，撤销栈也清空。
 *    doc 02 §6.1 明确说这类动作「不靠跨项目撤销保命」，所以换之前先把走掉的那一份
 *    立成恢复点，人从「项目历史」里回去 —— 比每次弹一层确认框既安全又不挡路。
 *  - 结果播报一律走非阻断通知：读档没有存档、导入被修过引用，原来要么静默要么
 *    window.alert（原生框不受主题与焦点管理，屏也读不到），现在都改过来了。
 * 重命名子电路原来是 window.prompt，现在就地改成行内输入。
 * ------------------------------------------------------------------ */

const ORDER: CompCategory[] = ["io", "gate", "math", "mux", "bus", "seq", "mem", "util"];

/** 导入报告可能上百条，通知里只列前几条，剩下的说清楚有多少 */
const REPORT_LINES = 6;

function reportBody(lines: string[]) {
  if (!lines.length) return null;
  return (
    <ul className="import-report">
      {lines.slice(0, REPORT_LINES).map((l, i) => (
        <li key={i}>{l}</li>
      ))}
      {lines.length > REPORT_LINES && <li className="more">…另有 {lines.length - REPORT_LINES} 条</li>}
    </ul>
  );
}

function when(at: number) {
  return at ? new Date(at).toLocaleString("zh-CN", { hour12: false }) : "未知时间";
}

export default function Palette() {
  const { modal, notification } = App.useApp();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ gate: true });
  /** 正在改名的子电路 + 输入框里的草稿；null 表示没有 */
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [history, setHistory] = useState(false);
  /* Esc 取消：Escape 之后输入框才失焦，靠这个标记让 onBlur 别当成「改完了」 */
  const cancelled = useRef(false);

  const placing = useEditor((s) => s.placing);
  const setPlacing = useEditor((s) => s.setPlacing);
  const design = useEditor((s) => s.design);
  const view = useEditor((s) => s.view);
  const enterView = useEditor((s) => s.enterView);
  const deleteDef = useEditor((s) => s.deleteDef);
  const renameDef = useEditor((s) => s.renameDef);
  const recovery = useEditor((s) => s.recovery);
  const recoverySaved = useEditor((s) => s.recoverySaved);
  const forgetRecovery = useEditor((s) => s.forgetRecovery);
  const clearRecovery = useEditor((s) => s.clearRecovery);

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

  const commitRename = (d: CustomDef) => {
    const name = (renaming?.draft ?? "").trim();
    setRenaming(null);
    if (!name || name === d.name) return;
    renameDef(d.id, name);
  };

  /** 顶栏那排通知都从右下角出，不压住画布中央 */
  const notify = (kind: "success" | "warning" | "error", title: string, lines: string[], hold: boolean) => {
    notification[kind]({
      title,
      description: reportBody(lines) ?? undefined,
      placement: "bottomRight",
      duration: hold ? 0 : 4,
      role: kind === "error" ? "alert" : "status",
    });
  };

  const onImport = async (file: File) => {
    const res = useEditor.getState().importText(await file.text());
    if (!res.ok) {
      notify("error", `「${file.name}」没能载入`, res.report, true);
      return;
    }
    res.apply();
    const name = useEditor.getState().design.name || file.name;
    /* 载入成功但被修过引用：如实报，不能把修过的工程当正常工程（doc 05 §3.3） */
    notify(res.report.length ? "warning" : "success", res.report.length ? `已导入「${name}」，${res.report.length} 处已修正` : `已导入「${name}」`, res.report, res.report.length > 0);
  };

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
                    {renaming?.id === d.id ? (
                      <Input
                        size="small"
                        className="pal-rename"
                        autoFocus
                        aria-label="子电路名称：回车确认，Esc 取消"
                        value={renaming.draft}
                        onChange={(e) => setRenaming({ id: d.id, draft: e.target.value })}
                        onPressEnter={() => commitRename(d)}
                        onBlur={() => {
                          if (cancelled.current) {
                            cancelled.current = false;
                            setRenaming(null);
                            return;
                          }
                          commitRename(d);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Escape") return;
                          e.stopPropagation();
                          cancelled.current = true;
                          (e.target as HTMLInputElement).blur();
                        }}
                      />
                    ) : (
                      <button
                        className="grow"
                        onClick={() => setPlacing(placing?.type === type ? null : type)}
                        title="点击后可在画布放置该子电路"
                      >
                        <span className="pal-glyph">{d.name.slice(0, 2)}</span>
                        <span className="pal-label">{d.name}</span>
                        <span className="pal-cost">{defCost(design, d.id)}</span>
                      </button>
                    )}
                    <button className="mini" onClick={() => enterView(d.id)} title="进入子电路编辑">
                      {view === d.id ? "●" : "✎"}
                    </button>
                    <button
                      className="mini"
                      onClick={() => setRenaming({ id: d.id, draft: d.name })}
                      title="重命名（就地输入，回车确认、Esc 取消）"
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
        <button className="btn" onClick={() => useEditor.getState().newDesign()} title="新建空白设计（当前这份进项目历史）">
          新建
        </button>
        <button
          className="btn"
          title="存到浏览器本地"
          onClick={() => {
            const ok = useEditor.getState().saveTo("slot");
            notify(ok ? "success" : "error", ok ? "已存档" : "存档没写进去", ok ? [] : ["浏览器拒绝写入本地存储（配额满或隐私模式），请立刻「导出」保住这份设计。"], !ok);
          }}
        >
          存档
        </button>
        <button
          className="btn"
          title="读回上次的存档（当前这份进项目历史）"
          onClick={() => {
            if (useEditor.getState().loadFrom("slot")) notify("success", "已读回存档", [], false);
            else notify("error", "本地还没有存档", ["先点「存档」，才会有可读回的工程。"], true);
          }}
        >
          读档
        </button>
        <Tooltip title="把当前设计导出成 JSON 文本">
          <button className="btn" onClick={() => downloadText("cpu-design.json", useEditor.getState().exportText())}>
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
              if (file) await onImport(file);
            }}
          />
        </label>
        <Tooltip title={recovery.length ? `回到其中一份：${recovery.map((p) => p.name).join("、")}` : "还没有可回退的整盘替换"}>
          <button className="btn" disabled={!recovery.length} onClick={() => setHistory(true)}>
            历史<em>{recovery.length}</em>
          </button>
        </Tooltip>
      </div>

      <Modal
        open={history}
        title="项目历史"
        footer={null}
        width={440}
        onCancel={() => setHistory(false)}
        destroyOnHidden
      >
        <p className="hint">
          「新建 / 读档 / 导入 / 切关 / 载入参考」会整盘换掉设计，撤销也回不去；换之前那一份先存到这里，最多 {MAX_POINTS}{" "}
          份。{recoverySaved ? "恢复时会把当前这份一并留底，来回切都不丢东西。" : "本地存储没写进去，这些只在这次会话里有效。"}
        </p>
        {recovery.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有恢复点" />
        ) : (
          <ul className="rec-list">
            {recovery.map((p) => (
              <li className="rec" key={p.id}>
                <div className="rec-main">
                  <span className="rec-name">{p.name}</span>
                  <span className="rec-meta">
                    {p.reason} · {p.comps} 元件 / {p.wires} 连线 · {when(p.at)}
                  </span>
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    if (!useEditor.getState().restoreRecovery(p.id)) {
                      notify("error", "这一份已经不在历史里了", [], true);
                      return;
                    }
                    setHistory(false);
                    notify("success", `已回到「${p.name}」`, [], false);
                  }}
                >
                  恢复
                </button>
                <button className="mini danger" title="删掉这条" onClick={() => forgetRecovery(p.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {!!recovery.length && (
          <button
            className="btn wide danger"
            onClick={() =>
              modal.confirm({
                title: "清空项目历史？",
                content: `这 ${recovery.length} 份恢复点删掉之后就没有别的退路了，确认当前画布上那份已经「存档」或「导出」。`,
                okText: "清空",
                okButtonProps: { danger: true },
                cancelText: "取消",
                onOk: () => {
                  clearRecovery();
                  setHistory(false);
                },
              })
            }
          >
            清空历史
          </button>
        )}
      </Modal>
    </div>
  );
}
