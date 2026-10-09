import Database from "better-sqlite3";
import path from "node:path";
import { rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  secretRef,
  type Core,
  type CreateCoreOptions,
  type ManifestV2,
  type EnginePermission,
  type AuditEvent,
} from "../src/index.js";
import { InstallStore, SCHEMA_VERSION } from "../src/install/store.js";
import { enginePermissionKey } from "../src/install/engine-trust.js";
import { makeCore, manifestZip } from "./package-helpers.js";
import { legacyGrantFingerprint } from "./legacy-grant-helper.js";
const opened: Core[] = [],
  dirs: string[] = [];
const child = (dataDir: string, action: string) =>
  promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./local-authorization-child.mjs", import.meta.url)),
    dataDir,
    action,
  ]);
afterEach(() => {
  vi.restoreAllMocks();
  opened.splice(0).forEach((c) => c.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const engine: EnginePermission = {
  id: "engine",
  kind: "engine",
  target: "local",
  reason: "Synthetic local execution",
};
const manifest: ManifestV2 = {
  formatVersion: "2.0",
  kind: "extension",
  id: "first",
  name: "Synthetic",
  version: "1.0.0",
  description: "",
  dependencies: [],
  permissions: [engine],
  payload: {},
};
function world(extra: Partial<CreateCoreOptions> = {}) {
  const w = makeCore({ instanceId: "agent-a", ...extra });
  opened.push(w.core);
  dirs.push(w.dataDir);
  return w;
}
function reopen(options: CreateCoreOptions) {
  const c = createCore(options);
  opened.push(c);
  return c;
}
const services: CreateCoreOptions["services"] = {
  https: {
    operations: { request: "egress" },
    getBinding: () => ({
      fingerprint: "synthetic-binding",
      sources: [],
      host: "fixture.test",
    }),
    invoke: async () => null,
  },
};
async function schema6() {
  const events: Readonly<AuditEvent>[] = [],
    secrets = new MemorySecretStore();
  const w = world({
    secrets,
    services,
    onAudit: (e) => {
      events.push(e);
    },
  });
  const options: CreateCoreOptions = {
    dataDir: w.dataDir,
    instanceId: "agent-a",
    secrets,
    services,
    egress: new RecordingEgressSink(),
    onAudit: (e) => {
      events.push(e);
    },
  };
  for (const id of [
    "first",
    "second",
    "changed",
    "reinstalled",
    "project",
    "memory",
  ]) {
    const m: ManifestV2 = {
      ...manifest,
      id,
      permissions:
        id === "memory"
          ? []
          : id === "project"
            ? [{ ...engine, tier: "project" }]
            : [engine],
    };
    if (id === "first") {
      m.permissions.push({
        id: "https",
        kind: "service",
        target: "https",
        operations: ["request"],
        reason: "Synthetic HTTPS",
      });
      m.settingsSchema = {
        type: "object",
        properties: {
          apiKey: {
            type: "string",
            title: "Key",
            description: "Synthetic key",
            "x-secret": true,
          },
        },
      };
    }
    await w.core.importPackage(await manifestZip(m));
    await w.core.grantConsent(id);
    await w.core.enable(id);
  }
  await secrets.set(secretRef("first", "apiKey"), "synthetic-secret-value");
  await w.core.setSettings("first", { apiKey: secretRef("first", "apiKey") });
  const snapshot = await w.core.engineTrustSnapshot("first", "local");
  await w.core.grantEngineTrust(snapshot);
  await w.core.grantBackgroundConsent({
    extensionId: "first",
    permissionId: "https",
    binding: "first/api",
    operation: "request",
    sources: [],
  });
  const scope = {
    reads: ["files"],
    outputs: ["reply"],
    services: [
      {
        packageId: "first",
        permissionId: "https",
        operation: "request",
        binding: "first/api",
      },
    ],
  };
  const grant = await w.core.createGrant({
    ...(await w.core.grantPlan({ ownerId: "first", engineId: "local", scope })),
    durationMs: 3_600_000,
  });
  const installed = await w.core.listInstalled(),
    consent = await w.core.getConsent("first"),
    refs = await w.core.getSecretReferences("first");
  const trust = (await w.core.localAuthorizationState()).grants[0]!;
  grant.fingerprint = await legacyGrantFingerprint(w.core, w.dataDir, grant);
  w.core.close();
  const db = new Database(path.join(w.dataDir, "plums.db"));
  db.prepare("UPDATE authority_grants SET record = ? WHERE id = ?").run(
    JSON.stringify(grant),
    grant.id,
  );
  const insert = db.prepare(
    "INSERT INTO engine_trust (package_id,engine_id,record) VALUES (?,?,?)",
  );
  for (const id of ["first", "changed", "reinstalled", "project"]) {
    const at = installed.find((p) => p.id === id)!.installedAt;
    const record = {
      instanceId: "agent-a",
      packageId: id,
      engineId: "local",
      installedAt: id === "reinstalled" ? "older-install" : at,
      permission:
        id === "changed"
          ? enginePermissionKey({ ...engine, reason: "Former declaration" })
          : id === "project"
            ? enginePermissionKey({ ...engine, tier: "project" })
            : trust.permission,
      grantedAt: trust.grantedAt,
    };
    insert.run(id, "local", JSON.stringify(record));
  }
  db.prepare("INSERT INTO mcp_tools VALUES (?,?,?,?,?)").run(
    "manual:fixture",
    "read",
    "legacy-fingerprint",
    "read",
    "2026-10-08T00:00:00Z",
  );
  db.prepare("INSERT INTO mcp_tools_v2 VALUES (?,?,?,?,?)").run(
    "fixture-connector",
    "read",
    "v2-fingerprint",
    "https",
    "2026-10-08T00:00:00Z",
  );
  const archive = db
    .prepare("SELECT * FROM engine_trust ORDER BY package_id")
    .all();
  db.exec(
    "DROP TABLE IF EXISTS authority_grant_legacy; DROP TABLE agent_tier; DROP TABLE agent_local_grants; DROP TABLE local_authorization_migrations; PRAGMA user_version = 6",
  );
  const before = Object.fromEntries(
    [
      "packages",
      "consents",
      "mcp_tools",
      "mcp_tools_v2",
      "background_consents",
      "settings_revisions",
      "authority_grants",
      "authority_grant_revision",
      "engine_trust_revision",
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
  );
  db.close();
  events.length = 0;
  return {
    ...w,
    options,
    events,
    archive,
    before,
    installed,
    consent,
    refs,
    grant,
  };
}

it("defaults new cores to sandbox and cannot infer grants from the ceiling or payload", async () => {
  const w = world();
  await w.core.importPackage(
    await manifestZip({
      ...manifest,
      payload: { tier: "machine", trusted: true },
    }),
  );
  expect(await w.core.localAuthorizationState()).toMatchObject({
    tier: { ceiling: "sandbox", projects: [], readOnly: [], components: [] },
    grants: [],
  });
  expect((await w.core.engineTrustSnapshot("first", "local")).trusted).toBe(
    false,
  );
  const db = new Database(path.join(w.dataDir, "plums.db"));
  db.prepare("INSERT INTO agent_tier VALUES (?,?)").run(
    "agent-a",
    JSON.stringify({
      instanceId: "agent-a",
      ceiling: "machine",
      projects: [],
      readOnly: [],
      components: [],
    }),
  );
  db.close();
  expect((await w.core.engineTrustSnapshot("first", "local")).trusted).toBe(
    false,
  );
});

it("never interprets an unknown engine kind in a 1.x permission as local execution authority", async () => {
  const w = world(),
    permission = { ...engine, level: "read" as const };
  await w.core.importPackage(
    await manifestZip({
      ...manifest,
      formatVersion: "1.0",
      permissions: [permission],
    }),
  );
  await expect(
    w.core.engineTrustSnapshot("first", "local"),
  ).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
    path: "/formatVersion",
    details: { reason: "FORMAT_API_MISMATCH" },
  });
  const installed = (await w.core.getPackage("first")).installed;
  w.core.close();
  const db = new Database(path.join(w.dataDir, "plums.db"));
  db.prepare("INSERT INTO engine_trust VALUES (?,?,?)").run(
    "first",
    "local",
    JSON.stringify({
      instanceId: "agent-a",
      packageId: "first",
      engineId: "local",
      installedAt: installed.installedAt,
      permission: enginePermissionKey(permission),
      grantedAt: installed.installedAt,
    }),
  );
  db.exec(
    "DROP TABLE agent_tier; DROP TABLE agent_local_grants; DROP TABLE local_authorization_migrations; PRAGMA user_version=6",
  );
  db.close();
  const core = reopen({
    dataDir: w.dataDir,
    instanceId: "agent-a",
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
    onAudit: () => {},
  });
  expect(await core.localAuthorizationState()).toMatchObject({
    tier: { ceiling: "sandbox" },
    grants: [],
    migration: { migrated: 0, skipped: 1, audited: true },
  });
});

it("migrates 6 to 7 without extending trust, preserves every old record and keeps finite Grants effective", async () => {
  const f = await schema6(),
    core = reopen(f.options);
  expect(await core.listInstalled()).toEqual(f.installed);
  const raw = new InstallStore(f.dataDir);
  expect(raw.listEngineTrust("first")).toEqual([]); // Pending audit cannot authorize execution.
  raw.close();
  const state = await core.localAuthorizationState();
  expect(state.tier).toEqual({
    instanceId: "agent-a",
    ceiling: "machine",
    projects: [],
    readOnly: [],
    components: [],
  });
  expect(state.grants.map((g) => g.packageId)).toEqual(["first"]);
  expect(state.grants[0]).toMatchObject({
    engineId: "local",
    tier: "machine",
    hosts: [],
    credentials: [],
    toolchains: [],
    configuration: [],
    source: "engine-trust",
  });
  expect(state.migration).toMatchObject({
    migrated: 1,
    skipped: 3,
    audited: true,
  });
  expect((await core.engineTrustSnapshot("first", "local")).trusted).toBe(true);
  for (const id of ["second", "changed", "reinstalled", "project"])
    expect((await core.engineTrustSnapshot(id, "local")).trusted).toBe(false);
  await expect(
    core.engineTrustSnapshot("memory", "local"),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(await core.getConsent("first")).toEqual(f.consent);
  expect(await core.getSecretReferences("first")).toEqual(f.refs);
  expect(
    await core.checkGrant(f.grant.id, "first", {
      reads: ["files"],
      outputs: ["reply"],
    }),
  ).toEqual(f.grant);
  const db = new Database(path.join(f.dataDir, "plums.db"));
  expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
  expect(
    db.prepare("SELECT * FROM engine_trust ORDER BY package_id").all(),
  ).toEqual(f.archive);
  for (const [table, rows] of Object.entries(f.before))
    expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows);
  db.close();
  expect(f.events).toHaveLength(1);
  expect(f.events[0]).toMatchObject({
    agentId: "agent-a",
    phase: "grant",
    reason: "LOCAL_AUTHORIZATION_MIGRATED",
    migration: { migrated: 1, skipped: 3 },
  });
  expect(Object.isFrozen(f.events[0])).toBe(true);
  expect(Object.isFrozen(f.events[0]!.migration)).toBe(true);
  expect(JSON.stringify(f.events)).not.toContain(f.dataDir);
  expect(JSON.stringify(f.events)).not.toContain("synthetic-secret-value");
  core.close();
  expect(
    (await reopen(f.options).engineTrustSnapshot("first", "local")).trusted,
  ).toBe(true);
  expect(f.events).toHaveLength(1);
});

it("keeps migration authority inactive on audit failure or missing audit and retries after restart", async () => {
  const f = await schema6(),
    core = reopen({
      ...f.options,
      onAudit: async () => {
        throw Error("synthetic-secret-value");
      },
    });
  await expect(core.localAuthorizationState()).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { phase: "migration_audit", executionState: "not_started" },
  });
  const store = new InstallStore(f.dataDir);
  expect(store.listEngineTrust("first")).toEqual([]);
  expect(store.localMigration("agent-a")?.audited).toBe(false);
  store.close();
  core.close();
  const missing = reopen({ ...f.options, onAudit: undefined });
  await expect(
    missing.engineTrustSnapshot("first", "local"),
  ).rejects.toMatchObject({ code: "CAPABILITY_FAILED" });
  missing.close();
  expect(
    (await reopen(f.options).engineTrustSnapshot("first", "local")).trusted,
  ).toBe(true);
});

