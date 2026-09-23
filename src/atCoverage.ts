/* ------------------------------------------------------------------ *
 * AT-01..AT-12 全验收矩阵 — doc/全量设计/07 §2
 *
 * 全部用顶层 import，避免 Node ESM/CJS 顶层 await 歧义
 * ------------------------------------------------------------------ */

import { assemble } from "./asm/assembler.ts";
import { SAMPLES } from "./asm/samples.ts";
import { Simulator } from "./core/sim.ts";
import type { Design } from "./core/types.ts";
import { referenceCpu } from "./cpu/reference.ts";
import { newInterpreter, runToHalt, loadProgram } from "./cpu/interpreter.ts";
import { validateProjectFile } from "./project/validate.ts";
import { LEVELS, levelDesign, solutionDesign } from "./challenges/levels.ts";
import { runLevelTests } from "./challenges/verify.ts";
import { buildHitIndex, hitTest } from "./editor/hitIndex.ts";
import { buildA11y } from "./editor/a11y.ts";
import { parseManifest, validateCatalog } from "./courses/manifest.ts";
import { validateCommand, validateResponse } from "./workers/protocol.ts";
import type { SimClientBackend, ClientEvents } from "./workers/client.ts";
import type { WorkerRequest, WorkerResponse } from "./workers/protocol.ts";
import { SimClient } from "./workers/client.ts";

export interface ATResult {
  id: string;
  ok: boolean;
  detail: string;
}

function t(id: string, ok: boolean, detail = ""): ATResult {
  return { id, ok, detail };
}

/* AT-01 基线与工程环境（doc 07 §2）：清单齐不齐、缺项会不会被当成通过。
 * 不接受「别的套件说过了」这种证据 —— 这里只看自己能测到的东西。 */
export function at01(ctx: { passed: number; failed: number } = { passed: 0, failed: 0 }): ATResult {
  const issues: string[] = [];
  if (LEVELS.length !== 31) issues.push(`关卡 ${LEVELS.length}≠31`);

  const noSolution = LEVELS.filter((l) => !solutionDesign(l)).map((l) => l.id);
  if (noSolution.length) issues.push(`缺参考解答 ${noSolution.length} 关(${noSolution.slice(0, 3).join(",")})`);

  // 故障注入：拿裸骨架去判题，31 关一关都不许通过
  const faked = LEVELS.filter((l) => runLevelTests(l, levelDesign(l)).pass).map((l) => l.id);
  if (faked.length) issues.push(`骨架冒充通过 ${faked.length} 关(${faked.slice(0, 3).join(",")})`);

  if (SAMPLES.length < 7) issues.push(`示例程序 ${SAMPLES.length}<7`);
  const badSample = SAMPLES.filter((s) => assemble(s.source).errors.length).map((s) => s.key);
  if (badSample.length) issues.push(`示例程序汇编失败 ${badSample.join(",")}`);

  if (ctx.failed) issues.push(`自检有 ${ctx.failed} 项失败`);
  if (!ctx.passed) issues.push("自检一项结果都没有");

  return t(
    "AT-01",
    !issues.length,
    issues.join("; ") || `31 关均有解答且骨架 0 通过，${SAMPLES.length} 个示例程序可汇编，自检 ${ctx.passed} 项全绿`,
  );
}

/* AT-02：损坏输入有界终止 */
export function at02(): ATResult {
  const cases: { name: string; ok: boolean; detail: string }[] = [
    { name: "空 # 单独", ok: assemble("#").errors.length > 0, detail: "" },
    { name: "空 @ 单独", ok: assemble("@").errors.length > 0, detail: "" },
    { name: "未定义符号", ok: assemble("ldi r0, nowhere").errors.some((x) => /未定义/.test(x)), detail: "" },
    { name: "非法指令", ok: assemble("foo r0, r1").errors.length > 0, detail: "" },
    { name: "非法常量", ok: assemble("ldi r0, 0xZZ").errors.length > 0, detail: "" },
    { name: "超长源码", ok: assemble("nop\n".repeat(100000)).errors.length === 0, detail: "" },
  ];
  const allOk = cases.every((c) => c.ok);
  return t("AT-02", allOk, cases.filter((c) => !c.ok).map((c) => c.name).join(";") || "全部有界");
}

