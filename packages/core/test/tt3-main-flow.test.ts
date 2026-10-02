import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countRows, fixtureBytes, fixturePath, snapshot, useWorlds, type World } from "./contract-helpers.js";
import { expectPlumsError } from "./package-helpers.js";

const world = useWorlds();

const installDir = (w: World, id: string) => path.join(w.dataDir, "packages", id);
const dataDirOf = (w: World, id: string) => path.join(w.dataDir, "data", id);

describe("main flow: import, inspect, consent, enable, run, uninstall, reinstall", () => {
  const FILE = "valid/extension-3-levels.zip";
  const ID = "test.ext.perms";

  it("walks the whole line", async () => {
    const w = world({ answers: [] });
    const { core } = w;

    const imported = await core.importPackage(fixturePath(FILE));
    expect(imported.manifest.id).toBe(ID);
    expect(existsSync(installDir(w, ID))).toBe(true);
    expect(await core.listInstalled()).toMatchObject([{ id: ID, kind: "extension", enabled: false, consented: false }]);
    expect(await core.getConsent(ID)).toBeNull();

    const before = await snapshot(w);
    const summary = await core.inspect(fixtureBytes(FILE));
    expect(summary).toMatchObject({ kind: "extension", id: ID });
    expect(summary.permissions.map((p) => p.level)).toEqual(["read", "write", "egress"]);
    expect(await snapshot(w)).toEqual(before);

    await expectPlumsError(core.enable(ID), "CONSENT_REQUIRED");
    await expectPlumsError(core.runAction({ extensionId: ID, permissionId: "p.read" }), "PERMISSION_DENIED");
    expect(await core.listInstalled()).toMatchObject([{ enabled: false, consented: false }]);

    const consent = await core.grantConsent(ID);
    expect(consent.permissions).toEqual(summary.permissions);
    expect(await core.getConsent(ID)).toEqual(consent);
    expect(await core.enable(ID)).toMatchObject({ id: ID, enabled: true, consented: true });

    expect(await core.runAction({ extensionId: ID, permissionId: "p.read" })).toEqual({ level: "read" });
    expect(w.confirm.asked).toEqual([]);
    expect(w.egress.records).toEqual([]);

    await core.setSettings(ID, { nickname: "Pat" });
    expect(existsSync(dataDirOf(w, ID))).toBe(true);

    await core.uninstall(ID);
    expect(existsSync(installDir(w, ID))).toBe(false);
    expect(existsSync(dataDirOf(w, ID))).toBe(false);
    expect(await core.listInstalled()).toEqual([]);
    expect([countRows(w, "packages"), countRows(w, "consents")]).toEqual([0, 0]);
    await expectPlumsError(core.getConsent(ID), "PERMISSION_DENIED");
    await expectPlumsError(core.runAction({ extensionId: ID, permissionId: "p.read" }), "PERMISSION_DENIED");

    await core.importPackage(fixturePath(FILE));
    expect(await core.listInstalled()).toMatchObject([{ id: ID, enabled: false, consented: false }]);
    expect(await core.getConsent(ID)).toBeNull();
    await expectPlumsError(core.enable(ID), "CONSENT_REQUIRED");
    await core.grantConsent(ID);
    expect(await core.enable(ID)).toMatchObject({ enabled: true, consented: true });
  });

  it.each([
    ["character", "valid/character-min.zip", "test.char.min"],
    ["connector", "valid/connector-min.zip", "test.conn.min"],
    ["extension", "valid/extension-min.zip", "test.ext.min"],
  ])("the same install state line holds for a %s", async (kind, file, id) => {
    const w = world();
    await w.core.importPackage(fixtureBytes(file));
    expect(await w.core.listInstalled()).toMatchObject([{ id, kind, enabled: false, consented: false }]);
    await expectPlumsError(w.core.enable(id), "CONSENT_REQUIRED");
    await w.core.grantConsent(id);
    await w.core.enable(id);
    await w.core.uninstall(id);
    expect(existsSync(installDir(w, id))).toBe(false);
    expect([countRows(w, "packages"), countRows(w, "consents")]).toEqual([0, 0]);
    await w.core.importPackage(fixtureBytes(file));
    expect(await w.core.listInstalled()).toMatchObject([{ id, enabled: false, consented: false }]);
    await expectPlumsError(w.core.enable(id), "CONSENT_REQUIRED");
  });
});
