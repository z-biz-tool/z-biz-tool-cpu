import { useMemo, useRef, useState } from "react";
import { defOf } from "../core/custom.ts";
import { sortDiags } from "../core/netlist.ts";
import { bin, hex } from "../core/types.ts";
import { buildA11y, describeFocus, endName, neighbour, portStructure } from "./a11y.ts";
import { useEditor } from "./store.ts";

/* ------------------------------------------------------------------ *
 * doc 02 §10：Canvas 只是位图，读屏拿不到「哪个脚接到哪、哪根线缺了」。
 * 这里把同一份电路再摆成元件树 + 端口与连接表 + 诊断列表，整张画布不能
 * 只留一句替代文本。
 *
 * 当前值按 §10「高速波形不逐变化朗读，用户主动查询当前值」处理：表格里只
 * 放不随仿真时间变化的结构信息（点一下按钮才读一次实时值），否则每拍重排
 * 几百行既拖慢拖动，也让播报追着波形跑。
 *
 * 元件清单是一份可漫游的列表：整张表只占一个 Tab 停靠点，↑↓←→ 在元件之间
 * 走（neighbour），走到的那个元件由 describeFocus 说明类型与引脚数，回车 /
 * 空格把它选到画布上 —— 选中之后画布、属性面板、播报讲的是同一个元件。
 *
 * 未连接端口清单同时是 §9 要的"端口选择器"：每一行是个按钮，按一下把该端口
 * 选作连线起点（画布上那根橡皮筋跟着走），再按另一行就落一根线 —— 键盘用户
 * 不必再用鼠标去命中几像素大的引脚。
 * ------------------------------------------------------------------ */

