import assert from "node:assert/strict";
import { mkdtemp, rm, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  createArchive,
  createCore,
  secretRef,
  redact,
  MemorySecretStore,
  RecordingEgressSink,
  REDACTED,
  type SecretStore,
} from "@plums/core";
import type { FoundationSelection } from "@plums/sdk";
import { DesktopHost } from "../src/host.js";
import { InstallStore } from "../../core/src/install/store.js";

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

async function fixture(store?: SecretStore) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-foundation-metadata-"),
  );
  directories.push(directory);
  const stores = new Map<string, MemorySecretStore>(),
    egress = new RecordingEgressSink();
  const host = new DesktopHost({
    dataDir: directory,
    secretStore: (id) => {
      if (store) return store;
      if (!stores.has(id)) stores.set(id, new MemorySecretStore());
      return stores.get(id)!;
    },
    egress,
    confirm: { ask: async () => true },
    audit: async () => {},
  });
  hosts.push(host);
  await host.initialize();
  const packageId = "fixture.foundation-metadata";
  const item = await host.importLibrary(
    (
      (await host.preview(
        await createArchive({
          "manifest.json": Buffer.from(
            JSON.stringify({
              formatVersion: "2.0",
              kind: "extension",
              id: packageId,
              name: "Synthetic metadata fixture",
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
                    title: "Token",
                    description: "Synthetic",
                  },
                },
              },
              payload: {
                plumsDesktop: {
                  sdkVersion: "2",
                  runtime: "main.js",
                  foundation: {
                    requirementVersion: "1.0",
                    protocolRange: "^1.0.0",
                    sdk: { id: "org.plums.sdk", version: "2.0.0" },
                    features: ["sdk.register", "sdk.resources"],
                    optionalFeatures: [
                      "sdk.synthetic-FEATURE",
                      "sdk.synthetic-FOUNDATION",
                    ],
                  },
                  contributes: {
                    commands: [
                      {
                        name: "echo",
                        title: "Echo",
                        inputSchema: {},
                        outputSchema: {},
                      },
                    ],
                  },
                },
              },
            }),
          ),
          "main.js": Buffer.from(
            "export function activate(s){s.register('commands','echo',async v=>v);}",
          ),
        }),
      )) as { token: string }
    ).token,
  );
  assert.ok("manifest" in item);
  const requirement = {
    requirementVersion: "1.0" as const,
    protocolRange: "^1.0.0",
    sdk: { id: "org.plums.sdk", version: "2.0.0" },
    features: ["sdk.register", "sdk.resources"],
    optionalFeatures: ["sdk.synthetic-FEATURE", "sdk.synthetic-FOUNDATION"],
  };
  const seed = await host.createAgent("Selection seed");
  const agent = await host.createAgent(
    "Synthetic metadata",
    [item.digest],
    undefined,
    undefined,
    [],
    { requirement, selection: seed.foundation!.selection },
  );
  const ref = secretRef(packageId, "synthetic-pending");
  const orphan = async (id: string) => {
    const dataDir = path.join(directory, "instances", id, "core");
    const secrets = store ?? stores.get(id)!;
    const core = createCore({ dataDir, instanceId: id, secrets, egress }),
      ledger = new InstallStore(dataDir);
    try {
      const installedAt = (await core.listInstalled())[0]!.installedAt;
      expect(
        ledger.reserveLocalCredentialReferences(packageId, installedAt, [ref]),
      ).toBe(true);
    } finally {
      core.close();
      ledger.close();
    }
    await host.uninstallPackage(id, packageId);
  };
  // Trusted ledger setup models a late write after uninstall, not a Host credential writer.
  await orphan(agent.instanceId);
  const set = (id: string, value: string) =>
    (store ?? stores.get(id)!).set(ref, value);
  return {
    host,
    agent,
    item,
    packageId,
    stores,
    egress,
    set,
    orphan,
    requirement,
  };
}

it.each(["id", "value", "a", "declared", "1.0.0", "foundation"])(
  "keeps usable foundation state and switch plans when a credential is %s",
  async (value) => {
    const f = await fixture(),
      id = f.agent.instanceId;
    const before = await f.host.foundationStatus(id),
      plan = await f.host.foundationPlan(id);
    await f.set(id, value);
    expect(await f.host.foundationStatus(id)).toEqual(before);
    expect(await f.host.foundationPlan(id)).toEqual(plan);
    // The returned control values must still work in the public mutation path.
    await f.host.switchFoundation(id, plan.fingerprint, plan.candidate);
    await f.host.setFoundationEnabled(id, false);
    expect(await f.host.foundationStatus(id)).toMatchObject({
      enabled: false,
      selection: before.selection,
    });
    await f.host.setFoundationEnabled(id, true);
    expect((await f.host.foundationStatus(id)).enabled).toBe(true);
    expect(f.egress.records).toEqual([]);
  },
);

