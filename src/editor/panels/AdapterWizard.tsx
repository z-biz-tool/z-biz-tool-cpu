import { Alert, Button, Input, Radio, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import { Simulator } from "../../core/sim.ts";
import { adapterForReference, validateUserAdapter } from "../../cpu/debug.ts";
import type { CpuDebugAdapter, SignalRef } from "../../cpu/debug.ts";
import { ISA_VERSION } from "../../asm/isa.ts";

/* ------------------------------------------------------------------ *
 * IMP-12: CPU 调试适配器 UI 向导
 *
 * 两模式：
 * - "reference"：使用参考 CPU 已知的 handles，自动绑定
 * - "user"：通过 SignalRef 字段手动填写组件 id + 引脚，
 *   并实时验证绑定是否能解析到当前画布上的有效信号
 * ------------------------------------------------------------------ */

export interface AdapterWizardProps {
  /** 当前画布设计的 Simulator，用于校验绑定能否解析到真实信号 */
  sim?: Simulator;
  /** 校验通过时回调；目前没有写入项目的通道，调用方可忽略 */
  onApply?: (adapter: CpuDebugAdapter) => void;
  /** 当前已绑定（来自项目），回填到表单 */
  current?: CpuDebugAdapter | null;
}

export default function AdapterWizard({ sim, onApply, current }: AdapterWizardProps) {
  const [mode, setMode] = useState<"reference" | "user">("user");
  const [pc, setPc] = useState<string>(current?.binding.pc.compId ?? "");
  const [pcPin, setPcPin] = useState<string>(current?.binding.pc.pin ?? "q");
  const [regsText, setRegsText] = useState<string>(() => (current?.binding.registers ?? []).map((r) => r.compId).join("\n"));
  const [regsPin, setRegsPin] = useState<string>(current?.binding.registers[0]?.pin ?? "q");
  const [flagZ, setFlagZ] = useState<string>(current?.binding.flags.z?.compId ?? "");
  const [flagZPin, setFlagZPin] = useState<string>(current?.binding.flags.z?.pin ?? "q0");
  const [flagC, setFlagC] = useState<string>(current?.binding.flags.c?.compId ?? "");
  const [flagCPin, setFlagCPin] = useState<string>(current?.binding.flags.c?.pin ?? "q1");
  const [flagN, setFlagN] = useState<string>(current?.binding.flags.n?.compId ?? "");
  const [flagNPin, setFlagNPin] = useState<string>(current?.binding.flags.n?.pin ?? "q2");
  const [halted, setHalted] = useState<string>(current?.binding.halted.compId ?? "");
  const [haltedPin, setHaltedPin] = useState<string>(current?.binding.halted.pin ?? "in");
  const [memPath, setMemPath] = useState<string>((current?.binding.memoryInstancePath ?? [])[0] ?? "");

  const refs = (comp: string, pin: string): SignalRef | undefined =>
    comp && pin ? { compId: comp.trim(), pin: pin.trim() } : undefined;

  const buildAdapter = (): CpuDebugAdapter | null => {
    if (mode === "reference") return null;
    const regs = regsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => refs(id, regsPin)!);
    return {
      id: "user-z16",
      isaVersion: ISA_VERSION,
      binding: {
        pc: refs(pc, pcPin)!,
        registers: regs,
        flags: {
          z: refs(flagZ, flagZPin),
          c: refs(flagC, flagCPin),
          n: refs(flagN, flagNPin),
          v: undefined,
        },
        halted: refs(halted, haltedPin)!,
        memoryInstancePath: memPath.trim() ? [memPath.trim()] : [],
      },
    };
  };

  const [errors, setErrors] = useState<string[]>([]);
  /** 上次校验结论；改动任一字段就作废，避免拿着旧结论当新结论 */
  const [pass, setPass] = useState<string | null>(null);
  useEffect(() => {
    setPass(null);
    setErrors([]);
  }, [mode, pc, pcPin, regsText, regsPin, flagZ, flagZPin, flagC, flagCPin, flagN, flagNPin, halted, haltedPin, memPath]);

  const apply = () => {
    setPass(null);
    if (mode === "reference") return;
    if (!sim) return setErrors(["缺少当前设计的仿真器：无法校验绑定"]);
    const a = buildAdapter();
    if (!a) return setErrors(["绑定未填完"]);
    const errs = validateUserAdapter(a, sim);
    setErrors(errs);
    if (errs.length) return;
    setPass("校验通过：PC、R0…R7、停机信号都能在当前画布的设计里解析到。");
    onApply?.(a);
  };

  return (
    <div className="adapter-wizard">
      <div className="panel-note">
        调试器要查看架构状态（PC / 寄存器 / 标志 / 停机），需要明确指出画布上的哪些信号代表哪个对象。
        用户向导只校验这些信号能否在当前设计里解析到，不会写入项目；参考 CPU 运行时使用内置绑定。
      </div>

      <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as "reference" | "user")} style={{ marginBottom: 12 }}>
        <Radio.Button value="user">用户 CPU 向导</Radio.Button>
        <Radio.Button value="reference">参考 Z16（自动）</Radio.Button>
      </Radio.Group>

      {mode === "reference" ? (
        <Alert
          type="info"
          showIcon
          title="参考 CPU 由系统装配，自动绑定为 PC/IR/标志/8 个寄存器/停机信号；如需换算成用户设计，可切到「用户 CPU 向导」手动填写。"
        />
      ) : (
        <>
          <Field label="PC（程序计数器）" comp={pc} pin={pcPin} setComp={setPc} setPin={setPcPin} hint="一般是 16 位寄存器的 q 输出" />
          <Field
            label="R0…R7（每行一个元件 id）"
            comp={regsText}
            pin={regsPin}
            setComp={(v) => setRegsText(v)}
            setPin={setRegsPin}
            multiline
            hint="按 R0/R1/R2/R3/R4/R5/SP/LR 的顺序每行写一个 id"
          />
          <Space>
            <Field label="标志 Z" comp={flagZ} pin={flagZPin} setComp={setFlagZ} setPin={setFlagZPin} inline />
            <Field label="标志 C" comp={flagC} pin={flagCPin} setComp={setFlagC} setPin={setFlagCPin} inline />
            <Field label="标志 N" comp={flagN} pin={flagNPin} setComp={setFlagN} setPin={setFlagNPin} inline />
          </Space>
          <Field label="HALT（停机信号）" comp={halted} pin={haltedPin} setComp={setHalted} setPin={setHaltedPin} hint="DFF 的 q 输出；1 表示停机" />
          <Field label="MEM 实例 id" comp={memPath} pin="" setComp={setMemPath} setPin={() => {}} hint="程序与数据所在的 RAM 元件 id；用于装载程序" />
        </>
      )}

      {pass && (
        <Alert type="success" showIcon style={{ marginTop: 12 }} title={pass} description="这是校验结论，没有写进项目文件；改动任一字段后会重新校验。" />
      )}

      {errors.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          title="绑定未通过"
          description={<ul className="asm-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        />
      )}

      <Space style={{ marginTop: 12 }}>
        <Button size="small" type="primary" onClick={apply} disabled={mode === "reference"}>
          校验绑定
        </Button>
        <Tag color="geekblue">ISA {ISA_VERSION}</Tag>
      </Space>
    </div>
  );
}

function Field({
  label,
  comp,
  pin,
  setComp,
  setPin,
  multiline,
  inline,
  hint,
}: {
  label: string;
  comp: string;
  pin: string;
  setComp: (v: string) => void;
  setPin: (v: string) => void;
  multiline?: boolean;
  inline?: boolean;
  hint?: string;
}) {
  return (
    <div className={"adapter-field" + (inline ? " inline" : "")}>
      <span className="adapter-label">{label}</span>
      <Input.TextArea
        value={comp}
        onChange={(e) => setComp(e.target.value)}
        autoSize={multiline ? { minRows: 8, maxRows: 12 } : undefined}
        placeholder="元件 id"
        style={{ width: inline ? 120 : "100%" }}
      />
      {pin !== "" && (
        <Input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="引脚"
          style={{ width: inline ? 80 : 120 }}
        />
      )}
      {hint && <span className="adapter-hint dim">{hint}</span>}
    </div>
  );
}

/** 在项目中保存适配器时使用的标准化方法 */
export function bindReferenceAdapter(_sim: Simulator, handles: import("../../cpu/reference.ts").CpuHandles, memoryId: string): CpuDebugAdapter {
  return adapterForReference(handles, memoryId);
}