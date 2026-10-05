import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Manifest, SettingsSchema } from "@plums/core";
import { describe, expect, it } from "vitest";
import { serializeError } from "./contract-helpers.js";
import { expectPlumsError, makeCore, manifestZip, validManifest } from "./package-helpers.js";

/**
 * Update paths that settings-validation.test.ts (from #13 @ 0ddb05db, which
 * contains #18 @ f36f89f6) does not already pin. That file already covers the
 * leftover import failures, including a JSON array, one stricter-schema update,
 * and one update that drops settingsSchema.
 *
 * These tests assert the installed end state. They do not look for a backup
 * directory: the leftover check runs before any files are moved.
 *
 * Leak checks use the shared serializeError helper, including non-enumerable
 * error properties and the whole cause chain.
 */

const MARK = "plums-settings-LEAK-9f3a7c1e";

function pack(settings: SettingsSchema | undefined, version: string): Manifest {
  const manifest = validManifest();
  manifest.version = version;
  manifest.dependencies = [];
  if (settings === undefined) delete manifest.settingsSchema;
  else manifest.settingsSchema = settings;
  return manifest;
}

const nickname = (type: "string" | "integer"): SettingsSchema => ({
  type: "object",
  required: type === "string" ? [] : ["nickname"],
  properties: {
    nickname: {
      type,
      title: "Nickname",
      description: "What to call you.",
    },
  },
});

describe("updatePackage rolls back when leftover settings fail the new schema", () => {
  const updates: [string, "REQUIRED" | "TYPE" | "NOT_JSON", string, string | undefined][] = [
    ["a missing required field", "REQUIRED", "/settings/nickname", undefined],
    ["a value of the wrong type", "TYPE", "/settings/nickname", undefined],
    ["invalid leftover JSON", "NOT_JSON", "/settings", `{"nickname":"${MARK}-NOT-JSON"`],
    ["a JSON array", "NOT_JSON", "/settings", "[]"],
    ["a bare JSON string", "NOT_JSON", "/settings", `"${MARK}-BARE"`],
  ];

  it.each(updates)("%s restores the installed package and leaves settings.json", async (_name, reason, at, broken) => {
    const { core, dataDir } = makeCore();
    const installed = pack(nickname("string"), "1.2.3");
    await core.importPackage(await manifestZip(installed, [{ name: "old.txt", data: "old" }]));
    await core.grantConsent(installed.id);
    await core.enable(installed.id);
    const saved = reason === "TYPE" ? { nickname: `${MARK}-TYPE` } : reason === "REQUIRED" ? {} : { nickname: "Pat" };
    await core.setSettings(installed.id, saved);
    const file = path.join(dataDir, "data", installed.id, "settings.json");
    const before = readFileSync(file);
    if (broken !== undefined) writeFileSync(file, broken);
    const consent = await core.getConsent(installed.id);

    const next = pack(nickname(reason === "TYPE" ? "integer" : "string"), "1.3.0");
    if (reason === "REQUIRED") next.settingsSchema!.required = ["nickname"];
    const err = await expectPlumsError(
      core.updatePackage(await manifestZip(next, [{ name: "new.txt", data: "new" }])),
      "IMPORT_INVALID",
      at,
    );
    expect(err.details).toEqual(reason === "NOT_JSON" ? { reason } : { key: "nickname", reason });
    expect(serializeError(err)).not.toContain(MARK);
    if (broken !== undefined) expect(readFileSync(file, "utf8")).toBe(broken);
    else expect(readFileSync(file)).toEqual(before);
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id: installed.id, version: "1.2.3", enabled: true, consented: true }),
    ]);
    expect(await core.getConsent(installed.id)).toEqual(consent);
    const dir = path.join(dataDir, "packages", installed.id);
    expect(readFileSync(path.join(dir, "old.txt"), "utf8")).toBe("old");
    expect(existsSync(path.join(dir, "new.txt"))).toBe(false);
    // The truncated-JSON row did not check the on-disk manifest. The other four did.
    if (broken !== `{"nickname":"${MARK}-NOT-JSON"`) {
      const onDisk = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
      expect(onDisk.version).toBe("1.2.3");
    }
  });
});

