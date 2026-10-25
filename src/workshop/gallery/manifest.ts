import { hashComponent } from "../index.ts";
import type { ComponentManifest } from "../index.ts";
import { buildNetlist } from "../dsl.ts";
import { GALLERY } from "./index.ts";
import { PACKS } from "./spec.ts";
import type { Example, PackKey } from "./spec.ts";

/* ------------------------------------------------------------------ *
 * 案例库 → 工坊组件
 *
 * 每个案例在工坊里就是一枚普通组件：同样的版本不可变、同样的接口说明、
 * 同样的「放入画布」。区别只有两点：
 *  - source = "course"（课程自带，不是你封装的）
 *  - 多一段 gallery 元信息（属于哪个包、第几层、为什么值得看）
 * 这样「案例」和「你自己的封装」用同一套机制，不搞两套数据。
 * ------------------------------------------------------------------ */

let cache: ComponentManifest[] | undefined;

export function galleryManifests(): ComponentManifest[] {
  if (cache) return cache;
  const out: ComponentManifest[] = [];
  for (const ex of GALLERY) {
    const built = buildNetlist(ex.src);
    const def = { id: ex.id, name: ex.name, circuit: built.circuit };
    out.push({
      id: ex.id,
      version: 1,
      title: ex.name,
      description: ex.blurb,
      interface: built.ports.map((p) => ({
        name: p.name,
        dir: p.dir,
        width: p.width,
        description: ex.ports[p.name] ?? "",
      })),
      def,
      contentHash: hashComponent(def),
      source: "course",
      createdAt: 0,
      gallery: {
        pack: ex.pack,
        tier: ex.tier,
        why: ex.why,
        tags: ex.tags ?? [],
      },
    });
  }
  cache = out;
  return out;
}

export function galleryExample(id: string): Example | undefined {
  return GALLERY.find((e) => e.id === id);
}

export function galleryManifest(id: string): ComponentManifest | undefined {
  return galleryManifests().find((m) => m.id === id);
}

/** 按包分组，给 UI 用；顺序沿用 PACKS 的顺序 */
export function galleryByPack(): { pack: (typeof PACKS)[number]; items: ComponentManifest[] }[] {
  const all = galleryManifests();
  return PACKS.map((pack) => ({ pack, items: all.filter((m) => m.gallery?.pack === (pack.key as PackKey)) })).filter(
    (g) => g.items.length > 0
  );
}

/** 案例库里的功能元件总数（不含端口） */
export function galleryCost(): number {
  return galleryManifests().reduce((n, m) => {
    const comps = m.def.circuit.comps.filter((c) => c.type !== "input" && c.type !== "output");
    return n + comps.length;
  }, 0);
}
