import { expect, it } from "vitest";
import {
  createArchive,
  IMPORT_INVALID,
  validatePackage,
  type ManifestV2,
} from "@plumsjs/core";
import {
  checkProtocolCompatibility,
  createAgentBundle,
  desktopContribution,
  validateAgentBundle,
  type DesktopContribution,
  type ProtocolProvider,
  type ProtocolRequirement,
} from "../src/index.js";

const memory: ProtocolProvider = {
  id: "memory-service",
  protocol: "org.plums.examples.memory",
  version: "1.1.0",
  features: ["search", "upsert"],
  contribution: { kind: "tools", name: "memory" },
};
const required: ProtocolRequirement = {
  id: "learning-memory",
  protocol: memory.protocol,
  range: "^1.0.0",
  features: ["search", "upsert"],
};
function contribution(): DesktopContribution {
  return {
    sdkVersion: "2",
    runtime: "main.js",
    contributes: {
      tools: [
        {
          name: "memory",
          title: "Memory",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
      ],
    },
    protocols: {
      provides: [structuredClone(memory)],
      requires: [structuredClone(required)],
    },
  };
}
function manifest(c: unknown = contribution()): ManifestV2 {
  return {
    formatVersion: "2.0",
    kind: "extension",
    id: "author-a-memory",
    name: "Memory A",
    version: "8.0.0",
    description: "",
    dependencies: [],
    permissions: [],
    payload: { plumsDesktop: c },
  };
}
const prefix = "/payload/plumsDesktop/protocols";

it("accepts independent memory and whiteboard declarations without granting permissions or changing dependencies", () => {
  const c = contribution();
  c.contributes!.commands = [{ name: "board", title: "Board" }];
  c.protocols!.provides!.push({
    id: "board",
    protocol: "org.plums.examples.whiteboard",
    version: "1.0.0",
    features: ["present", "snapshot", "submit"],
    contribution: { kind: "commands", name: "board" },
  });
  c.protocols!.requires!.push({
    id: "extra-board",
    protocol: "org.plums.examples.whiteboard",
    range: "~1.0.0",
    optional: true,
  });
  const m = manifest(c),
    before = structuredClone(m);
  expect(desktopContribution(m)).toBe(c);
  expect(m).toEqual(before);
  expect(m.permissions).toEqual([]);
  expect(m.dependencies).toEqual([]);
});

it.each(["1", "2"] as const)(
  "keeps SDK %s contributions without protocol declarations compatible",
  (sdkVersion) => {
    const c = contribution();
    c.sdkVersion = sdkVersion;
    delete c.protocols;
    expect(desktopContribution(manifest(c))).toBe(c);
  },
);

it.each([
  [null, prefix],
  [[], prefix],
  ["protocols", prefix],
  [{ provides: null }, `${prefix}/provides`],
  [{ requires: {} }, `${prefix}/requires`],
  [{ provides: Array(101).fill(memory) }, `${prefix}/provides`],
  [{ requires: Array(101).fill(required) }, `${prefix}/requires`],
] as const)(
  "rejects malformed or oversized declaration containers (%j)",
  (protocols, path) => {
    expect(() =>
      desktopContribution(manifest({ ...contribution(), protocols })),
    ).toThrowError(expect.objectContaining({ code: IMPORT_INVALID, path }));
  },
);

it.each([
  ["id", "", "id"],
  ["id", "x".repeat(65), "id"],
  ["protocol", "memory", "protocol"],
  ["protocol", "Org.Example.memory", "protocol"],
  ["protocol", "org.example/secret", "protocol"],
  ["version", "^1.0.0", "version"],
  ["version", "v1.0.0", "version"],
  ["version", "1.0", "version"],
  ["version", "01.0.0", "version"],
  ["version", "1.0.0-beta.1", "version"],
  ["version", "1.0.0+build", "version"],
  ["version", null, "version"],
  ["features", "search", "features"],
  ["features", Array(65).fill("search"), "features"],
  ["features", ["search", "search"], "features/1"],
  ["features", ["bad feature"], "features/0"],
  ["contribution", null, "contribution"],
  ["contribution", { kind: "panels", name: "memory" }, "contribution/kind"],
  ["contribution", { kind: "tools", name: "../memory" }, "contribution/name"],
  ["contribution", { kind: "commands", name: "memory" }, "contribution"],
  ["contribution", { kind: "tools", name: "undeclared" }, "contribution"],
] as const)(
  "rejects invalid provider %s=%j with a public field error",
  (key, value, field) => {
    const c = {
      ...contribution(),
      protocols: { provides: [{ ...memory, [key]: value }] },
    };
    expect(() => desktopContribution(manifest(c))).toThrowError(
      expect.objectContaining({
        code: IMPORT_INVALID,
        path: `${prefix}/provides/0/${field}`,
      }),
    );
  },
);

it.each([
  ["range", "", "range"],
  ["range", "   ", "range"],
  ["range", "latest", "range"],
  ["range", 1, "range"],
  ["range", "1".repeat(257), "range"],
  ["optional", "true", "optional"],
  ["optional", null, "optional"],
  ["features", [1], "features/0"],
  ["features", ["search", "search"], "features/1"],
] as const)("rejects invalid requirement %s=%j", (key, value, field) => {
  const c = {
    ...contribution(),
    protocols: { requires: [{ ...required, [key]: value }] },
  };
  expect(() => desktopContribution(manifest(c))).toThrowError(
    expect.objectContaining({
      code: IMPORT_INVALID,
      path: `${prefix}/requires/0/${field}`,
    }),
  );
});

it.each(["provides", "requires"] as const)(
  "rejects duplicate %s slots while allowing identical protocol ids in distinct slots",
  (key) => {
    const c = contribution(),
      item = key === "provides" ? memory : required;
    c.protocols = { [key]: [item, { ...item, id: "second-slot" }] };
    expect(desktopContribution(manifest(c))).toBe(c);
    c.protocols = { [key]: [item, item] };
    expect(() => desktopContribution(manifest(c))).toThrowError(
      expect.objectContaining({
        code: IMPORT_INVALID,
        path: `${prefix}/${key}/1/id`,
      }),
    );
  },
);

it("requires SDK v2 and a runnable provider entry, even when metadata matches", () => {
  const c = contribution();
  c.sdkVersion = "1";
  expect(() => desktopContribution(manifest(c))).toThrowError(
    expect.objectContaining({
      code: IMPORT_INVALID,
      path: "/payload/plumsDesktop/sdkVersion",
    }),
  );
  c.sdkVersion = "2";
  delete c.runtime;
  expect(() => desktopContribution(manifest(c))).toThrowError(
    expect.objectContaining({
      code: IMPORT_INVALID,
      path: "/payload/plumsDesktop/runtime",
    }),
  );
  c.runtime = "main.js";
  expect(() => desktopContribution(manifest(c), {})).toThrowError(
    expect.objectContaining({ code: IMPORT_INVALID }),
  );
});

it("does not echo rejected declaration values in errors", () => {
  const privateValue = "fake-private-declaration-value";
  try {
    desktopContribution(
      manifest({
        ...contribution(),
        protocols: { provides: [{ ...memory, version: privateValue }] },
      }),
    );
    throw new Error("expected an import failure");
  } catch (error) {
    expect(error).toMatchObject({
      code: IMPORT_INVALID,
      path: `${prefix}/provides/0/version`,
      details: { reason: "PROTOCOL_DECLARATION_INVALID" },
    });
    expect(String(error) + JSON.stringify(error)).not.toContain(privateValue);
  }
});

it("matches two independent authors regardless of package version and contribution naming", () => {
  const a = manifest(),
    b = manifest();
  b.id = "author-b-memory";
  b.version = "0.3.2";
  const c = contribution();
  c.contributes!.tools![0]!.name = "storage";
  c.protocols!.provides![0]!.contribution.name = "storage";
  c.protocols!.provides![0]!.version = "1.2.4";
  b.payload = { plumsDesktop: c };
  for (const m of [a, b]) {
    const p = desktopContribution(m)!.protocols!.provides![0]!;
    expect(checkProtocolCompatibility(required, p)).toEqual({
      compatible: true,
    });
  }
});

it.each([
  [
    { ...memory, protocol: "org.example.other" },
    { compatible: false, reason: "PROTOCOL_MISMATCH" },
  ],
  [
    { ...memory, version: "2.0.0" },
    { compatible: false, reason: "VERSION_MISMATCH" },
  ],
  [
    { ...memory, version: "0.9.0" },
    { compatible: false, reason: "VERSION_MISMATCH" },
  ],
  [
    { ...memory, features: ["search"] },
    {
      compatible: false,
      reason: "FEATURES_MISSING",
      missingFeatures: ["upsert"],
    },
  ],
  [
    { ...memory, features: undefined },
    {
      compatible: false,
      reason: "FEATURES_MISSING",
      missingFeatures: ["search", "upsert"],
    },
  ],
] as const)(
  "reports a specific compatibility failure without weakening optional requirements (%j)",
  (provided, result) => {
    expect(
      checkProtocolCompatibility(required, provided as ProtocolProvider),
    ).toEqual(result);
    expect(
      checkProtocolCompatibility(
        { ...required, optional: true },
        provided as ProtocolProvider,
      ),
    ).toEqual(result);
  },
);

it("uses declared SemVer ranges, explicit multi-major support and feature subsets without mutating metadata", () => {
  const before = structuredClone({ required, memory });
  expect(
    checkProtocolCompatibility({ ...required, range: "~1.0.0" }, memory),
  ).toEqual({ compatible: false, reason: "VERSION_MISMATCH" });
  expect(
    checkProtocolCompatibility(
      { ...required, range: "^1.0.0 || ^2.0.0", features: ["search"] },
      { ...memory, version: "2.0.0" },
    ),
  ).toEqual({ compatible: true });
  expect(
    checkProtocolCompatibility(
      { ...required, features: undefined },
      { ...memory, features: undefined },
    ),
  ).toEqual({ compatible: true });
  expect({ required, memory }).toEqual(before);
});

it("rejects invalid direct matcher input with a public error instead of a parser exception", () => {
  expect(() =>
    checkProtocolCompatibility({ ...required, range: "broken" }, memory),
  ).toThrowError(
    expect.objectContaining({
      code: IMPORT_INVALID,
      path: "/requirement/range",
    }),
  );
  expect(() =>
    checkProtocolCompatibility(required, { ...memory, version: "1.0.0-rc.1" }),
  ).toThrowError(
    expect.objectContaining({
      code: IMPORT_INVALID,
      path: "/provider/version",
    }),
  );
});

it("preserves unknown protocol fields, contribution schemas and formatVersion through nested Agent ZIP roundtrips", async () => {
  const c = contribution();
  c.protocols!.future = { opaque: true };
  c.protocols!.provides![0]!.future = { authorMetadata: ["preserved"] };
  c.protocols!.provides![0]!.contribution.future = "route metadata";
  c.protocols!.requires![0]!.future = { optionalPolicy: "opaque" };
  const m = manifest(c);
  m.formatVersion = "2.7";
  const bytes = await createArchive({
    "manifest.json": new TextEncoder().encode(JSON.stringify(m)),
    "main.js": new TextEncoder().encode("export function activate() {}"),
  });
  const checked = await validatePackage(bytes);
  const parsed = desktopContribution(checked.manifest, checked.files)!;
  expect(parsed).toEqual(c);
  const agent = {
    bundleVersion: "1.0" as const,
    id: "composition",
    name: "Composition",
    version: "1.0.0",
    extensions: ["memory.zip"],
    connectors: [],
  };
  const one = await validateAgentBundle(
    await createAgentBundle(agent, { "memory.zip": bytes }),
  );
  const two = await validateAgentBundle(
    await createAgentBundle(
      one.agent,
      Object.fromEntries(one.packages.map((p) => [p.archive, p.bytes])),
    ),
  );
  expect(two.packages[0]!.contents.manifest.formatVersion).toBe("2.7");
  expect(desktopContribution(two.packages[0]!.contents.manifest)).toEqual(c);
});
