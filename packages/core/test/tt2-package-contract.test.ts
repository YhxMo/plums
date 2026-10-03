import { describe, expect, it } from "vitest";
import {
  fixtureBytes,
  fixtureManifest,
  expectNothingWritten,
  fixturePath,
  install,
  useWorlds,
} from "./contract-helpers.js";
import { buildZip, expectPlumsError, manifestZip } from "./package-helpers.js";

const world = useWorlds();

const VALID = [
  "valid/character-min.zip",
  "valid/connector-min.zip",
  "valid/egress-target-exact.zip",
  "valid/egress-target-port.zip",
  "valid/egress-target-wildcard.zip",
  "valid/extension-3-levels.zip",
  "valid/extension-min.zip",
  "valid/extension-unknown-fields.zip",
  "valid/extension-with-dep.zip",
  "valid/update/ext-v1.zip",
  "valid/update/ext-v2-more-perms.zip",
  "valid/update/ext-v2-same-perms.zip",
];

describe("T2: a bad manifest is MANIFEST_INVALID with a JSON Pointer path", () => {
  const cases: [string, string | undefined][] = [
    ["missing-name", "/name"],
    ["missing-id", "/id"],
    ["bad-kind", "/kind"],
    ["bad-version", "/version"],
    ["perm-bad-level", "/permissions/0/level"],
    ["perm-missing-reason", "/permissions/0/reason"],
    ["settings-bad-type", "/settingsSchema/properties/n/type"],
    ["dependencies-not-array", "/dependencies"],
    ["egress-target-with-scheme", "/permissions/0/target"],
    ["egress-target-with-path", "/permissions/0/target"],
    ["egress-target-ip", "/permissions/0/target"],
    ["egress-target-localhost", "/permissions/0/target"],
    ["egress-target-empty", "/permissions/0/target"],
    ["manifest-not-json", undefined],
  ];

  it.each(cases)("invalid/%s -> %s", async (name, at) => {
    const w = world();
    const err = await expectPlumsError(w.core.importPackage(fixturePath(`invalid/${name}.zip`)), "MANIFEST_INVALID");
    expect(err.path).toBe(at);
    expectNothingWritten(w);
  });

  // A wildcard needs two labels after `*.`, and a bare TLD is no host.
  it.each(["egress-target-wildcard-tld", "egress-target-single-label"])(
    "invalid/%s -> MANIFEST_INVALID at /permissions/0/target",
    async (name) => {
      const w = world();
      await expectPlumsError(w.core.importPackage(fixturePath(`invalid/${name}.zip`)), "MANIFEST_INVALID", "/permissions/0/target");
      expectNothingWritten(w);
    },
  );

  // A wildcard is only a leading `*.`, and the host after it still needs two labels. localhost is never a target.
  const hostRules: [string, string][] = [
    ["*.localhost", "wildcard localhost"],
    ["api.localhost", "a localhost subdomain"],
    ["foo.*.example.com", "a wildcard that is not the first label"],
    ["*example.com", "a star glued to the name"],
  ];
  it.each(hostRules)("egress target %s (%s) is MANIFEST_INVALID at /permissions/0/target", async (target) => {
    const w = world();
    const manifest = await fixtureManifest(w, "valid/egress-target-exact.zip");
    manifest.permissions = [{ id: "p.egress", level: "egress", target, reason: "测试用" }];
    await expectPlumsError(w.core.importPackage(await manifestZip(manifest)), "MANIFEST_INVALID", "/permissions/0/target");
    expectNothingWritten(w);
  });

  it.each([["an array", []], ["a string", "hello"], ["null", null], ["a number", 42]])(
    "a manifest that is %s has no path",
    async (_name, value) => {
      const err = await expectPlumsError(world().core.importPackage(await manifestZip(value)), "MANIFEST_INVALID");
      expect(err.path).toBeUndefined();
    },
  );

  it("points at the index of the bad egress permission, not always the first", async () => {
    const w = world();
    const manifest = await fixtureManifest(w, "valid/extension-3-levels.zip");
    manifest.permissions[2] = { ...manifest.permissions[2]!, target: "https://example.com/x" };
    await expectPlumsError(w.core.importPackage(await manifestZip(manifest)), "MANIFEST_INVALID", "/permissions/2/target");
  });

  it("FORMAT_UNSUPPORTED for a higher format major", async () => {
    await expectPlumsError(world().core.importPackage(fixturePath("invalid/format-major-3.zip")), "FORMAT_UNSUPPORTED");
  });
});

