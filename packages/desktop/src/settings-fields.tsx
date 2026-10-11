import type { SettingsDescription } from "@plumsjs/core";
import { useEffect, useId, useRef } from "react";

export function settingsErrorField(path: string) {
  const match = /^\/settings\/([^/]+)$/.exec(path);
  return match?.[1]?.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function settingsChanged(
  settings: SettingsDescription,
  values: Record<string, unknown>,
  secrets: Record<string, string>,
) {
  const initial = initialSettings(settings);
  return (
    Object.keys(secrets).length > 0 ||
    [...new Set([...Object.keys(initial), ...Object.keys(values)])].some(
      (key) => initial[key] !== values[key],
    )
  );
}

export function initialSettings(settings: SettingsDescription) {
  const values = { ...settings.values };
  for (const [key, spec] of Object.entries(settings.schema?.properties ?? {}))
    if (
      spec.type === "boolean" &&
      settings.schema?.required?.includes(key) &&
      values[key] === undefined
    )
      values[key] = false;
  return values;
}
export function SettingsFields({
  settings,
  values,
  secrets,
  onValue,
  onSecret,
  requiredOnly,
  errorField,
  focusField,
}: {
  settings: SettingsDescription;
  values: Record<string, unknown>;
  secrets: Record<string, string>;
  onValue: (key: string, value: unknown) => void;
  onSecret: (key: string, value: string) => void;
  requiredOnly?: boolean;
  errorField?: string;
  focusField?: string;
}) {
  const id = useId();
  const fields = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = errorField ?? focusField;
    if (!key) return;
    let current = true;
    // Let ManagedDialog capture the invoking control before selecting a field.
    queueMicrotask(() => {
      if (!current) return;
      const field = Array.from(
        fields.current?.querySelectorAll<HTMLElement>("[data-setting-key]") ??
          [],
      ).find((el) => el.dataset.settingKey === key);
      const details = field?.closest("details");
      if (details) details.open = true;
      field?.querySelector<HTMLElement>("input, select")?.focus();
    });
    return () => {
      current = false;
    };
  }, [errorField, focusField]);
  return (
    <div ref={fields}>
      {Object.entries(settings.schema?.properties ?? {})
        .filter(
          ([key]) =>
            requiredOnly === undefined ||
            (settings.schema?.required?.includes(key) ?? false) ===
              requiredOnly,
        )
        .map(([key, spec]) => {
          const required = settings.schema?.required?.includes(key) ?? false;
          const title = spec.title || key;
          const invalid = errorField === key;
          const descriptionId = `${id}-${encodeURIComponent(key)}-description`;
          const errorId = `${id}-${encodeURIComponent(key)}-error`;
          const a11y = {
            "aria-invalid": invalid || undefined,
            "aria-describedby":
              [spec.description ? descriptionId : "", invalid ? errorId : ""]
                .filter(Boolean)
                .join(" ") || undefined,
          };
          return (
            <label className="field" key={key} data-setting-key={key}>
              <strong>
                {title}
                {required && <span className="required-mark"> *</span>}
              </strong>
              {spec.description && (
                <small id={descriptionId}>{spec.description}</small>
              )}
              {spec["x-secret"] ? (
                <input
                  {...a11y}
                  aria-label={title}
                  type="password"
                  autoComplete="new-password"
                  required={required && !settings.secrets[key]}
                  value={secrets[key] ?? ""}
                  placeholder={
                    settings.secrets[key]
                      ? "已配置，留空保持原值"
                      : "输入 API Key 或其他凭据"
                  }
                  onChange={(e) => onSecret(key, e.target.value)}
                />
              ) : spec.type === "boolean" ? (
                <input
                  {...a11y}
                  aria-label={title}
                  type="checkbox"
                  checked={values[key] === true}
                  onChange={(e) => onValue(key, e.target.checked)}
                />
              ) : spec.enum ? (
                <select
                  {...a11y}
                  aria-label={title}
                  required={required}
                  value={String(values[key] ?? "")}
                  onChange={(e) =>
                    onValue(
                      key,
                      spec.enum!.find((x) => String(x) === e.target.value),
                    )
                  }
                >
                  <option value="">请选择</option>
                  {spec.enum.map((x) => (
                    <option key={String(x)} value={String(x)}>
                      {String(x)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  {...a11y}
                  aria-label={title}
                  type={spec.type === "string" ? "text" : "number"}
                  autoComplete="off"
                  step={spec.type === "integer" ? 1 : "any"}
                  min={spec.minimum}
                  max={spec.maximum}
                  minLength={
                    typeof spec.minLength === "number"
                      ? spec.minLength
                      : undefined
                  }
                  maxLength={
                    typeof spec.maxLength === "number"
                      ? spec.maxLength
                      : undefined
                  }
                  required={required}
                  value={String(values[key] ?? "")}
                  onChange={(e) =>
                    onValue(
                      key,
                      spec.type === "string"
                        ? e.target.value
                        : e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                    )
                  }
                />
              )}
              {invalid && (
                <small id={errorId} className="error-text">
                  请检查此设置项后重新保存。
                </small>
              )}
            </label>
          );
        })}
    </div>
  );
}