it("does not resurrect a grant revoked during asynchronous migration audit, or on reinstall/restart", async () => {
  const f = await schema6();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  const core = reopen({
    ...f.options,
    onAudit: async () => {
      entered();
      await gate;
    },
  });
  const check = core.engineTrustSnapshot("first", "local");
  await started;
  await child(f.dataDir, "revoke");
  release();
  expect((await check).trusted).toBe(false);
  core.close();
  const again = reopen(f.options);
  expect((await again.engineTrustSnapshot("first", "local")).trusted).toBe(
    false,
  );
  await again.uninstall("first");
  await again.importPackage(await manifestZip(manifest));
  expect((await again.engineTrustSnapshot("first", "local")).trusted).toBe(
    false,
  );
  const db = new Database(path.join(f.dataDir, "plums.db"));
  expect(
    db.prepare("SELECT * FROM engine_trust ORDER BY package_id").all(),
  ).toEqual(f.archive);
  db.close();
});

it("isolates authorization by Agent and cannot approve a project through the deprecated engine API", async () => {
  const w = world();
  await w.core.importPackage(await manifestZip(manifest));
  await w.core.grantEngineTrust(
    await w.core.engineTrustSnapshot("first", "local"),
  );
  const other = reopen({
    dataDir: w.dataDir,
    instanceId: "agent-b",
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  expect((await other.localAuthorizationState()).tier.ceiling).toBe("sandbox");
  expect((await other.engineTrustSnapshot("first", "local")).trusted).toBe(
    false,
  );
  await other.grantEngineTrust(
    await other.engineTrustSnapshot("first", "local"),
  );
  expect((await w.core.engineTrustSnapshot("first", "local")).trusted).toBe(
    true,
  );
  expect((await other.engineTrustSnapshot("first", "local")).trusted).toBe(
    true,
  );
  await w.core.revokeEngineTrust("first", "local");
  expect((await other.engineTrustSnapshot("first", "local")).trusted).toBe(
    true,
  );
  await w.core.importPackage(
    await manifestZip({
      ...manifest,
      id: "project",
      permissions: [{ ...engine, tier: "project" }],
    }),
  );
  expect(
    await w.core.grantEngineTrust(
      await w.core.engineTrustSnapshot("project", "local"),
    ),
  ).toBe(false);
  expect((await w.core.localAuthorizationState()).grants).toEqual([]);
});

it("cannot activate migration when acknowledging the durable audit fails", async () => {
  const f = await schema6(),
    core = reopen(f.options);
  await core.listInstalled();
  const db = new Database(path.join(f.dataDir, "plums.db"));
  db.exec(
    "CREATE TRIGGER fail_ack BEFORE UPDATE ON local_authorization_migrations BEGIN SELECT RAISE(ABORT, 'synthetic-private-error'); END",
  );
  await expect(
    core.engineTrustSnapshot("first", "local"),
  ).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { phase: "migration_audit", executionState: "not_started" },
  });
  const store = new InstallStore(f.dataDir);
  expect(store.listEngineTrust("first")).toEqual([]);
  store.close();
  db.exec("DROP TRIGGER fail_ack");
  db.close();
  expect((await core.engineTrustSnapshot("first", "local")).trusted).toBe(true);
  expect(f.events).toHaveLength(2);
  expect(f.events[0]!.callId).toBe(f.events[1]!.callId);
});

