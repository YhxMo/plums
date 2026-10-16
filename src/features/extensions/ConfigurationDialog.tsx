import { useState } from "react";
import type { Runtime } from "../../shell/runtime";
import type { ShellOperations } from "../../shell/useOperations";
import { Dialog } from "../../components/Dialog";
import type { ConfigurationValue } from "../../../modules/sdk/configuration";
import { saveConfiguration } from "../../../modules/shell/configuration";
export function ConfigurationDialog({
  runtime,
  operations,
  id: configuring,
  source,
  onClose,
}: {
  runtime: Runtime;
  operations: ShellOperations;
  id: string;
  source: HTMLElement | null;
  onClose: () => void;
}) {
  const { host } = runtime;
  const { busy, error, operate, setNotice } = operations;
  const [configDraft, setConfigDraft] = useState<
    Record<string, ConfigurationValue>
  >(() => ({ ...host.configuration(configuring).value.values }));
  return (
    <Dialog
      title="扩展配置"
      returnFocusTo={source}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void operate(async () => {
            const id = configuring;
            await saveConfiguration(
              host,
              id,
              {
                version: host.manifest(id).configuration!.version,
                values: configDraft,
              },
              async (value) => {
                const configurations = Object.assign(
                  Object.create(null),
                  runtime.configurations,
                  { [id]: value },
                );
                await runtime.save({ configurations });
                runtime.configurations = configurations;
              },
            );
            onClose();
            setNotice("配置已保存并应用；未启用的扩展保持停用。");
          });
        }}
      >
        <div className="dialog-content">
          <p>
            {configuring} ·
            仅填写普通配置，勿输入密钥或令牌。保存会先停用扩展；已启用的扩展随后重新启动。
          </p>
          {host.configuration(configuring).error && (
            <p className="error">
              原配置无效：{host.configuration(configuring).error}
              。下方展示默认值，确认保存会替换原配置；取消保留原值。
            </p>
          )}
          {Object.entries(host.manifest(configuring).configuration!.fields).map(
            ([key, field]) => (
              <label
                className={field.type === "boolean" ? "check-field" : "field"}
                key={key}
              >
                {field.label}
                {field.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={configDraft[key] === true}
                    onChange={(event) =>
                      setConfigDraft({
                        ...configDraft,
                        [key]: event.target.checked,
                      })
                    }
                  />
                ) : (
                  <input
                    type={field.type === "number" ? "number" : "text"}
                    required={field.type === "number"}
                    step={field.type === "number" ? "any" : undefined}
                    min={field.type === "number" ? field.min : undefined}
                    max={field.type === "number" ? field.max : undefined}
                    maxLength={
                      field.type === "string" ? field.maxLength : undefined
                    }
                    value={String(configDraft[key] ?? "")}
                    onChange={(event) =>
                      setConfigDraft({
                        ...configDraft,
                        [key]:
                          field.type === "number" && event.target.value !== ""
                            ? Number(event.target.value)
                            : event.target.value,
                      })
                    }
                  />
                )}
              </label>
            ),
          )}
          {error && (
            <p className="error" role="alert">
              配置操作未完成：{error}
              。扩展可能已停用，配置可能已保存；重载确认或修复后重新启用。
            </p>
          )}
        </div>
        <footer className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => onClose()}
          >
            取消
          </button>
          <button disabled={busy}>保存并应用</button>
        </footer>
      </form>
    </Dialog>
  );
}
