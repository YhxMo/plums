import { expect, it } from "vitest";
import {
  portableProtocolIntent,
  validateProtocolIntents,
  type ProtocolBindingIntent,
  type DesktopContribution,
} from "../src/index.js";
import type { ManifestV2 } from "@plums/core";
const protocol = "org.example.store",
  contribution = { kind: "tools" as const, name: "store" };
const manifest = (id: string, c: DesktopContribution): ManifestV2 => ({
  id,
  name: id,
  version: "1.0.0",
  formatVersion: "2.0",
  kind: "extension",
  description: "",
  dependencies: [],
  permissions: [],
  payload: { plumsDesktop: c },
});
const components = [
  {
    digest: "a".repeat(64),
    manifest: manifest("consumer", {
      sdkVersion: "2",
      protocols: {
        requires: [
          { id: "store", protocol, range: "^1.0.0", features: ["read"] },
        ],
      },
    }),
  },
  {
    digest: "b".repeat(64),
    manifest: manifest("provider", {
      sdkVersion: "2",
      runtime: "main.js",
      contributes: { tools: [{ name: "store", title: "Store" }] },
      protocols: {
        provides: [
          {
            id: "store",
            protocol,
            version: "1.0.0",
            features: ["read"],
            contribution,
          },
        ],
      },
    }),
  },
];
const intent: ProtocolBindingIntent = {
  consumerId: "consumer",
  consumerDigest: "a".repeat(64),
  requirementId: "store",
  providerId: "provider",
  providerDigest: "b".repeat(64),
  provideId: "store",
  protocolVersion: "1.0.0",
  contribution,
};
it("accepts old bundles with no intents and strips local authority from a portable choice", () => {
  expect(() => validateProtocolIntents(undefined, components)).not.toThrow();
  expect(() => validateProtocolIntents([intent], components)).not.toThrow();
  expect(
    portableProtocolIntent({
      ...intent,
      agentId: "local",
      grantId: "not-portable",
      runtimeHandle: "handle",
    } as ProtocolBindingIntent),
  ).toEqual(intent);
});
it.each([
  "consumerDigest",
  "providerDigest",
  "providerId",
  "requirementId",
  "provideId",
  "protocolVersion",
  "contribution",
])("rejects a forged %s without echoing the rejected value", (key) => {
  const changed = { ...intent, [key]: "private-rejected-value" };
  try {
    validateProtocolIntents([changed], components);
    throw Error("accepted");
  } catch (e) {
    expect(e).toMatchObject({
      code: "IMPORT_INVALID",
      path: expect.stringMatching(/^\/protocolBindings\/0/),
      details: { reason: "PROTOCOL_INTENT_INVALID" },
    });
    expect(JSON.stringify(e)).not.toContain("private-rejected-value");
  }
});
it("rejects duplicate requirement choices and missing required features", () => {
  expect(() =>
    validateProtocolIntents([intent, intent], components),
  ).toThrowError(
    expect.objectContaining({
      code: "IMPORT_INVALID",
      path: "/protocolBindings/1",
    }),
  );
  const changed = structuredClone(components);
  (
    changed[1]!.manifest.payload as { plumsDesktop: DesktopContribution }
  ).plumsDesktop.protocols!.provides![0]!.features = [];
  expect(() => validateProtocolIntents([intent], changed)).toThrowError(
    expect.objectContaining({ code: "IMPORT_INVALID" }),
  );
});
