import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { secretRef, type Manifest, type Permission } from "@plums/core";
import { describe, expect, it } from "vitest";
import { FAKE_SECRET, fixtureBytes, fixtureManifest, fixturePath, install, snapshot, useWorlds, type World } from "./contract-helpers.js";
import { expectPlumsError, manifestZip } from "./package-helpers.js";

const world = useWorlds();

const V1 = "valid/update/ext-v1.zip";
const SAME = "valid/update/ext-v2-same-perms.zip";
const MORE = "valid/update/ext-v2-more-perms.zip";
const ID = "test.ext.update";
const READ: Permission = { id: "p.read", level: "read", target: "x", reason: "测试用" };

/** v1 installed, consented and enabled. */
async function ready(): Promise<World & { v1: Manifest }> {
  const w = world();
  await install(w, V1, { enable: true });
  return Object.assign(w, { v1: await fixtureManifest(w, V1) });
}

const next = (v1: Manifest, patch: Partial<Manifest>) => manifestZip({ ...v1, version: "1.5.0", ...patch });

describe("T6: updatePackage refuses before it writes anything", () => {
  it("not installed: PERMISSION_DENIED / NOT_INSTALLED", async () => {
    const w = world();
    const err = await expectPlumsError(w.core.updatePackage(fixturePath(MORE), { consent: true }), "PERMISSION_DENIED");
    expect(err.details).toEqual({ id: ID, reason: "NOT_INSTALLED" });
  });

  const rejected: [string, (v1: Manifest) => Promise<Uint8Array> | Uint8Array, string, string, unknown?, [number, string, string][]?][] = [
    ["the same version", () => fixtureBytes(V1), "IMPORT_INVALID", "/version", { id: ID, installed: "1.0.0", incoming: "1.0.0" }],
    ["a downgrade", (v1) => manifestZip({ ...v1, version: "0.9.0" }), "IMPORT_INVALID", "/version", { id: ID, installed: "1.0.0", incoming: "0.9.0" }],
    ["a kind change", (v1) => next(v1, { kind: "connector" }), "IMPORT_INVALID", "/kind"],
    [
      "a required dependency that is missing",
      (v1) => next(v1, { dependencies: [{ kind: "extension", id: "does.not.exist", range: "^1.0.0" }] }),
      "DEPENDENCY_MISSING",
      "/dependencies/0",
    ],
    ["a new permission", () => fixtureBytes(MORE), "CONSENT_REQUIRED", "/permissions/1", { reason: "NEW_PERMISSION" }, [[1, "p.egress", "NEW_PERMISSION"]]],
    [
      "a raised level",
      (v1) => next(v1, { permissions: [{ ...READ, level: "write" }] }),
      "CONSENT_REQUIRED",
      "/permissions/0",
      { reason: "LEVEL_RAISED" },
      [[0, "p.read", "LEVEL_RAISED"]],
    ],
    [
      "a changed target",
      (v1) => next(v1, { permissions: [{ ...READ, target: "elsewhere" }] }),
      "CONSENT_REQUIRED",
      "/permissions/0",
      { reason: "TARGET_CHANGED" },
      [[0, "p.read", "TARGET_CHANGED"]],
    ],
    [
      "several growing permissions (the first one is reported)",
      (v1) =>
        next(v1, {
          permissions: [READ, { ...READ, id: "p.b", level: "write" }, { ...READ, id: "p.c" }],
        }),
      "CONSENT_REQUIRED",
      "/permissions/1",
      { reason: "NEW_PERMISSION" },
      [[1, "p.b", "NEW_PERMISSION"], [2, "p.c", "NEW_PERMISSION"]],
    ],
  ];

  it.each(rejected)("%s", async (_name, build, code, at, details) => {
    const w = await ready();
    const zip = await build(w.v1);
    for (const options of [undefined, {}, { consent: false }]) {
      const before = await snapshot(w);
      const err = await expectPlumsError(w.core.updatePackage(zip, options), code, at);
      if (details !== undefined) expect(err.details).toMatchObject(details as object);
      expect(await snapshot(w)).toEqual(before);
    }
  });

  // details.added lists every new or grown permission by its index in the new version. The top-level
  // path, details.permissionId and details.reason repeat the first entry.
  it.each(rejected.filter(([, , , , , added]) => added !== undefined))(
    "%s: details.added lists all of them",
    async (_name, build, _code, _at, _details, added) => {
      const w = await ready();
      const err = await expectPlumsError(w.core.updatePackage(await build(w.v1)), "CONSENT_REQUIRED");
      const expected = added!.map(([index, permissionId, reason]) => ({ path: `/permissions/${index}`, permissionId, reason }));
      expect(err.details).toMatchObject({ id: ID, permissionId: expected[0]!.permissionId, reason: expected[0]!.reason, added: expected });
      expect(err.path).toBe(expected[0]!.path);
      expect((err.details as { added: unknown[] }).added).toHaveLength(expected.length);
    },
  );

  it.each(rejected.filter(([, , code]) => code !== "CONSENT_REQUIRED"))(
    "%s is refused even with consent: true",
    async (_name, build, code, at) => {
      const w = await ready();
      const before = await snapshot(w);
      await expectPlumsError(w.core.updatePackage(await build(w.v1), { consent: true }), code, at);
      expect(await snapshot(w)).toEqual(before);
    },
  );

  it("a package that was never consented to is refused too, and stays that way", async () => {
    const w = world();
    await install(w, V1);
    const before = await snapshot(w);
    await expectPlumsError(w.core.updatePackage(fixturePath(MORE)), "CONSENT_REQUIRED", "/permissions/1");
    expect(await snapshot(w)).toEqual(before);
  });
});

