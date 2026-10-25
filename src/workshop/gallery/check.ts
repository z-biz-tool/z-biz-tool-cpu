import { Simulator } from "../../core/sim.ts";
import { totalCost } from "../../core/custom.ts";
import { mask } from "../../core/types.ts";
import type { Design } from "../../core/types.ts";
import { buildNetlist } from "../dsl.ts";
import type { Example } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 案例自检：把「100 个案例」从文案变成可验证的事实
 *
 * 每个案例都要过五关：
 *  1. 能搭起来（网表语法 + 引脚存在 + 无重复名）
 *  2. 端口声明与 ports 说明一一对应（不允许有没人解释的引脚）
 *  3. 无阻断性诊断（多驱动 / 未知引脚 / 位宽冲突）
 *  4. 行为对拍：组合案例跑边界向量 + 随机向量，与 model 逐位比较；
 *     时序案例按 seq 脚本打拍，比对每一步的输出
 *  5. 结果确定：同样的输入跑两遍必须一样（反馈环没收敛会在这里露出来）
 * ------------------------------------------------------------------ */

export interface ExampleReport {
  id: string;
  name: string;
  pack: string;
  ok: boolean;
  problems: string[];
  stats: { comps: number; wires: number; cost: number; ports: number; vectors: number };
}

/** 可复现的伪随机：同一个案例每次跑出来的向量都一样，失败能照着复现 */
function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function vectors(names: string[], widths: Record<string, number>, count = 12): Record<string, number>[] {
  const maxOf = (n: string) => mask(0xffffffff, widths[n] ?? 1);
  const out: Record<string, number>[] = [];
  // 边界：全 0 / 全 1 / 交替 / 单比特
  out.push(Object.fromEntries(names.map((n) => [n, 0])));
  out.push(Object.fromEntries(names.map((n) => [n, maxOf(n)])));
  out.push(Object.fromEntries(names.map((n, i) => [n, mask(i % 2 ? 0xaaaaaaaa : 0x55555555, widths[n] ?? 1)])));
  for (let bit = 0; bit < 32; bit++) {
    if (out.length >= count) break;
    const v: Record<string, number> = {};
    for (const n of names) v[n] = mask(1 << bit, widths[n] ?? 1);
    out.push(v);
  }
  const rnd = lcg(0x9e3779b9);
  while (out.length < count + 8) {
    out.push(Object.fromEntries(names.map((n) => [n, mask(rnd(), widths[n] ?? 1)])));
  }
  return out;
}

/** 给一个上升沿：先把 clk 拉高走一步，再拉低走一步（回到低电平，便于下次再打） */
function pulse(sim: Simulator, clkId: string) {
  sim.setInput(clkId, 1);
  sim.step();
  sim.setInput(clkId, 0);
  sim.step();
}

