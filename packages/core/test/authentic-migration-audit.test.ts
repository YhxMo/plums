import assert from "node:assert/strict";
import { mkdtemp, rm, lstat, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  type Core,
  type CreateCoreOptions,
  type ManifestV2,
  type AuditEvent,
} from "../src/index.js";
import { SCHEMA_VERSION } from "../src/install/store.js";
import { buildHistoricalCore } from "./historical-core.js";

let historical: Awaited<ReturnType<typeof buildHistoricalCore>>;
const opened: Core[] = [],
  directories: string[] = [];
beforeAll(async () => {
  historical = await buildHistoricalCore();
}, 20_000);
afterAll(async () => {
  if (historical) {
    await rm(historical.dir, { recursive: true, force: true });
    await assert.rejects(lstat(historical.dir), { code: "ENOENT" });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of opened.splice(0)) c.close();
  for (const d of directories.splice(0)) {
    await rm(d, { recursive: true, force: true });
    await assert.rejects(lstat(d), { code: "ENOENT" });
  }
});
function rows(dir: string) {
  const db = new Database(path.join(dir, "plums.db"));
  try {
    return Object.fromEntries(
      (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
          )
          .all() as { name: string }[]
      ).map(({ name }) => [
        name,
        db.prepare('SELECT * FROM "' + name + '"').all(),
      ]),
    );
  } finally {
    db.close();
  }
}
async function hashes(dir: string) {
  const out: Record<string, string> = {};
  for (const name of await readdir(dir, { recursive: true })) {
    const p = path.join(dir, name);
    if ((await lstat(p)).isFile())
      out[name] = createHash("sha256")
        .update(await readFile(p))
        .digest("hex");
  }
  return out;
}
async function fixture(value: string, audit?: CreateCoreOptions["onAudit"]) {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "plums-authentic-migration-"),
  );
  directories.push(dir);
  const secrets = new MemorySecretStore(),
    egress = new RecordingEgressSink(),
    events: Readonly<AuditEvent>[] = [];
  const serviceCalls = { count: 0 };
  const options: CreateCoreOptions = {
    dataDir: dir,
    instanceId: "synthetic-agent",
    secrets,
    egress,
    onAudit: async (event) => {
      events.push(event);
      await audit?.(event);
    },
    services: {
      https: {
        operations: { request: "egress" },
        getBinding: () => ({
          fingerprint: "synthetic-binding",
          sources: [],
          host: "migration.plums-fixture.test",
        }),
        invoke: async (r) => {
          await r.assertActive();
          serviceCalls.count++;
          return null;
        },
      },
    },
  };
  const base = (id: string, kind: ManifestV2["kind"]): ManifestV2 => ({
    formatVersion: "2.0",
    kind,
    id,
    name: "Synthetic",
    description: "",
    version: "1.0.0",
    dependencies: [],
    permissions: [],
    payload: {},
  });
  const first = base("first", "extension"),
    second = base("second", "extension"),
    memory = base("memory", "extension"),
    model = base("model", "connector");
  const engine = {
    id: "local",
    kind: "engine" as const,
    target: "local",
    reason: "Synthetic",
  };
  const https = {
    id: "https",
    kind: "service" as const,
    target: "https",
    operations: ["request"],
    reason: "Synthetic",
  };
  first.permissions = [engine, https];
  second.permissions = [engine];
  model.permissions = [
    https,
    {
      id: "mcp",
      kind: "egress",
      target: "mcp.plums-fixture.test",
      reason: "Synthetic MCP",
    },
  ];
  first.settingsSchema = {
    type: "object",
    properties: {
      token: {
        type: "string",
        "x-secret": true,
        title: "Token",
        description: "Synthetic",
      },
    },
  };
  const old = historical.old.createCore({ ...options, onAudit: () => {} });
  opened.push(old);
  for (const m of [first, second, memory, model]) {
    await old.importPackage(await old.exportPackage({ manifest: m }));
    await old.grantConsent(m.id);
    await old.enable(m.id);
    await old.setSettings(m.id, {});
  }
  await secrets.set("secret:first/token", value);
  await old.setSettings("first", { token: "secret:first/token" });
  await old.grantEngineTrust(await old.engineTrustSnapshot("first", "local"));
  for (const id of ["first", "model"])
    await old.grantBackgroundConsent({
      extensionId: id,
      permissionId: "https",
      operation: "request",
      binding: "model/api",
      sources: [],
    });
  const tool = {
    name: "synthetic",
    description: "Synthetic",
    inputSchema: { type: "object" },
  };
  await old.approveMcpToolsV2("model", "mcp", [tool]);
  const grant = await old.createGrant({
    ...(await old.grantPlan({
      ownerId: "first",
      engineId: "local",
      scope: {
        reads: [],
        outputs: [],
        services: ["first", "model"].map((packageId) => ({
          packageId,
          permissionId: "https",
          operation: "request",
          binding: "model/api",
        })),
      },
    })),
    durationMs: 3_600_000,
  });
  const request = {
    packageId: "model",
    permissionId: "https",
    callers: [{ packageId: "first", permissionId: "https" }],
    request: {
      kind: "service" as const,
      operation: "request",
      binding: "model/api",
      sources: [],
      input: null,
    },
    grantId: grant.id,
    grantScope: { reads: [], outputs: [] },
  };
  await old.runDelegatedCapability(request);
  const installed = await old.listInstalled(),
    original = rows(dir);
  old.close();
  const db = new Database(path.join(dir, "plums.db"));
  expect(db.pragma("user_version", { simple: true })).toBe(6);
  db.close();
  const core = createCore(options);
  opened.push(core);
  return {
    dir,
    options,
    secrets,
    egress,
    events,
    core,
    original,
    installed,
    tool,
    grant,
    request,
    serviceCalls,
  };
}
const collisions = [
  "callId",
  "phase",
  "not_started",
  "engine",
  "LOCAL_AUTHORIZATION_MIGRATED",
  "0",
];
it.each(collisions)(
  "migrates an authentic schema-6 database without corrupting trusted audit controls (%s)",
  async (value) => {
    const f = await fixture(value);
    const state = await f.core.localAuthorizationState();
    const event = f.events.find(
      (e) => e.reason === "LOCAL_AUTHORIZATION_MIGRATED",
    )!;
    expect(event).toMatchObject({
      callId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      timestamp: expect.any(String),
      kind: "engine",
      phase: "grant",
      outcome: "allowed",
      executionState: "not_started",
      reason: "LOCAL_AUTHORIZATION_MIGRATED",
      migration: { migrated: 1, skipped: 0 },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.migration)).toBe(true);
    expect(state.tier).toMatchObject({
      ceiling: "machine",
      projects: [],
      readOnly: [],
      components: [],
    });
    expect(state.grants.map((g) => [g.packageId, g.engineId])).toEqual([
      ["first", "local"],
    ]);
    expect(await f.core.listInstalled()).toEqual(f.installed);
    const migrated = rows(f.dir);
    for (const [name, data] of Object.entries(f.original))
      expect(migrated[name], name).toEqual(data);
    expect(migrated.local_credential_reservations).toEqual([]);
    expect(await f.core.getSecretReferences("first")).toContain(
      "secret:first/token",
    );
    expect((await f.core.checkMcpToolsV2("model", [f.tool]))[0]!.state).toBe(
      "APPROVED",
    );
    expect(
      await f.core.checkGrant(f.grant.id, "first", { reads: [], outputs: [] }),
    ).not.toBeNull();
    await f.core.runDelegatedCapability(f.request);
    expect(f.serviceCalls.count).toBe(2);
    f.core.close();
    const current = createCore(f.options);
    opened.push(current);
    expect((await current.localAuthorizationState()).grants).toEqual(
      state.grants,
    );
    expect(
      await current.checkGrant(f.grant.id, "first", { reads: [], outputs: [] }),
    ).not.toBeNull();
    await current.runDelegatedCapability(f.request);
    expect(f.serviceCalls.count).toBe(3);
    expect(
      f.events.filter((e) => e.reason === "LOCAL_AUTHORIZATION_MIGRATED"),
    ).toHaveLength(1);
    current.close();
    const before = await hashes(f.dir);
    const legacy = historical.old.createCore(f.options);
    opened.push(legacy);
    await expect(legacy.listInstalled()).rejects.toMatchObject({
      code: "SECRET_NOT_FOUND",
    });
    legacy.close();
    const oldStore = new historical.store.InstallStore(f.dir);
    expect(() => oldStore.open()).toThrow(
      /database version 8, this build reads 6/,
    );
    oldStore.close();
    expect(await hashes(f.dir)).toEqual(before);
    expect(SCHEMA_VERSION).toBe(8);
    expect(f.egress.records).toHaveLength(0);
  },
);
it.each(["callId", "phase", "not_started"])(
  "retains current internal migration failure controls and retries only the unacknowledged audit (%s)",
  async (value) => {
    let reject = true;
    const f = await fixture(value, (event) => {
      if (event.reason === "LOCAL_AUTHORIZATION_MIGRATED" && reject)
        throw Error("Synthetic audit refusal");
    });
    await expect(f.core.localAuthorizationState()).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: {
        callId: expect.stringMatching(/^[a-f0-9-]{36}$/),
        phase: "migration_audit",
        executionState: "not_started",
      },
    });
    const prior = f.events[0]!;
    reject = false;
    expect((await f.core.localAuthorizationState()).grants).toHaveLength(1);
    expect(f.events[1]!.callId).toBe(prior.callId);
    expect(f.egress.records).toHaveLength(0);
  },
);
it("closes migration authorization when secret refresh fails, hiding the underlying error", async () => {
  const f = await fixture("synthetic-secret-read-failure");
  vi.spyOn(f.secrets, "get").mockRejectedValue(
    Error("synthetic-secret-read-failure"),
  );
  await expect(f.core.localAuthorizationState()).rejects.toMatchObject({
    code: "SECRET_NOT_FOUND",
    details: undefined,
  });
  expect(f.events).toHaveLength(0);
  expect(f.egress.records).toHaveLength(0);
});

