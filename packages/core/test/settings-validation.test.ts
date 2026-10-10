import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Manifest, SettingsSchema } from "@plumsjs/core";
import { describe, expect, it } from "vitest";
import {
  expectPlumsError,
  makeCore,
  manifestZip,
  validManifest,
} from "./package-helpers.js";

const SECRET = "sk-FAKE-settings-value";

function schema(maximum = 5): SettingsSchema {
  return {
    type: "object",
    required: ["nickname"],
    properties: {
      nickname: {
        type: "string",
        title: "Nickname",
        description: "What to call you.",
        enum: ["Pat", "Sam"],
      },
      retries: {
        type: "integer",
        title: "Retries",
        description: "How many times to retry.",
        minimum: 1,
        maximum,
        default: 3,
      },
    },
  };
}

function pack(
  settings: SettingsSchema | undefined,
  version = "1.2.3",
): Manifest {
  const manifest = validManifest();
  manifest.version = version;
  manifest.dependencies = [];
  if (settings === undefined) delete manifest.settingsSchema;
  else manifest.settingsSchema = settings;
  return manifest;
}

function plant(dataDir: string, id: string, text: string): string {
  const file = path.join(dataDir, "data", id, "settings.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

describe("setSettings checks values before writing", () => {
  it("rejects a wrong type, a missing required field, a bound, and an enum without changing the file", async () => {
    const { core, dataDir } = makeCore();
    const manifest = pack(schema());
    await core.importPackage(await manifestZip(manifest));
    const file = path.join(dataDir, "data", manifest.id, "settings.json");

    const wrongType = await expectPlumsError(
      core.setSettings(manifest.id, { nickname: 1 }),
      "SETTINGS_INVALID",
      "/settings/nickname",
    );
    expect(wrongType.details).toEqual({ key: "nickname", reason: "TYPE" });
    expect(existsSync(file)).toBe(false);

    const missing = await expectPlumsError(
      core.setSettings(manifest.id, {}),
      "SETTINGS_INVALID",
      "/settings/nickname",
    );
    expect(missing.details).toEqual({ key: "nickname", reason: "REQUIRED" });
    expect(existsSync(file)).toBe(false);

    const withDefault = schema();
    withDefault.properties.nickname!.default = "Pat";
    const requiredDespiteDefault = pack(withDefault, "1.2.4");
    // A second id keeps this order check off the file written below.
    requiredDespiteDefault.id = "demo-defaults";
    await core.importPackage(await manifestZip(requiredDespiteDefault));
    const stillRequired = await expectPlumsError(
      core.setSettings("demo-defaults", {}),
      "SETTINGS_INVALID",
      "/settings/nickname",
    );
    expect(stillRequired.details).toEqual({
      key: "nickname",
      reason: "REQUIRED",
    });

    await core.setSettings(manifest.id, { nickname: "Pat" });
    const saved = readFileSync(file, "utf8");
    expect(JSON.parse(saved)).toEqual({ nickname: "Pat", retries: 3 });

    const tooHigh = await expectPlumsError(
      core.setSettings(manifest.id, { nickname: "Pat", retries: 9 }),
      "SETTINGS_INVALID",
      "/settings/retries",
    );
    expect(tooHigh.details).toEqual({ key: "retries", reason: "MAXIMUM" });
    expect(readFileSync(file, "utf8")).toBe(saved);

    const notInEnum = await expectPlumsError(
      core.setSettings(manifest.id, { nickname: SECRET, retries: 3 }),
      "SETTINGS_INVALID",
      "/settings/nickname",
    );
    expect(notInEnum.details).toEqual({ key: "nickname", reason: "ENUM" });
    expect(notInEnum.message).not.toContain(SECRET);
    expect(JSON.stringify(notInEnum.details)).not.toContain(SECRET);
    expect(readFileSync(file, "utf8")).toBe(saved);
  });
});

describe("leftover settings.json", () => {
  const cases: [
    string,
    string,
    SettingsSchema | undefined,
    string,
    { key?: string; reason: string },
  ][] = [
    [
      "missing required",
      "{}",
      schema(),
      "/settings/nickname",
      { key: "nickname", reason: "REQUIRED" },
    ],
    [
      "wrong type",
      '{"nickname":1}',
      schema(),
      "/settings/nickname",
      { key: "nickname", reason: "TYPE" },
    ],
    [
      "stricter maximum",
      '{"nickname":"Pat","retries":8}',
      schema(3),
      "/settings/retries",
      { key: "retries", reason: "MAXIMUM" },
    ],
    [
      "no settingsSchema",
      `{"nickname":"${SECRET}"}`,
      undefined,
      "/settings",
      { reason: "NO_SCHEMA" },
    ],
    ["invalid JSON", "{", schema(), "/settings", { reason: "NOT_JSON" }],
    [
      "JSON that is not an object",
      "[]",
      schema(),
      "/settings",
      { reason: "NOT_JSON" },
    ],
  ];

  it.each(cases)(
    "%s rolls the package back and leaves no install record",
    async (_name, text, settings, at, details) => {
      const { core, dataDir } = makeCore();
      const manifest = pack(settings);
      const file = plant(dataDir, manifest.id, text);
      const err = await expectPlumsError(
        core.importPackage(await manifestZip(manifest)),
        "IMPORT_INVALID",
        at,
      );
      expect(err.details).toEqual(details);
      expect(err.message).not.toContain(SECRET);
      expect(JSON.stringify(err.details)).not.toContain(SECRET);
      expect(await core.listInstalled()).toEqual([]);
      expect(existsSync(path.join(dataDir, "packages", manifest.id))).toBe(
        false,
      );
      expect(readFileSync(file, "utf8")).toBe(text);
    },
  );

  it("keeps a leftover file that already matches, without rewriting it", async () => {
    const { core, dataDir } = makeCore();
    const manifest = pack(schema());
    const text = '{"nickname":"Pat"}\n';
    const file = plant(dataDir, manifest.id, text);
    await core.importPackage(await manifestZip(manifest));
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id: manifest.id, version: "1.2.3" }),
    ]);
  });

  it("rolls an update back to the installed files when the new schema is stricter", async () => {
    const { core, dataDir } = makeCore();
    const installed = pack(schema(10));
    await core.importPackage(
      await manifestZip(installed, [{ name: "old.txt", data: "old" }]),
    );
    await core.grantConsent(installed.id);
    await core.enable(installed.id);
    await core.setSettings(installed.id, { nickname: "Pat", retries: 8 });
    const file = path.join(dataDir, "data", installed.id, "settings.json");
    const before = readFileSync(file, "utf8");
    const err = await expectPlumsError(
      core.updatePackage(
        await manifestZip(pack(schema(3), "1.3.0"), [
          { name: "new.txt", data: "new" },
        ]),
      ),
      "IMPORT_INVALID",
      "/settings/retries",
    );
    expect(err.details).toEqual({ key: "retries", reason: "MAXIMUM" });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({
        id: installed.id,
        version: "1.2.3",
        enabled: true,
        consented: true,
      }),
    ]);
    expect((await core.getConsent(installed.id))?.version).toBe("1.2.3");
    const dir = path.join(dataDir, "packages", installed.id);
    expect(readFileSync(path.join(dir, "old.txt"), "utf8")).toBe("old");
    expect(existsSync(path.join(dir, "new.txt"))).toBe(false);
    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "manifest.json"), "utf8"),
    ) as Manifest;
    expect(onDisk.version).toBe("1.2.3");
    expect(onDisk.settingsSchema?.properties.retries?.maximum).toBe(10);
  });

  it("updates to a package with no settingsSchema and leaves the settings file unread", async () => {
    const { core, dataDir } = makeCore();
    const installed = pack(schema());
    await core.importPackage(
      await manifestZip(installed, [{ name: "old.txt", data: "old" }]),
    );
    await core.grantConsent(installed.id);
    await core.enable(installed.id);
    const grantedAt = (await core.getConsent(installed.id))?.grantedAt;
    await core.setSettings(installed.id, { nickname: "Pat" });
    const file = path.join(dataDir, "data", installed.id, "settings.json");
    const before = readFileSync(file, "utf8");
    const updated = await core.updatePackage(
      await manifestZip(pack(undefined, "1.3.0"), [
        { name: "new.txt", data: "new" },
      ]),
    );
    expect(updated.previousVersion).toBe("1.2.3");
    expect(updated.manifest.settingsSchema).toBeUndefined();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({
        id: installed.id,
        version: "1.3.0",
        enabled: true,
        consented: true,
      }),
    ]);
    expect((await core.getConsent(installed.id))?.grantedAt).toBe(grantedAt);
    const dir = path.join(dataDir, "packages", installed.id);
    expect(readFileSync(path.join(dir, "new.txt"), "utf8")).toBe("new");
    expect(existsSync(path.join(dir, "old.txt"))).toBe(false);
    const onDisk = JSON.parse(
      readFileSync(path.join(dir, "manifest.json"), "utf8"),
    ) as Manifest;
    expect(onDisk.version).toBe("1.3.0");
    expect(onDisk.settingsSchema).toBeUndefined();
  });
});
