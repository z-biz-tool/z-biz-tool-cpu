import { Alert, App, Button, Empty, Select, Table, Tag, Tooltip } from "antd";
import { useMemo } from "react";
import { SAMPLES } from "../../asm/samples.ts";
import { PORT_OUT } from "../../asm/isa.ts";
import { useEditor } from "../store.ts";

/* ------------------------------------------------------------------ *
 * 汇编面板：写 Z16 汇编 → 查机器码清单 → 灌进存储元件
 * ------------------------------------------------------------------ */

const MEM_TYPES = new Set(["ram", "rom"]);

export default function AsmPanel() {
  const { message: toast } = App.useApp();
  const source = useEditor((s) => s.asmSource);
  const setAsm = useEditor((s) => s.setAsm);
  const target = useEditor((s) => s.asmTarget);
  const setTarget = useEditor((s) => s.setAsmTarget);
  const errors = useEditor((s) => s.asmErrors);
  const words = useEditor((s) => s.asmWords);
  const listing = useEditor((s) => s.asmListing);
  const circuit = useEditor((s) => s.circuit());
  const tick = useEditor((s) => s.tick);

  const mems = useMemo(
    () =>
      circuit.comps
        .filter((c) => MEM_TYPES.has(c.type))
        .map((c) => ({ value: c.id, label: c.name || `${c.type} · ${c.id}` })),
    [circuit, tick]
  );
  /* 目标元件可能被删掉，也可能因为切到子电路而不在本视图里；这种时候按钮不能装作还能装 */
  const targetMissing = !!target && !mems.some((m) => m.value === target);
  const targetLabel = mems.find((m) => m.value === target)?.label ?? target;
  const loadTip = !target
    ? "先选一个存储元件"
    : targetMissing
      ? "选中的存储元件不在当前视图，请重新选择"
      : "把机器码按地址写进选中的存储元件";

  return (
    <div className="panel-body">
      <div className="panel-note">
        Z16：16 位定长指令，[15:12] 操作码 / [11:8] A / [7:4] B；立即数形式占两个字。
        输出端口 <code>0x{PORT_OUT.toString(16)}</code> 会显示在终端元件上。
      </div>

      <div className="asm-samples">
        {SAMPLES.map((s) => (
          <Tooltip key={s.key} title={s.desc}>
            <Button size="small" onClick={() => useEditor.getState().useSample(s.key)}>
              {s.name}
            </Button>
          </Tooltip>
        ))}
      </div>

      <textarea
        className="asm-editor"
        value={source}
        spellCheck={false}
        onChange={(e) => setAsm(e.target.value)}
        onBlur={() => useEditor.getState().assembleNow()}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget;
            const at = el.selectionStart;
            setAsm(source.slice(0, at) + "  " + source.slice(el.selectionEnd));
            requestAnimationFrame(() => el.setSelectionRange(at + 2, at + 2));
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            useEditor.getState().assembleNow();
          }
        }}
      />

      <div className="asm-actions">
        <Button size="small" type="primary" onClick={() => useEditor.getState().assembleNow()}>
          汇编 (⌘↵)
        </Button>
        <Select
          size="small"
          className="asm-target"
          placeholder="装载到…"
          value={target || undefined}
          options={mems}
          onChange={setTarget}
          notFoundContent={mems.length ? undefined : "画布上没有 RAM/ROM"}
        />
        <Tooltip title={loadTip}>
          <Button
            size="small"
            disabled={!target || targetMissing}
            onClick={() => {
              const st = useEditor.getState();
              if (!st.loadProgramToTarget()) {
                st.assembleNow();
                toast.warning("汇编没通过，机器码没有写入存储元件");
                return;
              }
              /* 条数取写入后的状态：用户可能改了源码还没失焦就点装载 */
              toast.success(`已把 ${useEditor.getState().asmWords.length} 条指令写入「${targetLabel}」`);
            }}
          >
            装载
          </Button>
        </Tooltip>
        <Tag color="blue">{words.length} 条指令</Tag>
      </div>

      {targetMissing && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title="选中的存储元件不在当前视图"
          description={`之前选的 ${target} 可能已被删除，或者你切到了别的子电路；装载前请重新选择目标。`}
        />
      )}

      {!!errors.length && <Alert type="error" showIcon title="汇编错误" description={<ul className="asm-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>} />}

      {listing.length ? (
        <Table
          size="small"
          pagination={false}
          rowKey={(r) => String(r.addr)}
          dataSource={listing}
          columns={[
            { title: "地址", dataIndex: "addr", width: 62, render: (v: number) => "0x" + v.toString(16).padStart(3, "0") },
            { title: "机器码", dataIndex: "word", width: 70, render: (v: number) => "0x" + v.toString(16).padStart(4, "0") },
            { title: "指令", dataIndex: "text", ellipsis: true },
          ]}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点「汇编」生成清单" />
      )}
    </div>
  );
}
