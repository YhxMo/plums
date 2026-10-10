import { Ajv } from "ajv";
import { rmSync } from "node:fs";
import type { SettingSpec } from "@plumsjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectPlumsError,
  makeCore,
  manifestZip,
  validManifestV2,
} from "./package-helpers.js";

let settingValueFailure: typeof import("../src/package/schema.js").settingValueFailure;
beforeEach(async () => {
  vi.resetModules();
  ({ settingValueFailure } = await import("../src/package/schema.js"));
});
afterEach(() => vi.restoreAllMocks());

function spec(extra: Partial<SettingSpec> = {}): SettingSpec {
  return {
    type: "integer",
    title: "Count",
    description: "Synthetic setting",
    ...extra,
  };
}

describe("bounded setting validators", () => {
  it("reuses equivalent constraints across fresh objects and ignores display metadata", () => {
    const compile = vi.spyOn(Ajv.prototype, "compile");
    expect(
      settingValueFailure(spec({ minimum: 0, maximum: 5 }), 3, true),
    ).toBeUndefined();
    const calls = compile.mock.calls.length;
    expect(
      settingValueFailure(
        spec({ minimum: 0, maximum: 5, title: "Other", default: 2 }),
        4,
        true,
      ),
    ).toBeUndefined();
    expect(compile).toHaveBeenCalledTimes(calls);
    expect(settingValueFailure(spec({ maximum: 3 }), 4, true)).toBe("MAXIMUM");
    expect(compile.mock.calls.length).toBeGreaterThan(calls);
    expect(settingValueFailure(spec({ maximum: 3 }), 4, false)).toBeUndefined();
  });

  it("snapshots enum content so a changed source array cannot poison an existing key", () => {
    const values = [1, 2];
    const original = spec({ enum: values });
    expect(settingValueFailure(original, 1, true)).toBeUndefined();
    values[0] = 3;
    expect(settingValueFailure(original, 1, true)).toBe("ENUM");
    expect(settingValueFailure(original, 3, true)).toBeUndefined();
    expect(
      settingValueFailure(spec({ enum: [1, 2] }), 1, true),
    ).toBeUndefined();
    expect(settingValueFailure(spec({ enum: [1, 2] }), 3, true)).toBe("ENUM");
  });

  it("evicts the least recently used entry at 256 validators", () => {
    const compile = vi.spyOn(Ajv.prototype, "compile");
    for (let i = 0; i < 256; i++)
      settingValueFailure(spec({ minimum: i }), i, true);
    const full = compile.mock.calls.length;
    settingValueFailure(spec({ minimum: 0 }), 0, true);
    expect(compile).toHaveBeenCalledTimes(full);
    settingValueFailure(spec({ minimum: 256 }), 256, true);
    const added = compile.mock.calls.length;
    settingValueFailure(spec({ minimum: 0 }), 0, true);
    expect(compile).toHaveBeenCalledTimes(added);
    settingValueFailure(spec({ minimum: 1 }), 1, true);
    expect(compile.mock.calls.length).toBeGreaterThan(added);
  });

  it("validates oversized schemas normally without caching them", () => {
    const compile = vi.spyOn(Ajv.prototype, "compile");
    const large = spec({ type: "string", enum: ["x".repeat(17 * 1024)] });
    expect(
      settingValueFailure(large, "x".repeat(17 * 1024), true),
    ).toBeUndefined();
    const calls = compile.mock.calls.length;
    expect(settingValueFailure(large, "rejected", true)).toBe("ENUM");
    expect(compile.mock.calls.length).toBeGreaterThan(calls);
  });

  it("removes Ajv's internal schema entries even when compilation fails", () => {
    const compile = vi.spyOn(Ajv.prototype, "compile");
    const remove = vi.spyOn(Ajv.prototype, "removeSchema");
    const invalid = spec({ enum: [1, 1] });
    expect(() => settingValueFailure(invalid, 1, true)).toThrow();
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ enum: [1, 1] }),
    );
    const calls = compile.mock.calls.length;
    expect(() => settingValueFailure(invalid, 1, true)).toThrow();
    expect(compile.mock.calls.length).toBeGreaterThan(calls);
  });

  it.each([
    [spec({ minimum: 1, maximum: 5, enum: [3] }), "wrong", "TYPE"],
    [spec({ minimum: 1, maximum: 5, enum: [3] }), 0, "MINIMUM"],
    [spec({ minimum: 1, maximum: 5, enum: [3] }), 8, "MAXIMUM"],
    [spec({ minimum: 1, maximum: 5, enum: [3] }), 2, "ENUM"],
    [spec({ type: "boolean", enum: [true] }), false, "ENUM"],
    [spec({ type: "number" }), Infinity, undefined],
    [spec(), 1.5, "TYPE"],
  ] as const)(
    "keeps Ajv's existing type and error priority for %j",
    (schema, value, reason) => {
      expect(settingValueFailure(schema, value, true)).toBe(reason);
      expect(settingValueFailure(schema, value, true)).toBe(reason);
    },
  );
});

it("reuses public setSettings validators and immediately enforces updated bounds", async () => {
  const { core, dataDir } = makeCore();
  try {
    const manifest = validManifestV2();
    manifest.settingsSchema = {
      type: "object",
      properties: { count: spec({ maximum: 29 }) },
    };
    await core.importPackage(await manifestZip(manifest));
    await core.setSettings(manifest.id, { count: 3 });
    const compile = vi.spyOn(Ajv.prototype, "compile");
    await core.setSettings(manifest.id, { count: 4 });
    expect(compile).not.toHaveBeenCalled();
    await core.updatePackage(
      await manifestZip({
        ...manifest,
        version: "1.2.4",
        settingsSchema: {
          type: "object",
          properties: { count: spec({ maximum: 5 }) },
        },
      }),
    );
    const error = await expectPlumsError(
      core.setSettings(manifest.id, { count: 6 }),
      "SETTINGS_INVALID",
      "/settings/count",
    );
    expect(error.details).toEqual({ key: "count", reason: "MAXIMUM" });
    expect(await core.resolveSettings(manifest.id)).toEqual({ count: 4 });
  } finally {
    core.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
