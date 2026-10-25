import { Alert, Button, Input, Modal, Popconfirm, Progress, Select, Space, Table, Tag, Tooltip, Upload } from "antd";
import { useMemo, useState } from "react";
import type { ComponentManifest } from "../../workshop/index.ts";
import { diffInterface, exportWorkshop, importWorkshop, lacksMeta } from "../../workshop/index.ts";
import { GALLERY } from "../../workshop/gallery/index.ts";
import { checkExample } from "../../workshop/gallery/check.ts";
import { galleryCost, galleryManifests, galleryExample } from "../../workshop/gallery/manifest.ts";
import { PACKS } from "../../workshop/gallery/spec.ts";
import { useEditor } from "../store.ts";

/* ------------------------------------------------------------------ *
 * IMP-13: 组件工坊面板
 *
 * 用户封装 + 课程奖励组件的本地索引；版本不可变；
 * 升级前显示接口差异并要求用户确认；当前版本可直接放进画布复用。
 * 工坊状态存在 editor store 里（并落本地存储），切标签页不会丢。
 *
 * 案例库（CASE-01）：100 个自带案例用同一套 manifest，走同一条「放入画布」，
 * 不另立一套数据结构 —— 案例不是展品，是随手能拆的零件。
 * ------------------------------------------------------------------ */

interface CheckState {
  done: number;
  total: number;
  bad: { id: string; name: string; problems: string[] }[];
  running: boolean;
}

