const id = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
};
const revision = { type: "string", pattern: "^1\\.(0|[1-9][0-9]*)$" };
const features = { type: "array", maxItems: 64, uniqueItems: true, items: id };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const sdk = object({ id, version: { type: "string", maxLength: 128 } }, [
  "id",
  "version",
]);
const schema = (name: string, body: object) => ({
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: `https://plums.dev/schema/foundation-${name}-1.json`,
  ...body,
});
export const foundationProviderSchema = schema(
  "provider",
  object(
    {
      declarationVersion: revision,
      id: { ...id, pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)+$" },
      foundationVersion: revision,
      entry: { type: "string", minLength: 1, maxLength: 255 },
      execution: { enum: ["controlled-node", "builtin-adapter"] },
      platforms: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
        items: id,
      },
      features,
      hostFeatures: features,
      dataFormats: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 128 },
      },
      sdks: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: object(
          {
            id,
            range: { type: "string", minLength: 1, maxLength: 128 },
            features,
            featureRanges: {
              type: "array",
              maxItems: 32,
              items: object(
                {
                  range: { type: "string", minLength: 1, maxLength: 128 },
                  features,
                },
                ["range", "features"],
              ),
            },
          },
          ["id", "range", "features"],
        ),
      },
    },
    [
      "declarationVersion",
      "id",
      "foundationVersion",
      "entry",
      "execution",
      "platforms",
      "features",
      "hostFeatures",
      "sdks",
    ],
  ),
);
export const foundationRequirementSchema = schema(
  "requirement",
  object(
    {
      requirementVersion: revision,
      protocolRange: { type: "string", minLength: 1, maxLength: 128 },
      sdk,
      features,
      optionalFeatures: features,
      providerId: id,
    },
    ["requirementVersion", "protocolRange", "sdk", "features"],
  ),
);
export const foundationSelectionSchema = schema(
  "selection",
  object(
    {
      selectionVersion: revision,
      source: { enum: ["builtin", "library"] },
      id,
      version: { type: "string", maxLength: 128 },
      digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    },
    ["selectionVersion", "source", "id", "version", "digest"],
  ),
);
/** Schemas preserve unknown fields. Semantic entry/range/version checks also apply. */
export const foundationAgentSchema = schema("agent", {
  ...object(
    {
      requirement: foundationRequirementSchema,
      selection: foundationSelectionSchema,
    },
    [],
  ),
  anyOf: [{ required: ["requirement"] }, { required: ["selection"] }],
});
const methods = [
  "settings",
  "context",
  "capability",
  "connection",
  "invoke",
  "character",
  "characters",
  "emit",
  "mcpCheck",
  "failResponse",
  "resource.list",
  "resource.read",
  "resource.write",
  "resource.delete",
  "protocol.status",
  "protocol.invoke",
  "common.describe",
  "common.bindings",
  "common.invoke",
  "common.tasks.create",
  "common.tasks.status",
  "common.tasks.list",
  "common.tasks.cancel",
  "common.policy.status",
];
export const FOUNDATION_CALLBACK_METHODS = methods as readonly string[];
/** Provider to host messages; authority fields are never provider-supplied. */
export const foundationMessageSchema = schema("message", {
  type: "object",
  properties: {
    foundationVersion: revision,
    sessionId: id,
    type: { enum: ["ready", "activated", "callback", "result", "fatal"] },
  },
  required: ["foundationVersion", "sessionId", "type"],
  additionalProperties: true,
  allOf: [
    ...[
      "binding",
      "agentId",
      "componentId",
      "installationId",
      "instanceId",
      "callers",
      "ancestry",
      "executionState",
      "context",
    ].map((k) => ({ not: { required: [k] } })),
    ...[
      ["ready", object({ sdk, features }, ["sdk", "features"])],
      ["activated", object({}, [])],
      [
        "callback",
        object(
          {
            callId: id,
            callbackId: id,
            method: { enum: methods },
            args: { type: "object" },
          },
          ["callId", "callbackId", "method", "args"],
        ),
      ],
      [
        "result",
        object({ callId: id, ok: { type: "boolean" }, value: {} }, [
          "callId",
          "ok",
          "value",
        ]),
      ],
      ["fatal", object({}, [])],
    ].map(([type, then]) => ({
      if: { properties: { type: { const: type } }, required: ["type"] },
      then,
    })),
  ],
});
