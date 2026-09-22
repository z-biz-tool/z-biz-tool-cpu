import { Modal, Progress, Tag, Tooltip } from "antd";
import { useState } from "react";
import { LEVELS, TIERS, levelById } from "../../challenges/levels.ts";
import { BADGES, isUnlocked, passed, scoreOf, tierDone } from "../../challenges/progress.ts";
import type { Badge } from "../../challenges/progress.ts";
import { settleState } from "../../core/sim.ts";
import { designCost, useEditor } from "../store.ts";

/* ------------------------------------------------------------------ *
 * 关卡面板：五层进度 + 任务说明 + 判题结果
 * ------------------------------------------------------------------ */

export default function ChallengePanel() {
  const levelId = useEditor((s) => s.levelId);
  const progress = useEditor((s) => s.progress);
  const result = useEditor((s) => s.result);
  const mode = useEditor((s) => s.mode);
  const design = useEditor((s) => s.design);
  const st = useEditor.getState;
  const level = levelById(levelId ?? "");
  const score = scoreOf(progress);
  /** doc 02 §5.2：振荡与预算用尽必须说不同的话 */
  const settle = result ? settleState(result.settleOutcome) : null;

  return (
    <div className="panel-body">
      <div className="head">
        <span className="title">关卡</span>
        <span className="tag">
          {score.levels}/{LEVELS.length} 关
        </span>
        <span className="tag">成就 {score.badges}/{BADGES.length}</span>
      </div>

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
                  const locked = !isUnlocked(progress, l.id);
                  const done = passed(progress, l.id);
                  const rec = progress.done[l.id];
                  return (
                    <button
                      key={l.id}
                      className={"lv" + (l.id === levelId ? " on" : "") + (done ? " done" : "") + (locked ? " locked" : "")}
                      disabled={locked}
                      onClick={() => st().startLevel(l.id)}
                      title={locked ? "先通过前面的关卡" : l.brief}
                    >
                      <span className="lv-no">{done ? "✓" : locked ? "🔒" : l.id.split("-")[0].toUpperCase()}</span>
                      <span className="lv-name">{l.name}</span>
                      {rec?.pass && <span className="lv-cost mono">{rec.cost}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

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
              <span className="tag">基准 {level.par ?? "—"}</span>
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
                <p className="note error">
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
              {result.errors.slice(0, 5).map((e, i) => (
                <p className="note error" key={i}>
                  {e.msg}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      <AchievementToast />
    </div>
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