export function CanvasA11y() {
  const design = useEditor((s) => s.design);
  const circuit = useEditor((s) => s.circuit());
  const sim = useEditor((s) => s.sim);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const pendingWire = useEditor((s) => s.pendingWire);
  const startWire = useEditor((s) => s.startWire);
  const cancelWire = useEditor((s) => s.cancelWire);
  const [readout, setReadout] = useState<string[]>([]);
  /** 清单里当前停着的元件：整张表只有一个 Tab 停靠点，方向键在它内部走 */
  const [focusId, setFocusId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  /** 结构指纹：只有元件/引脚/连线端点变了才重排表格，纯拖动不重算 */
  const sig = useMemo(() => {
    let s = "";
    for (const c of circuit.comps) s += c.id + "|" + c.type + "|" + c.name + "\n";
    for (const w of circuit.wires) s += w.a.comp + "." + w.a.pin + ">" + w.b.comp + "." + w.b.pin + "\n";
    return s;
  }, [circuit]);

  const model = useMemo(() => buildA11y(circuit, design, sim), [sig, design, sim]);
  const { labels, pins, openPorts } = useMemo(() => portStructure(model), [model]);
  const diags = useMemo(() => sortDiags(sim.errors), [sim]);
  const paramsOf = useMemo(() => new Map(circuit.comps.map((c) => [c.id, c.params])), [circuit]);

  /**
   * 焦点停在哪一个元件上：没有焦点时是第一个（那一个才是 Tab 停靠点）。
   * 走掉的那个元件可能已被删除，这时必须退回第一个，否则整张表一个停靠点都没有。
   */
  const stoppedAt =
    focusId && model.comps.some((c) => c.id === focusId) ? focusId : (model.comps[0]?.id ?? null);
  const focusHint = useMemo(() => {
    if (!stoppedAt) return "";
    const inst = circuit.comps.find((c) => c.id === stoppedAt);
    return inst ? describeFocus(model, { type: "comp", comp: inst, dist: 0 }) : "";
  }, [stoppedAt, model, circuit]);

  /**
   * 走过去：先把停靠点记在 state 上，再移 DOM 焦点。
   * 两件事必须一起做 —— 只靠 focus 事件回填 state 的话，页面失去焦点时
   * 浏览器只挪 activeElement、根本不派发 focus 事件，停靠点会留在原地，
   * 读屏念到的说明和脚下这一行就对不上了。
   */
  const moveTo = (id: string | null) => {
    if (!id) return;
    setFocusId(id);
    rowRefs.current.get(id)?.focus();
  };

  const onRowKey = (e: React.KeyboardEvent, id: string) => {
    const step: Record<string, "next" | "prev"> = { ArrowDown: "next", ArrowRight: "next", ArrowUp: "prev", ArrowLeft: "prev" };
    if (step[e.key]) {
      e.preventDefault();
      moveTo(neighbour(model, id, step[e.key]));
    } else if (e.key === "Home") {
      e.preventDefault();
      moveTo(neighbour(model, null, "next"));
    } else if (e.key === "End") {
      e.preventDefault();
      moveTo(model.comps[model.comps.length - 1]?.id ?? null);
    }
  };

  const compRows = useMemo(
    () =>
      model.comps.map((c) => {
        const def = defOf(design, c.type, paramsOf.get(c.id) ?? {});
        return (
          <tr key={c.id}>
            <th scope="row">
              <button
                type="button"
                className="a11y-row"
                ref={(el) => {
                  if (el) rowRefs.current.set(c.id, el);
                  else rowRefs.current.delete(c.id);
                }}
                tabIndex={stoppedAt === c.id ? 0 : -1}
                onFocus={() => setFocusId(c.id)}
                onClick={() => setSelection({ comps: [c.id], wires: [] })}
                onKeyDown={(e) => onRowKey(e, c.id)}
                aria-pressed={selection.comps.includes(c.id)}
                aria-describedby={stoppedAt === c.id ? "a11y-focus-hint" : undefined}
              >
                {labels.get(c.id) ?? c.id}
              </button>
            </th>
            <td>{def?.label ?? c.type}</td>
            <td>{pins.get(c.id)}</td>
          </tr>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, labels, pins, paramsOf, design, stoppedAt, selection.comps],
  );

  const wireRows = useMemo(
    () =>
      model.wires.map((w) => (
        <tr key={w.id}>
          <td>{endName(w.from, labels)}</td>
          <td>{endName(w.to, labels)}</td>
        </tr>
      )),
    [model, labels],
  );

  /** 用户主动查询：按选区取值，没选就取所有叫得出名字的元件 */
  const readValues = () => {
    const picked = selection.comps.length
      ? selection.comps
      : circuit.comps.filter((c) => c.name).map((c) => c.id);
    const rows: string[] = [];
    for (const id of picked) {
      const c = model.comps.find((x) => x.id === id);
      if (!c) continue;
      for (const p of c.pins) {
        const v = sim.valueOf({ comp: id, pin: p.id });
        if (!v) continue;
        const shown = v.width > 4 ? hex(v.value, v.width) : bin(v.value, v.width);
        rows.push(`${labels.get(id) ?? id} 的 ${p.id} = ${shown}（${v.width} 位${v.driven ? "" : "，未驱动，按 0 读取"}）`);
      }
    }
    setReadout(rows.length ? rows : ["这个范围内没有可读取的引脚"]);
  };

  return (
    <section className="a11y-only" id="canvas-a11y" aria-label="电路可访问视图" tabIndex={0}>
      <p id="canvas-a11y-sum">
        当前视图共 {model.comps.length} 个元件、{model.wires.length} 根导线、{openPorts.length} 个未连接端口、{diags.length} 条诊断。
      </p>
      <h3>元件与端口</h3>
      <p id="a11y-focus-hint" className="a11y-hint">
        {focusHint || "画布上还没有元件。"}
      </p>
      {/* data-keys="local"：这张清单自己吃 ↑↓←→ 与空格（走访 / 选中），不再同时
          被 App 的画布快捷键吃掉。范围只圈清单 —— 圈整个 section 会让"读取当前
          引脚值"按钮上的方向键也失去原有的单步推进。 */}
      <table data-keys="local">
        <thead>
          <tr>
            <th scope="col">名称</th>
            <th scope="col">类型</th>
            <th scope="col">端口</th>
          </tr>
        </thead>
        <tbody>{compRows}</tbody>
      </table>
      <h3>连接表</h3>
      {model.wires.length ? (
        <table>
          <thead>
            <tr>
              <th scope="col">端点 A</th>
              <th scope="col">端点 B</th>
            </tr>
          </thead>
          <tbody>{wireRows}</tbody>
        </table>
      ) : (
        <p>还没有导线。</p>
      )}
      <h3>未连接端口</h3>
      {openPorts.length ? (
        <>
          <p id="a11y-port-hint" className="a11y-hint">
            点一行把该端口选作连线起点，再点另一行完成连线（等价于在画布上点两个引脚）。
          </p>
          <ul className="a11y-ports">
            {openPorts.map((p) => (
              <li key={`${p.comp}.${p.pin}`}>
                <button
                  type="button"
                  className="a11y-port"
                  aria-pressed={!!pendingWire && pendingWire.comp === p.comp && pendingWire.pin === p.pin}
                  aria-describedby="a11y-port-hint"
                  onClick={() => startWire({ comp: p.comp, pin: p.pin })}
                >
                  {p.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{model.comps.length ? "所有端口都已连接。" : "画布上还没有元件。"}</p>
      )}
      {/* 起点选上之后要说清"接下来做什么"和"怎么反悔"，但这句话只给看得见的人：
          说给读屏的那一份走 #a11y-live 那条唯一的播报通道（announce.ts 里
          判题＞保存＞运行＞连线＞选区），这里再挂一个 live 区就把同一句念两遍。 */}
      {pendingWire && (
        <>
          <p className="a11y-hint">
            连线起点已选 {endName(`${pendingWire.comp}.${pendingWire.pin}`, labels)}：再点一个端口完成连线，按 Esc
            或用下面的按钮放弃。
          </p>
          <button type="button" onClick={cancelWire}>
            取消连线
          </button>
        </>
      )}
      <h3>诊断</h3>
      {diags.length ? (
        <ul>
          {diags.map((e, i) => (
            <li key={i}>{e.level === "error" ? "错误：" : "警告："}{e.msg}</li>
          ))}
        </ul>
      ) : (
        <p>目前没有诊断。</p>
      )}
      <button type="button" onClick={readValues}>
        读取当前引脚值
      </button>
      <p role="status" aria-live="polite">
        {readout.length ? readout.join("；") : ""}
      </p>
    </section>
  );
}