describe("a schema can return after an update that dropped it", () => {
  /** Installs 1.2.3, saves a nickname, then updates to 1.3.0 with no settingsSchema. */
  async function dropSchema() {
    const { core, dataDir } = makeCore();
    const installed = pack(nickname("string"), "1.2.3");
    await core.importPackage(await manifestZip(installed, [{ name: "old.txt", data: "old" }]));
    await core.grantConsent(installed.id);
    await core.enable(installed.id);
    const grantedAt = (await core.getConsent(installed.id))?.grantedAt;
    await core.setSettings(installed.id, { nickname: `${MARK}-KEEP` });
    const file = path.join(dataDir, "data", installed.id, "settings.json");
    const before = readFileSync(file);
    const updated = await core.updatePackage(
      await manifestZip(pack(undefined, "1.3.0"), [{ name: "mid.txt", data: "mid" }]),
    );
    // The no-schema update itself is settings-validation.test.ts. Here it is only setup.
    expect(updated.previousVersion).toBe("1.2.3");
    expect(readFileSync(file)).toEqual(before);
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id: installed.id, version: "1.3.0", enabled: true, consented: true }),
    ]);
    expect((await core.getConsent(installed.id))?.version).toBe("1.3.0");
    return { core, dataDir, id: installed.id, file, before, grantedAt };
  }

  it("accepts the leftover file when the later schema allows it, and does not rewrite the bytes", async () => {
    const { core, dataDir, id, file, before, grantedAt } = await dropSchema();
    const updated = await core.updatePackage(
      await manifestZip(pack(nickname("string"), "1.4.0"), [{ name: "new.txt", data: "new" }]),
    );
    expect(updated.previousVersion).toBe("1.3.0");
    expect(updated.manifest.settingsSchema?.properties.nickname?.type).toBe("string");
    expect(readFileSync(file)).toEqual(before);
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id, version: "1.4.0", enabled: true, consented: true }),
    ]);
    expect((await core.getConsent(id))?.version).toBe("1.4.0");
    expect((await core.getConsent(id))?.grantedAt).toBe(grantedAt);
    const dir = path.join(dataDir, "packages", id);
    expect(readFileSync(path.join(dir, "new.txt"), "utf8")).toBe("new");
    expect(existsSync(path.join(dir, "mid.txt"))).toBe(false);
  });

  it("rejects the leftover file when the later schema is stricter, and stays on the no-schema version", async () => {
    const dropped = await dropSchema();
    const consent = await dropped.core.getConsent(dropped.id);
    const err = await expectPlumsError(
      dropped.core.updatePackage(
        await manifestZip(pack(nickname("integer"), "1.4.0"), [{ name: "new.txt", data: "new" }]),
      ),
      "IMPORT_INVALID",
      "/settings/nickname",
    );
    expect(err.details).toEqual({ key: "nickname", reason: "TYPE" });
    expect(serializeError(err)).not.toContain(MARK);
    expect(readFileSync(dropped.file)).toEqual(dropped.before);
    expect(await dropped.core.listInstalled()).toEqual([
      expect.objectContaining({ id: dropped.id, version: "1.3.0", enabled: true, consented: true }),
    ]);
    expect(await dropped.core.getConsent(dropped.id)).toEqual(consent);
    const dir = path.join(dropped.dataDir, "packages", dropped.id);
    expect(readFileSync(path.join(dir, "mid.txt"), "utf8")).toBe("mid");
    expect(existsSync(path.join(dir, "new.txt"))).toBe(false);
    const onDisk = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    expect(onDisk.version).toBe("1.3.0");
    expect(onDisk.settingsSchema).toBeUndefined();
  });
});
