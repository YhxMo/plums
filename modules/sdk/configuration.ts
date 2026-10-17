import { ContractError } from "./errors";
import { object, string, oneOf } from "./validation";
export type ConfigurationValue = string | number | boolean;
export type ConfigurationField = { label: string } & (
  | { type: "string"; default: string; maxLength: number }
  | { type: "number"; default: number; min: number; max: number }
  | { type: "boolean"; default: boolean }
);
export type ConfigurationDeclaration = {
  version: number;
  fields: Record<string, ConfigurationField>;
};
export type Configuration = {
  version: number;
  values: Readonly<Record<string, ConfigurationValue>>;
};
function validateValue(
  field: ConfigurationField,
  value: unknown,
  path: string,
  label: string,
) {
  if (field.type === "string") {
    string(value, "extension.invalid", {
      path,
      max: field.maxLength,
      label,
    });
    return;
  }
  if (
    field.type === "number" &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= field.min &&
    value <= field.max
  )
    return;
  if (field.type === "boolean") {
    oneOf(value, "extension.invalid", [true, false], { path, label });
    return;
  }
  throw new ContractError("extension.invalid", path, label);
}
export function validateConfigurationDeclaration(
  value: unknown,
): asserts value is ConfigurationDeclaration | undefined {
  if (value === undefined) return;
  const declaration = object(value, "extension.invalid", {
    path: "configuration",
    label: "Invalid configuration declaration",
  });
  if (
    !Number.isSafeInteger(declaration.version) ||
    Number(declaration.version) < 1
  )
    throw new ContractError(
      "extension.invalid",
      "configuration.version",
      "Invalid configuration declaration",
    );
  const fields = object(declaration.fields, "extension.invalid", {
    path: "configuration.fields",
    label: "Invalid configuration declaration",
  });
  for (const [key, candidate] of Object.entries(fields)) {
    const path = `configuration.fields.${key}`;
    string(key, "extension.invalid", {
      path,
      pattern: /^[a-z][a-zA-Z0-9_]{0,63}$/,
      label: "Invalid configuration field",
    });
    const field = object(candidate, "extension.invalid", {
      path,
      label: "Invalid configuration field",
    }) as ConfigurationField;
    if (
      !string(field.label, "extension.invalid", {
        path: `${path}.label`,
        label: "Invalid configuration field",
      }).trim()
    )
      throw new ContractError(
        "extension.invalid",
        `${path}.label`,
        "Invalid configuration field",
      );
    if (
      field.type === "string" &&
      (!Number.isSafeInteger(field.maxLength) ||
        field.maxLength < 1 ||
        field.maxLength > 4000)
    )
      throw new ContractError(
        "extension.invalid",
        `${path}.maxLength`,
        "Invalid configuration string bound",
      );
    if (
      field.type === "number" &&
      (!Number.isFinite(field.min) ||
        !Number.isFinite(field.max) ||
        field.min > field.max)
    )
      throw new ContractError(
        "extension.invalid",
        path,
        "Invalid configuration number bounds",
      );
    validateValue(
      field,
      field.default,
      `${path}.default`,
      "Invalid configuration default",
    );
  }
}
export function resolveConfiguration(
  declaration: ConfigurationDeclaration | undefined,
  input: unknown,
): Configuration {
  validateConfigurationDeclaration(declaration);
  if (!declaration) {
    if (input !== undefined)
      throw new ContractError(
        "extension.invalid",
        "configuration",
        "Extension declares no configuration",
      );
    return { version: 1, values: Object.freeze({}) };
  }
  const fields = declaration.fields;
  let values: Record<string, unknown>;
  if (input === undefined) {
    values = Object.fromEntries(
      Object.entries(fields).map(([key, field]) => [key, field.default]),
    );
  } else {
    const candidate = object(input, "state.corrupt", {
      path: "configurations",
      label: "Configuration version or shape is invalid; original preserved",
    });
    if (candidate.version !== declaration.version)
      throw new ContractError(
        "state.corrupt",
        "configurations.version",
        "Configuration version or shape is invalid; original preserved",
      );
    values = object(candidate.values, "state.corrupt", {
      path: "configurations.values",
      label: "Configuration version or shape is invalid; original preserved",
    });
  }
  if (Object.keys(values).some((key) => !Object.hasOwn(fields, key)))
    throw new ContractError(
      "extension.invalid",
      "configuration.values",
      "Unknown configuration field",
    );
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(values, key))
      throw new ContractError(
        "extension.invalid",
        `configuration.values.${key}`,
        `Invalid configuration value: ${key}`,
      );
    validateValue(
      field,
      values[key],
      `configuration.values.${key}`,
      `Invalid configuration value: ${key}`,
    );
  }
  return {
    version: declaration.version,
    values: Object.freeze({ ...values }) as Configuration["values"],
  };
}
