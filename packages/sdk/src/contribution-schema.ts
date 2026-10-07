import { Ajv, type ValidateFunction } from "ajv";
import { PlumsError, IMPORT_INVALID, CAPABILITY_FAILED } from "@plums/core";

// Draft-07, synchronous local schemas. No coercion, defaults or remote loading.
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: false });
const cache = new Map<string, ValidateFunction>();
function compile(schema: unknown): ValidateFunction {
  const key = JSON.stringify(schema);
  if (!key || Buffer.byteLength(key) > 64 * 1024) throw Error();
  const visit = (v: unknown, depth = 0): void => {
    if (depth > 32) throw Error();
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    for (const [k, item] of Object.entries(v)) {
      if (
        ["$async", "pattern", "patternProperties", "format"].includes(k) ||
        (k === "$ref" && (typeof item !== "string" || !item.startsWith("#/")))
      )
        throw Error();
      if (
        ["properties", "definitions", "$defs", "dependencies"].includes(k) &&
        item &&
        typeof item === "object"
      ) {
        for (const child of Object.values(item))
          if (!Array.isArray(child)) visit(child, depth + 1);
      } else if (
        !["enum", "const", "default", "examples", "required"].includes(k)
      )
        visit(item, depth + 1);
    }
  };
  visit(schema);
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  let validate: ValidateFunction;
  try {
    validate = ajv.compile(JSON.parse(key));
  } finally {
    ajv.removeSchema();
  }
  cache.set(key, validate);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  return validate;
}
export function validateContributionSchema(
  schema: unknown,
  path: string,
): void {
  try {
    compile(schema);
  } catch {
    throw new PlumsError({
      code: IMPORT_INVALID,
      message: "贡献 schema 必须是有效的本地 Draft-07 JSON Schema。",
      path,
      details: { reason: "CONTRIBUTION_SCHEMA_INVALID" },
    });
  }
}
export function validateContributionValue(
  schema: unknown,
  value: unknown,
  phase: "input" | "output",
): void {
  let valid = false;
  try {
    valid = compile(schema)(value) === true;
  } catch {
    /* fail closed without rejected values */
  }
  if (!valid)
    throw new PlumsError({
      code: CAPABILITY_FAILED,
      message:
        phase === "input"
          ? "输入不符合组件协议。"
          : "组件已执行，但返回结果不符合协议；请核对状态后再操作。",
      path: `/${phase}`,
      details: {
        reason:
          phase === "input"
            ? "CONTRIBUTION_INPUT_INVALID"
            : "CONTRIBUTION_OUTPUT_INVALID",
        phase,
        executionState: phase === "input" ? "not_started" : "completed",
      },
    });
}
