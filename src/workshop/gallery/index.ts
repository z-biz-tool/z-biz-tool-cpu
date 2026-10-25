import { ARITH } from "./arith.ts";
import { BUS } from "./bus.ts";
import { CPU } from "./cpu.ts";
import { IO } from "./io.ts";
import { LOGIC } from "./logic.ts";
import { MACHINE } from "./machine.ts";
import { MEM } from "./mem.ts";
import { SEQ } from "./seq.ts";
import type { Example } from "./spec.ts";

/** 全部案例：顺序即工坊列表的顺序（按包分组，入门在前） */
export const GALLERY: Example[] = [...LOGIC, ...ARITH, ...SEQ, ...BUS, ...MEM, ...CPU, ...IO, ...MACHINE];
