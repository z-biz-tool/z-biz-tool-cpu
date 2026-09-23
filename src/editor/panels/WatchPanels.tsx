import { Button, Empty, Table, Tag } from "antd";
import { useMemo, useRef, useState } from "react";
import { CONDS, OPS, REG_NAMES, SYSS } from "../../asm/isa.ts";
import { isaDoc } from "../../asm/assembler.ts";
import { CTRL_DOC } from "../../cpu/reference.ts";
import { hex } from "../../core/types.ts";
import { useEditor } from "../store.ts";

/* ------------------------------------------------------------------ *
 * 探针 / 日志 / 手册面板
 * ------------------------------------------------------------------ */

const GROUP_LABEL: Record<string, string> = {
  data: "数据搬移",
  alu: "运算",
  mem: "访存",
  ctrl: "控制",
  sys: "系统",
};

export function ProbePanel() {
  const sim = useEditor((s) => s.sim);
  const tick = useEditor((s) => s.tick);
  const probes = useMemo(() => sim.probes(), [sim, tick]);

  if (!probes.length) {
    return (
      <div className="panel-body">
        <div className="panel-note">给元件起个名字（属性面板里的「命名」），它就会出现在这里。</div>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无命名元件" />
      </div>
    );
  }
  return (
    <div className="panel-body">
      <div className="panel-note">共 {probes.length} 个命名元件 · 第 {sim.time} 拍 · 点一行可选中对应元件</div>
      <Table
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={probes}
        onRow={(r) => ({
          onClick: () => useEditor.getState().setSelection({ comps: [r.id], wires: [] }),
        })}
        columns={[
          { title: "名称", dataIndex: "name", width: 96, ellipsis: true },
          { title: "元件", dataIndex: "label", width: 78 },
          {
            title: "值",
            dataIndex: "value",
            width: 82,
            render: (v?: { value: number; width: number }) =>
              v ? (v.width > 4 ? hex(v.value, v.width) : String(v.value)) : "—",
          },
          {
            title: "位宽",
            dataIndex: "value",
            key: "w",
            width: 46,
            render: (v?: { width: number }) => v?.width ?? "—",
          },
          { title: "类型", dataIndex: "kind", width: 50, render: (k: string) => <Tag>{k}</Tag> },
        ]}
      />
      {/* FIX-07: 在探针表下方追加波形面板，紧凑显示最近 N 拍变化 */}
      <WaveformPanel />
    </div>
  );
}

/**
 * FIX-07: 波形面板 — 每行一个信号，每格一拍，从右往左是最近的拍。
 *
 * 早先这里把颜色直接写死在行内 style 里，11 px 字号压在合成底色上实测只有
 * 3.95 与 2.75（AA 要 4.5），而且行名是 c_x8k2.out 这种内部 id，读屏和肉眼都
 * 认不出是哪个元件。改法：颜色走 index.css 的变量（于是对比度门禁量得到，
 * 实测 5.66 / 4.94 / 14.05），行名用元件的命名，内部 id 留在 title 里备查。
 *
 * doc 02 §9 还给波形定了键位：方向键移时间游标、Enter 定位信号、Tab 退出。
 * 一格一拍的值原先只有鼠标 tooltip 才看得到，键盘用户什么都拿不到，所以游标
 * 停在哪一拍都另外写成一句不打断的话（读屏与肉眼共用同一份）。
 */
