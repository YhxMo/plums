import assert from "node:assert/strict";
import { mkdtemp, rm, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  secretRef,
  type Core,
  type SecretStore,
} from "@plums/core";
import { InstallStore } from "../../core/src/install/store.js";
import { DesktopHost } from "../src/host.js";

const hosts: DesktopHost[] = [],
  cores: Core[] = [],
  stores: InstallStore[] = [],
  directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const core of cores.splice(0)) core.close();
  for (const store of stores.splice(0)) store.close();
  for (const host of hosts.splice(0)) await host.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(lstat(directory), { code: "ENOENT" });
  }
});

async function fixture(
  name: string,
  secretStore?: (id: string) => SecretStore,
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-host-credential-"),
  );
  directories.push(directory);
  const values = new Map<string, MemorySecretStore>();
  const storage = (id: string) => {
    if (!values.has(id)) values.set(id, new MemorySecretStore());
    return values.get(id)!;
  };
  const egress = new RecordingEgressSink();
  const host = new DesktopHost({
    dataDir: directory,
    secretStore: secretStore ?? storage,
    egress,
    confirm: { ask: async () => true },
    audit: async () => {},
  });
  hosts.push(host);
  await host.initialize();
  const packageId = "fixture.credential-ref";
  const archive = await createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify({
        formatVersion: "2.0",
        kind: "extension",
        id: packageId,
        name: "Synthetic reference fixture",
        version: "1.0.0",
        description: "",
        dependencies: [],
        permissions: [],
        settingsSchema: {
          type: "object",
          properties: {
            token: {
              type: "string",
              "x-secret": true,
              title: "Synthetic token",
              description: "Synthetic",
            },
          },
        },
        payload: {},
      }),
    ),
  });
  const item = await host.importLibrary(
    ((await host.preview(archive)) as { token: string }).token,
  );
  assert.ok("manifest" in item);
  const agent = await host.createAgent(name, [item.digest]);
  const id = agent.instanceId;
  const secrets = (secretStore ?? storage)(id);
  const coreDir = path.join(directory, "instances", id, "core");
  const core = createCore({
    dataDir: coreDir,
    instanceId: id,
    secrets,
    egress,
  });
  const store = new InstallStore(coreDir);
  cores.push(core);
  stores.push(store);
  const installedAt = (await core.listInstalled())[0]!.installedAt;
  const pending = async (ref: string, value: string, orphan = true) => {
    expect(
      store.reserveLocalCredentialReferences(packageId, installedAt, [ref]),
    ).toBe(true);
    if (orphan) await host.uninstallPackage(id, packageId);
    await secrets.set(ref, value);
    expect(store.listSecretRefs()).toContain(ref);
  };
  return {
    host,
    id,
    directory,
    secrets,
    core,
    store,
    installedAt,
    packageId,
    item,
    pending,
    storage,
    egress,
  };
}

