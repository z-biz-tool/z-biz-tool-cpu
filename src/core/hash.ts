/* FNV-1a 32 位内容哈希 —— 仓内唯一实现。
 * sim.ts / courses/judging.ts / workshop/index.ts / courses/manifest.ts 曾各抄一份，
 * 常量相同、细节各异，改一处漏一处。现在统一走这里。 */

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

export class Fnv1a32 {
  private h = OFFSET >>> 0;

  /** 混入一个数值（字符码 / 网络值 / 状态值都走这里） */
  mix(value: number): this {
    this.h = Math.imul(this.h ^ value, PRIME) >>> 0;
    return this;
  }

  /** 混入一整串（逐字符码） */
  mixString(text: string): this {
    for (let i = 0; i < text.length; i++) this.mix(text.charCodeAt(i));
    return this;
  }

  digest(): number {
    return this.h >>> 0;
  }

  /** 8 位十六进制（补零），供内容哈希字段使用 */
  hex(): string {
    return this.digest().toString(16).padStart(8, "0");
  }
}

/** 整串的 FNV-1a 32 位 */
export function fnv1a32(text: string): number {
  return new Fnv1a32().mixString(text).digest();
}
