import { LEVELS, solutionDesign } from "../src/challenges/levels.ts";
import { Simulator } from "../src/core/sim.ts";

const level = LEVELS.find(l => l.id === process.env.LV)!;
const design = solutionDesign(level)!;
console.log("wires:", design.root.wires.map(w => `${w.a.comp}.${w.a.pin}->${w.b.comp}.${w.b.pin}`).join("\n"));
const sim = new Simulator(design, design.root);
const inputs = (process.env.PH || "").split(";").map(s => s.trim()).filter(Boolean).map(s => {
  const [kv, steps] = s.split("|");
  const inputs: Record<string, number> = {};
  for (const p of (kv || "").split(",").filter(Boolean)) { const [k, v] = p.split("="); inputs[k] = Number(v); }
  return { inputs, steps: Number(steps || 0) };
});
for (const ph of inputs) {
  for (const [k, v] of Object.entries(ph.inputs)) {
    const c = design.root.comps.find(c => c.name === k || c.id === k || c.id === "in-" + k);
    if (!c) { console.log("!! no input", k); continue; }
    sim.setInput(c.id, v);
  }
  for (let i = 0; i < ph.steps; i++) {
    sim.step();
    console.log(" step", i+1, JSON.stringify(Object.fromEntries(sim.probes().map(p => [p.name, p.value?.value]))), "mem", sim.readMemory(design.root.comps.find(c=>c.type==="ram")!.id).slice(0,6));
  }
}
console.log("logs", sim.logs.map(l => l.comp + ":" + l.msg));