it("redacts unknown selection keys and nested metadata while retaining validated identities across restart", async () => {
  const f = await fixture();
  const future = JSON.parse(
    '{"id":"id","value":{"selection":{"id":"id"}},"__proto__":{"id":"id"}}',
  );
  const agent = await f.host.createAgent(
    "Unknown metadata",
    [f.item.digest],
    undefined,
    undefined,
    [],
    {
      selection: { ...f.agent.foundation!.selection, future },
    },
  );
  await f.orphan(agent.instanceId);
  await f.set(agent.instanceId, "id");
  const expected = JSON.parse(
    '{"[REDACTED]":"[REDACTED]","value":{"selection":{"[REDACTED]":"[REDACTED]"}},"__proto__":{"[REDACTED]":"[REDACTED]"}}',
  );
  const status = await f.host.foundationStatus(agent.instanceId),
    plan = await f.host.foundationPlan(agent.instanceId);
  expect(status.selection).toEqual({
    ...f.agent.foundation!.selection,
    future: expected,
  });
  expect(plan.current).toEqual(status);
  expect(plan.candidate).toEqual(status.selection);
  expect(Object.hasOwn(status.selection.future as object, "__proto__")).toBe(
    true,
  );
  expect(Object.getPrototypeOf(status.selection.future)).toBe(Object.prototype);
  expect(future).toEqual(
    JSON.parse(
      '{"id":"id","value":{"selection":{"id":"id"}},"__proto__":{"id":"id"}}',
    ),
  );
  // Neither the persisted selection nor the caller's input is rewritten.
  expect(
    (await f.host.listAgents()).find((a) => a.instanceId === agent.instanceId)!
      .foundation,
  ).toEqual(agent.foundation);
  await f.host.close();
  await f.host.initialize();
  expect(await f.host.foundationStatus(agent.instanceId)).toEqual(status);
  expect(await f.host.foundationPlan(agent.instanceId)).toEqual(plan);
  expect(f.egress.records).toEqual([]);
});

it("refreshes unknown presentation values on each read and isolates them by Agent", async () => {
  const f = await fixture(),
    value = "SYNTHETIC_FOUNDATION_DISPLAY_VALUE";
  const create = () =>
    f.host.createAgent(
      "Display fixture",
      [f.item.digest],
      undefined,
      undefined,
      [],
      {
        selection: {
          ...f.agent.foundation!.selection,
          future: { display: value },
        },
      },
    );
  const a = await create(),
    b = await create();
  await f.orphan(a.instanceId);
  await f.orphan(b.instanceId);
  await f.set(a.instanceId, value);
  expect(
    (await f.host.foundationStatus(a.instanceId)).selection.future,
  ).toEqual({ display: REDACTED });
  expect((await f.host.foundationPlan(a.instanceId)).candidate.future).toEqual({
    display: REDACTED,
  });
  expect(
    (await f.host.foundationStatus(b.instanceId)).selection.future,
  ).toEqual({ display: value });
  await f.set(a.instanceId, "SYNTHETIC_REPLACEMENT_VALUE");
  expect(
    (await f.host.foundationStatus(a.instanceId)).selection.future,
  ).toEqual({ display: value });
  expect((await f.host.foundationPlan(a.instanceId)).candidate.future).toEqual({
    display: value,
  });
});

async function limitedFoundation(
  host: DesktopHost,
): Promise<FoundationSelection> {
  const item = await host.importLibrary(
    (
      (await host.preview(
        await createArchive({
          "manifest.json": Buffer.from(
            JSON.stringify({
              formatVersion: "2.0",
              kind: "extension",
              id: "fixture.metadata-provider",
              name: "Synthetic limited provider",
              version: "1.0.0",
              description: "",
              dependencies: [],
              permissions: [],
              payload: {
                plumsFoundation: {
                  declarationVersion: "1.0",
                  id: "fixture.metadata-provider",
                  foundationVersion: "1.0",
                  entry: "provider.mjs",
                  execution: "controlled-node",
                  platforms: [process.platform + "-" + process.arch],
                  features: [
                    "session.invoke",
                    "session.callback",
                    "session.cancel",
                  ],
                  hostFeatures: [],
                  sdks: [
                    {
                      id: "org.plums.sdk",
                      range: "2.0.0",
                      features: ["sdk.register"],
                    },
                  ],
                },
              },
            }),
          ),
          "provider.mjs": Buffer.from(
            "// This compatibility-only fixture is never started.\n",
          ),
        }),
      )) as { token: string }
    ).token,
  );
  assert.ok("manifest" in item);
  return {
    selectionVersion: "1.0",
    source: "library",
    id: item.manifest.id,
    version: item.manifest.version,
    digest: item.digest,
  };
}

