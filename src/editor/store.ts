import { create } from "zustand";
import { Simulator } from "../core/sim.ts";
import { CircuitBuilder } from "../core/build.ts";
import { customCost, defOf, pinProblem, totalCost } from "../core/custom.ts";
import { baseDef, defaultParams } from "../core/registry.ts";
import { cloneDesign, emptyDesign, loadSlot, parse, saveSlot, serialize } from "../core/serialize.ts";
import type { Circuit, CompInstance, CustomDef, Design, PinRef, Point, Rot, Wire } from "../core/types.ts";
import { GRID, uid } from "../core/types.ts";
import { levelById, levelDesign } from "../challenges/levels.ts";
import { runLevelTests } from "../challenges/verify.ts";
import type { LevelResult } from "../challenges/verify.ts";
import { applyResult, loadProgress, saveProgress } from "../challenges/progress.ts";
import type { Badge, Progress } from "../challenges/progress.ts";
import { assemble } from "../asm/assembler.ts";
import type { AsmResult, ListingLine } from "../asm/assembler.ts";
import { assemblesSample } from "../asm/samples.ts";
import type { WorkshopState } from "../workshop/index.ts";
import { addOrUpdate, findComponent, loadWorkshopLocal, removeVersion, saveWorkshopLocal } from "../workshop/index.ts";

/* ------------------------------------------------------------------ *
 * 编辑器状态中枢：设计数据 + 仿真器 + 视图 + 关卡 + 汇编
 * ------------------------------------------------------------------ */

export type Tool = "select" | "wire";

export interface Selection {
  comps: string[];
  wires: string[];
}

export interface Hover {
  kind: "comp" | "pin" | "wire" | "empty";
  comp?: string;
  pin?: string;
  wire?: string;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const MAX_HISTORY = 60;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

interface Snapshot {
  design: Design;
  label: string;
}

export type PanelKey = "inspector" | "level" | "asm" | "cpu" | "probe" | "log" | "help" | "workshop";

export interface EditorState {
  design: Design;
  /** "root" 或子电路 def id */
  view: string;
  sim: Simulator;
  /** 设计内容版本（每次 design 引用变更 +1，给列表/列表订阅者用） */
  tick: number;
  /** FIX-10: 仿真器重建版本（只有拓扑/参数改动才递增；纯布局不递增） */
  simRev: number;
  camera: Camera;
  /** 画布像素尺寸，fitView 需要 */
  viewport: { w: number; h: number };
  tool: Tool;
  placing: { type: string; rot: Rot } | null;
  pendingWire: PinRef | null;
  hover: Hover;
  selection: Selection;
  running: boolean;
  speed: number;
  clipboard: { comps: CompInstance[]; wires: Wire[] } | null;
  undo: Snapshot[];
  redo: Snapshot[];
  /** 拖拽事务：开始时打一次快照 */
  transactionOpen: boolean;
  levelId: string | null;
  mode: "level" | "sandbox";
  result: LevelResult | null;
  progress: Progress;
  /** 最近一次判题新拿到的成就 */
  earned: Badge[];
  panel: PanelKey;
  asmSource: string;
  asmTarget: string;
  asmErrors: string[];
  asmWords: number[];
  asmListing: ListingLine[];
  /** IMP-13：作品工坊（本地持久化） */
  workshop: WorkshopState;

  circuit(): Circuit;
  isRoot(): boolean;
  compById(id: string): CompInstance | undefined;
  /** 屏幕像素 → 网格坐标 */
  toGrid(px: number, py: number): Point;

  setPanel(p: PanelKey): void;
  setCamera(c: Partial<Camera>): void;
  setViewport(w: number, h: number): void;
  zoomBy(factor: number, anchor?: Point): void;
  fitView(): void;

  pushHistory(label: string): void;
  undoAction(): void;
  redoAction(): void;
  beginTransaction(label: string): void;
  endTransaction(): void;

  setTool(t: Tool): void;
  setPlacing(type: string | null, rot?: Rot): void;
  rotatePlacing(): void;
  setHover(h: Hover): void;

  placeComp(type: string, x: number, y: number): void;
  moveSelection(dx: number, dy: number): void;
  nudgeSelection(dx: number, dy: number): void;
  deleteSelection(): void;
  rotateSelection(): void;
  flipSelection(): void;
  setParam(compId: string, key: string, value: number | string | boolean): void;
  setCompName(compId: string, name: string): void;
  setSelection(sel: Partial<Selection>): void;
  toggleSelect(kind: "comp" | "wire", id: string, additive: boolean): void;
  selectAll(): void;
  clearSelection(): void;

