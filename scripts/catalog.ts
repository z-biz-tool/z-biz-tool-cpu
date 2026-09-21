import { BUILTIN_DEFS } from "../src/core/registry.ts";
for (const d of BUILTIN_DEFS) {
  const pins = d.pins.map(p => `${p.kind === "in" ? "<" : ">"}${p.id}${p.width === "auto" ? "*" : p.width === 1 ? "" : ":" + p.width}${p.clock ? "!" : ""}`).join(" ");
  const params = (d.params ?? []).map(p => `${p.key}=${p.default ?? "-"}`).join(" ");
  console.log(`${d.type} [${d.category}] ${d.label} cost=${d.cost} size=${d.size.w}x${d.size.h} wmode=${d.widthMode ?? "-"} onRise=${d.onRise ? "Y" : ""}\n    pins: ${pins}\n    params: ${params}`);
}
