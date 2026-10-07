import Database from "better-sqlite3";
import path from "node:path";
import { rmSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
  type Core,
  type AuditEvent,
  type CreateCoreOptions,
  type GrantUse,
} from "@plums/core";
import { makeCore, manifestZip, validManifestV2 } from "./package-helpers.js";
const worlds: { core: Core; dataDir: string }[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const w of worlds.splice(0)) {
    w.core.close();
    rmSync(w.dataDir, { recursive: true, force: true });
  }
});
async function fixture(extra: Partial<CreateCoreOptions> = {}) {
  const events: Readonly<AuditEvent>[] = [],
    confirm = new ScriptedConfirm(),
    calls: unknown[] = [];
  let fingerprint = "binding-one";
  const services: CreateCoreOptions["services"] = {
    https: {
      operations: { request: "egress" },
      getBinding: () => ({ fingerprint, sources: [], host: "fake.invalid" }),
      invoke: async (invocation) => {
        await invocation.assertActive();
        calls.push(invocation.input);
        return { text: "fixture reply" };
      },
    },
  };
  const options = {
    instanceId: "agent-a",
    services,
    onAudit: (e: Readonly<AuditEvent>) => {
      events.push(e);
    },
    confirm,
    ...extra,
  };
  const w = makeCore(options);
  worlds.push(w);
  for (const [id, kind] of [
    ["model", "connector"],
    ["assistant", "extension"],
  ] as const) {
    const m = {
      ...validManifestV2(kind),
      id,
      dependencies:
        id === "assistant"
          ? [{ id: "model", kind: "connector" as const, range: "*" }]
          : [],
      permissions: [
        {
          id: "https",
          kind: "service" as const,
          target: "https",
          operations: ["request"],
          reason: "Use configured endpoint",
        },
        ...(id === "assistant"
          ? [
              {
                id: "engine",
                kind: "engine" as const,
                target: "local",
                reason: "Run local engine",
              },
            ]
          : []),
      ],
    };
    await w.core.importPackage(await manifestZip(m));
    await w.core.grantConsent(id);
    await w.core.enable(id);
    await w.core.grantBackgroundConsent({
      extensionId: id,
      permissionId: "https",
      binding: "model/api",
      operation: "request",
      sources: [],
    });
  }
  await w.core.grantEngineTrust(
    await w.core.engineTrustSnapshot("assistant", "local"),
  );
  const scope = {
    reads: ["conversation", "memory"],
    outputs: ["reply", "memory", "feed"],
    services: ["assistant", "model"].map((packageId) => ({
      packageId,
      permissionId: "https",
      binding: "model/api",
      operation: "request",
    })),
  };
  const create = async () =>
    w.core.createGrant({
      ...(await w.core.grantPlan({
        ownerId: "assistant",
        engineId: "local",
        scope,
      })),
      durationMs: 3_600_000,
    });
  const use: GrantUse = { reads: ["conversation"], outputs: ["reply"] };
  const run = (grantId?: string, grantScope = use) =>
    w.core.runDelegatedCapability({
      packageId: "model",
      permissionId: "https",
      callers: [{ packageId: "assistant", permissionId: "https" }],
      request: {
        kind: "service",
        operation: "request",
        binding: "model/api",
        sources: [],
        input: { private: "not in audit" },
      },
      ...(grantId ? { grantId, grantScope } : {}),
    });
  return {
    ...w,
    options,
    events,
    calls,
    confirm,
    scope,
    create,
    run,
    use,
    change: () => {
      fingerprint = "binding-two";
    },
  };
}
it("uses a persisted finite grant without prompting and audits its identity, never content", async () => {
  const w = await fixture(),
    g = await w.create();
  await expect(w.run(g.id)).resolves.toMatchObject({ kind: "service" });
  expect(w.calls).toHaveLength(1);
  expect(w.confirm.asked).toHaveLength(0);
  expect(w.events.some((e) => e.grantId === g.id && e.phase === "grant")).toBe(
    true,
  );
  expect(w.events.some((e) => e.grantId === g.id && e.phase === "result")).toBe(
    true,
  );
  expect(JSON.stringify(w.events)).not.toContain("not in audit");
  expect(JSON.stringify(w.events)).not.toContain("conversation");
  w.core.close();
  w.core = createCore({
    dataDir: w.dataDir,
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
    ...w.options,
  });
  worlds[worlds.length - 1]!.core = w.core;
  expect(await w.core.checkGrant(g.id, "assistant", w.use)).toMatchObject({
    id: g.id,
  });
});
it.each([
  "expired",
  "revoked",
  "binding",
  "disabled",
  "settings",
  "engine-trust",
])("blocks %s grants before execution", async (reason) => {
  const w = await fixture(),
    g = await w.create();
  if (reason === "expired") vi.spyOn(Date, "now").mockReturnValue(g.expiresAt);
  if (reason === "revoked") await w.core.revokeGrant(g.id);
  if (reason === "binding") w.change();
  if (reason === "disabled") await w.core.disable("assistant");
  if (reason === "settings") await w.core.setSettings("model", {});
  if (reason === "engine-trust")
    await w.core.revokeEngineTrust("assistant", "local");
  await expect(w.run(g.id)).rejects.toMatchObject({
    code: reason === "binding" ? "CONSENT_REQUIRED" : "PERMISSION_DENIED",
  });
  expect(w.calls).toHaveLength(0);
});
it("never turns legacy service consent into a confirmation exemption", async () => {
  const w = await fixture();
  await expect(w.run()).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
  expect(w.confirm.asked).toHaveLength(1);
  expect(w.calls).toHaveLength(0);
});
it("rejects unselected resources and incomplete caller chains", async () => {
  const w = await fixture(),
    g = await w.create();
  await expect(
    w.run(g.id, { reads: ["files"], outputs: ["reply"] }),
  ).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
  await expect(
    w.core.runDelegatedCapability({
      packageId: "model",
      permissionId: "https",
      callers: [],
      request: {
        kind: "service",
        operation: "request",
        binding: "model/api",
        sources: [],
        input: null,
      },
      grantId: g.id,
      grantScope: w.use,
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(w.calls).toHaveLength(0);
});
it("refuses stale previews and revocation during grant audit", async () => {
  const w = await fixture(),
    plan = await w.core.grantPlan({
      ownerId: "assistant",
      engineId: "local",
      scope: w.scope,
    });
  w.change();
  await expect(
    w.core.createGrant({ ...plan, durationMs: 3_600_000 }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect(await w.core.listGrants()).toHaveLength(0);
  const x = await fixture({
    onAudit: async (e) => {
      if (e.grantId && e.phase === "grant") await x.core.revokeGrant(e.grantId);
    },
  });
  await expect(x.create()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(await x.core.listGrants()).toHaveLength(0);
});
it("does not return a model result if revocation occurs during result audit", async () => {
  const w = await fixture({
      onAudit: async (e) => {
        if (e.grantId && e.phase === "result")
          await w.core.revokeGrant(e.grantId);
      },
    }),
    g = await w.create();
  await expect(w.run(g.id)).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { phase: "result_authorization", executionState: "completed" },
  });
  expect(w.calls).toHaveLength(1);
});
it("fails closed on grant audit failure and copies the proposal before waiting", async () => {
  const w = await fixture({
    onAudit: async (e) => {
      if (e.grantId) throw Error("private failure");
    },
  });
  await expect(w.create()).rejects.toMatchObject({ code: "CAPABILITY_FAILED" });
  expect(await w.core.listGrants()).toHaveLength(0);
  const x = await fixture(),
    plan = await x.core.grantPlan({
      ownerId: "assistant",
      engineId: "local",
      scope: x.scope,
    }),
    proposal = { ...plan, durationMs: 900_000 };
  const task = x.core.createGrant(proposal);
  proposal.scope.reads.push("files");
  const g = await task;
  expect(g.scope.reads).not.toContain("files");
});

it("does not activate a grant when its durable transaction fails", async () => {
  const w = await fixture();
  const db = new Database(path.join(w.dataDir, "plums.db"));
  db.exec(
    "CREATE TRIGGER fail_grant BEFORE INSERT ON authority_grants BEGIN SELECT RAISE(ABORT, 'private storage failure'); END",
  );
  db.close();
  await expect(w.create()).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { phase: "grant_save", executionState: "not_started" },
  });
  expect(await w.core.listGrants()).toEqual([]);
});
it("migrates version 5 without losing installs, consent or engine/service authority", async () => {
  const w = await fixture(),
    before = await w.core.listInstalled(),
    trust = await w.core.engineTrustSnapshot("assistant", "local"),
    consents = await w.core.listBackgroundConsents("assistant");
  w.core.close();
  const db = new Database(path.join(w.dataDir, "plums.db"));
  db.exec("DROP TABLE authority_grants;DROP TABLE authority_grant_revision;");
  db.pragma("user_version=5");
  db.close();
  expect(await w.core.listInstalled()).toEqual(before);
  expect(await w.core.engineTrustSnapshot("assistant", "local")).toMatchObject({
    trusted: true,
    installedAt: trust.installedAt,
  });
  expect(await w.core.listBackgroundConsents("assistant")).toEqual(consents);
  expect(await w.core.listGrants()).toEqual([]);
  await expect(w.create()).resolves.toHaveProperty("id");
});

it("falls back to single confirmation outside a live grant, without expanding its scope", async () => {
  const w = await fixture(),
    g = await w.create();
  const prompt = vi.spyOn(w.confirm, "ask").mockResolvedValue(true);
  await w.run(g.id, { reads: ["files"], outputs: ["reply"] });
  expect(prompt).toHaveBeenCalledTimes(1);
  expect((await w.core.listGrants())[0].scope.reads).not.toContain("files");
});

it("does not revive an old grant after engine trust is revoked and restored at the same clock time", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T08:00:00Z"));
  try {
    const w = await fixture(),
      g = await w.create();
    await w.core.revokeEngineTrust("assistant", "local");
    await w.core.grantEngineTrust(
      await w.core.engineTrustSnapshot("assistant", "local"),
    );
    expect(await w.core.checkGrant(g.id, "assistant", w.use)).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
