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
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function valid(field: ConfigurationField, value: unknown) {
  if (field.type === "string")
    return typeof value === "string" && value.length <= field.maxLength;
  if (field.type === "number")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= field.min &&
      value <= field.max
    );
  return field.type === "boolean" && typeof value === "boolean";
}
export function validateConfigurationDeclaration(
  value: unknown,
): asserts value is ConfigurationDeclaration | undefined {
  if (value === undefined) return;
  if (
    !object(value) ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1 ||
    !object(value.fields)
  )
    throw Error("Invalid configuration declaration");
  for (const [key, candidate] of Object.entries(value.fields)) {
    if (
      !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) ||
      !object(candidate) ||
      typeof candidate.label !== "string" ||
      !candidate.label.trim()
    )
      throw Error("Invalid configuration field");
    const field = candidate as ConfigurationField;
    if (
      field.type === "string" &&
      (!Number.isSafeInteger(field.maxLength) ||
        field.maxLength < 1 ||
        field.maxLength > 4000)
    )
      throw Error("Invalid configuration string bound");
    if (
      field.type === "number" &&
      (!Number.isFinite(field.min) ||
        !Number.isFinite(field.max) ||
        field.min > field.max)
    )
      throw Error("Invalid configuration number bounds");
    if (!valid(field, field.default))
      throw Error("Invalid configuration default");
  }
}
export function resolveConfiguration(
  declaration: ConfigurationDeclaration | undefined,
  input: unknown,
): Configuration {
  validateConfigurationDeclaration(declaration);
  if (!declaration) {
    if (input !== undefined) throw Error("Extension declares no configuration");
    return { version: 1, values: Object.freeze({}) };
  }
  const fields = declaration.fields;
  if (
    input !== undefined &&
    (!object(input) ||
      input.version !== declaration.version ||
      !object(input.values))
  )
    throw Error(
      "Configuration version or shape is invalid; original preserved",
    );
  const values =
    input === undefined
      ? Object.fromEntries(
          Object.entries(fields).map(([key, field]) => [key, field.default]),
        )
      : (input as Configuration).values;
  if (Object.keys(values).some((key) => !Object.hasOwn(fields, key)))
    throw Error("Unknown configuration field");
  for (const [key, field] of Object.entries(fields))
    if (!Object.hasOwn(values, key) || !valid(field, values[key]))
      throw Error(`Invalid configuration value: ${key}`);
  return { version: declaration.version, values: Object.freeze({ ...values }) };
}
