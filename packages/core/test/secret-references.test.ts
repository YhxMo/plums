import assert from "node:assert/strict";
import { mkdtemp, rm, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  secretRef,
  type Core,
} from "../src/index.js";
import { InstallStore } from "../src/install/store.js";
import { validManifestV2 } from "./package-helpers.js";

const cores: Core[] = [],
  stores: InstallStore[] = [],
  directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const core of cores.splice(0)) core.close();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(lstat(directory), { code: "ENOENT" });
  }
});
async function fixture(count = 1) {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "plums-secret-references-"),
  );
  directories.push(dataDir);
  const secrets = new MemorySecretStore();
  const options = { dataDir, secrets, egress: new RecordingEgressSink() };
  const core = createCore(options);
  cores.push(core);
  const manifests = Array.from({ length: count }, (_, index) => ({
    ...validManifestV2(),
    id: `fixture.references-${index}`,
    kind: "character" as const,
    permissions: [],
    settingsSchema: {
      type: "object" as const,
      properties: {
        token: {
          type: "string" as const,
          "x-secret": true,
          title: "Synthetic",
          description: "Synthetic",
        },
      },
    },
    payload: {},
  }));
  for (const manifest of manifests)
    await core.importPackage(await core.exportPackage({ manifest }));
  const store = new InstallStore(dataDir);
  stores.push(store);
  return { core, store, secrets, options, manifests };
}

it("enumerates current and historical settings plus orphan reservations across restart and release", async () => {
  const f = await fixture(2);
  const manifest = f.manifests[0]!;
  const token = secretRef(manifest.id, "token");
  await f.secrets.set(token, "SYNTHETIC_TOKEN");
  await f.core.updatePackage(
    await f.core.exportPackage({
      manifest: { ...manifest, version: "2.0.0", settingsSchema: undefined },
    }),
  );
  const pending = secretRef(f.manifests[1]!.id, "late");
  const installedAt = (await f.core.listInstalled()).find(
    (p) => p.id === f.manifests[1]!.id,
  )!.installedAt;
  expect(
    f.store.reserveLocalCredentialReferences(f.manifests[1]!.id, installedAt, [
      pending,
    ]),
  ).toBe(true);
  await f.core.uninstall(f.manifests[1]!.id);
  await f.secrets.set(pending, "SYNTHETIC_LATE_TOKEN");
  f.core.close();
  const reopened = createCore(f.options);
  cores.push(reopened);
  expect(new Set(await reopened.listSecretReferences())).toEqual(
    new Set([token, pending]),
  );
  await f.secrets.delete(pending);
  f.store.releaseLocalCredentialReferences(f.manifests[1]!.id, installedAt, [
    pending,
  ]);
  expect(await reopened.listSecretReferences()).toEqual([token]);
});

it.each([1, 12])(
  "enumerates %i components with one reusable SELECT and no value or manifest reads",
  async (count) => {
    const f = await fixture(count);
    const first = await f.core.listSecretReferences();
    const get = vi.spyOn(f.secrets, "get");
    const list = vi.spyOn(InstallStore.prototype, "list");
    const manifest = vi.spyOn(InstallStore.prototype, "getManifest");
    const prepare = vi.spyOn(Database.prototype, "prepare");
    const probe = new Database(":memory:");
    const prototype = Object.getPrototypeOf(
      probe.prepare("SELECT 1"),
    ) as Database.Statement;
    probe.close();
    prepare.mockClear();
    const queries: string[] = [],
      original = prototype.all;
    const all = vi.spyOn(prototype, "all").mockImplementation(function (
      this: Database.Statement,
      ...args: unknown[]
    ) {
      queries.push(this.source);
      return original.apply(this, args);
    });
    expect(await f.core.listSecretReferences()).toEqual(first);
    expect(all).toHaveBeenCalledTimes(1);
    expect(queries[0]).toContain("local_credential_reservations");
    expect(prepare).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(manifest).not.toHaveBeenCalled();
    expect(first).toHaveLength(count);
  },
);