export default function WorkshopPanel() {
  const state = useEditor((s) => s.workshop);
  const replaceWorkshop = useEditor((s) => s.replaceWorkshop);
  const removeWorkshopVersion = useEditor((s) => s.removeWorkshopVersion);
  const useWorkshopComponent = useEditor((s) => s.useWorkshopComponent);
  const loadGallery = useEditor((s) => s.loadGallery);
  const placeGallery = useEditor((s) => s.placeGallery);
  const setPanel = useEditor((s) => s.setPanel);
  const openPackageMeta = useEditor((s) => s.openPackageMeta);
  const [diffId, setDiffId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "warning"; text: string } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pack, setPack] = useState<string>("all");
  const [check, setCheck] = useState<CheckState>({ done: 0, total: GALLERY.length, bad: [], running: false });

  const rows = state.components;
  const grouped = groupBy(rows, (c) => c.id);
  const loaded = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const examples = useMemo(() => galleryManifests(), []);
  const totalComps = useMemo(() => galleryCost(), []);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return examples.filter((m) => {
      if (pack !== "all" && m.gallery?.pack !== pack) return false;
      if (!kw) return true;
      const ex = galleryExample(m.id);
      const hay = [m.id, m.title, m.description, ex?.why ?? "", (m.gallery?.tags ?? []).join(" ")].join(" ").toLowerCase();
      return hay.includes(kw);
    });
  }, [examples, pack, q]);

  /** 在浏览器里把这 100 个案例当场重跑一遍：结构、仿真、模型对拍 */
  async function runCheck() {
    setCheck({ done: 0, total: GALLERY.length, bad: [], running: true });
    const bad: CheckState["bad"] = [];
    for (let i = 0; i < GALLERY.length; i++) {
      const r = checkExample(GALLERY[i]);
      if (!r.ok) bad.push({ id: r.id, name: r.name, problems: r.problems });
      if (i % 6 === 0 || i === GALLERY.length - 1) {
        setCheck({ done: i + 1, total: GALLERY.length, bad: [...bad], running: true });
        await new Promise((r2) => setTimeout(r2, 0));
      }
    }
    setCheck({ done: GALLERY.length, total: GALLERY.length, bad, running: false });
  }

  return (
    <div className="workshop-panel">
      <div className="panel-note">
        作品工坊只保留在你本地。它记录了你创建 / 收藏的封装组件；每个版本不可修改，升级需要另存。
      </div>

      <div className="gallery-entry">
        <div>
          <b>案例库</b>
          <span className="dim">
            {" "}
            · {examples.length} 个可拆可跑的电路 · {totalComps} 个功能元件 · 全部带模型对拍
          </span>
        </div>
        <Space size={4} wrap>
          <Button size="small" type="primary" onClick={() => setGalleryOpen(true)}>
            打开案例库
          </Button>
          <Button
            size="small"
            onClick={() => {
              const n = loadGallery();
              setNotice({
                kind: "success",
                text: n ? `已把 ${n} 个案例装进工坊（重复的没再登记）` : "100 个案例本来就都在工坊里",
              });
            }}
          >
            一键全部载入
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 8 }}>
        <Button
          size="small"
          disabled={!rows.length}
          onClick={() => {
            const blob = new Blob([exportWorkshop(state)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "workshop.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          导出备份
        </Button>
        <Upload
          accept="application/json"
          showUploadList={false}
          beforeUpload={(file) => {
            const reader = new FileReader();
            reader.onload = () => {
              const draft = { components: state.components.map((c) => ({ ...c })) };
              const r = importWorkshop(draft, String(reader.result ?? ""));
              replaceWorkshop(draft);
              setNotice({
                kind: r.failed ? "warning" : "success",
                text:
                  r.added || r.failed
                    ? `导入完成：新增 ${r.added} 个版本${r.failed ? `，${r.failed} 项格式不符被跳过` : ""}`
                    : "导入完成：备份里的组件本来就都在工坊里",
              });
            };
            reader.readAsText(file);
            return false;
          }}
        >
          <Button size="small">导入 JSON</Button>
        </Upload>
      </Space>

      {notice && (
        <Alert
          type={notice.kind}
          showIcon
          closable
          onClose={() => setNotice(null)}
          title={notice.text}
          style={{ marginBottom: 8 }}
        />
      )}

      {rows.length === 0 ? (
        <Alert
          type="info"
          showIcon
          title="作品工坊还是空的"
          description="在画布里选中元件后「打包子电路」，组件会自动登记到这里；也可以导入已有的 workshop.json 备份，或者从上面「案例库」里拿 100 个现成电路。组件版本一旦发布就不可修改，升级需另存为新版本。"
        />
      ) : (
        <Table
          size="small"
          rowKey={(r) => `${r.id}#${r.version}`}
          dataSource={rows}
          pagination={{ pageSize: 12, size: "small", hideOnSinglePage: true }}
          columns={[
            {
              title: "组件",
              dataIndex: "id",
              render: (v: string, r: ComponentManifest) => (
                <span>
                  <b>{r.title}</b>
                  {r.gallery && (
                    <Tag color="purple" style={{ marginLeft: 6 }}>
                      案例
                    </Tag>
                  )}
                  {lacksMeta(r) && (
                    <Tooltip title="缺名称、说明或端口说明：旧档导入的和当时跳过的都照常可用，只是接口含义只有作者自己清楚">
                      <Tag color="warning" style={{ marginLeft: 6 }}>
                        待完善元数据
                      </Tag>
                    </Tooltip>
                  )}
                  <br />
                  <span className="dim">id: {v}</span>
                </span>
              ),
            },
            {
              title: "版本",
              dataIndex: "version",
              width: 70,
              render: (v: number, r: ComponentManifest) => (
                <Tag color={r.supersededBy ? "default" : "blue"}>
                  v{v}
                  {r.supersededBy ? ` → v${r.supersededBy}` : " · 当前"}
                </Tag>
              ),
            },
            {
              title: "接口",
              dataIndex: "interface",
              render: (_: unknown, r: ComponentManifest) => (
                <Tooltip title={r.interface.map((p) => [`${p.dir} ${p.name}(${p.width})`, p.description].filter(Boolean).join(" — ")).join("、")}>
                  <span>{r.interface.length} 个端口</span>
                </Tooltip>
              ),
            },
            {
              title: "来源",
              dataIndex: "source",
              width: 80,
              render: (v: string) => <Tag>{sourceLabel(v)}</Tag>,
            },
            {
              title: "操作",
              key: "actions",
              render: (_: unknown, r: ComponentManifest) => {
                const same = grouped.get(r.id) ?? [];
                const latest = same.find((c) => !c.supersededBy);
                const newer = same.find((c) => c.version > r.version && !c.supersededBy);
                return (
                  <Space size={4}>
                    {newer && (
                      <Button size="small" onClick={() => setDiffId(`${r.id}#${r.version}->${newer.version}`)}>
                        查看升级
                      </Button>
                    )}
                    {latest?.version === r.version && (
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        onClick={() => {
                          const ok = useWorkshopComponent(r.id, r.version);
                          setNotice({
                            kind: ok ? "success" : "warning",
                            text: ok
                              ? "已把组件放到画布中央"
                              : "当前视图放不下这枚组件（可能正处在它自己的子电路里）",
                          });
                          if (ok) setPanel("inspector");
                        }}
                      >
                        放入画布
                      </Button>
                    )}
                    {latest?.version === r.version && lacksMeta(r) && (
                      <Button size="small" onClick={() => openPackageMeta(r.id)}>
                        补全说明
                      </Button>
                    )}
                    {r.gallery && (
                      <Button size="small" type="text" onClick={() => setDetailId(r.id)}>
                        说明
                      </Button>
                    )}
                    <Popconfirm
                      title={`删除 v${r.version}？`}
                      description="只影响工坊索引，已经用过这枚组件的电路不会被改动。"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => removeWorkshopVersion(r.id, r.version)}
                    >
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                );
              },
            },
          ]}
        />
      )}

      {diffId &&
        (() => {
          const [fromVer, toVer] = diffId.split("->");
          const [fromId] = fromVer.split("#");
          const from = state.components.find((c) => c.id === fromId && c.version === Number(fromVer.split("#")[1]));
          const to = state.components.find((c) => c.id === fromId && c.version === Number(toVer));
          if (!from || !to) return null;
          const d = diffInterface(from, to);
          return (
            <Alert
              type={d.removed.length || d.changed.length ? "warning" : "success"}
              showIcon
              style={{ marginTop: 12 }}
              title={`v${from.version} → v${to.version} 接口差异`}
              description={
                <ul className="asm-errors">
                  {d.added.map((n) => (
                    <li key={"a" + n}>新增 {n}</li>
                  ))}
                  {d.removed.map((n) => (
                    <li key={"r" + n}>删除 {n}</li>
                  ))}
                  {d.changed.map((c) => (
                    <li key={"c" + c.name}>
                      变化 {c.name}: {c.reason}
                    </li>
                  ))}
                  {!d.added.length && !d.removed.length && !d.changed.length && <li>无破坏性差异</li>}
                </ul>
              }
              closable
              onClose={() => setDiffId(null)}
            />
          );
        })()}

      {/* ---------------- 案例库 ---------------- */}
      <Modal
        open={galleryOpen}
        width={960}
        title={`案例库 · ${examples.length} 个电路`}
        onCancel={() => setGalleryOpen(false)}
        footer={[
          <Button key="check" onClick={runCheck} loading={check.running}>
            在本机重跑自检
          </Button>,
          <Button
            key="all"
            type="primary"
            onClick={() => {
              const n = loadGallery();
              setNotice({ kind: "success", text: n ? `已载入 ${n} 个案例` : "案例本来就都在工坊里" });
              setGalleryOpen(false);
            }}
          >
            全部载入工坊
          </Button>,
        ]}
      >
        <Space wrap style={{ marginBottom: 10 }}>
          <Input.Search
            allowClear
            placeholder="搜案例名 / 用途 / 标签"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 260 }}
          />
          <Select
            value={pack}
            onChange={setPack}
            style={{ width: 180 }}
            options={[{ value: "all", label: `全部（${examples.length}）` }, ...PACKS.map((p) => ({ value: p.key, label: p.title }))]}
          />
          <span className="dim">
            命中 {filtered.length} / {examples.length}
          </span>
        </Space>

        {check.done > 0 && (
          <Alert
            style={{ marginBottom: 10 }}
            type={check.bad.length ? "warning" : check.running ? "info" : "success"}
            showIcon
            title={
              check.running
                ? `自检中 ${check.done}/${check.total}`
                : check.bad.length
                  ? `${check.bad.length} 个案例没过（见下方详情）`
                  : `${check.total}/${check.total} 全部通过：结构、仿真、模型对拍三条都验过`
            }
            description={
              <>
                <Progress percent={Math.round((check.done / check.total) * 100)} size="small" showInfo={false} />
                {check.bad.slice(0, 3).map((b) => (
                  <div key={b.id} className="mono" style={{ fontSize: 12 }}>
                    {b.id}: {b.problems[0]}
                  </div>
                ))}
              </>
            }
          />
        )}

        <div className="pack-strip">
          {PACKS.map((p) => {
            const n = examples.filter((m) => m.gallery?.pack === p.key).length;
            return (
              <button key={p.key} className={"pack-chip" + (pack === p.key ? " on" : "")} onClick={() => setPack(p.key)}>
                <b style={{ color: p.accent }}>{p.title}</b>
                <span className="dim"> {n} 个</span>
              </button>
            );
          })}
        </div>

        <Table
          size="small"
          rowKey="id"
          dataSource={filtered}
          pagination={{ pageSize: 10, size: "small" }}
          columns={[
            {
              title: "案例",
              dataIndex: "title",
              render: (t: string, m: ComponentManifest) => (
                <span>
                  <b>{t}</b> <span className="dim mono">{m.id}</span>
                  <br />
                  <span className="dim">{m.description}</span>
                </span>
              ),
            },
            {
              title: "层",
              dataIndex: "tier",
              width: 50,
              render: (_: unknown, m: ComponentManifest) => <Tag color="blue">T{m.gallery?.tier}</Tag>,
            },
            {
              title: "规模",
              width: 90,
              render: (_: unknown, m: ComponentManifest) => {
                const comps = m.def.circuit.comps.filter((c) => c.type !== "input" && c.type !== "output").length;
                return (
                  <span className="mono dim">
                    {comps} 件 / {m.interface.length} 端口
                  </span>
                );
              },
            },
            {
              title: "操作",
              width: 170,
              render: (_: unknown, m: ComponentManifest) => (
                <Space size={4}>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    onClick={() => {
                      const ok = placeGallery(m.id);
                      setNotice({
                        kind: ok ? "success" : "warning",
                        text: ok ? `已把「${m.title}」放到画布中央` : "当前视图放不下（可能正处在这枚组件自己的子电路里）",
                      });
                      if (ok) {
                        setGalleryOpen(false);
                        setPanel("inspector");
                      }
                    }}
                  >
                    放入画布
                  </Button>
                  <Button size="small" type="text" onClick={() => setDetailId(m.id)}>
                    说明
                  </Button>
                  {loaded.has(m.id) ? <Tag color="green">已载入</Tag> : null}
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      {/* ---------------- 案例说明 ---------------- */}
      <Modal
        open={!!detailId}
        width={760}
        title={detailId ? `${galleryManifestTitle(detailId)}` : ""}
        onCancel={() => setDetailId(null)}
        footer={[
          <Button key="close" onClick={() => setDetailId(null)}>
            关闭
          </Button>,
          <Button
            key="place"
            type="primary"
            onClick={() => {
              if (!detailId) return;
              const ok = placeGallery(detailId);
              setNotice({ kind: ok ? "success" : "warning", text: ok ? "已放到画布中央" : "当前视图放不下这枚组件" });
              if (ok) {
                setDetailId(null);
                setGalleryOpen(false);
                setPanel("inspector");
              }
            }}
          >
            放入画布
          </Button>,
        ]}
      >
        {detailId && <ExampleDetail id={detailId} />}
      </Modal>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  user: "自建",
  course: "案例库",
  imported: "导入",
};

function sourceLabel(v: string): string {
  return SOURCE_LABEL[v] ?? v;
}

function galleryManifestTitle(id: string): string {
  return galleryManifests().find((m) => m.id === id)?.title ?? id;
}

/** 案例详情：为什么值得看 + 端口表 + 电路源码（可复制改） */
function ExampleDetail({ id }: { id: string }) {
  const m = galleryManifests().find((x) => x.id === id);
  const ex = galleryExample(id);
  if (!m || !ex) return null;
  const pack = PACKS.find((p) => p.key === m.gallery?.pack);
  const comps = m.def.circuit.comps.filter((c) => c.type !== "input" && c.type !== "output").length;
  return (
    <div className="example-detail">
      <p className="desc">{ex.blurb}</p>
      <p className="teach">{ex.why}</p>
      <div className="chips" style={{ margin: "8px 0" }}>
        <Tag color="blue">T{m.gallery?.tier}</Tag>
        <Tag>{pack?.title ?? m.gallery?.pack}</Tag>
        <Tag>{comps} 个功能元件</Tag>
        <Tag>{m.def.circuit.wires.length} 根连线</Tag>
        {(m.gallery?.tags ?? []).map((t) => (
          <Tag key={t} color="purple">
            {t}
          </Tag>
        ))}
      </div>
      <Table
        size="small"
        rowKey="name"
        pagination={false}
        dataSource={m.interface}
        columns={[
          { title: "端口", dataIndex: "name", width: 90, render: (v: string) => <span className="mono">{v}</span> },
          { title: "方向", dataIndex: "dir", width: 60, render: (v: string) => <Tag color={v === "in" ? "cyan" : "green"}>{v}</Tag> },
          { title: "位宽", dataIndex: "width", width: 60 },
          { title: "含义", dataIndex: "description" },
        ]}
      />
      <details style={{ marginTop: 10 }}>
        <summary className="dim">看电路源码（迷你网表，可直接改成你自己的组件）</summary>
        <pre className="example-src mono">{ex.src.trim()}</pre>
      </details>
    </div>
  );
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of arr) {
    const k = key(x);
    let bucket = m.get(k);
    if (!bucket) {
      bucket = [];
      m.set(k, bucket);
    }
    bucket.push(x);
  }
  return m;
}
