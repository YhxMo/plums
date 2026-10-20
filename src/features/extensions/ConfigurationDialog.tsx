import { useState } from "react";
import type { Host } from "../../../modules/extension-host/host";
import type { ConfigurationValue } from "../../../modules/sdk/configuration";
import type { DialogFeedback } from "../../shell/controllers";
import { Dialog, DialogActions, DialogBody } from "../../components/Dialog";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Field, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
export function ConfigurationDialog({
  host,
  feedback,
  id: configuring,
  source,
  onClose,
  onSave,
}: {
  host: Pick<Host, "manifest" | "configuration">;
  feedback: DialogFeedback;
  id: string;
  source: HTMLElement | null;
  onClose(): void;
  onSave(values: Record<string, ConfigurationValue>): Promise<void>;
}) {
  const { busy } = feedback;
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
          void onSave(configDraft);
        }}
      >
        <DialogBody>
          <p className="text-muted-foreground">
            {configuring} ·
            仅填写普通配置，勿输入密钥或令牌。保存会先停用扩展；已启用的扩展随后重新启动。
          </p>
          {host.configuration(configuring).error && (
            <p className="text-destructive">
              原配置无效：{host.configuration(configuring).error}
              。下方展示默认值，确认保存会替换原配置；取消保留原值。
            </p>
          )}
          {Object.entries(host.manifest(configuring).configuration!.fields).map(
            ([key, field]) =>
              field.type === "boolean" ? (
                <Field key={key} orientation="horizontal">
                  <Checkbox
                    id={`config-${key}`}
                    checked={configDraft[key] === true}
                    onCheckedChange={(checked) =>
                      setConfigDraft({
                        ...configDraft,
                        [key]: checked === true,
                      })
                    }
                  />
                  <FieldLabel htmlFor={`config-${key}`}>
                    {field.label}
                  </FieldLabel>
                </Field>
              ) : (
                <Field key={key}>
                  <FieldLabel htmlFor={`config-${key}`}>
                    {field.label}
                  </FieldLabel>
                  <Input
                    id={`config-${key}`}
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
                </Field>
              ),
          )}
        </DialogBody>
        <DialogActions>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onClose()}
          >
            取消
          </Button>
          <Button disabled={busy}>保存并应用</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
