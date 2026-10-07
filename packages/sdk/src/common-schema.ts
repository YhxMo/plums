const id = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
};
const version = { type: "string", pattern: "^1\\.(0|[1-9][0-9]*)$" };
const sequence = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
const features = { type: "array", maxItems: 64, uniqueItems: true, items: id };
const errors = [
  "INVALID_REQUEST",
  "INCOMPATIBLE",
  "UNBOUND",
  "STALE_BINDING",
  "NOT_AUTHORIZED",
  "POLICY_UNAVAILABLE",
  "CANCELLED",
  "DEADLINE_EXCEEDED",
  "RESOURCE_CONFLICT",
  "RESOURCE_NOT_FOUND",
  "REPLAY_GAP",
  "LIMIT_EXCEEDED",
  "PROVIDER_FAILED",
  "RUNTIME_UNAVAILABLE",
];
const properties = {
  commonVersion: version,
  callId: id,
  kind: { enum: ["invoke", "cancel", "accepted", "event", "result"] },
  binding: id,
  operation: id,
  input: {},
  timeoutMs: { type: "integer", minimum: 1, maximum: 3_600_000 },
  reason: { enum: ["user", "deadline", "owner_closed"] },
  sequence,
  taskId: id,
  channel: id,
  data: {},
  executionState: { enum: ["not_started", "unknown", "completed"] },
  outcome: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      value: {},
      error: {
        type: "object",
        properties: {
          code: { enum: errors },
          path: {
            type: "string",
            maxLength: 256,
            pattern: "^(?:/(?:[^~]|~[01])*)*$",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
    required: ["ok"],
    additionalProperties: true,
    allOf: [
      {
        if: { properties: { ok: { const: true } }, required: ["ok"] },
        then: { required: ["value"], not: { required: ["error"] } },
        else: { required: ["error"], not: { required: ["value"] } },
      },
    ],
  },
};
function branch(kind: string, required: string[], forbidden: string[]) {
  return {
    if: { properties: { kind: { const: kind } }, required: ["kind"] },
    then: {
      required,
      ...(forbidden.length
        ? { not: { anyOf: forbidden.map((k) => ({ required: [k] })) } }
        : {}),
    },
  };
}
/** Draft-07. Unknown fields are retained; recognized fields cannot change meaning. */
export const commonEnvelopeSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://plums.dev/schema/common-envelope-1.json",
  type: "object",
  properties,
  required: ["commonVersion", "callId", "kind"],
  additionalProperties: true,
  allOf: [
    branch(
      "invoke",
      ["binding", "operation", "input"],
      [
        "reason",
        "sequence",
        "taskId",
        "channel",
        "data",
        "executionState",
        "outcome",
      ],
    ),
    branch(
      "cancel",
      ["reason"],
      [
        "binding",
        "operation",
        "input",
        "timeoutMs",
        "sequence",
        "taskId",
        "channel",
        "data",
        "executionState",
        "outcome",
      ],
    ),
    branch(
      "accepted",
      ["sequence", "taskId"],
      [
        "binding",
        "operation",
        "input",
        "timeoutMs",
        "reason",
        "channel",
        "data",
        "executionState",
        "outcome",
      ],
    ),
    branch(
      "event",
      ["sequence", "channel", "data"],
      [
        "binding",
        "operation",
        "input",
        "timeoutMs",
        "reason",
        "taskId",
        "executionState",
        "outcome",
      ],
    ),
    branch(
      "result",
      ["sequence", "executionState", "outcome"],
      [
        "binding",
        "operation",
        "input",
        "timeoutMs",
        "reason",
        "taskId",
        "channel",
        "data",
      ],
    ),
    {
      if: {
        properties: {
          kind: { const: "result" },
          outcome: {
            type: "object",
            properties: { ok: { const: true } },
            required: ["ok"],
          },
        },
        required: ["kind", "outcome"],
      },
      then: { properties: { executionState: { const: "completed" } } },
    },
  ],
};
export const commonDeclarationSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://plums.dev/schema/common-declaration-1.json",
  type: "object",
  properties: {
    commonVersion: version,
    features,
    runtime: { enum: ["isolate", "controlled-node"] },
    background: { type: "boolean" },
    resources: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        properties: {
          id,
          permissionId: id,
          operations: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
            items: { enum: ["read", "write", "delete"] },
          },
          optional: { type: "boolean" },
        },
        required: ["id", "permissionId", "operations"],
        additionalProperties: true,
      },
    },
    policy: {
      type: "object",
      properties: { provideId: id },
      required: ["provideId"],
      additionalProperties: true,
    },
  },
  required: ["commonVersion", "features", "runtime"],
  additionalProperties: true,
};
export const commonPolicyDecisionSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://plums.dev/schema/common-policy-decision-1.json",
  type: "object",
  properties: {
    assessmentId: id,
    operationFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
    decision: { enum: ["allow", "deny", "confirm"] },
  },
  required: ["assessmentId", "operationFingerprint", "decision"],
  additionalProperties: false,
};