it.each(["FEATURE", "FOUNDATION"])(
  "keeps incompatibility diagnostics usable while redacting feature text containing %s",
  async (value) => {
    const f = await fixture(),
      candidate = await limitedFoundation(f.host);
    await f.set(f.agent.instanceId, value);
    const plan = await f.host.foundationPlan(f.agent.instanceId, candidate);
    expect(plan).toMatchObject({
      compatible: false,
      candidate,
      evidence: "declared",
      failure: {
        reason: "FOUNDATION_INCOMPATIBLE",
        executionState: "not_started",
        reports: [
          {
            componentId: "",
            compatible: false,
            diagnostics: [{ reason: "FEATURE", missing: ["sdk.resources"] }],
            missingOptionalFeatures: [
              value === "FEATURE"
                ? "sdk.synthetic-[REDACTED]"
                : "sdk.synthetic-FEATURE",
              value === "FOUNDATION"
                ? "sdk.synthetic-[REDACTED]"
                : "sdk.synthetic-FOUNDATION",
            ],
            evidence: "declared",
            foundationVersion: "1.0",
          },
        ],
      },
    });
    await expect(
      f.host.switchFoundation(
        f.agent.instanceId,
        plan.fingerprint,
        plan.candidate,
      ),
    ).rejects.toMatchObject({
      details: {
        reason: "FOUNDATION_INCOMPATIBLE",
        executionState: "not_started",
      },
    });
    expect(f.egress.records).toEqual([]);
  },
);

it.each(["xy", "zz"])(
  "still redacts short scalar %s from actual worker replies and business keys",
  async (value) => {
    const f = await fixture(),
      agent = await f.host.createAgent("Business redaction", [f.item.digest]),
      id = agent.instanceId;
    await f.host.setSettings(id, f.packageId, {}, { token: value });
    await f.host.enable(id, f.packageId);
    const input = JSON.parse(
      JSON.stringify({
        [value]: value,
        nested: { selection: { id: value, fingerprint: value } },
      }),
    );
    const result = await f.host.invoke(
      id,
      f.packageId,
      f.packageId,
      "commands",
      "echo",
      input,
    );
    const encoded = JSON.stringify(result).replaceAll(REDACTED, "");
    expect(encoded).not.toContain(value);
    expect(JSON.stringify(result)).toContain(REDACTED);
    expect(input[value]).toBe(value);
    expect(f.egress.records).toEqual([]);
  },
);

it.each(["id", "a"])(
  "keeps the public redactor's protection of scalar %s and arbitrary business keys",
  (value) => {
    const input = JSON.parse(
      JSON.stringify({
        [value]: value,
        selection: { id: value, digest: value },
      }),
    );
    const result = redact(input, [value]);
    expect(JSON.stringify(result).replaceAll(REDACTED, "")).not.toContain(
      value,
    );
    expect(Object.hasOwn(result as object, REDACTED)).toBe(true);
    expect(input[value]).toBe(value);
  },
);

it("fails safely when credential enumeration cannot read SecretStore values", async () => {
  const backing = new MemorySecretStore(),
    value = "SYNTHETIC_METADATA_LOOKUP_FAILURE";
  let fail = false;
  const get = vi.fn(async (ref: string) => {
    if (fail) throw new Error(value);
    return backing.get(ref);
  });
  const f = await fixture({
    get,
    set: (ref, secret) => backing.set(ref, secret),
    delete: (ref) => backing.delete(ref),
  });
  await f.set(f.agent.instanceId, value);
  get.mockClear();
  fail = true;
  for (const read of [
    () => f.host.foundationStatus(f.agent.instanceId),
    () => f.host.foundationPlan(f.agent.instanceId),
  ]) {
    const error = await read().catch((error) => error);
    expect(error).toMatchObject({ code: "SECRET_NOT_FOUND" });
    expect(String(error)).not.toContain(value);
    expect(JSON.stringify(error)).not.toContain(value);
    expect(error.stack).not.toContain(value);
  }
  expect(get).toHaveBeenCalledTimes(2);
});