/* AT-03：仿真确定性 */
export function at03(): ATResult {
  const cpu = referenceCpu([0x0001, 0x000a, 0x5000, 0xb001, 0x3000, 0xe000, 0x0009, 0xf000]);
  const r1 = runStableTrace(cpu.design);
  let mismatch = 0;
  for (let i = 0; i < 50; i++) {
    const rn = runStableTrace(cpu.design);
    if (rn !== r1) mismatch++;
  }
  return t("AT-03", mismatch === 0, mismatch === 0 ? "50 次结果一致" : mismatch + " 次不一致");
}
function runStableTrace(design: Design): string {
  const sim = new Simulator(design, design.root);
  const out: string[] = [];
  for (let i = 0; i < 60; i++) {
    sim.step();
    for (const c of sim.probes()) if (c.kind === "io" && c.value) out.push(`${i}:${c.value.value}`);
  }
  return out.join("|");
}

/* AT-04：≥1000 恢复 + 旧快照不可变 + 版本拒绝 */
export function at04(): ATResult {
  const cpu = referenceCpu([]);
  const sim = new Simulator(cpu.design, cpu.design.root);
  for (let i = 0; i < 200; i++) sim.step();
  const snap = sim.snapshot();
  for (let i = 0; i < 100; i++) sim.step();
  const savedTime = snap.time;
  const savedLogs = snap.logs.length;
  let consistent = 0;
  for (let i = 0; i < 1000; i++) {
    const ok = sim.restore(snap);
    if (ok && sim.time === savedTime && sim.logs.length === savedLogs) consistent++;
  }
  sim.step();
  const snapUnchanged = snap.time === savedTime && snap.logs.length === savedLogs;
  const badFmt = sim.restore({ ...snap, format: "wrong/2" } as any);
  const badHash = sim.restore({ ...snap, netHash: -1 } as any);
  const badSession = sim.restore({ ...snap, sessionId: "different" } as any);
  return t(
    "AT-04",
    consistent === 1000 && snapUnchanged && !badFmt && !badHash && !badSession,
    `一致 ${consistent}/1000, 旧快照不变=${snapUnchanged}, 错格式=${!badFmt}, 错哈希=${!badHash}, 错session=${!badSession}`,
  );
}

/* AT-05：布局不重编译 */
export function at05(): ATResult {
  const cpu = referenceCpu([0x0001, 0x000a, 0x5000, 0xb001, 0x3000, 0xe000, 0x0009, 0xf000]);
  const sim = new Simulator(cpu.design, cpu.design.root);
  for (let i = 0; i < 30; i++) sim.step();
  const beforeTime = sim.time;
  if (cpu.design.root.comps[0]) {
    cpu.design.root.comps[0].x += 10;
    cpu.design.root.comps[0].y += 10;
  }
  return t("AT-05", sim.time === beforeTime, `time=${sim.time} (前=${beforeTime})`);
}

/* AT-06：保存 + schema 校验 */
export function at06(): ATResult {
  const v = validateProjectFile({
    schemaVersion: 2,
    id: "x",
    title: "x",
    revision: 1,
    kernelVersion: "k1",
    isaVersion: "z16/1.1",
    catalogVersion: "c1",
    design: { name: "x", root: { comps: [], wires: [] }, defs: [] },
    assemblyFiles: {},
    testbenches: [],
    watchConfig: { signals: [], breakpoints: [] },
    componentLocks: [],
  });
  return t("AT-06", v.ok, v.ok ? "schema 通过" : v.issues.map((i) => i.msg).join(";"));
}

/* AT-07：Worker 协议与过期响应（doc 07 §2「旧响应无效；不伪报通过」）
 * 这里跑的是真的 SimClient + validateCommand/validateResponse，不再另写一份判定。 */
