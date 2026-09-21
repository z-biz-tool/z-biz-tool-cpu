import { SAMPLES } from "../src/asm/samples.ts";
import { runProgram } from "../src/cpu/run.ts";

/* 开发用：把全部示例程序在参考 CPU 上跑一遍 */
const only = process.argv[2];
const maxSteps = Number(process.argv[3] ?? 60000);
for (const s of SAMPLES) {
  if (only && only !== "all" && s.key !== only) continue;
  const r = runProgram(s.source, { maxSteps });
  console.log(
    `${s.key.padEnd(6)} 拍数=${String(r.steps).padStart(6)} 停机=${r.done} 输出=[${r.prints.join(" ")}]` +
      (r.errors.length ? `\n  错误: ${r.errors.join(" / ")}` : "")
  );
}
