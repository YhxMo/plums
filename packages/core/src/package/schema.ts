import { Ajv, type ValidateFunction } from "ajv";
import semver from "semver";

export const ID_PATTERN = "^[a-z0-9]+([._-][a-z0-9]+)*$";
export const FORMAT_VERSION_PATTERN = "^[1-9][0-9]*\\.[0-9]+$";
const SEMVER_PATTERN =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$";

const nonEmptyString = { type: "string", minLength: 1 } as const;

/**
 * The envelope schema. It deliberately does not set `additionalProperties: false`
 * so unknown fields survive an import and export round trip.
 */
export const MANIFEST_SCHEMA = {
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
          id: { type: "string", minLength: 1, maxLength: 64, pattern: ID_PATTERN },
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
            required: ["type"],
            properties: {
              type: { enum: ["string", "number", "integer", "boolean"] },
              title: { type: "string" },
              description: { type: "string" },
              "x-secret": { type: "boolean" },
            },
          },
        },
        required: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

let compiled: ValidateFunction | undefined;

export function manifestValidator(): ValidateFunction {
  if (compiled === undefined) {
    const ajv = new Ajv({ allErrors: false, strict: true });
    ajv.addFormat("semver-range", {
      type: "string",
      validate: (value: string) => semver.validRange(value) !== null,
    });
    compiled = ajv.compile(MANIFEST_SCHEMA);
  }
  return compiled;
}
