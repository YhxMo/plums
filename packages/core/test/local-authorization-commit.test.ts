import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createCore,
  enginePermissionKey,
  MemorySecretStore,
  RecordingEgressSink,
  type Core,
  type LocalAuthorizationCommit,
  type ManifestV2,
} from "../src/index.js";
import { makeCore, manifestZip } from "./package-helpers.js";
const opened: Core[] = [],
  dirs: string[] = [];
afterEach(() => {
  opened.splice(0).forEach((c) => c.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
async function fixture() {
  const w = makeCore({ instanceId: "agent-a", onAudit: () => {} });
  opened.push(w.core);
  dirs.push(w.dataDir);
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id: "first",
    name: "Fixture",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [
      { id: "local", kind: "engine", target: "local", reason: "Fixture" },
    ],
    payload: {},
  };
  await w.core.importPackage(await manifestZip(manifest));
  const plan = async (): Promise<LocalAuthorizationCommit> => {
    const state = await w.core.localAuthorizationState();
    const assembly = await Promise.all(
      (await w.core.listInstalled()).map(async (p) => ({
        packageId: p.id,
        installedAt: p.installedAt,
        permissions: enginePermissionKey(
          (await w.core.getPackage(p.id)).manifest.permissions,
        ),
      })),
    );
    return {
      revision: state.revision,
      assembly,
      tier: { ...state.tier, ceiling: "machine", components: assembly },
      grants: [
        {
          instanceId: "agent-a",
          packageId: "first",
          engineId: "local",
          installedAt: assembly[0]!.installedAt,
          permission: enginePermissionKey(manifest.permissions[0]),
          tier: "machine",
          hosts: [],
          toolchains: [],
          configuration: [],
          credentials: [],
          grantedAt: new Date().toISOString(),
          source: "confirmation",
        },
      ],
    };
  };
  return { ...w, manifest, plan };
}
it("commits an assembly atomically and cannot replay the same revision", async () => {
  const f = await fixture(),
    p = await f.plan();
  expect(await f.core.commitLocalAuthorization(p)).toBe(true);
  expect(await f.core.commitLocalAuthorization(p)).toBe(false);
  expect(await f.core.localAuthorizationState()).toMatchObject({
    tier: { ceiling: "machine" },
    grants: [{ packageId: "first" }],
    revision: p.revision + 1,
  });
});
it("a ceiling alone grants no local entry and confirms no ordinary component", async () => {
  const f = await fixture(),
    p = await f.plan();
  p.grants = [];
  p.tier.components = [];
  expect(await f.core.commitLocalAuthorization(p)).toBe(true);
  expect((await f.core.engineTrustSnapshot("first", "local")).trusted).toBe(
    false,
  );
});
it("binds the commit to its Agent and complete assembly identity", async () => {
  const f = await fixture();
  const wrongAgent = await f.plan();
  wrongAgent.tier.instanceId = "agent-b";
  expect(await f.core.commitLocalAuthorization(wrongAgent)).toBe(false);
  const old = await f.plan();
  await f.core.importPackage(
    await manifestZip({ ...f.manifest, id: "second" }),
  );
  expect(await f.core.commitLocalAuthorization(old)).toBe(false);
  const unknown = await f.plan();
  unknown.grants[0]!.permission = "different";
  expect(await f.core.commitLocalAuthorization(unknown)).toBe(false);
  expect((await f.core.localAuthorizationState()).grants).toEqual([]);
});
it("cannot authorize absent engines, higher tiers, duplicate entries or undeclared hosts", async () => {
  const f = await fixture();
  for (const mutate of [
    (p: LocalAuthorizationCommit) => {
      p.grants[0]!.engineId = "undeclared";
    },
    (p: LocalAuthorizationCommit) => {
      p.tier.ceiling = "project";
    },
    (p: LocalAuthorizationCommit) => {
      p.grants.push(structuredClone(p.grants[0]!));
    },
    (p: LocalAuthorizationCommit) => {
      p.grants[0]!.hosts.push("undeclared.test");
    },
    (p: LocalAuthorizationCommit) => {
      p.grants[0]!.installedAt = "old-install";
    },
  ]) {
    const p = await f.plan();
    mutate(p);
    expect(await f.core.commitLocalAuthorization(p)).toBe(false);
  }
});
it("rejects a stale plan after same-process, legacy or cross-process revocation", async () => {
  const f = await fixture();
  const old = await f.plan();
  await f.core.revokeEngineTrust("first", "local");
  expect(await f.core.commitLocalAuthorization(old)).toBe(false);
  const beforeLegacy = await f.plan();
  expect(
    await f.core.grantEngineTrust(
      await f.core.engineTrustSnapshot("first", "local"),
    ),
  ).toBe(true);
  expect(await f.core.commitLocalAuthorization(beforeLegacy)).toBe(false);
  const beforeChild = await f.plan();
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./local-authorization-child.mjs", import.meta.url)),
    f.dataDir,
    "revoke",
  ]);
  expect(await f.core.commitLocalAuthorization(beforeChild)).toBe(false);
});
it("a database write failure rolls back both ceiling and execution items", async () => {
  const f = await fixture(),
    p = await f.plan();
  const db = new Database(path.join(f.dataDir, "plums.db"));
  db.exec(
    "CREATE TRIGGER synthetic_failure BEFORE INSERT ON agent_local_grants BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
  );
  db.close();
  await expect(f.core.commitLocalAuthorization(p)).rejects.toThrow();
  expect(await f.core.localAuthorizationState()).toMatchObject({
    tier: { ceiling: "sandbox" },
    grants: [],
    revision: p.revision,
  });
});
it("persisted grants survive restart and unchanged upgrades but not reinstall", async () => {
  const f = await fixture();
  await f.core.commitLocalAuthorization(await f.plan());
  await f.core.updatePackage(
    await manifestZip({ ...f.manifest, version: "1.1.0" }),
  );
  const c = createCore({
    dataDir: f.dataDir,
    instanceId: "agent-a",
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
    onAudit: () => {},
  });
  opened.push(c);
  expect((await c.engineTrustSnapshot("first", "local")).trusted).toBe(true);
  const beforeReinstall = await f.plan();
  await f.core.uninstall("first");
  await f.core.importPackage(await manifestZip(f.manifest));
  expect(await c.commitLocalAuthorization(beforeReinstall)).toBe(false);
  expect((await c.engineTrustSnapshot("first", "local")).trusted).toBe(false);
});
