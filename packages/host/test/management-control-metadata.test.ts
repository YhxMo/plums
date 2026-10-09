import assert from "node:assert/strict";
import { mkdtemp, rm, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  REDACTED,
  type SecretStore,
  type Manifest,
} from "@plums/core";
import { DesktopHost } from "../src/host.js";
import type { TierPlan } from "../src/local-authorization.js";
import type { TierSelection } from "../src/local-authorization.js";

const hosts: DesktopHost[] = [],
  directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) await host.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(lstat(directory), { code: "ENOENT" });
  }
});

async function fixture(store?: SecretStore, local = false) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-management-control-"),
  );
  directories.push(directory);
  const secrets = new MemorySecretStore(),
    egress = new RecordingEgressSink(),
    confirm = { ask: vi.fn(async () => true) };
  const options = {
    dataDir: directory,
    secretStore: () => store ?? secrets,
    egress,
    confirm,
    audit: async () => {},
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  const manifest = {
    formatVersion: "2.0",
    kind: "extension",
    id: "fixture.management-control",
    name: "Synthetic id name",
    version: "1.0.0",
    description: "Synthetic id text",
    dependencies: [],
    permissions: local
      ? [
          {
            id: "local",
            kind: "engine",
            target: "id",
            tier: "project",
            network: { hosts: ["api.test"] },
            reason: "Synthetic local declaration",
          },
        ]
      : [],
    settingsSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          "x-secret": true,
          title: "Token",
          description: "Synthetic",
        },
      },
    },
    payload: {
      business: JSON.parse(
        '{"id":"id","fingerprint":"id","__proto__":{"id":"id"}}',
      ),
      ...(local
        ? {
            plumsDesktop: {
              sdkVersion: "2",
              runtime: "main.js",
              engines: [
                {
                  id: "id",
                  title: "Synthetic",
                  entry: "engine.mjs",
                  runtime: "node",
                  platforms: [process.platform + "-" + process.arch],
                  protocol: "jsonrpc-jsonl-v1",
                },
              ],
            },
          }
        : {}),
    },
    future: { id: "id", fingerprint: "id" },
  };
  const item = await host.importLibrary(
    (
      (await host.preview(
        await createArchive({
          "manifest.json": Buffer.from(JSON.stringify(manifest)),
          ...(local
            ? {
                "main.js": Buffer.from("export function activate(){}"),
                "engine.mjs": Buffer.from(
                  "// This declaration-only fixture is never started.\n",
                ),
              }
            : {}),
        }),
      )) as { token: string }
    ).token,
  );
  const agent = await host.createAgent("Synthetic management", [item.digest]);
  const set = (value: string) =>
    host.setSettings(agent.instanceId, manifest.id, {}, { token: value });
  const resources = () =>
    host.resources(agent.instanceId) as Promise<{
      record: unknown;
      packages: { id: string; manifest: Manifest }[];
    }>;
  const selection = {
    ceiling: "machine" as const,
    projects: [],
    readOnly: [],
    components: [manifest.id],
  };
  const plan = () =>
    host.tierPlan(agent.instanceId, selection) as Promise<TierPlan>;
  return {
    host,
    agent,
    manifest,
    set,
    resources,
    plan,
    selection,
    confirm,
    directory,
    options,
    secrets,
    egress,
  };
}

it.each(["id", "a", "manifest", "1.0.0", "extension"])(
  "preserves installed resource identity at the exact manifest path for credential %s",
  async (value) => {
    const f = await fixture();
    await f.set(value);
    const result = await f.resources(),
      p = result.packages[0]!;
    expect(p.id).toBe(f.manifest.id);
    expect(p.manifest).toMatchObject({
      id: f.manifest.id,
      version: "1.0.0",
      formatVersion: "2.0",
      kind: "extension",
    });
    expect(Object.hasOwn(p.manifest, "id")).toBe(true);
    expect(f.egress.records).toEqual([]);
    // A trusted metadata projection must not change the installed document.
    const core = createCore({
      dataDir: path.join(f.directory, "instances", f.agent.instanceId, "core"),
      secrets: f.secrets,
      egress: f.egress,
    });
    try {
      expect((await core.getPackage(f.manifest.id)).manifest).toEqual(
        f.manifest,
      );
    } finally {
      core.close();
    }
  },
);

