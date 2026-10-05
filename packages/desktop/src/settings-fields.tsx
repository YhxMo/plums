import type { SettingsDescription } from "@plums/core";

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
}: {
  settings: SettingsDescription;
  values: Record<string, unknown>;
  secrets: Record<string, string>;
  onValue: (key: string, value: unknown) => void;
  onSecret: (key: string, value: string) => void;
  requiredOnly?: boolean;
}) {
  return (
    <>
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
          return (
            <label className="field" key={key}>
              <strong>
                {title}
                {required && <span className="required-mark"> *</span>}
              </strong>
              {spec.description && <small>{spec.description}</small>}
              {spec["x-secret"] ? (
                <input
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
                  aria-label={title}
                  type="checkbox"
                  checked={values[key] === true}
                  onChange={(e) => onValue(key, e.target.checked)}
                />
              ) : spec.enum ? (
                <select
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
            </label>
          );
        })}
    </>
  );
}