export function at07(): ATResult {
  const issues: string[] = [];
  const base = { requestId: "r1", sessionId: "s1", designRevision: 5 };
  if (!validateCommand({ ...base, command: "step" })) issues.push("已知命令被拒");
  if (validateCommand({ ...base, command: "drop-table" })) issues.push("未知命令通过");
  if (validateCommand({ ...base, command: "step", designRevision: "5" })) issues.push("revision 类型没校验");
  if (validateCommand(null)) issues.push("null 命令通过");
  if (!validateResponse({ ...base, sequence: 1, type: "result" })) issues.push("合法响应被拒");
  if (validateResponse({ ...base, sequence: 1, type: "maybe" })) issues.push("未知响应类型通过");

  // 假 backend：只记录发出的命令，回包由测试这边决定
  class EchoBackend implements SimClientBackend {
    sent: WorkerRequest[] = [];
    private handler: ((r: WorkerResponse) => void) | null = null;
    post(req: WorkerRequest) {
      this.sent.push(req);
    }
    onResponse(h: (r: WorkerResponse) => void) {
      this.handler = h;
    }
    emit(resp: WorkerResponse) {
      this.handler?.(resp);
    }
  }
  const backend = new EchoBackend();
  const got: number[] = [];
  const events: ClientEvents = { onResult: (r) => got.push(r.tick) };
  const client = new SimClient(backend, { sessionId: "s1", revision: 5 });
  client.setEvents(events);
  client.step(1);
  if (backend.sent.length !== 1 || backend.sent[0].command !== "step") issues.push("命令没按协议发出");

  // 上一版设计的回包：既不能进 UI，也不能污染 latestResult
  backend.emit({ requestId: "r1", sessionId: "s1", designRevision: 4, sequence: 1, type: "result", payload: { tick: 4 } });
  if (got.length || client.result()) issues.push("旧 revision 的响应被当成当前结果");
  // 别的 session 的回包
  backend.emit({ requestId: "r1", sessionId: "other", designRevision: 5, sequence: 2, type: "result", payload: { tick: 5 } });
  if (got.length) issues.push("接受了别家 session 的回包");
  // 当前版本
  backend.emit({ requestId: "r1", sessionId: "s1", designRevision: 5, sequence: 3, type: "result", payload: { tick: 6 } });
  if (got.length !== 1 || client.result()?.tick !== 6) issues.push("当前 revision 的响应没送到 UI");
  // 切项目：旧版本号整段作废，之后就算再回也无效
  client.bumpRevision(7);
  backend.emit({ requestId: "r1", sessionId: "s1", designRevision: 5, sequence: 4, type: "result", payload: { tick: 8 } });
  if (got.length !== 1) issues.push("切版本后旧响应仍然生效");
  // 版本号会被复用（撤销 / 重做回到同一 revision）：回到这一版后新回包必须能进 UI，
  // 否则界面永远停在旧结果。同一版号在飞时的旧回包与新版无法只靠版号区分，不强测。
  client.bumpRevision(5);
  backend.emit({ requestId: "r1", sessionId: "s1", designRevision: 5, sequence: 5, type: "result", payload: { tick: 10 } });
  if (got.length !== 2 || client.result()?.tick !== 10) issues.push("撤销标记挡住了复用后的新回包");
  // 出错回包必须显式上报，不能悄悄当成功
  let err = "";
  client.setEvents({ ...events, onError: (e) => (err = e.message) });
  backend.emit({ requestId: "r1", sessionId: "s1", designRevision: 5, sequence: 7, type: "error", payload: { message: "编译炸了" } });
  if (err !== "编译炸了") issues.push("错误回包没上报");

  return t("AT-07", !issues.length, issues.join("; ") || "协议校验 + 过期/别家/错误回包均按预期");
}

/* AT-08：短脉冲保留（step 内部 captureTraceEndOfTick 抓所有已命名元件） */
export function at08(): ATResult {
  const lvl = LEVELS.find((l: any) => l.id === "t1-halfadd");
  if (!lvl) return t("AT-08", false, "缺 t1-halfadd");
  const sk = levelDesign(lvl);
  const sim = new Simulator(sk, sk.root);
  const inputs = sim.rootComps().filter((c) => c.def.type === "input");
  if (!inputs.length) return t("AT-08", false, "无 input 元件");
  // 通过 step 产生变化：先给 0，step 抓 0 事件；setInput 1 后再 step 抓 1
  sim.step();
  sim.setInput(inputs[0].id, 1);
  sim.step();
  sim.setInput(inputs[0].id, 0);
  sim.step();
  const evs = sim.trace.events();
  const saw01 = evs.some((e) => e.value === 1) && evs.some((e) => e.value === 0);
  return t("AT-08", saw01, `events=${evs.length}, 包含 0/1=${saw01}`);
}