it("shares a pending migration audit while each caller keeps only its own failure provenance", async () => {
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => {
    entered = r;
  });
  const f = await fixture("callId", async (event) => {
    if (event.reason === "LOCAL_AUTHORIZATION_MIGRATED") {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
      throw Error("Synthetic refusal");
    }
  });
  const first = f.core.localAuthorizationState(),
    second = f.core.localAuthorizationState();
  const collected = Promise.allSettled([first, second]);
  await waiting;
  release();
  const results = await collected;
  expect(f.events).toHaveLength(1);
  for (const result of results) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected")
      expect(result.reason).toMatchObject({
        details: {
          callId: f.events[0]!.callId,
          phase: "migration_audit",
          executionState: "not_started",
        },
      });
  }
});
it("does not restore a previous internal migration error when an adapter rethrows it on a later call", async () => {
  let reject = true;
  const f = await fixture("callId", (event) => {
    if (event.reason === "LOCAL_AUTHORIZATION_MIGRATED" && reject)
      throw Error("Synthetic refusal");
  });
  let previous: unknown;
  try {
    await f.core.localAuthorizationState();
  } catch (e) {
    previous = e;
  }
  expect(previous).toBeDefined();
  reject = false;
  await f.core.localAuthorizationState();
  vi.spyOn(f.options.services!.https!, "getBinding").mockImplementation(() => {
    throw previous;
  });
  await expect(
    f.core.grantPlan({
      ownerId: "first",
      engineId: "local",
      scope: {
        reads: [],
        outputs: [],
        services: [
          {
            packageId: "model",
            permissionId: "https",
            operation: "request",
            binding: "model/api",
          },
        ],
      },
    }),
  ).rejects.toSatisfy(
    (e: { details: object }) => !Object.hasOwn(e.details, "callId"),
  );
});
