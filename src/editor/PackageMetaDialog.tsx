import { Alert, Input, Modal, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { findComponent } from "../workshop/index.ts";
import { useEditor } from "./store.ts";

/* ------------------------------------------------------------------ *
 * doc 05 §4（PRJ-02）：新封装必须填写名称及端口说明
 *
 * 封装一落地就弹出这个面板，把「叫什么、整体做什么、每个引脚做什么」一次问清。
 * 端口清单直接读刚登记好的 manifest —— 也就是电路真实的对外引脚，不在这里重算
 * 边界，免得面板和实际接口两套说法。
 * ------------------------------------------------------------------ */

const st = () => useEditor.getState();

export function PackageMetaDialog() {
  const pending = useEditor((s) => s.pendingMeta);
  const workshop = useEditor((s) => s.workshop);
  const defId = pending?.defId;
  const manifest = useMemo(() => (defId ? findComponent(workshop, defId) : undefined), [defId, workshop]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ports, setPorts] = useState<Record<string, string>>({});

  /* 每次换一个封装就按现状重填一遍，避免把上一个的说明带过来 */
  useEffect(() => {
    if (!manifest) return;
    setTitle(manifest.title ?? "");
    setDescription(manifest.description ?? "");
    const notes: Record<string, string> = {};
    for (const p of manifest.interface) notes[p.name] = p.description ?? "";
    setPorts(notes);
  }, [manifest]);

  if (!manifest) return null;

  const labels = new Map(manifest.def.circuit.comps.map((c) => [c.id, c.name || c.id]));
  const missingPorts = manifest.interface.filter((p) => !(ports[p.name] ?? "").trim()).map((p) => p.name);
  const ok = !!title.trim() && !!description.trim() && missingPorts.length === 0;

  return (
    <Modal
      open
      title={`补全封装信息 · ${manifest.title || manifest.id}`}
      okText="保存"
      cancelText="先跳过"
      okButtonProps={{ disabled: !ok }}
      onCancel={() => st().dismissPackageMeta()}
      onOk={() => {
        const name = title.trim();
        if (name && name !== manifest.title) st().renameDef(manifest.id, name);
        st().setPackageMeta(manifest.id, { title: name, description: description.trim(), ports });
      }}
      closable
      mask={{ closable: false }}
      destroyOnHidden
    >
      {!ok && (
        <Alert
          type="info"
          showIcon
          title={
            missingPorts.length
              ? `还有 ${missingPorts.length} 个端口没写说明`
              : !title.trim()
                ? "封装要有名称"
                : "写一句这个封装做什么，之后在工坊和升级预览里都靠它认组件"
          }
          style={{ marginBottom: 12 }}
        />
      )}
      <label className="pkg-field">
        <span>名称</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如 4 位行波加法器" />
      </label>
      <label className="pkg-field">
        <span>说明</span>
        <Input.TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="这个封装对外做什么，一两句话"
        />
      </label>
      <div className="pkg-ports">
        <div className="pkg-ports-head">端口（{manifest.interface.length}）</div>
        {manifest.interface.map((p) => (
          <div className="pkg-port" key={p.name}>
            <Tag color={p.dir === "in" ? "blue" : "purple"}>{p.dir === "in" ? "入" : "出"}</Tag>
            <span className="pkg-port-name">{labels.get(p.name) ?? p.name}</span>
            <span className="pkg-port-bits">{p.width} bit</span>
            <Input
              size="small"
              value={ports[p.name] ?? ""}
              onChange={(e) => setPorts({ ...ports, [p.name]: e.target.value })}
              placeholder="这个引脚的含义"
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