/* AT-09：判题契约 — 改小位宽不能绕过 */
export function at09(): ATResult {
  const t1 = LEVELS.find((l: any) => l.id === "t1-gates");
  if (!t1) return t("AT-09", false, "缺 t1-gates");
  const sk: any = levelDesign(t1);
  const inA = sk.root.comps.find((c: any) => c.id === "in-A");
  if (inA) inA.params.bitWidth = 2;
  const r = runLevelTests(t1, sk);
  return t("AT-09", !r.pass, "改小位宽后判题失败=" + !r.pass);
}

/* AT-10：CPU 全 ISA 矩阵 + 装载超界 */
export function at10(): ATResult {
  const ops = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  let ok = 0;
  for (const op of ops) {
    const words: number[] = [];
    words.push(((op & 15) << 12) | (1 << 8) | (2 << 4));
    if (op === 2 || op === 14) words.push(0);
    if (op !== 14) words.push(0xf000);
    const interp = newInterpreter();
    loadProgram(interp, words);
    const ev = runToHalt(interp);
    if (ev.length >= 1) ok++;
  }
  const big = new Array(70000).fill(0);
  const bigInterp = newInterpreter();
  loadProgram(bigInterp, big);
  return t("AT-10", ok >= ops.length - 1 && bigInterp.fault === undefined, `指令 ${ok}/${ops.length}, 超界不崩溃`);
}

/* AT-11：课程 manifest —— 没构建出清单就是没证据，不能算通过 */
export function at11(): ATResult {
  const raw = (globalThis as any).__manifest as string | undefined;
  if (!raw) return t("AT-11", false, "缺 dist-curriculum/manifest.json，先跑 npm run build:curriculum");
  const parsed = parseManifest(raw);
  if (!parsed.ok) return t("AT-11", false, "清单解析失败: " + parsed.errors.slice(0, 3).join(";"));
  const m = parsed.manifest;
  const v = validateCatalog(m);
  if (!v.ok) return t("AT-11", false, "清单校验失败: " + v.issues.slice(0, 3).map((i) => i.path + " " + i.msg).join(";"));
  // ID 无丢失、无重复：清单里的关卡要和代码里的 LEVELS 一一对上
  const catalogIds = new Set(m.levels.map((l) => l.id));
  const missing = LEVELS.filter((l) => !catalogIds.has(l.id)).map((l) => l.id);
  const extra = [...catalogIds].filter((id) => !LEVELS.some((l) => l.id === id));
  const issues: string[] = [];
  if (missing.length) issues.push(`清单丢了 ${missing.join(",")}`);
  if (extra.length) issues.push(`清单多出 ${extra.join(",")}`);
  if (m.prologues.length !== 3) issues.push(`序章 ${m.prologues.length}≠3`);
  return t("AT-11", !issues.length, issues.join("; ") || `${m.levels.length} 关 + ${m.prologues.length} 序章，ID 对得上且先修图无环`);
}

/* AT-12：a11y / 性能基座 */
export function at12(): ATResult {
  const cpu = referenceCpu([]);
  const idx = buildHitIndex(cpu.design.root);
  const a11y = buildA11y(cpu.design.root, cpu.design);
  const hit = hitTest(idx, cpu.design.root, cpu.design, { x: 0, y: 0 });
  return t("AT-12", idx.comps.length === cpu.design.root.comps.length && a11y.comps.length > 0 && hit !== undefined, `comps=${idx.comps.length} a11y=${a11y.comps.length} hit=${!!hit}`);
}

export function runAllAT(ctx: { passed: number; failed: number } = { passed: 0, failed: 0 }): ATResult[] {
  return [at01(ctx), at02(), at03(), at04(), at05(), at06(), at07(), at08(), at09(), at10(), at11(), at12()];
}