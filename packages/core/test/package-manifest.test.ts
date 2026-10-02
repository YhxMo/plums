import { describe, expect, it } from "vitest";
import {
  buildZip,
  expectPlumsError,
  listAll,
  makeCore,
  manifestZip,
  validManifest,
} from "./package-helpers.js";

type Mutate = (manifest: Record<string, any>) => void;

const badManifests: [string, Mutate, string][] = [
  ["missing id", (m) => delete m.id, "/id"],
  ["missing name", (m) => delete m.name, "/name"],
  ["missing version", (m) => delete m.version, "/version"],
  ["missing description", (m) => delete m.description, "/description"],
  ["missing payload", (m) => delete m.payload, "/payload"],
  ["missing formatVersion", (m) => delete m.formatVersion, "/formatVersion"],
  ["missing permissions", (m) => delete m.permissions, "/permissions"],
  ["missing dependencies", (m) => delete m.dependencies, "/dependencies"],
  ["unknown kind", (m) => (m.kind = "theme"), "/kind"],
  ["kind of the wrong type", (m) => (m.kind = 7), "/kind"],
  ["version that is not semver", (m) => (m.version = "1.2"), "/version"],
  ["version with a leading v", (m) => (m.version = "v1.2.3"), "/version"],
  ["version of the wrong type", (m) => (m.version = 1), "/version"],
  ["id with capital letters", (m) => (m.id = "My Pack"), "/id"],
  ["id that is empty", (m) => (m.id = ""), "/id"],
  ["name that is empty", (m) => (m.name = ""), "/name"],
  ["formatVersion that is not MAJOR.MINOR", (m) => (m.formatVersion = "one"), "/formatVersion"],
  ["formatVersion 0.x", (m) => (m.formatVersion = "0.9"), "/formatVersion"],
  ["license of the wrong type", (m) => (m.license = 5), "/license"],
  ["author of the wrong type", (m) => (m.author = {}), "/author"],
  ["permission level outside read/write/egress", (m) => (m.permissions[0].level = "admin"), "/permissions/0/level"],
  ["permission level missing", (m) => delete m.permissions[1].level, "/permissions/1/level"],
  ["permission without reason", (m) => delete m.permissions[0].reason, "/permissions/0/reason"],
  ["permission with an empty reason", (m) => (m.permissions[1].reason = ""), "/permissions/1/reason"],
  ["permission without target", (m) => delete m.permissions[0].target, "/permissions/0/target"],
  ["permission without id", (m) => delete m.permissions[0].id, "/permissions/0/id"],
  ["permission with an empty id", (m) => (m.permissions[0].id = ""), "/permissions/0/id"],
  ["permission with an empty target", (m) => (m.permissions[1].target = ""), "/permissions/1/target"],
  ["permission level of the wrong type", (m) => (m.permissions[0].level = true), "/permissions/0/level"],
  ["permission reason of the wrong type", (m) => (m.permissions[0].reason = 5), "/permissions/0/reason"],
  ["permission that is not an object", (m) => (m.permissions[0] = "read"), "/permissions/0"],
  ["permissions that is not a list", (m) => (m.permissions = {}), "/permissions"],
  ["setting with an unknown type", (m) => (m.settingsSchema.properties.nickname.type = "color"), "/settingsSchema/properties/nickname/type"],
  ["setting without a type", (m) => delete m.settingsSchema.properties.retries.type, "/settingsSchema/properties/retries/type"],
  ["setting without a title", (m) => delete m.settingsSchema.properties.nickname.title, "/settingsSchema/properties/nickname/title"],
  ["setting without a description", (m) => delete m.settingsSchema.properties.retries.description, "/settingsSchema/properties/retries/description"],
  ["setting default of the wrong type", (m) => (m.settingsSchema.properties.retries.default = "3"), "/settingsSchema/properties/retries/default"],
  ["setting default above its maximum", (m) => (m.settingsSchema.properties.retries.maximum = 2), "/settingsSchema/properties/retries/default"],
  ["minimum on a string setting", (m) => (m.settingsSchema.properties.nickname.minimum = 1), "/settingsSchema/properties/nickname/minimum"],
  ["setting that is not an object", (m) => (m.settingsSchema.properties.nickname = "string"), "/settingsSchema/properties/nickname"],
  ["settingsSchema that is not an object", (m) => (m.settingsSchema = "none"), "/settingsSchema"],
  ["settingsSchema without properties", (m) => delete m.settingsSchema.properties, "/settingsSchema/properties"],
  ["x-secret as the string true", (m) => (m.settingsSchema.properties.nickname["x-secret"] = "true"), "/settingsSchema/properties/nickname/x-secret"],
  ["x-secret as the number 1", (m) => (m.settingsSchema.properties.nickname["x-secret"] = 1), "/settingsSchema/properties/nickname/x-secret"],
  ["dependency that is a string", (m) => (m.dependencies[0] = "base-pack@^1.0.0"), "/dependencies/0"],
  ["dependency that is null", (m) => (m.dependencies = [null]), "/dependencies/0"],
  ["second dependency that is a number", (m) => m.dependencies.push(3), "/dependencies/1"],
  ["dependency without kind", (m) => delete m.dependencies[0].kind, "/dependencies/0/kind"],
  ["dependency kind character", (m) => (m.dependencies[0].kind = "character"), "/dependencies/0/kind"],
  ["dependency kind unknown", (m) => (m.dependencies[0].kind = "plugin"), "/dependencies/0/kind"],
  ["dependency kind of the wrong type", (m) => (m.dependencies[0].kind = 1), "/dependencies/0/kind"],
  ["dependency optional as a string", (m) => (m.dependencies[0].optional = "false"), "/dependencies/0/optional"],
  ["dependency optional as a number", (m) => (m.dependencies[0].optional = 1), "/dependencies/0/optional"],
  ["dependency optional as null", (m) => (m.dependencies[0].optional = null), "/dependencies/0/optional"],
  ["dependency without id", (m) => delete m.dependencies[0].id, "/dependencies/0/id"],
  ["dependency without range", (m) => delete m.dependencies[0].range, "/dependencies/0/range"],
  ["dependency with a bad range", (m) => (m.dependencies[0].range = "latest"), "/dependencies/0/range"],
  ["dependency with an empty range", (m) => (m.dependencies[0].range = ""), "/dependencies/0/range"],
  ["dependencies that is not a list", (m) => (m.dependencies = "none"), "/dependencies"],
];

