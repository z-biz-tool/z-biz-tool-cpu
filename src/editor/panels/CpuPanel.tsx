import { Alert, Button, Progress, Switch, Table, Tag, Tooltip } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { REG_NAMES } from "../../asm/isa.ts";
import { hex } from "../../core/types.ts";
import { CTRL_DOC, referenceCpu } from "../../cpu/reference.ts";
import { programImage, runProgram } from "../../cpu/run.ts";
import type { CpuRun } from "../../cpu/run.ts";
import { assemble } from "../../asm/assembler.ts";
import { useEditor } from "../store.ts";
import AdapterWizard from "./AdapterWizard.tsx";

/* ------------------------------------------------------------------ *
 * CPU 视图：在参考 CPU 上跑汇编程序，逐拍查看内部状态
 * ------------------------------------------------------------------ */

const MEM_WINDOW = 16;

interface Snapshot {
  pc: number;
  ir: number;
  imm: number;
  st: number;
  ctrl: number;
  flags: number;
  regs: number[];
  mem: number[];
  prints: string[];
  done: boolean;
  steps: number;
  unstable: boolean;
}

function snapOf(run: CpuRun, prints: string[]): Snapshot {
  const h = run.handles;
  const v = (ref: { comp: string; pin: string }) => run.sim.valueOf(ref)?.value ?? 0;
  return {
    pc: v({ comp: h.pc, pin: "q" }),
    ir: v({ comp: h.ir, pin: "q" }),
    imm: v({ comp: h.imm, pin: "q" }),
    st: v({ comp: h.state, pin: "q" }),
    ctrl: v({ comp: h.ctrl, pin: "dout" }),
    flags: v({ comp: h.flags, pin: "q" }),
    regs: h.regs.map((id) => v({ comp: id, pin: "q" })),
    mem: run.sim.readMemory(h.mem).slice(0, MEM_WINDOW),
    prints,
    done: !!v({ comp: h.done, pin: "in" }),
    steps: run.sim.time,
    unstable: run.sim.unstable,
  };
}

/** 把控制字按 CTRL_DOC 的位段拆开，只留下当前激活的字段 */
function ctrlFields(ctrl: number): { name: string; desc: string; value: number }[] {
  const out: { name: string; desc: string; value: number }[] = [];
  for (const doc of CTRL_DOC) {
    const parts = doc.bits.split("-").map((x) => Number(x));
    const lo = parts[0];
    const hi = parts.length > 1 ? parts[1] : parts[0];
    const value = (ctrl >>> lo) & ((1 << (hi - lo + 1)) - 1);
    if (value) out.push({ name: doc.name, desc: doc.desc, value });
  }
  return out;
}