describe("T6: a successful update", () => {
  it("swaps the whole folder, keeps enabled, and rewrites consent for the new list (path and bytes)", async () => {
    for (const input of [fixturePath(SAME), fixtureBytes(SAME)]) {
      const w = await ready();
      const old = await w.core.getConsent(ID);
      const result = await w.core.updatePackage(input);
      expect(result).toMatchObject({ previousVersion: "1.0.0", manifest: { id: ID, version: "1.1.0" } });
      expect(await w.core.listInstalled()).toMatchObject([{ id: ID, version: "1.1.0", enabled: true, consented: true }]);
      const consent = await w.core.getConsent(ID);
      expect(consent?.permissions).toEqual(result.manifest.permissions);
      expect(consent?.permissions).toEqual(old?.permissions);
      expect(JSON.parse(readFileSync(path.join(result.installDir, "manifest.json"), "utf8")).version).toBe("1.1.0");
    }
  });

  it("with consent: true takes new permissions into the consent record and stays enabled", async () => {
    const w = await ready();
    await w.core.updatePackage(fixturePath(MORE), { consent: true });
    expect(await w.core.listInstalled()).toMatchObject([{ version: "2.0.0", enabled: true, consented: true }]);
    expect((await w.core.getConsent(ID))?.permissions.map((p) => p.id)).toEqual(["p.read", "p.egress"]);
    expect(await w.core.runAction({ extensionId: ID, permissionId: "p.read" })).toEqual({ level: "read" });
  });

  it("replaces every file: old ones are gone, new ones are there", async () => {
    const w = world();
    const v1 = await fixtureManifest(w, V1);
    await w.core.importPackage(await manifestZip(v1, [{ name: "old.txt", data: "old" }, { name: "keep/a.txt", data: "a" }]));
    const dir = path.join(w.dataDir, "packages", ID);
    expect(existsSync(path.join(dir, "old.txt"))).toBe(true);
    await w.core.updatePackage(await manifestZip({ ...v1, version: "1.1.0" }, [{ name: "new.txt", data: "new" }]));
    expect(existsSync(path.join(dir, "old.txt"))).toBe(false);
    expect(existsSync(path.join(dir, "keep"))).toBe(false);
    expect(readFileSync(path.join(dir, "new.txt"), "utf8")).toBe("new");
    expect(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")).version).toBe("1.1.0");
  });

  it("does not create a consent out of thin air, with or without consent: true", async () => {
    for (const [file, options] of [[SAME, undefined], [SAME, { consent: true }], [MORE, { consent: true }]] as const) {
      const w = world();
      await install(w, V1);
      await w.core.updatePackage(fixturePath(file), options);
      expect(await w.core.getConsent(ID)).toBeNull();
      expect(await w.core.listInstalled()).toMatchObject([{ id: ID, enabled: false, consented: false }]);
      await expectPlumsError(w.core.enable(ID), "CONSENT_REQUIRED");
    }
  });

  it("dropping an x-secret field deletes the stored secret and leaves the others", async () => {
    const w = world();
    const v1 = await fixtureManifest(w, V1);
    const schema = {
      type: "object" as const,
      properties: {
        apiKey: { type: "string" as const, title: "API key", description: "Secret key.", "x-secret": true },
        keep: { type: "string" as const, title: "Keep", description: "Kept secret.", "x-secret": true },
      },
    };
    await w.core.importPackage(await manifestZip({ ...v1, settingsSchema: schema }));
    await w.core.grantConsent(ID);
    await w.secrets.set(secretRef(ID, "apiKey"), FAKE_SECRET);
    await w.secrets.set(secretRef(ID, "keep"), `${FAKE_SECRET}-keep`);
    const dropped = {
      type: "object" as const,
      properties: {
        apiKey: { type: "string" as const, title: "API key", description: "No longer a secret." },
        keep: { type: "string" as const, title: "Keep", description: "Kept secret.", "x-secret": true },
      },
    };
    await w.core.updatePackage(await manifestZip({ ...v1, version: "1.1.0", settingsSchema: dropped }));
    expect(await w.secrets.get(secretRef(ID, "apiKey"))).toBeUndefined();
    expect(await w.secrets.get(secretRef(ID, "keep"))).toBe(`${FAKE_SECRET}-keep`);
    expect(await w.core.listInstalled()).toMatchObject([{ id: ID, version: "1.1.0", enabled: false, consented: true }]);
  });

  it("a newly consented package can be enabled after an update", async () => {
    const w = world();
    await install(w, V1, { consent: true });
    await w.core.updatePackage(fixturePath(MORE), { consent: true });
    expect(await w.core.enable(ID)).toMatchObject({ enabled: true, version: "2.0.0" });
  });
});
