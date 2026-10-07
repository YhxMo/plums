import { Ajv, type ValidateFunction } from "ajv";
import semver from "semver";
import type { SettingSpec } from "./types.js";

export const ID_PATTERN = "^[a-z0-9]+([._-][a-z0-9]+)*$";
export const FORMAT_VERSION_PATTERN = "^[1-9][0-9]*\\.[0-9]+$";
const SEMVER_PATTERN =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$";

const nonEmptyString = { type: "string", minLength: 1 } as const;

/**
 * The envelope schema. It deliberately does not set `additionalProperties: false`
 * so unknown fields survive an import and export round trip.
 */
const MANIFEST_SCHEMA = {
  type: "object",
  required: [
    "formatVersion",
    "kind",
    "id",
    "name",
    "version",
    "description",
    "dependencies",
    "permissions",
    "payload",
  ],
  properties: {
    formatVersion: { type: "string", pattern: FORMAT_VERSION_PATTERN },
    kind: { enum: ["character", "extension", "connector"] },
    id: { type: "string", minLength: 1, maxLength: 64, pattern: ID_PATTERN },
    name: nonEmptyString,
    version: { type: "string", pattern: SEMVER_PATTERN },
    description: { type: "string" },
    payload: {},
    license: nonEmptyString,
    author: nonEmptyString,
    dependencies: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "id", "range"],
        properties: {
          kind: { enum: ["extension", "connector"] },
          id: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            pattern: ID_PATTERN,
          },
          range: { type: "string", minLength: 1, format: "semver-range" },
          optional: { type: "boolean" },
        },
      },
    },
    permissions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "level", "target", "reason"],
        properties: {
          id: nonEmptyString,
          level: { enum: ["read", "write", "egress"] },
          target: nonEmptyString,
          reason: nonEmptyString,
        },
      },
    },
    settingsSchema: {
      type: "object",
      required: ["type", "properties"],
      properties: {
        type: { const: "object" },
        properties: {
          type: "object",
          additionalProperties: {
            type: "object",
            // Why these three: a setting needs a type to check, a title to label it, and a description to explain it.
            required: ["type", "title", "description"],
            properties: {
              type: { enum: ["string", "number", "integer", "boolean"] },
              title: { type: "string" },
              description: { type: "string" },
              // Why open: the default is judged later against this property's type and bounds, not as a free-form blob here.
              default: {},
              // Why a number: a bound that is not a number is not a bound.
              minimum: { type: "number" },
              maximum: { type: "number" },
              // Why a list: enum is the set of allowed values; membership is checked when the default or a saved value is judged.
              enum: { type: "array", minItems: 1 },
              "x-secret": { type: "boolean" },
            },
          },
        },
        required: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export const SERVICE_NAME_PATTERN = "^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$";
const namedList = {
  type: "array",
  minItems: 1,
  uniqueItems: true,
  items: nonEmptyString,
} as const;

/** Keep the common envelope and JSON representation; dispatch only the permissions schema. */
const MANIFEST_V2_SCHEMA = {
  ...MANIFEST_SCHEMA,
  properties: {
    ...MANIFEST_SCHEMA.properties,
    permissions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "kind", "target", "reason"],
        properties: {
          id: nonEmptyString,
          kind: {
            enum: ["fs", "exec", "egress", "service", "engine", "resource"],
          },
          target: nonEmptyString,
          reason: nonEmptyString,
        },
        allOf: [
          {
            if: {
              required: ["kind"],
              properties: { kind: { const: "resource" } },
            },
            then: {
              required: ["operations"],
              properties: {
                target: { enum: ["agent", "shared", "business"] },
                operations: {
                  type: "array",
                  minItems: 1,
                  uniqueItems: true,
                  items: { enum: ["read", "write", "delete"] },
                },
              },
            },
          },
          {
            if: {
              required: ["kind"],
              properties: { kind: { const: "engine" } },
            },
            then: {
              properties: { target: { type: "string", pattern: ID_PATTERN } },
            },
          },
          {
            if: {
              required: ["kind"],
              properties: { kind: { const: "service" } },
            },
            then: {
              required: ["operations"],
              properties: {
                target: { type: "string", pattern: SERVICE_NAME_PATTERN },
                operations: {
                  type: "array",
                  minItems: 1,
                  uniqueItems: true,
                  items: { type: "string", pattern: SERVICE_NAME_PATTERN },
                },
              },
            },
          },
          {
            if: { required: ["kind"], properties: { kind: { const: "fs" } } },
            then: {
              required: ["operations"],
              properties: {
                operations: {
                  type: "array",
                  minItems: 1,
                  uniqueItems: true,
                  items: { enum: ["read", "write", "list"] },
                },
              },
            },
          },
          {
            if: { required: ["kind"], properties: { kind: { const: "exec" } } },
            then: {
              required: ["cwdRoots"],
              properties: { cwdRoots: namedList },
            },
          },
        ],
      },
    },
  },
} as const;

