import { useMemo, useState } from "react";
import { defOf } from "../core/custom.ts";
import { sortDiags } from "../core/netlist.ts";
import { bin, hex } from "../core/types.ts";
import { buildA11y, portStructure } from "./a11y.ts";
import { useEditor } from "./store.ts";

/* ------------------------------------------------------------------ *
 * doc 02 §10：Canvas 只是位图，读屏拿不到「哪个脚接到哪、哪根线缺了」。
 * 这里把同一份电路再摆成元件树 + 端口与连接表 + 诊断列表，整张画布不能
 * 只留一句替代文本。
 *
 * 当前值按 §10「高速波形不逐变化朗读，用户主动查询当前值」处理：表格里只
 * 放不随仿真时间变化的结构信息（点一下按钮才读一次实时值），否则每拍重排
 * 几百行既拖慢拖动，也让播报追着波形跑。
 * ------------------------------------------------------------------ */

const endName = (ref: string, labels: Map<string, string>) => {
  const i = ref.lastIndexOf(".");
  const comp = ref.slice(0, i);
  return `${labels.get(comp) ?? comp}.${ref.slice(i + 1)}`;
};

export function CanvasA11y() {
  const design = useEditor((s) => s.design);
  const circuit = useEditor((s) => s.circuit());
  const sim = useEditor((s) => s.sim);
  const selection = useEditor((s) => s.selection);
  const [readout, setReadout] = useState<string[]>([]);

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

  const compRows = useMemo(
    () =>
      model.comps.map((c) => {
        const def = defOf(design, c.type, paramsOf.get(c.id) ?? {});
        return (
          <tr key={c.id}>
            <th scope="row">{labels.get(c.id) ?? c.id}</th>
            <td>{def?.label ?? c.type}</td>
            <td>{pins.get(c.id)}</td>
          </tr>
        );
      }),
    [model, labels, pins, paramsOf, design],
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
      <table>
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
        <ul>
          {openPorts.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p>{model.comps.length ? "所有端口都已连接。" : "画布上还没有元件。"}</p>
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
