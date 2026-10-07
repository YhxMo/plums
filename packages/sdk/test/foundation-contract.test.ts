import { describe, it, expect } from "vitest";
import { Ajv } from "ajv";
import {
  parseFoundationProvider,
  parseFoundationRequirement,
  parseFoundationSelection,
  checkFoundationCompatibility,
  foundationProvider,
  foundationProviderSchema,
  desktopContribution,
  parseFoundationMessage,
} from "../src/index.js";
const provider = {
  declarationVersion: "1.0",
  id: "org.example.foundation",
  foundationVersion: "1.0",
  entry: "provider.mjs",
  execution: "controlled-node",
  platforms: ["darwin-arm64"],
  features: ["session.invoke", "session.callback", "session.cancel"],
  hostFeatures: [],
  sdks: [
    {
      id: "org.plums.sdk",
      range: "^2.0.0",
      features: [
        "sdk.register",
        "sdk.settings",
        "sdk.context",
        "sdk.capability",
      ],
    },
  ],
};
const requirement = {
  requirementVersion: "1.0",
  protocolRange: "^1.0.0",
  sdk: { id: "org.plums.sdk", version: "2.0.0" },
  features: ["sdk.register", "sdk.settings"],
  optionalFeatures: ["sdk.events"],
};
describe("public foundation metadata", () => {
  it("limits version-specific SDK features to their declared range", () => {
    const p = {
      ...provider,
      declarationVersion: "1.1",
      sdks: [
        {
          id: "org.plums.sdk",
          range: "1.0.0 || 2.0.0",
          features: ["sdk.register"],
          featureRanges: [{ range: "2.0.0", features: ["sdk.context"] }],
        },
      ],
    };
    const r = { ...requirement, features: ["sdk.context"] };
    expect(
      checkFoundationCompatibility(p, r, "darwin-arm64", []).compatible,
    ).toBe(true);
    expect(
      checkFoundationCompatibility(
        p,
        { ...r, sdk: { id: "org.plums.sdk", version: "1.0.0" } },
        "darwin-arm64",
        [],
      ),
    ).toMatchObject({
      compatible: false,
      diagnostics: [{ reason: "FEATURE", missing: ["sdk.context"] }],
    });
    expect(() =>
      parseFoundationProvider({
        ...p,
        sdks: [
          { ...p.sdks[0], featureRanges: [{ range: "bad", features: [] }] },
        ],
      }),
    ).toThrow();
    expect(
      new Ajv({ strict: false }).compile(foundationProviderSchema)(p),
    ).toBe(true);
  });
  it("accepts a trusted builtin declaration but refuses a package claiming builtin execution", () => {
    const p = {
      ...provider,
      declarationVersion: "1.1",
      execution: "builtin-adapter",
    };
    expect(parseFoundationProvider(p).execution).toBe("builtin-adapter");
    const manifest = {
      formatVersion: "2.0",
      id: provider.id,
      kind: "extension",
      name: "Fixture",
      version: "1.0.0",
      description: "",
      dependencies: [],
      permissions: [],
      payload: { plumsFoundation: p },
    } as const;
    expect(() =>
      foundationProvider(manifest as any, {
        [provider.entry]: new Uint8Array(),
      }),
    ).toThrow();
  });
  it("copies and preserves unknown same-major fields; offline schema matches", () => {
    const value = {
      ...provider,
      declarationVersion: "1.7",
      future: { flag: true },
    };
    const parsed = parseFoundationProvider(value);
    expect(parsed).toEqual(value);
    value.future.flag = false;
    expect(parsed.future).toEqual({ flag: true });
    expect(
      new Ajv({ strict: false }).compile(foundationProviderSchema)(parsed),
    ).toBe(true);
  });
  it.each([
    { ...provider, declarationVersion: "2.0" },
    { ...provider, foundationVersion: "2.0" },
    { ...provider, entry: "../private.js" },
    { ...provider, entry: "/tmp/private.js" },
    { ...provider, sdks: [provider.sdks[0], provider.sdks[0]] },
    { ...provider, sdks: [{ ...provider.sdks[0], range: "garbage" }] },
    { ...provider, features: ["session.invoke", "session.invoke"] },
    { ...provider, execution: "engine" },
  ])(
    "rejects invalid declarations without rejected values in errors",
    (value) => {
      expect(() => parseFoundationProvider(value)).toThrow();
    },
  );
  it("reports protocol, SDK, feature, platform, provider and host mismatch separately", () => {
    expect(
      checkFoundationCompatibility(provider, requirement, "darwin-arm64", []),
    ).toMatchObject({
      compatible: true,
      missingOptionalFeatures: ["sdk.events"],
      evidence: "declared",
    });
    for (const change of [
      { protocolRange: "^2.0.0" },
      { sdk: { id: "custom.sdk", version: "2.0.0" } },
      { features: ["sdk.engine"] },
      { providerId: "another.foundation" },
    ])
      expect(
        checkFoundationCompatibility(
          provider,
          { ...requirement, ...change },
          "darwin-arm64",
          [],
        ).compatible,
      ).toBe(false);
    expect(
      checkFoundationCompatibility(provider, requirement, "linux-x64", [])
        .compatible,
    ).toBe(false);
    expect(
      checkFoundationCompatibility(
        { ...provider, hostFeatures: ["host.unknown"] },
        requirement,
        "darwin-arm64",
        [],
      ).compatible,
    ).toBe(false);
    expect(() =>
      parseFoundationRequirement({
        ...requirement,
        sdk: { id: "org.plums.sdk", version: "^2" },
      }),
    ).toThrow();
  });
  it("pins concrete artifacts and refuses future or incomplete records", () => {
    const selected = {
      selectionVersion: "1.0",
      source: "library",
      id: provider.id,
      version: "1.2.3",
      digest: "a".repeat(64),
      future: 17,
    };
    expect(parseFoundationSelection(selected)).toEqual(selected);
    for (const change of [
      { selectionVersion: "2.0" },
      { version: "latest" },
      { digest: "" },
      { source: "remote" },
    ])
      expect(() =>
        parseFoundationSelection({ ...selected, ...change }),
      ).toThrow();
  });
  it("uses a separate payload declaration; leaves runtime and common fields intact", () => {
    const manifest: any = {
      formatVersion: "2.0",
      kind: "extension",
      id: provider.id,
      version: "1.0.0",
      permissions: [],
      payload: { plumsFoundation: provider },
    };
    expect(
      foundationProvider(manifest, {
        "provider.mjs": Buffer.from("export {};"),
      }),
    ).toEqual(provider);
    expect(() =>
      foundationProvider({
        ...manifest,
        permissions: [{ id: "engine", kind: "engine" }],
      }),
    ).toThrow();
    expect(() =>
      foundationProvider({
        ...manifest,
        payload: {
          ...manifest.payload,
          plumsDesktop: { sdkVersion: "2", runtime: "main.js" },
        },
      }),
    ).toThrow();
    const desktop: any = {
      formatVersion: "2.0",
      kind: "extension",
      permissions: [],
      payload: {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          foundation: requirement,
          common: { commonVersion: "1.0", runtime: "isolate", features: [] },
        },
      },
    };
    expect(
      desktopContribution(desktop, { "main.js": Buffer.from("") }),
    ).toMatchObject({
      runtime: "main.js",
      common: { runtime: "isolate" },
      foundation: requirement,
    });
    expect(() =>
      desktopContribution({
        ...desktop,
        payload: {
          plumsDesktop: {
            ...desktop.payload.plumsDesktop,
            foundation: { ...requirement, requirementVersion: "2.0" },
          },
        },
      }),
    ).toThrow();
  });
});

it("never uses a provider's newer protocol claim to downgrade an explicit requirement", () => {
  expect(
    checkFoundationCompatibility(
      { ...provider, foundationVersion: "1.1" },
      { ...requirement, protocolRange: "^1.1.0" },
      "darwin-arm64",
      [],
    ),
  ).toMatchObject({ compatible: false, diagnostics: [{ reason: "PROTOCOL" }] });
});

it("retains message additions but forbids provider-supplied context", () => {
  const m = {
    foundationVersion: "1.0",
    sessionId: "i",
    type: "callback",
    callId: "p",
    callbackId: "c",
    method: "settings",
    args: {},
    future: { supported: true },
  };
  expect(parseFoundationMessage(m)).toEqual(m);
  expect(() =>
    parseFoundationMessage({ ...m, context: { componentId: "victim" } }),
  ).toThrow();
});
