import { Alert, Button, Space, Table, Tag, Tooltip, Upload } from "antd";
import { useState } from "react";
import type { WorkshopState } from "../../workshop/index.ts";
import { diffInterface, emptyWorkshop, exportWorkshop, importWorkshop } from "../../workshop/index.ts";
import type { ComponentManifest } from "../../workshop/index.ts";

/* ------------------------------------------------------------------ *
 * IMP-13: 组件工坊面板
 *
 * 用户封装 + 课程奖励组件的本地索引；版本不可变；
 * 升级前显示接口差异并要求用户确认。
 * ------------------------------------------------------------------ */

export interface WorkshopPanelProps {
  state: WorkshopState;
  onChange: (next: WorkshopState) => void;
}

export default function WorkshopPanel({ state, onChange }: WorkshopPanelProps) {
  const [diffId, setDiffId] = useState<string | null>(null);

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
          beforeUpload={(file) => {
            const reader = new FileReader();
            reader.onload = () => {
              const r = importWorkshop(state, String(reader.result ?? ""));
              onChange({ ...state });
              if (r.failed) alert(`导入失败 ${r.failed} 项`);
            };
            reader.readAsText(file);
            return false;
          }}
        >
          <Button size="small">导入 JSON</Button>
        </Upload>
      </Space>

      {state.components.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message="作品工坊还是空的"
          description="保存第一个电路，或导入已有 JSON。组件版本一旦发布就不可修改，升级需另存为新版本。"
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
                <Tooltip title={r.interface.map((p) => `${p.dir} ${p.name}(${p.width})`).join("、")}>
                  <span>{r.interface.length} 个端口</span>
                </Tooltip>
              ),
            },
            {
              title: "来源",
              dataIndex: "source",
              width: 80,
              render: (v: string) => <Tag>{v}</Tag>,
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
                        <Button
                          size="small"
                          onClick={() => {
                            setDiffId(`${r.id}#${r.version}->${newer.version}`);
                          }}
                        >
                          查看升级
                        </Button>
                      )}
                      {latest && latest.version === r.version && (
                        <Tag color="green">当前使用</Tag>
                      )}
                    </Space>
                );
              },
            },
          ]}
        />
      )}

      {diffId && (() => {
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
            message={`v${from.version} → v${to.version} 接口差异`}
            description={
              <ul className="asm-errors">
                {d.added.map((n) => <li key={"a" + n}>新增 {n}</li>)}
                {d.removed.map((n) => <li key={"r" + n}>删除 {n}</li>)}
                {d.changed.map((c) => <li key={"c" + c.name}>变化 {c.name}: {c.reason}</li>)}
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

/** 默认从项目里加载（如果存在）或创建空工坊 */
export function loadOrEmpty(json: string | null): WorkshopState {
  if (!json) return emptyWorkshop();
  try {
    const obj = JSON.parse(json);
    if (obj && Array.isArray(obj.components)) {
      return { components: obj.components };
    }
  } catch {
    // ignore
  }
  return emptyWorkshop();
}