function WaveformPanel() {
  const sim = useEditor((s) => s.sim);
  const tick = useEditor((s) => s.tick);
  const setSelection = useEditor((s) => s.setSelection);
  const [open, setOpen] = useState(false);
  /** 焦点停在哪一条信号、游标停在该行的第几格（0 = 最新那一拍） */
  const [at, setAt] = useState<{ row: number; cell: number } | null>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());

  const rows = useMemo(() => {
    if (!open) return [];
    return sim.trace
      .signals()
      .map((s) => {
        const name = sim.compById(s.compId)?.inst?.name ?? s.compId;
        return {
          compId: s.compId,
          key: s.compId + "." + s.pin,
          label: `${name}.${s.pin}`,
          cells: sim.trace.historyOf(s, 64).reverse(),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "zh"));
  }, [sim, tick, open]);

  if (!open) {
    return (
      <div className="wave-wrap">
        <Button size="small" onClick={() => setOpen(true)}>
          展开波形
        </Button>
      </div>
    );
  }

  /* 元件被删、仿真被复位之后游标会指到空处：读数按夹紧后的下标算，
   * 游标越界就当没有游标，不拿 undefined 去拼一句话。 */
  const rowAt = at ? Math.min(at.row, rows.length - 1) : -1;
  const active = rowAt >= 0 ? rows[rowAt] : undefined;
  const cellAt = active ? Math.min(at!.cell, active.cells.length - 1) : -1;
  const cursor = active && cellAt >= 0 ? active.cells[cellAt] : undefined;

  const moveTo = (row: number, cell: number) => {
    if (!rows.length) return;
    const r = Math.max(0, Math.min(rows.length - 1, row));
    setAt({ row: r, cell: Math.max(0, Math.min(rows[r].cells.length - 1, cell)) });
    rowRefs.current.get(r)?.focus();
  };

  const onRowKey = (e: React.KeyboardEvent, row: number) => {
    const cells = rows[row]?.cells.length ?? 1;
    const cell = Math.min(at?.cell ?? 0, cells - 1);
    /* 右边是最新的一拍，所以 → 往"更近"走 = 下标变小 */
    if (e.key === "ArrowRight") moveTo(row, cell - 1);
    else if (e.key === "ArrowLeft") moveTo(row, cell + 1);
    else if (e.key === "ArrowDown") moveTo(row + 1, cell);
    else if (e.key === "ArrowUp") moveTo(row - 1, cell);
    else if (e.key === "Home") moveTo(row, cells - 1);
    else if (e.key === "End") moveTo(row, 0);
    else return;
    e.preventDefault();
  };

  const readout = cursor
    ? `第 ${cursor.tick} 拍 ${active!.label} = ${cursor.width > 4 ? hex(cursor.value, cursor.width) : cursor.value}${
        cursor.driven ? "" : "（未驱动，按 0 读取）"
      }`
    : "";

  return (
    <div className="wave-wrap">
      <div className="asm-actions">
        <span className="sub-title">波形</span>
        <span className="dim">每行一个信号，每格一拍（右边最新）；↑↓ 换信号，←→ 移游标，回车选中该元件</span>
        <Button size="small" className="wave-collapse" onClick={() => setOpen(false)}>
          收起
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="panel-note">还没有波形：给元件起个名字，再按 → 跑一拍。</div>
      ) : (
        <div className="wave-list" data-keys="local">
          {rows.map((r, ri) => (
            <div key={r.key} className="wave-row">
              <button
                type="button"
                className="wave-signal"
                ref={(el) => {
                  if (el) rowRefs.current.set(ri, el);
                  else rowRefs.current.delete(ri);
                }}
                tabIndex={ri === (rowAt < 0 ? 0 : rowAt) ? 0 : -1}
                onFocus={() => setAt({ row: ri, cell: at?.row === ri ? at!.cell : 0 })}
                onClick={() => setSelection({ comps: [r.compId], wires: [] })}
                onKeyDown={(e) => onRowKey(e, ri)}
                aria-describedby="wave-readout"
                title={r.key}
              >
                {r.label}
              </button>
              <span className="wave-cells">
                {r.cells.map((c, i) => (
                  <span
                    key={i}
                    className={"wave-cell" + (c.value ? " hi" : "") + (ri === rowAt && i === cellAt ? " cursor" : "")}
                    title={`第 ${c.tick} 拍 ${r.label} = ${c.width > 4 ? hex(c.value, c.width) : c.value}`}
                  >
                    {c.width > 4 ? hex(c.value, c.width) : c.value}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="wave-readout" id="wave-readout" role="status" aria-live="polite">
        {readout}
      </p>
    </div>
  );
}

export function LogPanel() {
  const sim = useEditor((s) => s.sim);
  const logs = sim.logs;
  const name = (id: string) => sim.compById(id)?.inst?.name ?? id;

  return (
    <div className="panel-body">
      <div className="asm-actions">
        <Tag color="blue">{logs.length} 条</Tag>
        <span className="dim">终端元件、告警与错误都会写进这里</span>
      </div>
      <div className="log-list">
        {logs.length ? (
          logs
            .slice(-400)
            .reverse()
            .map((l, i) => (
              <div key={i} className={"log-row " + l.level}>
                <span className="log-t">{l.time}</span>
                <span className="log-c">{name(l.comp)}</span>
                <span className="log-m">{l.msg}</span>
              </div>
            ))
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日志" />
        )}
      </div>
    </div>
  );
}

export function HelpPanel() {
  const doc = isaDoc();
  return (
    <div className="panel-body help">
      <div className="sub-title">快捷键</div>
      <table className="help-keys">
        <tbody>
          {[
            ["空格", "运行 / 暂停"],
            ["→", "单拍"],
            ["⌘Z / ⌘⇧Z", "撤销 / 重做"],
            ["Delete", "删除选区"],
            ["R", "旋转（放置中或选中的元件）"],
            ["G", "把多选元件封装成子电路"],
            ["F", "适应视图"],
            ["W", "连线工具"],
            ["Esc", "取消放置 / 连线 / 选区"],
            ["⌘D", "复制一份选中元件"],
          ].map(([k, v]) => (
            <tr key={k}>
              <td>
                <code>{k}</code>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="panel-note">
        焦点在输入框、下拉框或弹窗里时，以上快捷键不生效——按键交给当前区域处理（文本框里的 ⌘Z 撤销的是文字）。
        焦点在可访问视图的元件清单或波形清单里时同样不生效：那两块用方向键走位，空格是「选中这个元件」而不是「运行」。
      </div>

      <div className="sub-title">键盘与读屏</div>
      <table className="help-keys">
        <tbody>
          {[
            ["Tab", "焦点依次进入画布（进入后即可用上面这些快捷键）和画布旁的可访问视图（元件与端口、连接表、未连接端口、诊断）"],
            ["↑ ↓ ← → / Home / End", "在可访问视图的元件清单里走访元件：整张清单只占一个 Tab 停靠点，走到的那一个会念出名称、类型与引脚数"],
            ["回车 / 空格", "把元件清单里当前这一行的元件选到画布上（画布与属性面板跟着同步）；在别处执行「读取当前引脚值」"],
          ].map(([k, v]) => (
            <tr key={k}>
              <td>
                <code>{k}</code>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="panel-note">
        画布是位图，读屏拿不到形状，因此另有一份等效的元件与端口清单：焦点用 Tab 移到它上面时整块会显形，平时只被辅助技术读到。
        清单里每一行是一个真正的按钮，方向键走访、回车选中，选中之后画布、属性面板与播报讲的是同一个元件。
        保存、运行、判题的结论会以不打断的方式播报；仿真的波形不逐拍朗读，要看当前引脚值就按「读取当前引脚值」。
      </div>

      <div className="sub-title">Z16 指令集</div>
      <div className="panel-note">
        16 位指令字：<code>[15:12] OP · [11:8] A · [7:4] B</code>；立即数形式第二条字放 16 位立即数。
        寄存器 {REG_NAMES.join(" ")}，其中 R6=SP、R7=LR。标志位 bit0=Z、bit1=C、bit2=N。
      </div>
      <table className="help-table">
        <thead>
          <tr>
            <th>汇编</th>
            <th>参数</th>
            <th>微操作</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {doc.map((o) => (
            <tr key={o.op}>
              <td>
                <Tag>{GROUP_LABEL[o.group] ?? o.group}</Tag>
                <code>{o.mnemonic}</code>
              </td>
              <td>
                <code>{o.args}</code>
                {o.words > 1 && <span className="dim"> · {o.words} 字</span>}
              </td>
              <td>
                <code>{o.micro}</code>
              </td>
              <td>{o.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sub-title">条件码</div>
      <table className="help-table">
        <tbody>
          {CONDS.map((c) => (
            <tr key={c.code}>
              <td>
                <code>{c.mnemonics.join(" / ")}</code>
              </td>
              <td>{c.test}</td>
              <td>{c.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sub-title">系统指令</div>
      <table className="help-table">
        <tbody>
          {SYSS.map((s) => (
            <tr key={s.code}>
              <td>
                <code>{s.mnemonic} {s.args}</code>
              </td>
              <td>{s.micro}</td>
              <td>{s.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sub-title">31 位控制字</div>
      <table className="help-table">
        <tbody>
          {CTRL_DOC.map((c) => (
            <tr key={c.name}>
              <td>
                <code>{c.name}</code>
              </td>
              <td>
                <code>{c.bits}</code>
              </td>
              <td>{c.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sub-title">ALU 操作编码</div>
      <div className="panel-note">
        {OPS.filter((o) => o.group === "alu").map((o) => o.mnemonics[0] + " (" + (o.alu ?? "-") + ")").join(" · ")}
      </div>

      <div className="asm-actions">
        <Button size="small" onClick={() => useEditor.getState().setPanel("cpu")}>
          去 CPU 视图
        </Button>
        <Button size="small" onClick={() => useEditor.getState().setPanel("asm")}>
          去汇编器
        </Button>
      </div>
    </div>
  );
}