it("serializes cross-process migration and does not duplicate the archived grants", async () => {
  const f = await schema6();
  await Promise.all([child(f.dataDir, "migrate"), child(f.dataDir, "migrate")]);
  const core = reopen(f.options),
    state = await core.localAuthorizationState();
  expect(state.grants).toHaveLength(1);
  expect(state.migration).toMatchObject({
    migrated: 1,
    skipped: 3,
    audited: true,
  });
  const db = new Database(path.join(f.dataDir, "plums.db"));
  expect(
    db.prepare("SELECT * FROM engine_trust ORDER BY package_id").all(),
  ).toEqual(f.archive);
  db.close();
});

it("leaves the ceiling at sandbox when no legacy entry has a current declaration", async () => {
  const f = await schema6(),
    db = new Database(path.join(f.dataDir, "plums.db"));
  db.prepare("DELETE FROM engine_trust WHERE package_id='first'").run();
  db.close();
  const state = await reopen(f.options).localAuthorizationState();
  expect(state.tier.ceiling).toBe("sandbox");
  expect(state.grants).toEqual([]);
  expect(state.migration).toMatchObject({
    migrated: 0,
    skipped: 3,
    audited: true,
  });
});

it("rolls back failed migration and rejects databases from a newer reader", async () => {
  const f = await schema6();
  const db = new Database(path.join(f.dataDir, "plums.db"));
  db.exec("CREATE TABLE agent_local_grants (wrong TEXT)");
  db.close();
  const core = reopen(f.options);
  await expect(core.listInstalled()).rejects.toThrow();
  core.close();
  const check = new Database(path.join(f.dataDir, "plums.db"));
  expect(check.pragma("user_version", { simple: true })).toBe(6);
  expect(
    check
      .prepare("SELECT name FROM sqlite_master WHERE name='agent_tier'")
      .get(),
  ).toBeUndefined();
  expect(
    check.prepare("SELECT * FROM engine_trust ORDER BY package_id").all(),
  ).toEqual(f.archive);
  check.exec(
    `DROP TABLE agent_local_grants; PRAGMA user_version=${SCHEMA_VERSION + 1}`,
  );
  check.close();
  const newer = new InstallStore(f.dataDir);
  expect(() => newer.open()).toThrow(/newer Plums/);
  newer.close();
  await expect(reopen(f.options).listInstalled()).rejects.toMatchObject({
    code: "SECRET_NOT_FOUND",
  });
});
