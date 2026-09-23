import { useEffect, useRef } from "react";
import type { Point } from "../core/types.ts";
import { CanvasA11y } from "./CanvasA11y.tsx";
import { useEditor } from "./store.ts";
import type { Scene } from "./render.ts";
import { THEME, compInRect, compSize, drawScene, hitComp, hitPin, hitWire, makeXform } from "./render.ts";

/* ------------------------------------------------------------------ *
 * 画布：仿真主循环 + 交互（选择 / 拖拽 / 连线 / 平移 / 缩放 / 框选）
 * ------------------------------------------------------------------ */

type Mode =
  | { kind: "idle" }
  | { kind: "pan"; from: Point; cam: Point }
  | { kind: "drag"; from: Point }
  | { kind: "marquee"; from: Point; add: boolean };

function sceneOf(st: ReturnType<typeof useEditor.getState>, cursor: Point | null): Scene {
  return {
    design: st.design,
    circuit: st.circuit(),
    camera: st.camera,
    viewport: st.viewport,
    sim: st.sim,
    selection: st.selection,
    hover: st.hover,
    pendingWire: st.pendingWire,
    cursor,
    placing: st.placing,
    tool: st.tool,
  };
}

export default function Canvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<Point | null>(null);
  const mode = useRef<Mode>({ kind: "idle" });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    let raf = 0;
    let acc = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const st = useEditor.getState();
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        st.setViewport(w, h);
      }
      if (st.running) {
        acc += dt * st.speed;
        const steps = Math.floor(acc);
        if (steps > 0) {
          acc -= steps;
          st.sim.run(Math.min(steps, 60));
          useEditor.setState({ tick: st.tick + 1 });
        }
      } else {
        acc = 0;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(ctx, sceneOf(st, cursor.current));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const gridAt = (e: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return useEditor.getState().toGrid(e.clientX - rect.left, e.clientY - rect.top);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const st = useEditor.getState();
    const g = gridAt(e);
    cursor.current = g;
    canvasRef.current?.setPointerCapture(e.pointerId);

    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      mode.current = { kind: "pan", from: { x: e.clientX, y: e.clientY }, cam: { x: st.camera.x, y: st.camera.y } };
      return;
    }
    if (e.button !== 0) return;

    if (st.placing) {
      const size = compSize(st.design, { id: "", type: st.placing.type, x: 0, y: 0, rot: st.placing.rot, params: {} });
      st.placeComp(st.placing.type, g.x + 0.5 - size.w / 2, g.y + 0.5 - size.h / 2);
      return;
    }
    const scene = sceneOf(st, g);
    const pin = hitPin(scene, g, e.shiftKey ? 0.7 : 0.5);
    if (pin) {
      st.startWire(pin);
      return;
    }
    const comp = hitComp(scene, g);
    if (comp) {
      if (!st.selection.comps.includes(comp.id)) st.toggleSelect("comp", comp.id, e.shiftKey || e.metaKey || e.ctrlKey);
      st.beginTransaction("移动");
      mode.current = { kind: "drag", from: g };
      return;
    }
    const wire = hitWire(scene, g);
    if (wire) {
      st.toggleSelect("wire", wire, e.shiftKey);
      return;
    }
    st.clearSelection();
    mode.current = { kind: "marquee", from: g, add: e.shiftKey };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = useEditor.getState();
    const g = gridAt(e);
    cursor.current = g;
    const m = mode.current;

    if (m.kind === "pan") {
      const s = makeXform(st.camera).s;
      st.setCamera({
        x: m.cam.x - (e.clientX - m.from.x) / s,
        y: m.cam.y - (e.clientY - m.from.y) / s,
      });
      return;
    }
    if (m.kind === "drag") {
      const dx = Math.round(g.x - m.from.x);
      const dy = Math.round(g.y - m.from.y);
      if (dx || dy) {
        mode.current = { kind: "drag", from: { x: m.from.x + dx, y: m.from.y + dy } };
        st.moveSelection(dx, dy);
      }
      return;
    }
    if (m.kind === "marquee") {
      selectRect(st, m.from, g, m.add);
      return;
    }
    const scene = sceneOf(st, g);
    const pin = hitPin(scene, g);
    if (pin) {
      st.setHover({ kind: "pin", comp: pin.comp, pin: pin.pin });
      return;
    }
    const comp = hitComp(scene, g);
    if (comp) {
      st.setHover({ kind: "comp", comp: comp.id });
      return;
    }
    const wire = hitWire(scene, g);
    st.setHover(wire ? { kind: "wire", wire } : { kind: "empty" });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const st = useEditor.getState();
    const m = mode.current;
    if (m.kind === "drag") st.endTransaction();
    if (m.kind === "marquee") selectRect(st, m.from, gridAt(e), m.add);
    mode.current = { kind: "idle" };
  };

  const onWheel = (e: React.WheelEvent) => {
    const st = useEditor.getState();
    const g = gridAt(e);
    if (e.shiftKey && !e.ctrlKey) {
      const s = makeXform(st.camera).s;
      st.setCamera({ x: st.camera.x + (e.deltaY || e.deltaX) / s });
      return;
    }
    st.zoomBy(Math.exp(-e.deltaY * 0.0015), g);
  };

  const onDoubleClick = () => {
    const st = useEditor.getState();
    if (!cursor.current) return;
    const comp = hitComp(sceneOf(st, cursor.current), cursor.current);
    if (comp?.type.startsWith("custom:")) st.enterView(comp.type.slice(7));
    else if (comp) st.setPanel("inspector");
  };

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <canvas
        ref={canvasRef}
        className="canvas"
        tabIndex={0}
        aria-label="电路画布：拖动摆放元件、拉线连接端口"
        aria-describedby="canvas-a11y-sum"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          mode.current = { kind: "idle" };
        }}
        onPointerLeave={() => {
          cursor.current = null;
          mode.current = { kind: "idle" };
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="canvas-legend">
        <span style={{ color: THEME.pinIn }}>输入脚</span>
        <span style={{ color: THEME.pinOut }}>输出脚</span>
        <span style={{ color: THEME.wireHigh }}>带电网络</span>
        <span>滚轮缩放 · 中键/右键/Alt 拖动平移 · Shift 框选 · 双击进入子电路</span>
      </div>
      <CanvasA11y />
    </div>
  );
}

function selectRect(st: ReturnType<typeof useEditor.getState>, a: Point, b: Point, add: boolean) {
  const rect = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
  const scene = sceneOf(st, null);
  const picked = scene.circuit.comps.filter((c) => compInRect(scene, c, rect)).map((c) => c.id);
  if (!picked.length && !add) {
    st.clearSelection();
    return;
  }
  st.setSelection(
    add
      ? { comps: [...new Set([...st.selection.comps, ...picked])], wires: [] }
      : { comps: picked, wires: [] }
  );
}
