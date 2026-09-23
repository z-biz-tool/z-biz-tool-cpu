import { Alert, Button, Popconfirm, Space, Table, Tag, Tooltip, Upload } from "antd";
import { useState } from "react";
import type { ComponentManifest } from "../../workshop/index.ts";
import { diffInterface, exportWorkshop, importWorkshop, lacksMeta } from "../../workshop/index.ts";
import { useEditor } from "../store.ts";

/* ------------------------------------------------------------------ *
 * IMP-13: 组件工坊面板
 *
 * 用户封装 + 课程奖励组件的本地索引；版本不可变；
 * 升级前显示接口差异并要求用户确认；当前版本可直接放进画布复用。
 * 工坊状态存在 editor store 里（并落本地存储），切标签页不会丢。
 * ------------------------------------------------------------------ */

export default function WorkshopPanel() {
  const state = useEditor((s) => s.workshop);
  const replaceWorkshop = useEditor((s) => s.replaceWorkshop);
  const removeWorkshopVersion = useEditor((s) => s.removeWorkshopVersion);
  const useWorkshopComponent = useEditor((s) => s.useWorkshopComponent);
  const setPanel = useEditor((s) => s.setPanel);
  const openPackageMeta = useEditor((s) => s.openPackageMeta);
  const [diffId, setDiffId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "warning"; text: string } | null>(null);

  const rows = state.components;
  const grouped = groupBy(rows, (c) => c.id);

  return (
    <div className="workshop-panel">
      <div className="panel-note">
        作品工坊只保留在你本地。它记录了你创建 / 收藏的封装组件；每个版本不可修改，升级需要另存。
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
          description="在画布里选中元件后「打包子电路」，组件会自动登记到这里；也可以导入已有的 workshop.json 备份。组件版本一旦发布就不可修改，升级需另存为新版本。"
        />
      ) : (
        <Table
          size="small"
          rowKey={(r) => `${r.id}#${r.version}`}
          dataSource={rows}
          pagination={false}
          columns={[
            {
              title: "组件",
              dataIndex: "id",
              render: (v: string, r: ComponentManifest) => (
                <span>
                  <b>{r.title}</b>
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
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  user: "自建",
  course: "课程奖励",
  imported: "导入",
};

function sourceLabel(v: string): string {
  return SOURCE_LABEL[v] ?? v;
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
