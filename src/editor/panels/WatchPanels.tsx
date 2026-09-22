import { Button, Empty, Table, Tag } from "antd";
import { useMemo, useState } from "react";
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

/** FIX-07: 简易波形面板 — 用 CSS 横向延伸的色块表示每拍值的变化 */
function WaveformPanel() {
  const sim = useEditor((s) => s.sim);
  const tick = useEditor((s) => s.tick);
  const [open, setOpen] = useState(false);
  const sigs = useMemo(() => sim.trace.signals(), [sim, tick]);
  if (!open) {
    return (
      <div style={{ marginTop: 12 }}>
        <Button size="small" onClick={() => setOpen(true)}>
          显示最近 N 拍波形 ({sigs.length} 信号)
        </Button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div className="asm-actions">
        <Tag color="purple">FIX-07 波形</Tag>
        <span className="dim">每行一个信号，每格一拍；同色 = 同值，色块长度即持续拍数</span>
        <Button size="small" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)}>
          收起
        </Button>
      </div>
      {sigs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没记录到事件，先跑一拍" />
      ) : (
        sigs.map((s) => {
          const ev = sim.trace.historyOf(s, 64);
          const compact = ev.map((e) => ({ tick: e.tick, value: e.value, w: e.width })).reverse();
          return (
            <div key={s.compId + "." + s.pin} style={{ display: "flex", gap: 4, alignItems: "center", margin: "4px 0" }}>
              <span className="dim" style={{ width: 110, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.compId}.{s.pin}
              </span>
              <div style={{ display: "flex", flexDirection: "row-reverse", gap: 1, flex: 1, overflowX: "auto" }}>
                {compact.map((c, i) => {
                  const bits = c.w > 1 ? hex(c.value, c.w) : String(c.value);
                  return (
                    <span
                      key={i}
                      title={`tick ${c.tick} = ${bits}`}
                      style={{
                        fontSize: 10,
                        padding: "0 4px",
                        borderRight: "1px solid #ddd",
                        background: c.value ? "#1677ff22" : "#88888822",
                        color: c.value ? "#1677ff" : "#666",
                      }}
                    >
                      {c.w > 4 ? hex(c.value, c.w) : c.value}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
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