describe("T2: a broken package is IMPORT_INVALID and writes nothing", () => {
  const cases = [
    "invalid/zip-slip.zip",
    "invalid/absolute-path.zip",
    "invalid/not-a-zip.zip",
    "invalid/no-manifest.zip",
    "malicious/zip-bomb-50mb.zip",
  ];

  it.each(cases)("%s", async (rel) => {
    const w = world();
    await expectPlumsError(w.core.importPackage(fixturePath(rel)), "IMPORT_INVALID");
    await expectPlumsError(w.core.importPackage(fixtureBytes(rel)), "IMPORT_INVALID");
    expectNothingWritten(w);
  });
});

describe("T2: valid packages", () => {
  it.each(VALID)("%s imports, and export then import gives the same content", async (rel) => {
    const w = world();
    const first = await w.core.importPackage(fixturePath(rel));
    const bytes = await w.core.exportPackage({ manifest: first.manifest, files: first.files });
    const again = await world().core.validatePackage(bytes);
    expect(again.manifest).toEqual(first.manifest);
    expect(again.files).toEqual(first.files);
  });

  it("keeps unknown fields and nested payload as written", async () => {
    const w = world();
    const { manifest } = await w.core.importPackage(fixturePath("valid/extension-unknown-fields.zip"));
    expect(manifest.futureField).toEqual({ a: 1 });
    expect(manifest.payload).toEqual({ x: [1, 2, { y: "原样保留" }] });
    const bytes = await w.core.exportPackage({ manifest });
    expect((await w.core.validatePackage(bytes)).manifest).toEqual(manifest);
  });

  it("treats a dependency without optional as required", async () => {
    const w = world();
    const manifest = await fixtureManifest(w, "valid/extension-with-dep.zip");
    const { optional: _dropped, ...dependency } = manifest.dependencies[0]!;
    const id = (await w.core.importPackage(await manifestZip({ ...manifest, dependencies: [dependency] }))).manifest.id;
    await w.core.grantConsent(id);
    await expectPlumsError(w.core.enable(id), "DEPENDENCY_MISSING", "/dependencies/0");
    await install(w, "valid/extension-min.zip");
    expect(await w.core.enable(id)).toMatchObject({ enabled: true });
  });
});

describe("T3: inspect", () => {
  it.each(VALID)("%s: same summary from bytes and path, nothing written", async (rel) => {
    const w = world();
    const manifest = await fixtureManifest(w, rel);
    const fromBytes = await w.core.inspect(fixtureBytes(rel));
    const fromPath = await w.core.inspect(fixturePath(rel));
    expect(fromBytes).toEqual(fromPath);
    expect(fromBytes).toEqual({
      kind: manifest.kind,
      formatVersion: manifest.formatVersion,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      permissions: manifest.permissions,
      dependencies: manifest.dependencies,
    });
    expectNothingWritten(w);
    expect(await w.core.listInstalled()).toEqual([]);
  });

  it("lists permissions in manifest order, each with level and reason", async () => {
    const summary = await world().core.inspect(fixturePath("valid/extension-3-levels.zip"));
    expect(summary.permissions).toEqual([
      { id: "p.read", level: "read", target: "memory", reason: "读取记忆" },
      { id: "p.write", level: "write", target: "notes", reason: "写入笔记" },
      { id: "p.egress", level: "egress", target: "example.com", reason: "把摘要发给示例网站" },
    ]);
  });

  it("returns dependencies", async () => {
    const summary = await world().core.inspect(fixturePath("valid/extension-with-dep.zip"));
    expect(summary.dependencies).toEqual([{ kind: "extension", id: "test.ext.min", range: "^1.0.0", optional: false }]);
  });

  it("does not treat text in the payload as permissions", async () => {
    const summary = await world().core.inspect(fixturePath("malicious/card-claims-permissions.zip"));
    expect(summary.permissions).toEqual([]);
  });

  it.each([
    ["invalid/missing-name.zip", "MANIFEST_INVALID"],
    ["invalid/format-major-3.zip", "FORMAT_UNSUPPORTED"],
    ["invalid/zip-slip.zip", "IMPORT_INVALID"],
  ])("%s throws %s and writes nothing", async (rel, code) => {
    const w = world();
    await expectPlumsError(w.core.inspect(fixturePath(rel)), code);
    expectNothingWritten(w);
  });

  it("an empty zip is no package", async () => {
    await expectPlumsError(world().core.inspect(await buildZip([])), "IMPORT_INVALID");
  });
});
