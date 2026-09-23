import { Progress } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FAST_LEVELS, LEVELS, STORAGE_LEVELS } from "../challenges/levels.ts";
import type { Level } from "../challenges/levels.ts";
import { passed } from "../challenges/progress.ts";
import type { Progress as ProgressState } from "../challenges/progress.ts";
import { useEditor } from "../editor/store.ts";

/* ------------------------------------------------------------------ *
 * 书架主页：3 张书卡 + 动态背景 + 入场动画 + 3D 悬停
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
  accent: string;
}

function scoreOfBookLevels(progress: ProgressState, list: Level[]): number {
  return list.filter((l) => passed(progress, l.id)).length;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  if (h < 22) return "晚上好";
  return "夜深了";
}

export default function ShelfPage() {
  const progress = useEditor((s) => s.progress);
  const setBook = useEditor((s) => s.setBook);
  const navigate = useNavigate();

  const books: Book[] = useMemo(
    () => [
      {
        key: "logic",
        glyph: "⛁",
        title: "CPU 书",
        sub: "《从门到一台 Z16》",
        blurb: "31 关 · 5 个世界，从与非门拼出能跑汇编的处理器",
        list: LEVELS,
        theme: "theme-cpu",
        accent: "#a78bfa",
      },
      {
        key: "memory",
        glyph: "☰",
        title: "存储书",
        sub: "《囚禁电荷》",
        blurb: "18 关 · 6 个世界，DRAM/Flash/磁盘的物理翻译成预算",
        list: STORAGE_LEVELS,
        theme: "theme-mem",
        accent: "#22d3ee",
      },
      {
        key: "fast",
        glyph: "⇉",
        title: "优化书",
        sub: "《流水线与之后的一切》",
        blurb: "8 关 · 2 个世界，把延迟与冒险变成可拼的电路",
        list: FAST_LEVELS,
        theme: "theme-fast",
        accent: "#fb923c",
      },
    ],
    [],
  );

  const stats = useMemo(() => {
    return books.map((b) => {
      const done = scoreOfBookLevels(progress, b.list);
      return { key: b.key, done, total: b.list.length, finished: done === b.list.length && b.list.length > 0 };
    });
  }, [books, progress]);

  const totalDone = stats.reduce((n, s) => n + s.done, 0);
  const totalAll = books.reduce((n, b) => n + b.list.length, 0);
  const totalPct = Math.round((totalDone / totalAll) * 100);

  return (
    <div className="shelf-page">
      {/* 漂浮光晕背景 —— 三本书的主题色各一 */}
      <div className="shelf-orbs" aria-hidden>
        <span className="orb orb-cpu" />
        <span className="orb orb-mem" />
        <span className="orb orb-fast" />
      </div>
      <div className="shelf-grid-bg" aria-hidden />

      <header className="shelf-page-head">
        <div className="brand">
          <span className="logo">Z</span>
          <div className="brand-text">
            <span className="brand-name">z-biz-tool</span>
            <span className="brand-tag">数字电路 · CPU · 从门到一台能跑汇编的处理器</span>
          </div>
        </div>
        <div className="greeting">
          <span className="greeting-hi">{greeting()}，今天读哪一本？</span>
        </div>
        <div className="total-pill">
          <Progress
            type="circle"
            percent={totalPct}
            size={56}
            strokeColor={{ "0%": "#a78bfa", "100%": "#22d3ee" }}
            trailColor="rgba(255,255,255,0.08)"
            format={(p) => <span className="total-num">{p}</span>}
          />
          <div className="total-text">
            <div className="total-line">总进度</div>
            <div className="total-line mono">
              <b>{totalDone}</b> / {totalAll} 关
            </div>
          </div>
        </div>
      </header>

      <div className="shelf" role="list">
        {books.map((b, i) => (
          <BookCard
            key={b.key}
            book={b}
            delay={i * 90}
            done={stats[i].done}
            total={stats[i].total}
            finished={stats[i].finished}
            onOpen={() => {
              setBook(b.key);
              navigate("/lesson");
            }}
          />
        ))}
      </div>

      <footer className="shelf-page-foot">
        <button className="btn ghost sand" onClick={() => navigate("/sandbox")}>
          <span className="sand-glyph">⊟</span>
          <span>没有关卡在手？直接进自由搭建沙盒</span>
          <span className="sand-arrow">→</span>
        </button>
        <span className="foot-tip">每一次保存都会进入项目历史，回到任何一步都不丢数据</span>
      </footer>
    </div>
  );
}

/* ---------------- 单张书卡：3D 悬停 + 入场动画 ---------------- */

interface CardProps {
  book: Book;
  done: number;
  total: number;
  finished: boolean;
  delay: number;
  onOpen: () => void;
}

function BookCard({ book, done, total, finished, delay, onOpen }: CardProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, gx: 50, gy: 50 });

  /* 鼠标位置 → 3D 倾斜；进入时还原 */
  const onMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const ry = (px - 0.5) * 10; // 左右 ±5°
    const rx = (0.5 - py) * 8; // 上下 ±4°
    setTilt({ rx, ry, gx: px * 100, gy: py * 100 });
  };
  const onLeave = () => setTilt({ rx: 0, ry: 0, gx: 50, gy: 50 });

  /* 入场动画只在挂载时跑一次 */
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const remain = total - done;

  return (
    <button
      ref={ref}
      role="listitem"
      className={
        "book-cover " +
        book.theme +
        (finished ? " done" : "") +
        (entered ? " entered" : "")
      }
      style={
        {
          "--accent-rgb": hexToRgb(book.accent),
          transform: `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
          "--glow-x": tilt.gx + "%",
          "--glow-y": tilt.gy + "%",
        } as React.CSSProperties
      }
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onFocus={onLeave}
      onClick={onOpen}
      aria-label={`${book.title} ${book.sub}，${done}/${total} 关${finished ? "，已通关" : ""}`}
    >
      <span className="cover-glow" aria-hidden />
      {finished && <span className="cover-badge">已通关</span>}

      <span className="cover-glyph" aria-hidden>
        {book.glyph}
      </span>

      <span className="cover-title">{book.title}</span>
      <span className="cover-sub">{book.sub}</span>
      <span className="cover-blurb">{book.blurb}</span>

      <div className="cover-progress">
        <Progress
          percent={pct}
          size="small"
          strokeColor={book.accent}
          trailColor="rgba(255,255,255,0.08)"
          format={() => (
            <span className="cover-progress-text">
              <b>{done}</b>
              <span className="muted">/{total}</span>
            </span>
          )}
        />
        <span className="cover-progress-meta">
          {finished
            ? "全部通关，去工坊翻翻你的设计"
            : remain === 1
              ? "再攻一关即可通关"
              : `还差 ${remain} 关`}
        </span>
      </div>

      <span className="cover-cta">
        <span>打开这本书</span>
        <span className="cta-arrow" aria-hidden>
          →
        </span>
      </span>
    </button>
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
