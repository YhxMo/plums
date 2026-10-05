import { useState } from "react";
import type { Resource } from "../shared/types.js";
import { ManagedDialog } from "../managed-dialog.js";
import { SettingsFields, initialSettings } from "../settings-fields.js";
export function ComponentConfigDialog({
  resource,
  busy,
  error,
  onClose,
  onSave,
}: {
  resource: Resource;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (
    values: Record<string, unknown>,
    secrets: Record<string, string>,
  ) => void;
}) {
  const [values, setValues] = useState(initialSettings(resource.settings)),
    [secrets, setSecrets] = useState<Record<string, string>>({});
  const properties = resource.settings.schema?.properties ?? {};
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
        <SettingsFields
          settings={resource.settings}
          values={values}
          secrets={secrets}
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
