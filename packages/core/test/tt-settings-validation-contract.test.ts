import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Manifest, SettingSpec, SettingsSchema } from "@plums/core";
import { describe, expect, it } from "vitest";
import { expectNothingWritten, serializeError, useWorlds } from "./contract-helpers.js";
import { expectPlumsError, manifestZip, validManifest } from "./package-helpers.js";

/**
 * Settings checks that #18's settings-validation.test.ts does not already pin.
 * That file (merged with f36f89f6) already covers a non-secret field missing
 * type, title or description, minimum on a string, a default of the wrong type
 * or above its maximum, setSettings TYPE / REQUIRED / MAXIMUM / ENUM, leftover
 * import rollbacks including a JSON array, and an update that drops
 * settingsSchema. The x-secret whitelist, including a secret `default`, already
 * lives in tt2-secrets-contract.test.ts. This file does not repeat those.
 *
 * 基线不同、故意自包含、故意绕过 API。Leak checks use the local serializeError.
 * @plums/core does not export that function.
 */

const world = useWorlds();

/** Distinctive enough that a leaked rejected value cannot hide in a short message. */
const MARK = "plums-settings-LEAK-9f3a7c1e";

function pack(settings: SettingsSchema, id = "test.settings.contract"): Manifest {
  const manifest = validManifest();
  manifest.id = id;
  manifest.dependencies = [];
  manifest.settingsSchema = settings;
  return manifest;
}

const text = (extra: Partial<SettingSpec> = {}): SettingSpec => ({
  type: "string",
  title: "Label",
  description: "Explains the field.",
  ...extra,
});

describe("manifest: an x-secret property still needs type, title and description", () => {
  it.each(["type", "title", "description"] as const)("missing %s is MANIFEST_INVALID at that keyword", async (missing) => {
    const w = world();
    const field: Record<string, unknown> = {
      type: "string",
      title: "API key",
      description: "Secret key.",
      "x-secret": true,
    };
    delete field[missing];
    const manifest = pack({ type: "object", properties: { apiKey: field as SettingSpec } });
    await expectPlumsError(
      w.core.importPackage(await manifestZip(manifest)),
      "MANIFEST_INVALID",
      `/settingsSchema/properties/apiKey/${missing}`,
    );
    expectNothingWritten(w);
  });
});

describe("manifest: a default has to satisfy its own bounds", () => {
  it("a default below minimum is MANIFEST_INVALID at .../default and does not leak the value", async () => {
    const w = world();
    const bad = -4242424242;
    const manifest = pack({
      type: "object",
      properties: {
        retries: { type: "integer", title: "Retries", description: "How many times to retry.", minimum: 1, default: bad },
      },
    });
    const err = await expectPlumsError(
      w.core.importPackage(await manifestZip(manifest)),
      "MANIFEST_INVALID",
      "/settingsSchema/properties/retries/default",
    );
    expect(serializeError(err)).not.toContain(String(bad));
    expectNothingWritten(w);
  });

  it("a default outside enum is MANIFEST_INVALID at .../default and does not leak the value", async () => {
    const w = world();
    const bad = `${MARK}-DEFAULT`;
    const manifest = pack({
      type: "object",
      properties: {
        nickname: { ...text(), enum: ["Pat", "Sam"], default: bad },
      },
    });
    const err = await expectPlumsError(
      w.core.importPackage(await manifestZip(manifest)),
      "MANIFEST_INVALID",
      "/settingsSchema/properties/nickname/default",
    );
    expect(serializeError(err)).not.toContain(bad);
    expectNothingWritten(w);
  });
});

describe("setSettings order: required and type, then a default, then the bounds", () => {
  const schema = (): SettingsSchema => ({
    type: "object",
    required: ["nickname"],
    properties: {
      nickname: { ...text({ title: "Nickname", description: "What to call you." }), enum: ["Pat", "Sam"] },
      retries: {
        type: "integer",
        title: "Retries",
        description: "How many times to retry.",
        minimum: 1,
        maximum: 5,
        default: 3,
      },
    },
  });

  it("fills a default that itself passes minimum, maximum and enum, and a later failure leaves the bytes", async () => {
    const w = world();
    const manifest = pack(schema());
    await w.core.importPackage(await manifestZip(manifest));
    const file = path.join(w.dataDir, "data", manifest.id, "settings.json");

    const refuse = async (
      values: Record<string, unknown>,
      key: string,
      reason: string,
      marker: string | undefined,
      before: Buffer | null,
    ) => {
      const err = await expectPlumsError(
        w.core.setSettings(manifest.id, values),
        "SETTINGS_INVALID",
        `/settings/${key}`,
      );
      expect(err.details).toEqual({ key, reason });
      if (marker !== undefined) expect(serializeError(err)).not.toContain(marker);
      const after = existsSync(file) ? readFileSync(file) : null;
      expect(after).toEqual(before);
    };

    // Required is decided before any default is filled, so an empty object never becomes { retries: 3 }.
    await refuse({}, "nickname", "REQUIRED", undefined, null);

    // A present value of the wrong type is TYPE. The default is not used to paper over it.
    const typeMarker = `${MARK}-TYPE`;
    await refuse({ nickname: { token: typeMarker } }, "nickname", "TYPE", typeMarker, null);

    await w.core.setSettings(manifest.id, { nickname: "Pat" });
    const saved = readFileSync(file);
    // The omitted retries field was filled with 3, and that default passed minimum and maximum.
    expect(JSON.parse(saved.toString("utf8"))).toEqual({ nickname: "Pat", retries: 3 });

    const low = -4242424242;
    await refuse({ nickname: "Pat", retries: low }, "retries", "MINIMUM", String(low), saved);
    const high = 4242424242;
    await refuse({ nickname: "Pat", retries: high }, "retries", "MAXIMUM", String(high), saved);
    const enumMarker = `${MARK}-ENUM`;
    await refuse({ nickname: enumMarker, retries: 3 }, "nickname", "ENUM", enumMarker, saved);
  });
});

describe("manifest: minimum and maximum belong on numbers", () => {
  it("maximum on a string setting is MANIFEST_INVALID at .../maximum", async () => {
    const w = world();
    const manifest = pack({
      type: "object",
      properties: { nickname: { ...text({ title: "Nickname", description: "What to call you." }), maximum: 1 } },
    });
    await expectPlumsError(
      w.core.importPackage(await manifestZip(manifest)),
      "MANIFEST_INVALID",
      "/settingsSchema/properties/nickname/maximum",
    );
    expectNothingWritten(w);
  });
});

describe("import rejects a leftover JSON value that is not an object", () => {
  it("a bare JSON string is NOT_JSON at /settings and leaves the file", async () => {
    const w = world();
    const manifest = pack({
      type: "object",
      properties: { nickname: text({ title: "Nickname", description: "What to call you." }) },
    });
    const bare = `"${MARK}-BARE"`;
    const file = path.join(w.dataDir, "data", manifest.id, "settings.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bare);
    const err = await expectPlumsError(w.core.importPackage(await manifestZip(manifest)), "IMPORT_INVALID", "/settings");
    expect(err.details).toEqual({ reason: "NOT_JSON" });
    expect(serializeError(err)).not.toContain(MARK);
    expect(await w.core.listInstalled()).toEqual([]);
    expect(existsSync(path.join(w.dataDir, "packages", manifest.id))).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(bare);
  });
});