export default function CpuPanel() {
  const source = useEditor((s) => s.asmSource);
  const speed = useEditor((s) => s.speed);
  const [run, setRun] = useState<CpuRun | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [auto, setAuto] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const prints = useRef<string[]>([]);

  const load = () => {
    const res = assemble(source, { base: 0 });
    if (res.errors.length) {
      setErrors(res.errors);
      setRun(null);
      setSnap(null);
      return;
    }
    const cpu = referenceCpu(programImage(res));
    const next = runProgram(source, { maxSteps: 0, design: cpu.design, handles: cpu.handles });
    prints.current = [];
    setErrors([]);
    setRun(next);
    setSnap(snapOf(next, prints.current));
  };

  const advance = (steps: number) => {
    if (!run) return 0;
    let added = 0;
    for (let i = 0; i < steps; i++) {
      const before = run.sim.logs.length;
      run.sim.step();
      for (let k = before; k < run.sim.logs.length; k++) {
        const l = run.sim.logs[k];
        if (l.comp === run.handles.out && l.level === "info") prints.current.push(l.msg);
      }
      if (run.sim.valueOf({ comp: run.handles.done, pin: "in" })?.value) {
        added++;
        break;
      }
      added++;
    }
    prints.current = prints.current.slice();
    setSnap(snapOf(run, prints.current));
    return added;
  };

  // 首次挂载自动装载，面板一进来就有状态可看
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!auto || !run) return;
    const id = window.setInterval(() => {
      if (!advance(1)) setAuto(false);
    }, Math.max(16, 1000 / speed));
    return () => window.clearInterval(id);
  }, [auto, run, speed]);

  const flags = snap?.flags ?? 0;
  const fields = useMemo(() => (snap ? ctrlFields(snap.ctrl) : []), [snap]);

  return (
    <div className="panel-body">
      {/* FIX-06: 明确运行对象身份 — 这台 CPU 是参考机，不是用户画布 */}
      <div className="cpu-identity">
        <Tag color="blue" style={{ marginRight: 8 }}>参考 Z16</Tag>
        <span className="dim">运行对象：参考机（与画布上的电路独立，可在另一标签查看你的设计）</span>
      </div>
      <div className="panel-note">
        参考 CPU 是模块内置的一台 Z16 机器：取指 → 译码 → 执行 → 写回，全部由门电路和寄存器搭出来。
        下面的状态每拍刷新一次。
      </div>

      <div className="asm-actions">
        <Button size="small" type="primary" onClick={load}>
          装载程序
        </Button>
        <Button
          size="small"
          onClick={() => setShowWizard((s) => !s)}
        >
          {showWizard ? "隐藏绑定向导" : "CPU 适配器"}
        </Button>
        <Tooltip title="单拍执行，看看 PC / IR / 控制字怎么变">
          <Button size="small" disabled={!run || snap?.done} onClick={() => advance(1)}>
            下一步
          </Button>
        </Tooltip>
        <Button size="small" disabled={!run} onClick={() => advance(8)}>
          ×8 拍
        </Button>
        <Button
          size="small"
          disabled={!run}
          onClick={() => {
            if (!run) return;
            const got = advance(4000);
            if (!got) setAuto(false);
          }}
        >
          跑到停机
        </Button>
        <Button
          size="small"
          disabled={!run}
          onClick={() => {
            if (!run) return;
            run.sim.reset();
            prints.current = [];
            setSnap(snapOf(run, []));
          }}
        >
          复位
        </Button>
        <span className="inline-label">
          连续运行 <Switch size="small" checked={auto} disabled={!run} onChange={setAuto} />
        </span>
      </div>

      {!!errors.length && (
        <Alert type="error" showIcon message="程序无法装载" description={<ul className="asm-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>} />
      )}

      {snap && (
        <>
          <div className="cpu-grid">
            <Cell label="PC" value={hex(snap.pc, 16)} hint="程序计数器" />
            <Cell label="IR" value={hex(snap.ir, 16)} hint="指令寄存器" />
            <Cell label="IMM" value={hex(snap.imm, 16)} hint="立即数锁存" />
            <Cell label="微指令" value={hex(snap.st, 8)} hint="状态机步序号" />
            <Cell label="控制字" value={hex(snap.ctrl, 31)} hint="31 位控制信号" />
            <Cell
              label="标志"
              value={`${flags & 1 ? "Z" : "-"}${flags & 2 ? "C" : "-"}${flags & 4 ? "N" : "-"}`}
              hint="bit0 为零 / bit1 进位 / bit2 负"
            />
          </div>

          <div className="sub-title">寄存器组</div>
          <div className="cpu-regs">
            {snap.regs.map((r, i) => (
              <Tooltip key={REG_NAMES[i]} title={i === 6 ? "栈顶指针" : i === 7 ? "调用返回地址" : "通用寄存器"}>
                <span className={"cpu-reg" + (i === 6 || i === 7 ? " sp" : "")}>
                  <b>{REG_NAMES[i]}</b>
                  <em>{hex(r, 16)}</em>
                </span>
              </Tooltip>
            ))}
          </div>

          <div className="sub-title">
            控制信号
            <Tag className="pull-right">{fields.length ? `${fields.length} 位有效` : "空闲"}</Tag>
          </div>
          <div className="cpu-ctrl">
            {fields.length ? (
              fields.map((f) => (
                <Tooltip key={f.name} title={f.desc}>
                  <span>
                    {f.name}=<b>{f.value}</b>
                  </span>
                </Tooltip>
              ))
            ) : (
              <span className="dim">本拍没有激活的控制信号</span>
            )}
          </div>

          <div className="sub-title">存储 (前 {MEM_WINDOW} 字)</div>
          <Table
            size="small"
            pagination={false}
            rowKey={(r) => String(r.addr)}
            dataSource={snap.mem.map((word, addr) => ({ addr, word }))}
            columns={[
              { title: "地址", dataIndex: "addr", width: 60, render: (v: number) => "0x" + v.toString(16).padStart(2, "0") },
              { title: "内容", dataIndex: "word", width: 64, render: (v: number) => "0x" + v.toString(16).padStart(4, "0") },
              {
                title: "字符",
                dataIndex: "word",
                key: "ch",
                width: 44,
                render: (v: number) => (v >= 32 && v < 127 ? String.fromCharCode(v) : "·"),
              },
            ]}
          />

          <div className="sub-title">
            终端输出
            <span className="pull-right dim">
              第 {snap.steps} 拍 {snap.done ? "· 已停机" : ""}
            </span>
          </div>
          <div className={"cpu-out" + (snap.done ? " done" : "")}>
            {snap.prints.length ? snap.prints.join(" ") : <span className="dim">还没有输出</span>}
          </div>
          {snap.unstable && <Alert type="warning" showIcon message="组合逻辑未收敛，可能存在环路" />}
        </>
      )}

      {showWizard && (
        <div style={{ marginTop: 12, padding: 8, background: "rgba(167,139,250,0.08)", borderRadius: 6 }}>
          <AdapterWizard
            sim={run ? run.sim : undefined}
            onApply={(a) => console.log("[adapter] saved", a.id)}
            current={null}
          />
        </div>
      )}

      <div className="asm-actions">
        <Button
          size="small"
          onClick={() => {
            const cpu = referenceCpu([]);
            useEditor.getState().loadDesign(cpu.design);
          }}
        >
          把参考 CPU 装入画布
        </Button>
        <Progress percent={snap ? (snap.done ? 100 : Math.min(99, snap.steps / 20)) : 0} size="small" showInfo={false} />
      </div>
    </div>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Tooltip title={hint}>
      <div className="cpu-cell">
        <span>{label}</span>
        <b>{value}</b>
      </div>
    </Tooltip>
  );
}
