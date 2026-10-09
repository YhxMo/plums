import assert from "node:assert/strict";
import { mkdtemp, rm, lstat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  secretRef,
  type Core,
} from "../src/index.js";
import { validManifestV2 } from "./package-helpers.js";
import { InstallStore } from "../src/install/store.js";

const cores: Core[] = [],
  directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const core of cores.splice(0)) core.close();
  for (const dir of directories.splice(0)) {
    await rm(dir, { recursive: true, force: true });
    await assert.rejects(lstat(dir), { code: "ENOENT" });
  }
});
async function fixture() {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "plums-installed-snapshot-"),
  );
  directories.push(dataDir);
  const secrets = new MemorySecretStore(),
    egress = new RecordingEgressSink();
  const core = createCore({ dataDir, secrets, egress });
  cores.push(core);
  const manifest = {
    ...validManifestV2(),
    permissions: [],
    payload: {},
    settingsSchema: {
      type: "object" as const,
      properties: {
        token: {
          type: "string" as const,
          "x-secret": true,
          title: "Token",
          description: "Synthetic",
        },
      },
    },
  };
  await core.importPackage(
    await core.exportPackage({
      manifest,
      files: { "main.js": "SYNTHETIC_SOURCE_TEXT" },
    }),
  );
  const expected = await core.getPackageContents(manifest.id);
  return { core, dataDir, secrets, egress, manifest, expected };
}

it.each(["id", "SYNTHETIC_SOURCE_TEXT"])(
  "matches the installed pin without exporting credential-overlapping text %s",
  async (value) => {
    const f = await fixture();
    await f.secrets.set(secretRef(f.manifest.id, "token"), value);
    expect(
      await f.core.matchesInstalledPackage(f.manifest.id, f.expected),
    ).toBe(true);
    await expect(
      f.core.getPackageContents(f.manifest.id),
    ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
    await expect(f.core.exportPackage(f.expected)).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
    expect(f.egress.records).toEqual([]);
  },
);

it.each(["changed", "added", "removed"])(
  "does not match a %s installed file",
  async (mode) => {
    const f = await fixture(),
      root = path.join(f.dataDir, "packages", f.manifest.id);
    if (mode === "changed")
      await writeFile(path.join(root, "main.js"), "modified");
    if (mode === "added") await writeFile(path.join(root, "extra.js"), "extra");
    if (mode === "removed") await rm(path.join(root, "main.js"));
    expect(
      await f.core.matchesInstalledPackage(f.manifest.id, f.expected),
    ).toBe(false);
  },
);

it("copies the supplied pin before reading files and checks installation identity after reading", async () => {
  const f = await fixture(),
    supplied = structuredClone(f.expected);
  const pending = f.core.matchesInstalledPackage(f.manifest.id, supplied);
  supplied.files["main.js"]!.fill(0);
  supplied.manifest.name = "Changed caller input";
  expect(await pending).toBe(true);
  expect(await f.core.matchesInstalledPackage(f.manifest.id, supplied)).toBe(
    false,
  );
  const original = InstallStore.prototype.getManifest;
  let changed = false;
  vi.spyOn(InstallStore.prototype, "getManifest").mockImplementation(function (
    this: InstallStore,
    id,
  ) {
    const result = original.call(this, id);
    if (!changed) {
      changed = true;
      this.remove(id);
    }
    return result;
  });
  expect(await f.core.matchesInstalledPackage(f.manifest.id, f.expected)).toBe(
    false,
  );
});

it("compares the full manifest including unknown fields and requires installation", async () => {
  const f = await fixture(),
    supplied = structuredClone(f.expected);
  supplied.manifest.future = { selection: { id: "synthetic" } };
  expect(await f.core.matchesInstalledPackage(f.manifest.id, supplied)).toBe(
    false,
  );
  await f.core.uninstall(f.manifest.id);
  await expect(
    f.core.matchesInstalledPackage(f.manifest.id, f.expected),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});
