import {
  localEntryPlan,
  revokeLocalEntry,
} from "./local-authorization-fixture.mjs";
import Database from "better-sqlite3";
import path from "node:path";
import { rmSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
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
  type Grant,
} from "@plumsjs/core";
import { makeCore, manifestZip, validManifestV2 } from "./package-helpers.js";
import { legacyGrantFingerprint } from "./legacy-grant-helper.js";
import { InstallStore } from "../src/install/store.js";
const worlds: { core: Core; dataDir: string }[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const w of worlds.splice(0)) {
    w.core.close();
    rmSync(w.dataDir, { recursive: true, force: true });
  }
});
async function fixture(
  extra: Partial<CreateCoreOptions> = {},
  secondEntry = false,
) {
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
              ...(secondEntry
                ? [
                    {
                      id: "other-engine",
                      kind: "engine" as const,
                      target: "other",
                      reason: "Other entry",
                    },
                  ]
                : []),
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
  await w.core.commitLocalAuthorization(
    await localEntryPlan(w.core, "assistant", "local"),
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
async function otherEngine(w: Awaited<ReturnType<typeof fixture>>) {
  await w.core.importPackage(
    await manifestZip({
      ...validManifestV2("extension"),
      id: "other",
      permissions: [
        {
          id: "engine",
          kind: "engine",
          target: "local",
          reason: "Other engine",
        },
      ],
    }),
  );
  await w.core.grantConsent("other");
  await w.core.enable("other");
}
const changeInChild = (dataDir: string, packageId: string, action: string) =>
  promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("./grants-child.mjs", import.meta.url)),
    dataDir,
    packageId,
    action,
  ]);

async function freezeLegacy(
  w: Awaited<ReturnType<typeof fixture>>,
  g: Grant,
  schema: 6 | 7,
) {
  const local = (await w.core.localAuthorizationState()).grants.find(
    (x) => x.packageId === g.ownerId && x.engineId === g.engineId,
  )!;
  const trust = Object.fromEntries(
    [
      "instanceId",
      "packageId",
      "engineId",
      "installedAt",
      "permission",
      "grantedAt",
    ].map((k) => [k, local[k as keyof typeof local]]),
  );
  w.core.close();
  const db = new Database(path.join(w.dataDir, "plums.db"));
  try {
    db.prepare("UPDATE authority_grants SET record = ? WHERE id = ?").run(
      JSON.stringify(g),
      g.id,
    );
    db.exec("DROP TABLE IF EXISTS authority_grant_legacy");
    if (schema === 6) {
      db.prepare("INSERT INTO engine_trust VALUES (?,?,?)").run(
        g.ownerId,
        g.engineId,
        JSON.stringify(trust),
      );
      db.exec(
        "DROP TABLE agent_tier; DROP TABLE agent_local_grants; DROP TABLE local_authorization_migrations; PRAGMA user_version=6",
      );
    }
  } finally {
    db.close();
  }
}

it("keeps finite Grants effective when another component is confirmed or revoked", async () => {
  const w = await fixture();
  await otherEngine(w);
  const g = await w.create();
  await w.core.commitLocalAuthorization(
    await localEntryPlan(w.core, "other", "local"),
  );
  expect(await w.core.checkGrant(g.id, "assistant", w.use)).toEqual(g);
  await revokeLocalEntry(w.core, "other", "local");
  await expect(w.run(g.id)).resolves.toHaveProperty("kind", "service");
  expect(w.confirm.asked).toHaveLength(0);
});

it.each(["grant", "allow", "result"] as const)(
  "keeps an unrelated cross-process confirmation from interrupting %s audit",
  async (phase) => {
    let armed = false;
    const w = await fixture({
      onAudit: async (e) => {
        if (armed && e.grantId && e.phase === phase) {
          armed = false;
          await changeInChild(w.dataDir, "other", "grant");
        }
      },
    });
    await otherEngine(w);
    armed = phase === "grant";
    const g = await w.create();
    armed = phase !== "grant";
    await expect(w.run(g.id)).resolves.toHaveProperty("kind", "service");
    expect(await w.core.checkGrant(g.id, "assistant", w.use)).toEqual(g);
    expect(w.calls).toHaveLength(1);
  },
);

it.each([6, 7] as const)(
  "retains authentic legacy Grants from schema %s across unrelated changes and restart",
  async (schema) => {
    const w = await fixture();
    await otherEngine(w);
    const g = await w.create();
    g.fingerprint = await legacyGrantFingerprint(w.core, w.dataDir, g);
    await freezeLegacy(w, g, schema);
    expect(await w.core.checkGrant(g.id, "assistant", w.use)).toEqual(g);
    await w.core.commitLocalAuthorization(
      await localEntryPlan(w.core, "other", "local"),
    );
    expect(await w.core.checkGrant(g.id, "assistant", w.use)).toEqual(g);
    await revokeLocalEntry(w.core, "other", "local");
    w.core.close();
    await expect(w.run(g.id)).resolves.toHaveProperty("kind", "service");
    expect((await w.core.listGrants())[0]).toEqual(g);
    await changeInChild(w.dataDir, "assistant", "restore");
    expect(await w.core.checkGrant(g.id, "assistant", w.use)).toBeUndefined();
  },
);