  startWire(from: PinRef): void;
  finishWire(to: PinRef): void;
  cancelWire(): void;
  /** 连线：引脚对不上号或重复连接会被拒绝，返回是否成功 */
  addWire(a: PinRef, b: PinRef, via?: Point[]): boolean;
  deleteWire(id: string): void;
  addViaOnWire(id: string, at: Point): void;

  copy(): void;
  paste(): void;
  duplicate(): void;

  rebuildSim(keepState?: boolean): void;
  play(): void;
  pause(): void;
  toggleRun(): void;
  stepOnce(): void;
  stepN(n: number): void;
  resetSim(): void;
  setSpeed(hz: number): void;
  toggleInput(compId: string): void;
  pressButton(compId: string, down: boolean): void;

  newDef(name: string): string;
  groupSelection(name: string): string | undefined;
  enterView(view: string): void;
  deleteDef(id: string): void;
  renameDef(id: string, name: string): void;

  saveTo(key: string): boolean;
  loadFrom(key: string): boolean;
  /** 直接载入一台现成设计（如参考 CPU） */
  loadDesign(design: Design): void;
  newDesign(): void;
  /** 导入设计；返回给用户的报告（错误 + 导入时修掉的问题），空数组表示原样可用 */
  importText(text: string): string[];
  exportText(): string;

  startLevel(id: string): void;
  openSandbox(): void;
  checkLevel(): LevelResult | null;

  setAsm(source: string): void;
  setAsmTarget(compId: string): void;
  assembleNow(): AsmResult;
  loadProgramToTarget(): boolean;
  useSample(name: string): void;