it("keeps unknown and nested business identity fields redacted and leaves input unchanged", async () => {
  const f = await fixture();
  await f.set("id");
  const p = (await f.resources()).packages[0]!;
  const unknown = { [REDACTED]: REDACTED, fingerprint: REDACTED };
  expect(p.manifest.future).toEqual(unknown);
  const business = (p.manifest.payload as { business: Record<string, unknown> })
    .business;
  expect(business).toEqual({
    ...unknown,
    ["__proto__"]: { [REDACTED]: REDACTED },
  });
  expect(Object.getPrototypeOf(business)).toBe(Object.prototype);
  expect(f.manifest.future).toEqual({ id: "id", fingerprint: "id" });
  expect(p.manifest.name).toBe(`Synthetic ${REDACTED} name`);
  expect(p.manifest.description).toBe(`Synthetic ${REDACTED} text`);
});

it.each(["a", "fingerprint", "selection", "components"])(
  "returns usable tier confirmation controls with short credential %s",
  async (value) => {
    const f = await fixture(),
      before = await f.plan();
    await f.set(value);
    const plan = await f.plan();
    expect(plan.fingerprint).toBe(before.fingerprint);
    expect(plan.selection).toEqual(f.selection);
    expect(plan.entries[0]).toMatchObject({
      packageId: f.manifest.id,
      formatVersion: "2.0",
      confirmed: false,
    });
    expect(
      await f.host.confirmTier(
        f.agent.instanceId,
        plan.fingerprint,
        plan.selection,
      ),
    ).toBe(true);
    expect(f.confirm.ask).toHaveBeenCalledTimes(1);
    expect(f.egress.records).toEqual([]);
  },
);

it("keeps a fingerprint that exactly equals a stored synthetic value usable across restart", async () => {
  const f = await fixture(),
    before = await f.plan();
  await f.set(before.fingerprint);
  await f.host.close();
  await f.host.initialize();
  const plan = await f.plan();
  expect(plan.fingerprint).toBe(before.fingerprint);
  expect(
    await f.host.confirmTier(
      f.agent.instanceId,
      plan.fingerprint,
      plan.selection,
    ),
  ).toBe(true);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});

it("redacts unknown selection metadata without extending control projections to its nested names", async () => {
  const f = await fixture();
  await f.set("id");
  const selection = {
    ...f.selection,
    future: JSON.parse(
      '{"id":"id","fingerprint":"id","__proto__":{"id":"id"}}',
    ),
  };
  const plan = (await f.host.tierPlan(
    f.agent.instanceId,
    selection as TierSelection,
  )) as TierPlan;
  expect((plan.selection as unknown as { future: unknown }).future).toEqual({
    [REDACTED]: REDACTED,
    fingerprint: REDACTED,
    ["__proto__"]: { [REDACTED]: REDACTED },
  });
  expect(plan.selection.components).toEqual(f.selection.components);
  expect(selection.future.id).toBe("id");
});

it("retains only declared component/engine host-map keys for a public project confirmation", async () => {
  const f = await fixture(undefined, true),
    root = await mkdtemp(path.join(os.tmpdir(), "plums-control-project-"));
  directories.push(root);
  await f.host.bindRoot(f.agent.instanceId, "id", root);
  await f.set("id");
  const selection: TierSelection = {
    ceiling: "project",
    projects: ["id"],
    readOnly: [],
    components: [f.manifest.id],
    hosts: { [f.manifest.id]: { id: ["api.test"] } },
  };
  const plan = (await f.host.tierPlan(
    f.agent.instanceId,
    selection,
  )) as TierPlan;
  expect(plan.selection).toEqual(selection);
  expect(plan.entries[0]!.engines[0]).toMatchObject({
    engineId: "id",
    tier: "project",
    state: "pending",
  });
  expect(
    await f.host.confirmTier(
      f.agent.instanceId,
      plan.fingerprint,
      plan.selection,
    ),
  ).toBe(true);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  expect(f.egress.records).toEqual([]);
});

it("fails closed on credential reads for both management paths without exposing exceptions", async () => {
  const backing = new MemorySecretStore(),
    value = "SYNTHETIC_MANAGEMENT_READ_FAILURE";
  let fail = false;
  const f = await fixture({
    get: async (ref) => {
      if (fail) throw new Error(value);
      return backing.get(ref);
    },
    set: (ref, value) => backing.set(ref, value),
    delete: (ref) => backing.delete(ref),
  });
  await f.set(value);
  fail = true;
  for (const read of [f.resources, f.plan]) {
    const error = await read().catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "SECRET_NOT_FOUND" });
    expect(String(error)).not.toContain(value);
    expect(JSON.stringify(error)).not.toContain(value);
  }
});