it("rejects Agent exports containing a late orphan credential after component removal and Host restart", async () => {
  const value = "SYNTHETIC_ORPHAN_EXPORT_CREDENTIAL_82f3";
  const f = await fixture(value);
  const ref = secretRef(f.packageId, "pending-unique");
  await f.pending(ref, value);
  expect(await f.core.listInstalled()).toEqual([]);
  await expect(
    f.core.exportPackage({ manifest: { ...f.item.manifest, payload: value } }),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  await expect(f.host.exportAgent(f.id)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  await f.host.close();
  const reopened = new DesktopHost({
    dataDir: f.directory,
    secretStore: f.storage,
    egress: f.egress,
    confirm: { ask: async () => true },
    audit: async () => {},
  });
  hosts.push(reopened);
  await reopened.initialize();
  await expect(reopened.exportAgent(f.id)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect(await f.secrets.get(ref)).toBe(value);
  expect(f.egress.records).toEqual([]);
});

it("redacts an orphan credential from trusted resource presentation after uninstall", async () => {
  const value = "SYNTHETIC_ORPHAN_PRESENTATION_CREDENTIAL";
  const f = await fixture(value);
  await f.pending(secretRef(f.packageId, "pending-unique"), value);
  const result = await f.host.resources(f.id);
  expect(JSON.stringify(result)).not.toContain(value);
  expect(result).toMatchObject({
    record: { name: "[REDACTED]" },
    packages: [],
  });
});

it("keeps orphan values isolated by Agent and reads fresh values on each export", async () => {
  const value = "SYNTHETIC_AGENT_SCOPED_CREDENTIAL";
  const f = await fixture(value);
  const other = await f.host.createAgent(value, [f.item.digest]);
  const ref = secretRef(f.packageId, "pending-unique");
  await f.pending(ref, value);
  await expect(f.host.exportAgent(f.id)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect((await f.host.exportAgent(other.instanceId)).length).toBeGreaterThan(
    0,
  );
  await f.secrets.set(ref, "SYNTHETIC_REPLACEMENT_CREDENTIAL");
  expect((await f.host.exportAgent(f.id)).length).toBeGreaterThan(0);
  await f.secrets.set(ref, value);
  await expect(f.host.exportAgent(f.id)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  await f.secrets.delete(ref);
  f.store.releaseLocalCredentialReferences(f.packageId, f.installedAt, [ref]);
  expect((await f.host.exportAgent(f.id)).length).toBeGreaterThan(0);
});

it.each(["id", "value", "a"])(
  "keeps exact reference identities when a known scalar is %s",
  async (value) => {
    const f = await fixture(`Reference fixture ${value}`);
    const ref = secretRef(f.packageId, "pending-value-id");
    await f.pending(ref, value, false);
    expect(await f.core.getSecretReferences(f.packageId)).toContain(ref);
    expect(await f.core.listSecretReferences()).toContain(ref);
    expect((await f.core.listInstalled())[0]!.id).toBe(f.packageId);
    await expect(f.host.exportAgent(f.id)).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
  },
);

it("hides SecretStore failures before Agent export without returning underlying exception content", async () => {
  const backing = new MemorySecretStore();
  const value = "SYNTHETIC_LOOKUP_FAILURE_CREDENTIAL";
  let fail = false;
  const f = await fixture("Storage failure fixture", () => ({
    get: async (ref) => {
      if (fail) throw new Error(value);
      return backing.get(ref);
    },
    set: (ref, secret) => backing.set(ref, secret),
    delete: (ref) => backing.delete(ref),
  }));
  await f.pending(secretRef(f.packageId, "pending-unique"), value);
  fail = true;
  const error = await f.host.exportAgent(f.id).catch((error) => error);
  expect(error).toMatchObject({ code: "SECRET_NOT_FOUND" });
  expect(String(error)).not.toContain(value);
  expect(error.stack).not.toContain(value);
  expect(JSON.stringify(error)).not.toContain(value);
});

it("refreshes credential values after reading exported components", async () => {
  const value = "SYNTHETIC_CREDENTIAL_ARRIVING_DURING_EXPORT";
  const f = await fixture(value);
  const ref = secretRef(f.packageId, "pending-later");
  expect(
    f.store.reserveLocalCredentialReferences(f.packageId, f.installedAt, [ref]),
  ).toBe(true);
  const get = f.secrets.get.bind(f.secrets);
  let reads = 0;
  vi.spyOn(f.secrets, "get").mockImplementation(async (reference) => {
    if (reference === ref && ++reads === 2) await f.secrets.set(ref, value);
    return get(reference);
  });
  await expect(f.host.exportAgent(f.id)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(await get(ref)).toBe(value);
});

it("retains previously read credential values when they change during export", async () => {
  const value = "SYNTHETIC_PREVIOUS_EXPORT_CREDENTIAL";
  const f = await fixture(value);
  const ref = secretRef(f.packageId, "pending-replaced");
  await f.pending(ref, value, false);
  const get = f.secrets.get.bind(f.secrets);
  let reads = 0;
  vi.spyOn(f.secrets, "get").mockImplementation(async (reference) => {
    if (reference === ref && ++reads === 2)
      await f.secrets.set(ref, "SYNTHETIC_NEW_EXPORT_CREDENTIAL");
    return get(reference);
  });
  await expect(f.host.exportAgent(f.id)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(await get(ref)).toBe("SYNTHETIC_NEW_EXPORT_CREDENTIAL");
});