export function checkExample(ex: Example): ExampleReport {
  const problems: string[] = [];
  const stats = { comps: 0, wires: 0, cost: 0, ports: 0, vectors: 0 };

  let built: ReturnType<typeof buildNetlist>;
  try {
    built = buildNetlist(ex.src);
  } catch (e) {
    return {
      id: ex.id,
      name: ex.name,
      pack: ex.pack,
      ok: false,
      problems: ["搭不起来：" + (e as Error).message],
      stats,
    };
  }

  const { circuit, ports } = built;
  stats.comps = circuit.comps.filter((c) => c.type !== "input" && c.type !== "output").length;
  stats.wires = circuit.wires.length;
  stats.ports = ports.length;

  const design: Design = { name: ex.name, root: circuit, defs: [] };
  stats.cost = totalCost(design, circuit);

  /* ---- 端口说明必须覆盖每个端口，且不能有多的 ---- */
  const portNames = ports.map((p) => p.name).sort();
  const documented = Object.keys(ex.ports).sort();
  const missing = portNames.filter((n) => !documented.includes(n));
  const extra = documented.filter((n) => !portNames.includes(n));
  if (missing.length) problems.push("端口没写说明：" + missing.join("、"));
  if (extra.length) problems.push("说明了不存在的端口：" + extra.join("、"));

  /* ---- 拓扑诊断 ---- */
  const sim0 = new Simulator(design, circuit);
  const errors = sim0.nl.errors.filter((e) => e.level === "error");
  if (errors.length) problems.push("拓扑错误：" + errors.map((e) => e.msg).join("；"));
  if (!stats.comps) problems.push("电路里没有一个功能元件（只有端口）");

  const ins = ports.filter((p) => p.dir === "in");
  const outs = ports.filter((p) => p.dir === "out");
  const widths = Object.fromEntries(ports.map((p) => [p.name, p.width]));
  if (!outs.length) problems.push("没有输出端口，验不了行为");

  /* ---- 组合：模型对拍 ---- */
  if (ex.model) {
    const names = ex.comb ?? ins.filter((p) => p.name !== "clk").map((p) => p.name);
    const list = vectors(names, widths);
    for (const v of list) {
      const sim = new Simulator(design, circuit);
      for (const [k, val] of Object.entries(v)) sim.setInput(k, val);
      const want = ex.model(v);
      for (const [k, val] of Object.entries(want)) {
        const got = sim.valueOf({ comp: k, pin: "in" });
        stats.vectors++;
        if (!got) {
          problems.push(`输出 ${k} 读不到`);
          continue;
        }
        if (!got.driven) problems.push(`输出 ${k} 从未被驱动（输入 ${JSON.stringify(v)}）`);
        if (mask(got.value, widths[k] ?? 1) !== mask(val, widths[k] ?? 1)) {
          problems.push(
            `${k}：输入 ${JSON.stringify(v)} → 期望 ${mask(val, widths[k] ?? 1)}，实际 ${got.value}` +
              `（${got.width} 位线上）`
          );
          if (problems.length > 6) break;
        }
      }
      if (problems.length > 6) break;
    }
  }

  /* ---- 组合：显式用例 ---- */
  for (const c of ex.cases ?? []) {
    const sim = new Simulator(design, circuit);
    for (const [k, v] of Object.entries(c.set)) sim.setInput(k, v);
    for (const [k, v] of Object.entries(c.expect)) {
      const got = sim.valueOf({ comp: k, pin: "in" });
      stats.vectors++;
      if (!got || mask(got.value, widths[k] ?? 1) !== mask(v, widths[k] ?? 1)) {
        problems.push(`${c.label ?? "用例"} ${k}：期望 ${mask(v, widths[k] ?? 1)}，实际 ${got?.value ?? "读不到"}`);
      }
    }
  }

  /* ---- 时序：脚本打拍 ---- */
  if (ex.seq) {
    if (!ins.some((p) => p.name === "clk" && p.width === 1)) {
      problems.push("时序案例必须有 1 位的 clk 输入端口");
    } else {
      const sim = new Simulator(design, circuit);
      const readAt = (map: Record<string, number> | undefined, where: string) => {
        for (const [k, v] of Object.entries(map ?? {})) {
          const got = sim.valueOf({ comp: k, pin: "in" });
          stats.vectors++;
          if (!got || mask(got.value, widths[k] ?? 1) !== mask(v, widths[k] ?? 1)) {
            problems.push(`${where} ${k}：期望 ${v}，实际 ${got?.value ?? "读不到"}`);
          }
        }
      };
      for (const step of ex.seq) {
        for (const [k, v] of Object.entries(step.set ?? {})) sim.setInput(k, v);
        readAt(step.at, "打拍前");
        for (let t = 0; t < (step.ticks ?? 1); t++) pulse(sim, "clk");
        readAt(step.expect, step.set ? JSON.stringify(step.set) : "（保持）");
      }
    }
  }

  if (!ex.model && !ex.seq && !ex.cases?.length) problems.push("没有行为验证（model / seq / cases 三选一）");
  if (!ex.blurb?.trim()) problems.push("缺一句话简介");
  if (!ex.why?.trim()) problems.push("缺教学价值说明");

  /* ---- 确定性：同样输入两遍必须一致 ---- */
  if (ex.model) {
    const names = ex.comb ?? ins.filter((p) => p.name !== "clk").map((p) => p.name);
    const a = new Simulator(design, circuit);
    const b = new Simulator(design, circuit);
    for (const n of names) {
      a.setInput(n, 1);
      b.setInput(n, 1);
    }
    for (const o of outs) {
      const va = a.valueOf({ comp: o.name, pin: "in" });
      const vb = b.valueOf({ comp: o.name, pin: "in" });
      if (!va || !vb || va.value !== vb.value) problems.push(`输出 ${o.name} 两次运行不一致（组合环没收敛？）`);
    }
    if (a.unstable) problems.push("组合逻辑未收敛：" + a.settleOutcome);
  }

  return {
    id: ex.id,
    name: ex.name,
    pack: ex.pack,
    ok: problems.length === 0,
    problems: problems.slice(0, 8),
    stats,
  };
}

export function checkGallery(list: Example[]): ExampleReport[] {
  return list.map(checkExample);
}
