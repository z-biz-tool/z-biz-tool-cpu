import { Button, Modal, Progress, Tag, Tooltip } from "antd";
import { useState } from "react";
import {
  FAST_LEVELS,
  LEVELS,
  STORAGE_LEVELS,
  TIERS,
  levelById,
  parCost,
} from "../../challenges/levels.ts";
import { catchupLevels, missingPrereqs } from "../../challenges/prereq.ts";
import { BADGES, passed, scoreOf, tierDone } from "../../challenges/progress.ts";
import type { Progress as ProgressState, Badge } from "../../challenges/progress.ts";
import { settleState } from "../../core/sim.ts";
import { sortDiags } from "../../core/netlist.ts";
import { designCost, useEditor } from "../store.ts";

/* ------------------------------------------------------------------ *
 * 关卡面板：根据 store.book 显示当前书的世界与关卡。
 * 书架入口已迁到主页（/），本面板只负责「书内关卡视图」。
 * ------------------------------------------------------------------ */

/** 跳关确认里要摆的事实 */
interface GapAsk {
  id: string;
  missing: string[];
  catchup: string[];
}

const levelName = (id: string) => levelById(id)?.name ?? id;

export default function ChallengePanel() {
  const levelId = useEditor((s) => s.levelId);
  const progress = useEditor((s) => s.progress);
  const result = useEditor((s) => s.result);
  const mode = useEditor((s) => s.mode);
  const design = useEditor((s) => s.design);
  const book = useEditor((s) => s.book);
  const setBook = useEditor((s) => s.setBook);
  const st = useEditor.getState;
  const level = levelById(levelId ?? "");
  const score = scoreOf(progress);
  const [gapAsk, setGapAsk] = useState<GapAsk | null>(null);
  /** doc 02 §5.2：振荡与预算用尽必须说不同的话 */
  const settle = result ? settleState(result.settleOutcome) : null;

  const openLevel = (id: string, p: ProgressState) => {
    const missing = missingPrereqs(p, id);
    if (!missing.length) {
      st().startLevel(id);
      return;
    }
    setGapAsk({ id, missing, catchup: catchupLevels(p, id) });
  };

  /* 三本书的视图互斥：
     - 没选书（直接刷 /lesson 进来）：显示「全部」概览
     - 选了某一本：只展示该本 */
  const showLogic = book === null || book === "logic";
  const showMemory = book === null || book === "memory";
  const showFast = book === null || book === "fast";
  const headTitle =
    book === "logic"
      ? "CPU 书"
      : book === "memory"
        ? "存储书"
        : book === "fast"
          ? "优化书"
          : "全部关卡";

  return (
    <div className="panel-body">
      <div className="book-tabs">
        <button
          className={"book-tab" + (book === null ? " on" : "")}
          onClick={() => setBook(null)}
          aria-pressed={book === null}
        >
          全部
        </button>
        <button
          className={"book-tab theme-cpu" + (book === "logic" ? " on" : "")}
          onClick={() => setBook("logic")}
          aria-pressed={book === "logic"}
        >
          CPU 书
        </button>
        <button
          className={"book-tab theme-mem" + (book === "memory" ? " on" : "")}
          onClick={() => setBook("memory")}
          aria-pressed={book === "memory"}
        >
          存储书
        </button>
        <button
          className={"book-tab theme-fast" + (book === "fast" ? " on" : "")}
          onClick={() => setBook("fast")}
          aria-pressed={book === "fast"}
        >
          优化书
        </button>
      </div>
      <div className="head">
        <span className="title">{headTitle}</span>
        <span className="tag">
          {score.levels}/{LEVELS.length + STORAGE_LEVELS.length + FAST_LEVELS.length} 关
        </span>
        <span className="tag">成就 {score.badges}/{BADGES.length}</span>
      </div>

      {showLogic && (
        <div className="level-list">
          {TIERS.map((t) => {
            const list = LEVELS.filter((l) => l.tier === t.tier);
            const { ok, total } = tierDone(progress, t.tier);
            return (
              <section key={t.tier} className="tier">
                <div className="tier-head">
                  <span>{t.name}</span>
                  <Tooltip title={t.blurb}>
                    <Progress
                      percent={Math.round((ok / total) * 100)}
                      size="small"
                      format={() => `${ok}/${total}`}
                      status={ok === total ? "success" : "active"}
                    />
                  </Tooltip>
                </div>
                <div className="tier-items">
                  {list.map((l) => {
                    const missing = missingPrereqs(progress, l.id);
                    const done = passed(progress, l.id);
                    const rec = progress.done[l.id];
                    return (
                      <button
                        key={l.id}
                        className={
                          "lv" +
                          (l.id === levelId ? " on" : "") +
                          (done ? " done" : "") +
                          (missing.length ? " gap" : "")
                        }
                        onClick={() => openLevel(l.id, progress)}
                        title={
                          missing.length
                            ? `还缺先修：${missing.map(levelName).join("、")}`
                            : l.brief
                        }
                      >
                        <span className="lv-no">
                          {done ? "✓" : missing.length ? "!" : l.id.split("-")[0].toUpperCase()}
                        </span>
                        <span className="lv-name">{l.name}</span>
                        {missing.length > 0 && <span className="lv-gap mono">先修 {missing.length}</span>}
                        {rec?.pass && <span className="lv-cost mono">{rec.cost}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {showMemory && (
        <StorageSection progress={progress} levelId={levelId} onOpen={openLevel} />
      )}
      {showFast && (
        <FastSection progress={progress} levelId={levelId} onOpen={openLevel} />
      )}

      <button className="btn wide" onClick={() => st().openSandbox()}>
        进入自由搭建沙盒
      </button>

      {mode === "sandbox" || !level ? (
        <p className="hint">沙盒模式没有判题，可随意搭建；选一个关卡即可开始挑战。</p>
      ) : (
        <>
          <h4>{level.name}</h4>
          <p className="desc">{level.brief}</p>
          <p className="teach">{level.teach}</p>
          {level.available.length > 0 && (
            <div className="chips">
              {level.available.map((a) => (
                <Tag key={a} className="chip">
                  {a === "custom" ? "子电路" : a}
                </Tag>
              ))}
            </div>
          )}
          <div className="ops">
            <button className="btn primary" onClick={() => st().checkLevel()}>
              运行测试
            </button>
            {level.hint && (
              <Tooltip title={level.hint}>
                <span className="tag">提示</span>
              </Tooltip>
            )}
            <Tooltip title={`当前花费 ${designCost(design)}`}>
              <span className="tag">基准 {parCost(level) ?? "—"}</span>
            </Tooltip>
          </div>
          {result && (
            <div className={"result" + (result.pass ? " ok" : " bad")}>
              <div className="result-head">
                <b>{result.pass ? "全部通过" : "还没通过"}</b>
                <span className="mono">
                  {result.ok}/{result.total} · 花费 {result.cost}
                  {result.defs ? ` · 子电路 ${result.defs}` : ""}
                </span>
              </div>
              {settle && (
                <p className={"note " + settle.tone}>
                  {settle.label}：{settle.detail}
                </p>
              )}
              {result.notes.map((n, i) => (
                <p className="note" key={i}>
                  {n}
                </p>
              ))}
              <ul className="checks">
                {result.outcomes.map((o, i) => (
                  <li key={i} className={o.pass ? "ok" : "bad"}>
                    <span className="t">{o.name}</span>
                    {o.checks.map((c, j) => (
                      <div key={j} className={c.pass ? "c ok" : "c bad"}>
                        {c.pass ? "✓" : "✗"} {c.label} <em>{c.detail}</em>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
              {sortDiags(result.errors)
                .slice(0, 5)
                .map((e, i) => (
                  <p className={"note " + e.level} key={i}>
                    {e.msg}
                  </p>
                ))}
            </div>
          )}
        </>
      )}
      {gapAsk && (
        <Modal
          open
          title={`「${levelName(gapAsk.id)}」还缺 ${gapAsk.missing.length} 项先修`}
          onCancel={() => setGapAsk(null)}
          footer={[
            <Button
              key="catchup"
              disabled={!gapAsk.catchup.length}
              onClick={() => {
                st().startLevel(gapAsk.catchup[0]);
                setGapAsk(null);
              }}
            >
              {gapAsk.catchup.length ? `先去补「${levelName(gapAsk.catchup[0])}」` : "没有可补的关卡"}
            </Button>,
            <Button
              key="enter"
              type="primary"
              onClick={() => {
                st().startLevel(gapAsk.id);
                setGapAsk(null);
              }}
            >
              直接进入
            </Button>,
            <Button key="back" type="text" onClick={() => setGapAsk(null)}>
              先不跳
            </Button>,
          ]}
        >
          <p className="desc">缺的先修：{gapAsk.missing.map(levelName).join("、")}</p>
          {!!gapAsk.catchup.length && (
            <p className="teach">
              最短补充路径：{gapAsk.catchup.slice(0, 6).map(levelName).join(" → ")}
              {gapAsk.catchup.length > 6 ? ` → 另 ${gapAsk.catchup.length - 6} 关` : ""}
            </p>
          )}
          <p className="hint">直接进入照样能判题、照样拿勋章；但前面那几关的通关记录不会因为跳关补上。</p>
        </Modal>
      )}
      <AchievementToast />
    </div>
  );
}

/** 存储书《囚禁电荷》：独立于 CPU 书 31 关的第二本书 */
function StorageSection({
  progress,
  levelId,
  onOpen,
}: {
  progress: ProgressState;
  levelId: string | null;
  onOpen: (id: string, p: ProgressState) => void;
}) {
  if (!STORAGE_LEVELS.length) return null;
  const done = STORAGE_LEVELS.filter((l) => passed(progress, l.id)).length;
  const worlds = [...new Set(STORAGE_LEVELS.map((l) => l.id.slice(0, 2).toUpperCase()))];
  const worldNames: Record<string, string> = {
    M1: "一 存就是状态",
    M2: "二 电容与 DRAM",
    M3: "三 浮栅与闪存",
    M4: "四 翻译层 FTL",
    M5: "五 磁头与盘片",
    M6: "六 整机与掉电",
  };
  return (
    <section className="tier">
      <div className="tier-head">
        <span>存储书 · 囚禁电荷</span>
        <Tooltip title="第二本书：把 DRAM / Flash / 磁盘的物理翻译成拍数与预算。六个世界，18 关全部上架。">
          <Progress
            percent={Math.round((done / STORAGE_LEVELS.length) * 100)}
            size="small"
            format={() => `${done}/${STORAGE_LEVELS.length}`}
            status={done === STORAGE_LEVELS.length ? "success" : "active"}
          />
        </Tooltip>
      </div>
      {worlds.map((w) => (
        <div key={w}>
          <p className="teach">
            世界 {w.replace(/^M/, "")} · {worldNames[w] ?? ""}
          </p>
          <div className="tier-items">
            {STORAGE_LEVELS.filter((l) => l.id.toUpperCase().startsWith(w)).map((l) => {
              const ok = passed(progress, l.id);
              const rec = progress.done[l.id];
              return (
                <button
                  key={l.id}
                  className={"lv" + (l.id === levelId ? " on" : "") + (ok ? " done" : "")}
                  onClick={() => onOpen(l.id, progress)}
                  title={l.brief}
                >
                  <span className="lv-no">{ok ? "✓" : l.id.split("-")[0].toUpperCase()}</span>
                  <span className="lv-name">{l.name}</span>
                  {rec?.pass && <span className="lv-cost mono">{rec.cost}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

function FastSection({
  progress,
  levelId,
  onOpen,
}: {
  progress: ProgressState;
  levelId: string | null;
  onOpen: (id: string, p: ProgressState) => void;
}) {
  if (!FAST_LEVELS.length) return null;
  const done = FAST_LEVELS.filter((l) => passed(progress, l.id)).length;
  const worlds = [...new Set(FAST_LEVELS.map((l) => l.id.slice(0, 2).toUpperCase()))];
  const worldNames: Record<string, string> = {
    F1: "一 切长路径",
    F2: "二 控制冒险",
  };
  return (
    <section className="tier">
      <div className="tier-head">
        <span>优化书 · 流水线与之后的一切</span>
        <Tooltip title="第三本书：把 CPU 性能账（延迟、冒险、预测）翻译成电路与拍数。两个世界，8 关全部上架。">
          <Progress
            percent={Math.round((done / FAST_LEVELS.length) * 100)}
            size="small"
            format={() => `${done}/${FAST_LEVELS.length}`}
            status={done === FAST_LEVELS.length ? "success" : "active"}
          />
        </Tooltip>
      </div>
      {worlds.map((w) => (
        <div key={w}>
          <p className="teach">
            世界 {w.replace(/^F/, "")} · {worldNames[w] ?? ""}
          </p>
          <div className="tier-items">
            {FAST_LEVELS.filter((l) => l.id.toUpperCase().startsWith(w)).map((l) => {
              const ok = passed(progress, l.id);
              const rec = progress.done[l.id];
              return (
                <button
                  key={l.id}
                  className={"lv" + (l.id === levelId ? " on" : "") + (ok ? " done" : "")}
                  onClick={() => onOpen(l.id, progress)}
                  title={l.brief}
                >
                  <span className="lv-no">{ok ? "✓" : l.id.split("-")[0].toUpperCase()}</span>
                  <span className="lv-name">{l.name}</span>
                  {rec?.pass && <span className="lv-cost mono">{rec.cost}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

function AchievementToast() {
  const earned = useEditor((s) => s.earned);
  const [seen, setSeen] = useState<Badge[]>([]);
  const open = earned.length > 0 && earned !== seen;
  if (!open) return null;
  return (
    <Modal
      open
      title="获得新成就"
      onCancel={() => setSeen(earned)}
      onOk={() => setSeen(earned)}
      okText="收下"
    >
      {earned.map((b) => (
        <p key={b.id}>
          <b>{b.name}</b> — {b.desc}
        </p>
      ))}
    </Modal>
  );
}