const valueAjv = new Ajv({ allErrors: true, strict: false });
const SETTING_CACHE_SIZE = 256;
const MAX_CACHED_SETTING_BYTES = 16 * 1024;
const settingValidators = new Map<string, ValidateFunction>();

function settingValidator(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  let validate = settingValidators.get(key);
  if (validate !== undefined) {
    settingValidators.delete(key);
    settingValidators.set(key, validate);
    return validate;
  }
  // Own the enum array and nested values so callers cannot mutate a cached validator.
  const snapshot = JSON.parse(key) as Record<string, unknown>;
  try {
    validate = valueAjv.compile(snapshot);
  } finally {
    // Compiled functions retain what they need; Ajv must not keep an unbounded second cache.
    valueAjv.removeSchema(snapshot);
  }
  if (Buffer.byteLength(key) <= MAX_CACHED_SETTING_BYTES) {
    settingValidators.set(key, validate);
    if (settingValidators.size > SETTING_CACHE_SIZE) {
      settingValidators.delete(settingValidators.keys().next().value!);
    }
  }
  return validate;
}

export type SettingValueFailure = "TYPE" | "MINIMUM" | "MAXIMUM" | "ENUM";

/**
 * Judges one value against a setting.
 * `constraints` is false for the first pass (type only) and true after defaults are filled.
 * Why Ajv: the same keywords that describe the property (`type`, `minimum`, `maximum`, `enum`) judge the value.
 * Why strict is off: an enum may list values of the declared type only, and strict mode rejects some of those schemas at compile time.
 */
export function settingValueFailure(
  spec: SettingSpec,
  value: unknown,
  constraints: boolean,
): SettingValueFailure | undefined {
  const schema: Record<string, unknown> = { type: spec.type };
  if (constraints) {
    if (spec.minimum !== undefined) schema.minimum = spec.minimum;
    if (spec.maximum !== undefined) schema.maximum = spec.maximum;
    if (spec.enum !== undefined) schema.enum = spec.enum;
  }
  const validate = settingValidator(schema);
  const ok = validate(value);
  if (ok) return undefined;
  const keywords = new Set(
    (validate.errors ?? []).map((error) => error.keyword),
  );
  // Why this order: a type mismatch is decided before a bound, which is the order setSettings uses across fields.
  if (keywords.has("type")) return "TYPE";
  if (keywords.has("minimum")) return "MINIMUM";
  if (keywords.has("maximum")) return "MAXIMUM";
  if (keywords.has("enum")) return "ENUM";
  return "TYPE";
}

const compiled = new Map<1 | 2, ValidateFunction>();

export function manifestValidator(major: 1 | 2): ValidateFunction {
  let validate = compiled.get(major);
  if (validate === undefined) {
    const ajv = new Ajv({ allErrors: false, strict: true });
    ajv.addFormat("semver-range", {
      type: "string",
      validate: (value: string) => semver.validRange(value) !== null,
    });
    validate = ajv.compile(major === 2 ? MANIFEST_V2_SCHEMA : MANIFEST_SCHEMA);
    compiled.set(major, validate);
  }
  return validate;
}