it.each([6, 7] as const)(
  "never revives already stale legacy Grants while opening schema %s",
  async (schema) => {
    const w = await fixture();
    await otherEngine(w);
    const g = await w.create();
    g.fingerprint = await legacyGrantFingerprint(w.core, w.dataDir, g);
    // The old global fingerprint was already stale before this migration started.
    await w.core.commitLocalAuthorization(
      await localEntryPlan(w.core, "other", "local"),
    );
    await freezeLegacy(w, g, schema);
    expect(await w.core.checkGrant(g.id, "assistant", w.use)).toBeUndefined();
    await revokeLocalEntry(w.core, "other", "local");
    w.core.close();
    expect(await w.core.checkGrant(g.id, "assistant", w.use)).toBeUndefined();
    expect((await w.core.listGrants())[0]).toEqual(g);
    await expect(w.run(g.id)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(w.calls).toHaveLength(0);
  },
);

it("keeps another entry in the same component from invalidating the selected Grant", async () => {
  const w = await fixture({}, true),
    g = await w.create();
  await w.core.commitLocalAuthorization(
    await localEntryPlan(w.core, "assistant", "other"),
  );
  expect(await w.core.checkGrant(g.id, "assistant", w.use)).toEqual(g);
  await revokeLocalEntry(w.core, "assistant", "other");
  await expect(w.run(g.id)).resolves.toHaveProperty("kind", "service");
  expect(w.confirm.asked).toHaveLength(0);
});

it.each(["grant", "allow", "result"] as const)(
  "blocks own cross-process revoke/reconfirm during %s audit",
  async (phase) => {
    let armed = false;
    const w = await fixture({
      onAudit: async (e) => {
        if (armed && e.grantId && e.phase === phase) {
          armed = false;
          await changeInChild(w.dataDir, "assistant", "restore");
        }
      },
    });
    if (phase === "grant") {
      armed = true;
      await expect(w.create()).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      expect(await w.core.listGrants()).toHaveLength(0);
    } else {
      const g = await w.create();
      armed = true;
      await expect(w.run(g.id)).rejects.toMatchObject(
        phase === "result"
          ? {
              code: "CAPABILITY_FAILED",
              details: {
                phase: "result_authorization",
                executionState: "completed",
              },
            }
          : { code: "PERMISSION_DENIED" },
      );
      expect(await w.core.checkGrant(g.id, "assistant", w.use)).toBeUndefined();
    }
    expect(w.calls).toHaveLength(phase === "result" ? 1 : 0);
  },
);

it.each(["expired", "revoked", "binding", "settings"])(
  "keeps legacy %s Grants invalid after compatibility anchoring",
  async (reason) => {
    const w = await fixture(),
      g = await w.create();
    g.fingerprint = await legacyGrantFingerprint(w.core, w.dataDir, g);
    await freezeLegacy(w, g, 6);
    expect(await w.core.checkGrant(g.id, "assistant", w.use)).toEqual(g);
    if (reason === "expired")
      vi.spyOn(Date, "now").mockReturnValue(g.expiresAt);
    if (reason === "revoked") await w.core.revokeGrant(g.id);
    if (reason === "binding") w.change();
    if (reason === "settings") await w.core.setSettings("model", {});
    expect(await w.core.checkGrant(g.id, "assistant", w.use)).toBeUndefined();
    await expect(w.run(g.id)).rejects.toMatchObject({
      code: reason === "binding" ? "CONSENT_REQUIRED" : "PERMISSION_DENIED",
    });
    expect(w.calls).toHaveLength(0);
  },
);
it.each(["other", "assistant"])(
  "checks the selected authorization under the save lock after %s changes at the persistence boundary",
  async (packageId) => {
    const w = await fixture();
    await otherEngine(w);
    const save = InstallStore.prototype.saveGrantIfCurrent;
    const spy = vi
      .spyOn(InstallStore.prototype, "saveGrantIfCurrent")
      .mockImplementation(function (grant, revision, authorization) {
        execFileSync(process.execPath, [
          fileURLToPath(new URL("./grants-child.mjs", import.meta.url)),
          w.dataDir,
          packageId,
          packageId === "assistant" ? "restore" : "grant",
        ]);
        return save.call(this, grant, revision, authorization);
      });
    if (packageId === "assistant") {
      await expect(w.create()).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      expect(await w.core.listGrants()).toEqual([]);
    } else {
      const g = await w.create();
      expect(await w.core.checkGrant(g.id, "assistant", w.use)).toEqual(g);
    }
    expect(spy).toHaveBeenCalledTimes(1);
  },
);
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
    await revokeLocalEntry(w.core, "assistant", "local");
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
    trust = await localEntryPlan(w.core, "assistant", "local"),
    consents = await w.core.listBackgroundConsents("assistant");
  w.core.close();
  const db = new Database(path.join(w.dataDir, "plums.db"));
  db.exec("DROP TABLE authority_grants;DROP TABLE authority_grant_revision;");
  db.pragma("user_version=5");
  db.close();
  expect(await w.core.listInstalled()).toEqual(before);
  expect(await localEntryPlan(w.core, "assistant", "local")).toMatchObject({
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

it.each([false, true])(
  "does not revive a Grant (legacy=%s) after own revoke/restore at the same clock time",
  async (legacy) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T08:00:00Z"));
    try {
      const w = await fixture(),
        g = await w.create();
      if (legacy) {
        g.fingerprint = await legacyGrantFingerprint(w.core, w.dataDir, g);
        await freezeLegacy(w, g, 6);
        expect(await w.core.checkGrant(g.id, "assistant", w.use)).toEqual(g);
      }
      await revokeLocalEntry(w.core, "assistant", "local");
      await w.core.commitLocalAuthorization(
        await localEntryPlan(w.core, "assistant", "local"),
      );
      expect(await w.core.checkGrant(g.id, "assistant", w.use)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  },
);
