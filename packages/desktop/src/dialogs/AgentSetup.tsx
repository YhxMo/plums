import { ProtocolBindings } from "../components/ProtocolBindings.js";
import { LocalPermissions } from "../components/LocalPermissions.js";
import { KindIcon } from "../components/KindIcon.js";
import { useState } from "react";
import { ManagedDialog } from "../managed-dialog.js";
import {
  SettingsFields,
  initialSettings,
  settingsChanged,
  settingsErrorField,
} from "../settings-fields.js";
import type { AgentRecord } from "@plumsjs/host";
import type { Resource } from "../shared/types.js";
import type { SettingsDescription } from "@plumsjs/core";
interface Props {
  record: AgentRecord;
  resources: Resource[];
  busy: boolean;
  error: string;
  errorPath?: string;
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
  errorPath = "",
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
  const [failedPackage, setFailedPackage] = useState<string>();
  const [saved, setSaved] = useState<Record<string, SettingsDescription>>({});
  const working = busy || submitting;
  const changed = configurable.filter((p) =>
    settingsChanged(
      saved[p.id] ?? p.settings,
      values[p.id] ?? {},
      secrets[p.id] ?? {},
    ),
  );
  const fields = (p: Resource, requiredOnly?: boolean) => (
    <SettingsFields
      settings={saved[p.id] ?? p.settings}
      values={values[p.id] ?? {}}
      secrets={secrets[p.id] ?? {}}
      requiredOnly={requiredOnly}
      errorField={
        failedPackage === p.id ? settingsErrorField(errorPath) : undefined
      }
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
                ? "开始使用"
                : "开始使用"}
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
      <p role="status" className={changed.length ? "notice" : "muted"}>
        {changed.length
          ? `${changed.length} 个组件有未保存的修改；开始使用时逐个保存，成功后再查看权限。`
          : "配置输入将先保存，再进入权限确认。"}
      </p>
      {failedPackage && error && (
        <p className="error-text">
          未保存：
          {resources.find((p) => p.id === failedPackage)?.name ?? "当前组件"}
          。请检查配置后重试。
        </p>
      )}
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {resources.some((p) => p.desktop?.protocols?.requires?.length) && (
        <ProtocolBindings
          key={record.instanceId}
          instanceId={record.instanceId}
          revision={resources}
        />
      )}
      <form
        id={`setup-${record.instanceId}`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (working) return;
          setSubmitting(true);
          setFailedPackage(undefined);
          try {
            for (const p of configurable) {
              try {
                await onSave(p.id, values[p.id] ?? {}, secrets[p.id] ?? {});
                // Preserve committed configuration when refreshing the manager fails.
                setSaved((old) => ({
                  ...old,
                  [p.id]: {
                    ...p.settings,
                    values: values[p.id] ?? {},
                    secrets: {
                      ...p.settings.secrets,
                      ...old[p.id]?.secrets,
                      ...Object.fromEntries(
                        Object.keys(secrets[p.id] ?? {}).map((key) => [
                          key,
                          true,
                        ]),
                      ),
                    },
                  },
                }));
                setSecrets((old) => ({ ...old, [p.id]: {} }));
              } catch (failure) {
                setFailedPackage(p.id);
                throw failure;
              }
            }
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
            {fields(
              p,
              p.desktop?.model || p.desktop?.connections?.length
                ? undefined
                : true,
            )}
            {!p.desktop?.model &&
              !p.desktop?.connections?.length &&
              Object.keys(p.settings.schema!.properties).some(
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
        {!configurable.length && (
          <p>此 Agent 没有必填设置。完成组件连接后可查看权限并启用。</p>
        )}
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
                    : "扩展 · 服务接入"}
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
      <LocalPermissions
        key={`permissions:${record.instanceId}`}
        record={record}
        resources={resources}
      />
    </ManagedDialog>
  );
}
