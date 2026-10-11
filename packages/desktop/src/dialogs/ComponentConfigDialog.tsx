import { useState } from "react";
import type { Resource } from "../shared/types.js";
import { ManagedDialog } from "../managed-dialog.js";
import {
  SettingsFields,
  initialSettings,
  settingsChanged,
  settingsErrorField,
} from "../settings-fields.js";
export function ComponentConfigDialog({
  resource,
  busy,
  error,
  errorPath = "",
  focusField,
  onClose,
  onSave,
}: {
  resource: Resource;
  busy: boolean;
  error: string;
  errorPath?: string;
  focusField?: string;
  onClose: () => void;
  onSave: (
    values: Record<string, unknown>,
    secrets: Record<string, string>,
  ) => void;
}) {
  const [values, setValues] = useState(initialSettings(resource.settings)),
    [secrets, setSecrets] = useState<Record<string, string>>({});
  const properties = resource.settings.schema?.properties ?? {};
  const dirty = settingsChanged(resource.settings, values, secrets);
  return (
    <ManagedDialog
      testId="config-dialog"
      label={`${resource.name} · 配置`}
      title={`${resource.name} · 配置`}
      footer={
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            form={`config-${resource.id}`}
            className="primary"
            disabled={busy}
          >
            保存设置
          </button>
        </div>
      }
      error={error}
      busy={busy}
      onClose={onClose}
    >
      <form
        id={`config-${resource.id}`}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(values, secrets);
        }}
      >
        <p role="status" className={dirty ? "notice" : "muted"}>
          {dirty
            ? "有未保存的修改。保存后才会应用，取消会放弃本次输入。"
            : "当前显示已保存的配置。"}
        </p>
        <SettingsFields
          settings={resource.settings}
          values={values}
          secrets={secrets}
          errorField={settingsErrorField(errorPath)}
          focusField={focusField}
          onValue={(key, value) =>
            setValues((old) => ({ ...old, [key]: value }))
          }
          onSecret={(key, value) =>
            setSecrets((old) => {
              const next = { ...old };
              if (value) next[key] = value;
              else delete next[key];
              return next;
            })
          }
        />
        {!Object.keys(properties).length && <p>此组件没有可配置的设置项。</p>}
      </form>
    </ManagedDialog>
  );
}
