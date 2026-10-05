import { KindIcon } from "../components/KindIcon.js";
import { useState } from "react";
import { ManagedDialog } from "../managed-dialog.js";
import { SettingsFields, initialSettings } from "../settings-fields.js";
import type { AgentRecord } from "@plums/host";
import type { Resource } from "../shared/types.js";
interface Props {
  record: AgentRecord;
  resources: Resource[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onStart: () => Promise<void>;
  onSave: (
    id: string,
    values: Record<string, unknown>,
    secrets: Record<string, string>,
  ) => Promise<void>;
  onEdit: () => void;
}
export function AgentSetup({
  record,
  resources,
  busy,
  error,
  onClose,
  onStart,
  onSave,
  onEdit,
}: Props) {
  const configurable = resources.filter(
      (p) =>
        p.settings.schema && Object.keys(p.settings.schema.properties).length,
    ),
    [values, setValues] = useState<Record<string, Record<string, unknown>>>(
      () =>
        Object.fromEntries(
          configurable.map((p) => [p.id, initialSettings(p.settings)]),
        ),
    ),
    [secrets, setSecrets] = useState<Record<string, Record<string, string>>>(
      {},
    );
  const [submitting, setSubmitting] = useState(false);
  const working = busy || submitting;
  const fields = (p: Resource, requiredOnly: boolean) => (
    <SettingsFields
      settings={p.settings}
      values={values[p.id] ?? {}}
      secrets={secrets[p.id] ?? {}}
      requiredOnly={requiredOnly}
      onValue={(key, value) =>
        setValues((old) => ({ ...old, [p.id]: { ...old[p.id], [key]: value } }))
      }
      onSecret={(key, value) =>
        setSecrets((old) => {
          const next = { ...old[p.id] };
          if (value) next[key] = value;
          else delete next[key];
          return { ...old, [p.id]: next };
        })
      }
    />
  );
  return (
    <ManagedDialog
      testId="setup-dialog"
      className="setup-modal"
      label={`设置 ${record.name}`}
      title={`配置 ${record.name}`}
      busy={working}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button type="button" disabled={working} onClick={onClose}>
            稍后配置
          </button>
          <button
            type="submit"
            form={`setup-${record.instanceId}`}
            className="primary"
            disabled={working}
          >
            {working
              ? "正在准备…"
              : configurable.length
                ? "保存并启用"
                : "启用并打开"}
          </button>
        </div>
      }
    >
      <ol className="setup-progress" aria-label="使用步骤">
        <li className="done">
          <span>✓</span>导入
        </li>
        <li className="current" aria-current="step">
          <span>2</span>配置
        </li>
        <li>
          <span>3</span>开始
        </li>
      </ol>
      <p>完成配置，统一查看所需组件的权限，然后打开工作界面。</p>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <form
        id={`setup-${record.instanceId}`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (working) return;
          setSubmitting(true);
          try {
            for (const p of configurable)
              await onSave(p.id, values[p.id] ?? {}, secrets[p.id] ?? {});
            await onStart();
          } catch {
            // The manager displays the sanitized host error and keeps this form open.
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {configurable.map((p) => (
          <section className="setup-section" key={p.id}>
            <h3 className="setup-group-title">
              <KindIcon kind={p.kind} size={24} />
              {p.name}
            </h3>
            {fields(p, true)}
            {Object.keys(p.settings.schema!.properties).some(
              (key) => !p.settings.schema!.required?.includes(key),
            ) && (
              <details
                open={Object.keys(p.settings.schema!.properties).some(
                  (key) =>
                    !!p.settings.schema!.required?.length &&
                    /endpoint|url|baseurl/i.test(key),
                )}
              >
                <summary>接口地址与其他设置</summary>
                {fields(p, false)}
              </details>
            )}
          </section>
        ))}
        {!configurable.length && <p>此 Agent 没有必填配置，可以直接启用。</p>}
        <details className="setup-components">
          <summary>统一启用 {resources.length} 个组件</summary>
          <ul>
            {resources.map((p) => (
              <li key={p.id}>
                {p.name} ·{" "}
                {p.kind === "character"
                  ? "角色卡"
                  : p.kind === "extension"
                    ? "扩展"
                    : "连接器"}
                {p.enabled ? " · 已启用" : ""}
              </li>
            ))}
          </ul>
          <p>已启用的组件保持原状态；之后可以在管理页单独停用。</p>
        </details>
        {!record.agent.startup && (
          <p>
            尚未选择工作界面。
            <button type="button" className="ghost" onClick={onEdit}>
              选择工作界面
            </button>
          </p>
        )}
      </form>
    </ManagedDialog>
  );
}
