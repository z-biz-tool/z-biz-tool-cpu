import { Progress } from "antd";
import { useNavigate } from "react-router-dom";
import { LEVELS, STORAGE_LEVELS, FAST_LEVELS } from "../challenges/levels.ts";
import type { Level } from "../challenges/levels.ts";
import { passed, scoreOf } from "../challenges/progress.ts";
import type { Progress as ProgressState } from "../challenges/progress.ts";
import { useEditor } from "../editor/store.ts";

/* ------------------------------------------------------------------ *
 * 书架主页：3 张书卡，点击进 /lesson 并把书设为当前。
 * 这是个独立的 URL（/），不挂编辑器的工具栏/元件库/画布。
 * ------------------------------------------------------------------ */

type BookKey = "logic" | "memory" | "fast";

interface Book {
  key: BookKey;
  glyph: string;
  title: string;
  sub: string;
  blurb: string;
  list: Level[];
  theme: string;
}

function scoreOfBookLevels(progress: ProgressState, list: Level[]): number {
  return list.filter((l) => passed(progress, l.id)).length;
}

export default function ShelfPage() {
  const progress = useEditor((s) => s.progress);
  const setBook = useEditor((s) => s.setBook);
  const navigate = useNavigate();

  const books: Book[] = [
    {
      key: "logic",
      glyph: "⛁",
      title: "CPU 书",
      sub: "《从门到一台 Z16》",
      blurb: "31 关 · 5 个世界（逻辑门 → 组合 → 时序 → 造 CPU → 存储体系）",
      list: LEVELS,
      theme: "theme-cpu",
    },
    {
      key: "memory",
      glyph: "☰",
      title: "存储书",
      sub: "《囚禁电荷》",
      blurb: "18 关 · 6 个世界（DRAM / Flash / FTL / 磁盘金字塔与掉电）",
      list: STORAGE_LEVELS,
      theme: "theme-mem",
    },
    {
      key: "fast",
      glyph: "⇉",
      title: "优化书",
      sub: "《流水线与之后的一切》",
      blurb: "8 关 · 2 个世界（切长路径 / 控制冒险）",
      list: FAST_LEVELS,
      theme: "theme-fast",
    },
  ];

  const totalDone = scoreOf(progress).levels;
  const totalAll = books.reduce((n, b) => n + b.list.length, 0);

  return (
    <div className="shelf-page">
      <header className="shelf-page-head">
        <div className="brand">
          <span className="logo">Z</span>
          <span className="brand-name">z-biz-tool</span>
        </div>
        <p className="brand-tag">从门到一台能跑汇编的 CPU，一本书一本书地学</p>
        <div className="total-progress mono">
          总进度 {totalDone} / {totalAll} 关
        </div>
      </header>

      <div className="shelf">
        {books.map((b) => {
          const done = scoreOfBookLevels(progress, b.list);
          const total = b.list.length;
          const pct = Math.round((done / total) * 100);
          const finished = done === total && total > 0;
          return (
            <button
              key={b.key}
              className={"book-cover " + b.theme + (finished ? " done" : "")}
              onClick={() => {
                setBook(b.key);
                navigate("/lesson");
              }}
            >
              <span className="cover-glyph">{b.glyph}</span>
              <span className="cover-title">{b.title}</span>
              <span className="cover-sub">{b.sub}</span>
              <span className="cover-blurb">{b.blurb}</span>
              <div className="cover-progress">
                <Progress
                  percent={pct}
                  size="small"
                  format={() => `${done}/${total}`}
                  status={finished ? "success" : "active"}
                />
              </div>
              <span className="cover-cta">打开这本书 →</span>
            </button>
          );
        })}
      </div>

      <footer className="shelf-page-foot">
        <button className="btn ghost" onClick={() => navigate("/sandbox")}>
          直接进自由搭建沙盒 ↗
        </button>
      </footer>
    </div>
  );
}