  /** IMP-13: 把子电路登记进作品工坊并落盘；返回是否产生了新版本 */
  publishToWorkshop(def: CustomDef, source?: "user" | "course" | "imported"): boolean;
  /** 覆盖工坊状态（导入备份用），自动写本地存储 */
  replaceWorkshop(next: WorkshopState): void;
  /** 删除某个组件版本；同 id 若还有更早版本则把它恢复为「当前」 */
  removeWorkshopVersion(id: string, version: number): void;
  /** 把工坊组件放到画布中心；当前设计缺少该子电路时先登记 */
  useWorkshopComponent(id: string, version?: number): boolean;
}

function currentCircuit(design: Design, view: string): Circuit {
  if (view === "root") return design.root;
  return design.defs.find((d) => d.id === view)?.circuit ?? design.root;
}

function findComp(design: Design, view: string, id: string): CompInstance | undefined {
  return currentCircuit(design, view).comps.find((c) => c.id === id);
}

function defaultParamsOf(type: string): Record<string, number | string | boolean> {
  const def = baseDef(type);
  return def ? defaultParams(def) : {};
}

const pinKey = (ref: PinRef) => ref.comp + "." + ref.pin;

export const useEditor = create<EditorState>((set, get) => {
  const initialDesign = loadSlot("autosave") ?? emptyDesign("自由搭建");
  const initialProgress = loadProgress();
  const initialWorkshop = loadWorkshopLocal();
  let sim = new Simulator(initialDesign, currentCircuit(initialDesign, "root"));

  /** 结构变更后统一入口：换新 design 引用 → 重建仿真器 → 自动存档 */
  const after = (label?: string, keepState = true) => {
    const st = get();
    const prev = keepState ? st.sim.dumpState() : undefined;
    const design: Design = { ...st.design };
    sim = new Simulator(design, currentCircuit(design, st.view));
    if (prev) sim.restoreState(prev);
    set({ design, sim, tick: st.tick + 1, simRev: st.simRev + 1, result: null });
    if (label) saveSlot("autosave", design);
  };

  const mutate = (fn: (c: Circuit) => void, label = "修改") => {
    const st = get();
    fn(currentCircuit(st.design, st.view));
    after(label);
  };

  /** FIX-10: 纯布局变更 — 更新 design 引用但不重建仿真器；切关 / 自动保存仍照常 */
  const mutateLayout = (fn: (c: Circuit) => void, label = "布局") => {
    const st = get();
    fn(currentCircuit(st.design, st.view));
    set({ design: { ...st.design }, tick: st.tick + 1, result: null });
    if (label) saveSlot("autosave", st.design);
  };

  /** 整体替换设计（撤销/重做/载入/进关卡） */
  const replace = (design: Design, view: string) => {
    const st = get();
    const v = view === "root" || design.defs.some((d) => d.id === view) ? view : "root";
    sim = new Simulator(design, currentCircuit(design, v));
    set({ design, view: v, sim, tick: st.tick + 1, simRev: st.simRev + 1, result: null });
    saveSlot("autosave", design);
  };

  return {
    design: initialDesign,
    view: "root",
    sim,
    tick: 0,
    simRev: 0,
    camera: { x: 6, y: 6, zoom: 1 },
    viewport: { w: 1200, h: 800 },
    tool: "select",
    placing: null,
    pendingWire: null,
    hover: { kind: "empty" },
    selection: { comps: [], wires: [] },
    running: false,
    speed: initialProgress.speed,
    clipboard: null,
    undo: [],
    redo: [],
    transactionOpen: false,
    levelId: null,
    mode: "sandbox",
    result: null,
    progress: initialProgress,
    earned: [],
    panel: "level",
    asmSource: assemblesSample("count"),
    asmTarget: "",
    asmErrors: [],
    asmWords: [],
    asmListing: [],
    workshop: initialWorkshop,

    circuit() {
      const st = get();
      return currentCircuit(st.design, st.view);
    },
    isRoot() {
      return get().view === "root";
    },
    compById(id) {
      const st = get();
      return findComp(st.design, st.view, id);
    },
    toGrid(px, py) {
      const { camera } = get();
      return {
        x: px / (GRID * camera.zoom) + camera.x,
        y: py / (GRID * camera.zoom) + camera.y,
      };
    },

    setPanel(p) {
      set({ panel: p });
    },
    setCamera(c) {
      set((s) => ({ camera: { ...s.camera, ...c } }));
    },
    setViewport(w, h) {
      const cur = get().viewport;
      if (cur.w === w && cur.h === h) return;
      set({ viewport: { w, h } });
    },
    zoomBy(factor, anchor) {
      set((s) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.camera.zoom * factor));
        if (zoom === s.camera.zoom) return {};
        if (!anchor) return { camera: { ...s.camera, zoom } };
        // 缩放后让锚点仍停在原屏幕位置
        const k = s.camera.zoom / zoom;
        return {
          camera: {
            zoom,
            x: anchor.x - (anchor.x - s.camera.x) * k,
            y: anchor.y - (anchor.y - s.camera.y) * k,
          },
        };
      });
    },
    fitView() {
      const st = get();
      const circuit = currentCircuit(st.design, st.view);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of circuit.comps) {
        const def = defOf(st.design, c.type, c.params);
        if (!def) continue;
        const rotated = c.rot % 2 === 1;
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x + (rotated ? def.size.h : def.size.w));
        maxY = Math.max(maxY, c.y + (rotated ? def.size.w : def.size.h));
      }
      if (!Number.isFinite(minX)) {
        set({ camera: { x: 6, y: 6, zoom: 1 } });
        return;
      }
      const pad = 3;
      const zoom = Math.min(
        MAX_ZOOM,
        Math.max(
          MIN_ZOOM,
          Math.min(
            st.viewport.w / ((maxX - minX + pad * 2) * GRID),
            st.viewport.h / ((maxY - minY + pad * 2) * GRID)
          )
        )
      );
      set({ camera: { x: minX - pad, y: minY - pad, zoom } });
    },

    pushHistory(label) {
      const st = get();
      const snap: Snapshot = { design: cloneDesign(st.design), label };
      set({ undo: [...st.undo.slice(-MAX_HISTORY + 1), snap], redo: [] });
    },
    undoAction() {
      const st = get();
      const last = st.undo[st.undo.length - 1];
      if (!last) return;
      const current: Snapshot = { design: cloneDesign(st.design), label: "重做" };
      set({ undo: st.undo.slice(0, -1), redo: [...st.redo, current], selection: { comps: [], wires: [] } });
      replace(last.design, st.view);
    },
    redoAction() {
      const st = get();
      const last = st.redo[st.redo.length - 1];
      if (!last) return;
      const current: Snapshot = { design: cloneDesign(st.design), label: "撤销" };
      set({ redo: st.redo.slice(0, -1), undo: [...st.undo, current], selection: { comps: [], wires: [] } });
      replace(last.design, st.view);
    },
    beginTransaction(label) {
      if (get().transactionOpen) return;
      set({ transactionOpen: true });
      get().pushHistory(label);
    },
    endTransaction() {
      if (!get().transactionOpen) return;
      set({ transactionOpen: false });
      after("拖拽");
    },

    setTool(t) {
      set({ tool: t, placing: null, pendingWire: null });
    },
    setPlacing(type, rot = 0) {
      set({ placing: type ? { type, rot } : null, tool: "select", pendingWire: null });
    },
    rotatePlacing() {
      set((s) => (s.placing ? { placing: { ...s.placing, rot: ((s.placing.rot + 1) % 4) as Rot } } : {}));
    },
    setHover(h) {
      const cur = get().hover;
      if (cur.kind === h.kind && cur.comp === h.comp && cur.pin === h.pin && cur.wire === h.wire) return;
      set({ hover: h });
    },

    placeComp(type, x, y) {
      const st = get();
      st.pushHistory("放置元件");
      const id = uid("c");
      mutate((c) => {
        c.comps.push({ id, type, x: Math.round(x), y: Math.round(y), rot: 0, params: defaultParamsOf(type) });
      }, "放置元件");
      set({ selection: { comps: [id], wires: [] }, placing: null });
    },

    moveSelection(dx, dy) {
      const st = get();
      const comps = new Set(st.selection.comps);
      if (!comps.size || (!dx && !dy)) return;
      // FIX-10: 移动/对齐不重建仿真器（拓扑未变）
      mutateLayout((c) => {
        for (const inst of c.comps) {
          if (!comps.has(inst.id)) continue;
          inst.x += dx;
          inst.y += dy;
        }
      }, "移动");
    },
    nudgeSelection(dx, dy) {
      const st = get();
      if (!st.selection.comps.length) return;
      st.pushHistory("移动");
      st.moveSelection(dx, dy);
    },

    deleteSelection() {
      const st = get();
      const comps = new Set(st.selection.comps);
      const wires = new Set(st.selection.wires);
      if (!comps.size && !wires.size) return;
      st.pushHistory("删除");
      mutate((c) => {
        c.comps = c.comps.filter((inst) => !comps.has(inst.id));
        c.wires = c.wires.filter((w) => !wires.has(w.id) && !comps.has(w.a.comp) && !comps.has(w.b.comp));
      }, "删除");
      set({ selection: { comps: [], wires: [] } });
    },

    rotateSelection() {
      const st = get();
      const ids = new Set(st.selection.comps);
      if (!ids.size) {
        st.rotatePlacing();
        return;
      }
      st.pushHistory("旋转");
      // FIX-10: 旋转不改拓扑
      mutateLayout((c) => {
        for (const inst of c.comps) if (ids.has(inst.id)) inst.rot = ((inst.rot + 1) % 4) as Rot;
      }, "旋转");
    },
    flipSelection() {
      const st = get();
      const ids = new Set(st.selection.comps);
      if (!ids.size) return;
      st.pushHistory("镜像");
      // FIX-10: 镜像不改拓扑
      mutateLayout((c) => {
        for (const inst of c.comps) if (ids.has(inst.id)) inst.flip = !inst.flip;
      }, "镜像");
    },

    setParam(compId, key, value) {
      const st = get();
      const inst = findComp(st.design, st.view, compId);
      if (!inst) return;
      const spec = defOf(st.design, inst.type, inst.params)?.params?.find((p) => p.key === key);
      if (spec?.structural) st.pushHistory("改参数");
      mutate((c) => {
        const target = c.comps.find((x) => x.id === compId);
        if (target) target.params = { ...target.params, [key]: value };
      }, "改参数");
    },
    setCompName(compId, name) {
      const st = get();
      st.pushHistory("命名");
      // FIX-10: 命名/标签属于布局变更，不重建仿真器
      mutateLayout((c) => {
        const target = c.comps.find((x) => x.id === compId);
        if (target) target.name = name || undefined;
      }, "命名");
    },

    setSelection(sel) {
      set((s) => ({
        selection: { comps: sel.comps ?? s.selection.comps, wires: sel.wires ?? s.selection.wires },
      }));
    },
    toggleSelect(kind, id, additive) {
      set((s) => {
        if (!additive) {
          return { selection: kind === "comp" ? { comps: [id], wires: [] } : { comps: [], wires: [id] } };
        }
        const comps = new Set(s.selection.comps);
        const wires = new Set(s.selection.wires);
        const list = kind === "comp" ? comps : wires;
        if (list.has(id)) list.delete(id);
        else list.add(id);
        return { selection: { comps: [...comps], wires: [...wires] } };
      });
    },
    selectAll() {
      const c = get().circuit();
      set({ selection: { comps: c.comps.map((x) => x.id), wires: c.wires.map((w) => w.id) } });
    },
    clearSelection() {
      set({ selection: { comps: [], wires: [] }, pendingWire: null });
    },

    startWire(from) {
      const st = get();
      if (st.pendingWire) {
        st.finishWire(from);
        return;
      }
      set({ pendingWire: from, placing: null });
    },
    finishWire(to) {
      const st = get();
      const from = st.pendingWire;
      if (!from) return;
      set({ pendingWire: null });
      if (from.comp === to.comp && from.pin === to.pin) return;
      get().addWire(from, to);
    },
    cancelWire() {
      set({ pendingWire: null });
    },
    addWire(a, b, via) {
      const st = get();
      const circuit = st.circuit();
      const bad = pinProblem(st.design, circuit, a) ?? pinProblem(st.design, circuit, b);
      if (bad) {
        st.sim.log("@wire", `拒绝连线：${bad}`, "warn");
        return false;
      }
      const dup = circuit.wires.some(
        (w) =>
          (w.a.comp === a.comp && w.a.pin === a.pin && w.b.comp === b.comp && w.b.pin === b.pin) ||
          (w.b.comp === a.comp && w.b.pin === a.pin && w.a.comp === b.comp && w.a.pin === b.pin)
      );
      if (dup) return false;
      st.pushHistory("连线");
      mutate((c) => {
        c.wires.push({ id: uid("w"), a, b, via });
      }, "连线");
      return true;
    },
    deleteWire(id) {
      const st = get();
      st.pushHistory("删除导线");
      mutate((c) => {
        c.wires = c.wires.filter((w) => w.id !== id);
      }, "删除导线");
      set((s) => ({ selection: { comps: s.selection.comps, wires: s.selection.wires.filter((x) => x !== id) } }));
    },
    addViaOnWire(id, at) {
      const st = get();
      st.pushHistory("调整走线");
      mutate((c) => {
        const w = c.wires.find((x) => x.id === id);
        if (w) w.via = [...(w.via ?? []), { x: Math.round(at.x), y: Math.round(at.y) }];
      }, "调整走线");
    },

    copy() {
      const st = get();
      const comps = new Set(st.selection.comps);
      if (!comps.size) return;
      const circuit = st.circuit();
      const picked = circuit.comps.filter((c) => comps.has(c.id));
      const inner = circuit.wires.filter((w) => comps.has(w.a.comp) && comps.has(w.b.comp));
      set({
        clipboard: {
          comps: JSON.parse(JSON.stringify(picked)) as CompInstance[],
          wires: JSON.parse(JSON.stringify(inner)) as Wire[],
        },
      });
    },
    paste() {
      const st = get();
      if (!st.clipboard?.comps.length) return;
      st.pushHistory("粘贴");
      const idMap = new Map<string, string>();
      const comps = st.clipboard.comps.map((c) => {
        const id = uid("c");
        idMap.set(c.id, id);
        return {
          ...c,
          id,
          x: c.x + 2,
          y: c.y + 2,
          params: { ...c.params },
          name: c.name ? c.name + "#" : undefined,
        };
      });
      const wires = st.clipboard.wires
        .filter((w) => idMap.has(w.a.comp) && idMap.has(w.b.comp))
        .map((w) => ({
          id: uid("w"),
          a: { comp: idMap.get(w.a.comp)!, pin: w.a.pin },
          b: { comp: idMap.get(w.b.comp)!, pin: w.b.pin },
          via: w.via?.map((p) => ({ x: p.x + 2, y: p.y + 2 })),
        }));
      mutate((c) => {
        c.comps.push(...comps);
        c.wires.push(...wires);
      }, "粘贴");
      set({ selection: { comps: comps.map((c) => c.id), wires: wires.map((w) => w.id) } });
    },
    duplicate() {
      get().copy();
      get().paste();
    },

    rebuildSim(keepState = true) {
      after("重建", keepState);
    },
    play() {
      set({ running: true });
    },
    pause() {
      set({ running: false });
    },
    toggleRun() {
      set((s) => ({ running: !s.running }));
    },
    stepOnce() {
      const st = get();
      st.sim.step();
      set({ tick: st.tick + 1, running: false });
    },
    stepN(n) {
      const st = get();
      st.sim.run(n);
      set({ tick: st.tick + 1 });
    },
    resetSim() {
      const st = get();
      st.sim.reset();
      set({ tick: st.tick + 1, running: false });
    },
    setSpeed(hz) {
      const speed = Math.min(240, Math.max(1, Math.round(hz)));
      const progress = { ...get().progress, speed };
      saveProgress(progress);
      set({ speed, progress });
    },
    toggleInput(compId) {
      const st = get();
      const inst = findComp(st.design, st.view, compId);
      if (!inst || inst.type !== "input") return;
      const cur = st.sim.valueOf({ comp: compId, pin: "out" });
      const bits = cur?.width ?? Math.max(1, Number(inst.params.bitWidth) || 1);
      const next = (~(cur?.value ?? 0) & (bits >= 32 ? 0xffffffff : (1 << bits) - 1)) >>> 0;
      st.sim.setInput(compId, next);
      mutate((c) => {
        const t = c.comps.find((x) => x.id === compId);
        if (t) t.params = { ...t.params, init: next };
      }, "切换输入");
    },
    pressButton(compId, down) {
      const st = get();
      st.sim.setInput(compId, down ? 1 : 0);
      set({ tick: st.tick + 1 });
    },

    newDef(name) {
      const st = get();
      const id = uid("d");
      st.pushHistory("新建子电路");
      set({
        design: {
          ...st.design,
          defs: [...st.design.defs, { id, name: name || "新子电路", circuit: { comps: [], wires: [] } }],
        },
      });
      after("新建子电路", false);
      return id;
    },

    /**
     * 把选中的元件封装成子电路：内部连线封进 def，跨界导线升格为对外引脚，
     * 原位置留下一枚 `custom:<defId>` 元件。
     */
    groupSelection(name) {
      const st = get();
      const ids = new Set(st.selection.comps);
      const circuit = st.circuit();
      const inside = circuit.comps.filter((c) => ids.has(c.id));
      if (!inside.length) return undefined;
      const external = circuit.wires.filter((w) => ids.has(w.a.comp) !== ids.has(w.b.comp));
      if (!external.length) return undefined;
      // 悬空引脚会让 CircuitBuilder 直接抛错，这里先挡下来并给日志
      const broken = circuit.wires
        .filter((w) => ids.has(w.a.comp) || ids.has(w.b.comp))
        .map((w) => pinProblem(st.design, circuit, w.a) ?? pinProblem(st.design, circuit, w.b))
        .find((m): m is string => !!m);
      if (broken) {
        st.sim.log("@group", `打包中止：${broken}`, "error");
        return undefined;
      }

      const defId = uid("d");
      const b = new CircuitBuilder();
      const minX = Math.min(...inside.map((c) => c.x));
      const minY = Math.min(...inside.map((c) => c.y));
      const innerW = Math.max(
        ...inside.map((c) => c.x + (defOf(st.design, c.type, c.params)?.size.w ?? 2) - minX)
      );
      const idMap = new Map<string, string>();
      for (const c of inside) {
        idMap.set(
          c.id,
          b.add(c.type, c.x - minX + 5, c.y - minY + 4, { ...c.params }, { rot: c.rot, flip: c.flip, name: c.name })
        );
      }
      for (const w of circuit.wires) {
        if (!ids.has(w.a.comp) || !ids.has(w.b.comp)) continue;
        b.connect(idMap.get(w.a.comp)!, w.a.pin, idMap.get(w.b.comp)!, w.b.pin);
      }

      /** 内部引脚 → def 内的边界元件 id，也就是 custom 元件对外的引脚名 */
      const boundary = new Map<string, string>();
      let nIn = 0;
      let nOut = 0;
      for (const w of external) {
        const innerRef = ids.has(w.a.comp) ? w.a : w.b;
        const key = pinKey(innerRef);
        if (boundary.has(key)) continue;
        const inst = findComp(st.design, st.view, innerRef.comp);
        const spec = inst ? defOf(st.design, inst.type, inst.params)?.pins.find((p) => p.id === innerRef.pin) : undefined;
        const ioType: "input" | "output" = spec?.kind === "out" ? "output" : "input";
        const bits = spec && spec.width !== "auto" ? spec.width : st.sim.valueOf(innerRef)?.width ?? 1;
        // 选区里已经是边界元件时直接复用，不再套一层
        const reusable =
          (ioType === "output" && inst?.type === "output" && innerRef.pin === "in") ||
          (ioType === "input" && inst?.type === "input" && innerRef.pin === "out");
        if (reusable) {
          boundary.set(key, idMap.get(innerRef.comp)!);
          if (ioType === "input") nIn++;
          else nOut++;
          continue;
        }
        const ioId = b.add(
          ioType,
          ioType === "input" ? 0 : innerW + 10,
          4 + (ioType === "input" ? nIn++ : nOut++) * 3,
          { bitWidth: bits },
          { name: inst?.name || innerRef.pin }
        );
        b.connect(ioId, ioType === "input" ? "out" : "in", idMap.get(innerRef.comp)!, innerRef.pin);
        boundary.set(key, ioId);
      }

      const def: CustomDef = { id: defId, name: name || "子电路", circuit: b.build() };
      const design: Design = { ...st.design, defs: [...st.design.defs, def] };
      const newId = uid("c");
      const remap = (ref: PinRef): PinRef => {
        if (!ids.has(ref.comp)) return ref;
        const pin = boundary.get(pinKey(ref));
        return pin ? { comp: newId, pin } : ref;
      };

      st.pushHistory("打包子电路");
      const target = currentCircuit(design, st.view);
      const kept: Wire[] = [];
      for (const w of target.wires) {
        const aIn = ids.has(w.a.comp);
        const bIn = ids.has(w.b.comp);
        if (aIn && bIn) continue;
        if (!aIn && !bIn) {
          kept.push(w);
          continue;
        }
        const next: Wire = { ...w, a: remap(w.a), b: remap(w.b) };
        if (next.a.comp === newId || next.b.comp === newId) next.via = undefined;
        kept.push(next);
      }
      target.comps = target.comps
        .filter((x) => !ids.has(x.id))
        .concat({ id: newId, type: "custom:" + defId, x: minX, y: minY, rot: 0, params: {}, name: def.name });
      target.wires = kept;
      set({ design });
      after("打包子电路", false);
      // IMP-13: 封装即入工坊（内容变化会自动升版本）
      get().publishToWorkshop(def);
      set({ selection: { comps: [newId], wires: [] } });
      return defId;
    },
    enterView(view) {
      set({ view, selection: { comps: [], wires: [] }, pendingWire: null, hover: { kind: "empty" } });
      after("切换视图", false);
      get().fitView();
    },
    deleteDef(id) {
      const st = get();
      const type = "custom:" + id;
      const drop = (c: Circuit): Circuit => {
        const dead = new Set(c.comps.filter((x) => x.type === type).map((x) => x.id));
        return {
          comps: c.comps.filter((x) => !dead.has(x.id)),
          wires: c.wires.filter((w) => !dead.has(w.a.comp) && !dead.has(w.b.comp)),
          view: c.view,
        };
      };
      st.pushHistory("删除子电路");
      replace(
        {
          ...st.design,
          root: drop(st.design.root),
          defs: st.design.defs.filter((d) => d.id !== id).map((d) => ({ ...d, circuit: drop(d.circuit) })),
        },
        st.view === id ? "root" : st.view
      );
    },
    renameDef(id, name) {
      const st = get();
      st.pushHistory("重命名子电路");
      set({ design: { ...st.design, defs: st.design.defs.map((d) => (d.id === id ? { ...d, name } : d)) } });
      after("重命名子电路");
    },

    saveTo(key) {
      return saveSlot(key || "slot", get().design);
    },
    loadFrom(key) {
      const design = loadSlot(key);
      if (!design) return false;
      set({ levelId: null, mode: "sandbox", selection: { comps: [], wires: [] } });
      replace(design, "root");
      return true;
    },
    newDesign() {
      set({ levelId: null, mode: "sandbox", selection: { comps: [], wires: [] }, undo: [], redo: [] });
      replace(emptyDesign("自由搭建"), "root");
    },
    loadDesign(design) {
      set({ levelId: null, mode: "sandbox", selection: { comps: [], wires: [] }, panel: "cpu" });
      replace(design, "root");
      get().fitView();
    },
    importText(text) {
      const res = parse(text);
      if (!res.design) return res.errors.length ? res.errors : ["文件无法解析"];
      set({ levelId: null, mode: "sandbox", selection: { comps: [], wires: [] } });
      replace(res.design, "root");
      // doc 05 §3.3：导入修掉的引用问题要报给导入者，不能静默丢弃后当作正常工程
      return res.errors.concat(res.warnings);
    },
    exportText() {
      return serialize(get().design);
    },

    startLevel(id) {
      const level = levelById(id);
      if (!level) return;
      set({
        levelId: id,
        mode: "level",
        panel: "level",
        running: false,
        earned: [],
        selection: { comps: [], wires: [] },
        undo: [],
        redo: [],
      });
      replace(levelDesign(level), "root");
      const progress = { ...get().progress, active: id };
      saveProgress(progress);
      set({ progress });
    },
    openSandbox() {
      set({
        levelId: null,
        mode: "sandbox",
        panel: "inspector",
        selection: { comps: [], wires: [] },
        undo: [],
        redo: [],
      });
      replace(loadSlot("sandbox") ?? emptyDesign("自由搭建"), "root");
    },
    checkLevel() {
      const st = get();
      const level = levelById(st.levelId ?? "");
      if (!level) return null;
      const result = runLevelTests(level, st.design);
      const applied = applyResult(st.progress, level, result);
      saveProgress(applied.progress);
      set({ result, progress: applied.progress, earned: applied.earned });
      return result;
    },

    setAsm(source) {
      set({ asmSource: source });
    },
    setAsmTarget(compId) {
      set({ asmTarget: compId });
    },
    assembleNow() {
      const st = get();
      const res = assemble(st.asmSource, { base: 0 });
      set({ asmErrors: res.errors, asmWords: res.words, asmListing: res.listing });
      return res;
    },
    /** 把汇编结果写进目标存储元件的 data 参数 */
    loadProgramToTarget() {
      const st = get();
      const target = findComp(st.design, st.view, st.asmTarget);
      if (!target) return false;
      const res = st.assembleNow();
      if (res.errors.length) return false;
      const depth = 2 ** (Number(target.params.addrBits) || 8);
      const words = new Array<number>(depth).fill(0);
      res.words.forEach((w, i) => {
        const addr = res.base + i;
        if (addr >= 0 && addr < depth) words[addr] = w;
      });
      const data = words.map((w) => "0x" + w.toString(16)).join(",");
      st.pushHistory("加载程序");
      mutate((c) => {
        const t = c.comps.find((x) => x.id === st.asmTarget);
        if (t) t.params = { ...t.params, data };
      }, "加载程序");
      return true;
    },
    useSample(name) {
      set({ asmSource: assemblesSample(name) });
      get().assembleNow();
    },

    publishToWorkshop(def, source = "user") {
      const cur = get().workshop;
      // addOrUpdate 会就地写 prev.supersededBy，这里先浅拷贝避免污染旧 state
      const draft: WorkshopState = { components: cur.components.map((c) => ({ ...c })) };
      const before = new Set(cur.components.map((c) => `${c.id}#${c.version}`));
      const manifest = addOrUpdate(draft, def, source);
      saveWorkshopLocal(draft);
      set({ workshop: draft });
      return !before.has(`${manifest.id}#${manifest.version}`);
    },
    replaceWorkshop(next) {
      saveWorkshopLocal(next);
      set({ workshop: next });
    },
    removeWorkshopVersion(id, version) {
      const draft = removeVersion(get().workshop, id, version);
      if (!draft) return;
      saveWorkshopLocal(draft);
      set({ workshop: draft });
    },
    useWorkshopComponent(id, version) {
      const st = get();
      const manifest = findComponent(st.workshop, id, version);
      if (!manifest) return false;
      if (st.view === manifest.id) return false; // 不能把自己放进自己的子电路里
      if (!st.design.defs.some((d) => d.id === manifest.id)) {
        // 当前设计里没有这枚子电路：先从工坊登记一份（深拷贝，避免共享引用）
        const def = JSON.parse(JSON.stringify(manifest.def)) as CustomDef;
        set({ design: { ...st.design, defs: [...st.design.defs, def] } });
        after("引入组件", false);
      }
      const { camera, viewport } = get();
      const cx = viewport.w / (2 * GRID * camera.zoom) + camera.x;
      const cy = viewport.h / (2 * GRID * camera.zoom) + camera.y;
      get().placeComp("custom:" + manifest.id, cx, cy);
      return true;
    },
  };
});

/* --------------------------- 供 UI 使用的辅助 --------------------------- */

export function designCost(design: Design): number {
  return totalCost(design, design.root);
}

export function defCost(design: Design, defId: string): number {
  return customCost(design, defId);
}

export type { LevelResult };
