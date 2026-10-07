import { expect, it, vi } from "vitest";
import { CAPABILITY_FAILED, PlumsError } from "@plums/core";
import {
  parseCommonEnvelope,
  parseCommonDeclaration,
  parseCommonPolicyDecision,
  negotiateCommonContract,
  CommonReplyTracker,
  checkProtocolCompatibility,
  validateContributionValue,
  type CommonEnvelope,
  type CommonDeclaration,
  type CommonPlatformSdk,
} from "../src/index.js";

const invoke: CommonEnvelope = {
  commonVersion: "1.0",
  kind: "invoke",
  callId: "call-1",
  binding: "opaque-1",
  operation: "find",
  input: { arbitrary: [1, null, { author: "fixture" }] },
};
const declaration: CommonDeclaration = {
  commonVersion: "1.0",
  features: ["resources-cas", "events"],
  runtime: "controlled-node",
  resources: [
    {
      id: "records",
      permissionId: "resource-permission",
      operations: ["read", "write"],
    },
  ],
};
it("preserves common declaration validation after schema mutation before and after first use", async () => {
  vi.resetModules();
  const api = await import("../src/common-contract.js");
  const { commonDeclarationSchema } = await import("../src/common-schema.js");
  const schema = commonDeclarationSchema as any;
  const original = schema.properties.runtime.enum;
  try {
    schema.properties.runtime.enum = [...original, "shell"];
    expect(() =>
      api.parseCommonDeclaration({ ...declaration, runtime: "shell" }),
    ).toThrow();
    expect(api.parseCommonDeclaration(declaration)).toEqual(declaration);
    schema.properties.runtime.enum = ["shell"];
    expect(api.parseCommonDeclaration(declaration)).toEqual(declaration);
    expect(() =>
      api.parseCommonDeclaration({ ...declaration, runtime: "shell" }),
    ).toThrow();
  } finally {
    schema.properties.runtime.enum = original;
  }
});
function rejected(value: unknown) {
  try {
    parseCommonEnvelope(value);
    throw Error("accepted");
  } catch (error) {
    expect(error).toBeInstanceOf(PlumsError);
    expect((error as PlumsError).code).toBe(CAPABILITY_FAILED);
    expect(JSON.stringify(error)).not.toContain("private-fixture-secret");
  }
}
it("copies opaque custom protocol data and unknown fields without granting identity", () => {
  const input = {
    ...invoke,
    commonVersion: "1.3",
    authorExtension: { custom: true },
    actor: { agentId: "forged" },
  };
  const parsed = parseCommonEnvelope(input);
  expect(parsed).toEqual(input);
  input.actor.agentId = "changed";
  expect(parsed.actor).toEqual({ agentId: "forged" });
  // Shape validation deliberately does not trust any actor field or create a binding.
});
it.each(["2.0", "1.01", "1.-1", "1.0.0"])(
  "rejects incompatible or malformed transport version %s",
  (commonVersion) => rejected({ ...invoke, commonVersion }),
);
it.each([
  { kind: "invoke", input: undefined },
  { kind: "cancel", reason: "user", binding: "opaque-1" },
  { kind: "unknown", input: "private-fixture-secret" },
  { kind: "event", sequence: -1, channel: "x", data: null },
  {
    kind: "result",
    sequence: 0,
    executionState: "not_started",
    outcome: { ok: true, value: null },
  },
  {
    kind: "result",
    sequence: 0,
    executionState: "completed",
    outcome: {
      ok: false,
      error: { code: "PROVIDER_FAILED", path: "physical/path" },
    },
  },
])("rejects invalid recognized fields without exposing data", (fields) =>
  rejected({ ...invoke, ...fields }),
);
it("rejects non-JSON values, accessors, holes, cycles and oversize messages", () => {
  const proxy = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw Error("private-fixture-secret");
      },
    },
  );
  rejected({ ...invoke, input: proxy });
  const cycle: unknown[] = [];
  cycle.push(cycle);
  const getter = Object.defineProperty({}, "secret", {
    enumerable: true,
    get: () => {
      throw Error("getter ran");
    },
  });
  const arrayGetter = Object.defineProperty([1], "0", {
    enumerable: true,
    get: () => {
      throw Error("getter ran");
    },
  });
  for (const input of [
    NaN,
    Infinity,
    BigInt(1),
    new Date(),
    () => {},
    cycle,
    getter,
    arrayGetter,
    Array(1),
    "x".repeat(1024 * 1024 + 1),
  ])
    rejected({ ...invoke, input });
});
it("requires result execution state and retains unknown/completed failure states", () => {
  for (const executionState of [
    "not_started",
    "unknown",
    "completed",
  ] as const) {
    const result = {
      commonVersion: "1.0",
      callId: "call-1",
      kind: "result",
      sequence: 0,
      executionState,
      outcome: { ok: false, error: { code: "CANCELLED", path: "/input/a~1b" } },
    };
    expect(parseCommonEnvelope(result)).toEqual(result);
  }
});
it("checks contiguous call-local replies and refuses mismatched calls, gaps and post-result events", () => {
  const tracker = new CommonReplyTracker("call-1");
  const reply = {
    commonVersion: "1.0",
    callId: "call-1",
    kind: "event",
    channel: "progress",
    data: null,
    sequence: 1,
  };
  expect(() => tracker.receive({ ...reply, sequence: 0 })).toThrow();
  tracker.receive({
    commonVersion: "1.0",
    callId: "call-1",
    kind: "accepted",
    sequence: 0,
    taskId: "task-1",
  });
  expect(() => tracker.receive({ ...reply, callId: "other" })).toThrow();
  expect(() => tracker.receive({ ...reply, sequence: 2 })).toThrow();
  tracker.receive(reply);
  expect(() => tracker.receive(reply)).toThrow();
  tracker.receive({
    commonVersion: "1.0",
    callId: "call-1",
    kind: "result",
    sequence: 2,
    executionState: "unknown",
    outcome: { ok: false, error: { code: "PROVIDER_FAILED" } },
  });
  expect(() => tracker.receive({ ...reply, sequence: 3 })).toThrow();
  expect(new CommonReplyTracker("call-1", 0).receive(reply)).toEqual(reply);
});
it("enforces the separate event size ceiling", () => {
  rejected({
    commonVersion: "1.0",
    callId: "call-1",
    kind: "event",
    channel: "progress",
    sequence: 1,
    data: "x".repeat(256 * 1024),
  });
});
it("negotiates mandatory platform features separately from custom protocol SemVer", () => {
  expect(negotiateCommonContract(declaration, ["events"])).toEqual({
    compatible: false,
    missingFeatures: ["resources-cas"],
  });
  expect(
    negotiateCommonContract(declaration, ["resources-cas", "events", "extra"]),
  ).toEqual({ compatible: true, features: declaration.features });
  const requirement = {
    id: "backend",
    protocol: "org.independent.records",
    range: "^1.0.0",
    features: ["find"],
  };
  for (const name of ["different-a", "different-b"])
    expect(
      checkProtocolCompatibility(requirement, {
        id: name,
        protocol: requirement.protocol,
        version: "1.2.0",
        features: ["find"],
        contribution: { kind: "tools", name },
      }),
    ).toEqual({ compatible: true });
  validateContributionValue(
    {
      type: "object",
      required: ["arbitrary"],
      properties: { arbitrary: { type: "array" } },
    },
    invoke.input,
    "input",
  );
});
it("checks resource IDs and exact operation sets without inferring read from write", () => {
  expect(
    parseCommonDeclaration({
      ...declaration,
      resources: [
        {
          id: "record",
          permissionId: "write-permission",
          operations: ["write"],
        },
      ],
    }).resources?.[0]?.operations,
  ).toEqual(["write"]);
  expect(() =>
    parseCommonDeclaration({
      ...declaration,
      resources: [...declaration.resources!, ...declaration.resources!],
    }),
  ).toThrow();
  expect(() =>
    parseCommonDeclaration({
      ...declaration,
      resources: [{ id: "r", permissionId: "p", operations: ["exec"] }],
    }),
  ).toThrow();
});
it("accepts only bound policy decisions; arbitrary scopes and raw errors cannot become grants", () => {
  const decision = {
    assessmentId: "assessment-1",
    operationFingerprint: "a".repeat(64),
    decision: "confirm",
  };
  expect(parseCommonPolicyDecision(decision)).toEqual(decision);
  for (const bad of [
    { ...decision, decision: true },
    { ...decision, scope: "all" },
    { ...decision, operationFingerprint: "private-fixture-secret" },
  ])
    expect(() => parseCommonPolicyDecision(bad)).toThrow();
});
// A compile-time consumer uses logical bindings, CAS and cancellation, with no package id.
async function independentConsumer(sdk: CommonPlatformSdk) {
  const binding = await sdk.binding("backend");
  if (!binding) return;
  const task = await sdk.tasks.create({ lifetime: "frontend" });
  const call = await sdk.invoke(
    binding.handle,
    "find",
    { arbitrary: [] },
    { taskId: task.taskId },
  );
  await call.cancel();
  const snapshot = await sdk.tasks.status(task.taskId);
  if (snapshot.result) expect(snapshot.result.callId).toBe(call.callId);
  const [resource] = await sdk.resources.list();
  if (resource) {
    const snapshot = await sdk.resources.read(resource.binding, "record");
    await sdk.resources.write(
      resource.binding,
      "record",
      snapshot.revision,
      null,
    );
  }
}
it("exports usable SDK interfaces for independent authors", () =>
  expect(typeof independentConsumer).toBe("function"));