describe("importPackage: MANIFEST_INVALID", () => {
  for (const [label, mutate, expectedPath] of badManifests) {
    it(`${label} -> ${expectedPath}`, async () => {
      const { core, dataDir } = makeCore();
      const manifest = validManifest() as Record<string, any>;
      mutate(manifest);

      const err = await expectPlumsError(
        core.importPackage(await manifestZip(manifest)),
        "MANIFEST_INVALID",
        expectedPath,
      );

      expect(err.path?.startsWith("/")).toBe(true);
      expect(err.message).not.toMatch(/instancePath|must match|\bajv\b/i);
      expect(listAll(dataDir)).toEqual([]);
    });
  }

  it("accepts dependencies with and without optional, and keeps them as written", async () => {
    const { core } = makeCore();
    const manifest = validManifest() as Record<string, any>;
    manifest.dependencies = [
      { kind: "extension", id: "a-ext", range: "^1.0.0" },
      { kind: "connector", id: "b-conn", range: ">=2.0.0 <3.0.0", optional: true, note: "kept" },
    ];
    const { manifest: out } = await core.validatePackage(await manifestZip(manifest));
    expect(out.dependencies).toEqual(manifest.dependencies);
    expect(out.dependencies[0]).not.toHaveProperty("optional");
  });

  it("reports a manifest that is not JSON, without a path", async () => {
    const { core, dataDir } = makeCore();
    for (const text of ["{ not json", "", "plain words"]) {
      const zip = await buildZip([{ name: "manifest.json", data: text }]);
      const err = await expectPlumsError(core.importPackage(zip), "MANIFEST_INVALID");
      expect(err.path).toBeUndefined();
    }
    expect(listAll(dataDir)).toEqual([]);
  });

  it("reports a manifest that is not UTF-8 text", async () => {
    const { core } = makeCore();
    const zip = await buildZip([{ name: "manifest.json", data: new Uint8Array([0xff, 0xfe, 0xfd]) }]);
    await expectPlumsError(core.importPackage(zip), "MANIFEST_INVALID");
  });

  it("reports a manifest that is not an object", async () => {
    const { core } = makeCore();
    for (const value of [[], "text", 3, null]) {
      const err = await expectPlumsError(core.importPackage(await manifestZip(value)), "MANIFEST_INVALID");
      expect(err.path).toBeUndefined();
    }
  });

  it("escapes special characters in JSON Pointer paths", async () => {
    const { core } = makeCore();
    const manifest = validManifest() as Record<string, any>;
    manifest.settingsSchema.properties["a/b~c"] = { type: "nope", title: "T", description: "D" };
    await expectPlumsError(
      core.importPackage(await manifestZip(manifest)),
      "MANIFEST_INVALID",
      "/settingsSchema/properties/a~1b~0c/type",
    );
  });

  it("explains the problem in plain words", async () => {
    const { core } = makeCore();
    const manifest = validManifest() as Record<string, any>;
    manifest.permissions[0].level = "admin";
    const err = await expectPlumsError(core.importPackage(await manifestZip(manifest)), "MANIFEST_INVALID");
    expect(err.message).toBe("「permissions」第 1 项的「level」 的值不对，只能是 read、write、egress 之一。");
  });
});

describe("egress targets that are accepted", () => {
  it.each(["api.example.com", "api.example.com:8443", "*.example.com", "API.Example.COM", "bücher.example"])(
    "%s",
    async (target) => {
      const { core } = makeCore();
      const manifest = validManifest();
      manifest.permissions[1]!.target = target;
      await expect(core.validatePackage(await manifestZip(manifest))).resolves.toBeDefined();
    },
  );
});
