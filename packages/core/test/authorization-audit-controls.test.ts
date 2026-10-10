import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  CAPABILITY_FAILED,
  createArchive,
  createCore,
  MemorySecretStore,
  PlumsError,
  RecordingEgressSink,
  REDACTED,
  redact,
  secretRef,
  type AuditEvent,
  type Core,
  type Grant,
} from "@plumsjs/core";
import { InstallStore } from "../src/install/store.js";

const cores: Core[] = [],
  directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  cores.splice(0).forEach((core) => core.close());
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(lstat(directory), { code: "ENOENT" });
  }
});

type Surface = "background" | "finite";
const surfaces: Surface[] = ["background", "finite"];
async function fixture(value: string, surface: Surface) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "plums-auth-audit-"));
  directories.push(directory);
  const id = "fixture.authorization-audit",
    permissionId = "https";
  const secrets = new MemorySecretStore(),
    egress = new RecordingEgressSink();
  const ref = secretRef(id, "token"),
    events: Readonly<AuditEvent>[] = [];
  let readFails = false,
    fingerprint = "synthetic-binding",
    invokes = 0;
  let audit:
    | ((event: Readonly<AuditEvent>) => void | Promise<void>)
    | undefined;
  let bindingError: unknown;
  const core = createCore({
    dataDir: directory,
    instanceId: "synthetic-agent",
    egress,
    secrets: {
      get: async (key) => {
        if (readFails) throw new Error("synthetic-read-failure " + value);
        return secrets.get(key);
      },
      set: (key, token) => secrets.set(key, token),
      delete: (key) => secrets.delete(key),
    },
    onAudit: async (event) => {
      events.push(event);
      await audit?.(event);
    },
    services: {
      https: {
        ownerId: id,
        operations: { read: "read", request: "model-egress" },
        getBinding: () => {
          if (bindingError) throw bindingError;
          return { fingerprint, sources: ["inbox"], host: "synthetic.test" };
        },
        invoke: async () => {
          invokes++;
          return null;
        },
      },
    },
  });
  cores.push(core);
  await core.importPackage(
    await createArchive({
      "manifest.json": Buffer.from(
        JSON.stringify({
          formatVersion: "2.0",
          id,
          kind: "extension",
          name: "Synthetic",
          version: "1.0.0",
          description: "",
          dependencies: [],
          permissions: [
            {
              id: permissionId,
              kind: "service",
              target: "https",
              operations: ["read", "request"],
              reason: "Synthetic",
            },
            {
              id: "local",
              kind: "engine",
              target: "local",
              reason: "Synthetic",
            },
          ],
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
          payload: {},
        }),
      ),
    }),
  );
  await core.grantConsent(id);
  await core.enable(id);
  // These grants authorize only the fake service; no runtime or external I/O starts.
  await core.grantBackgroundConsent({
    extensionId: id,
    permissionId,
    operation: "request",
    binding: "account",
    sources: ["inbox"],
  });
  await core.grantEngineTrust(await core.engineTrustSnapshot(id, "local"));
  await secrets.set(ref, value);
  await core.setSettings(id, { token: ref });
  events.length = 0;
  const background = {
    extensionId: id,
    permissionId,
    operation: "read",
    binding: "account",
    sources: ["inbox"],
  };
  const finite = {
    ownerId: id,
    engineId: "local",
    scope: {
      reads: ["conversation"],
      outputs: ["reply"],
      services: [
        {
          packageId: id,
          permissionId,
          operation: "request",
          binding: "account",
        },
      ],
    },
  };
  let grant: Grant | undefined;
  const create = async () => {
    if (surface === "background") await core.grantBackgroundConsent(background);
    else
      grant = await core.createGrant({
        ...(await core.grantPlan(finite)),
        durationMs: 900_000,
      });
  };
  const revoke = () =>
    surface === "background"
      ? core.revokeBackgroundConsent(id, "account")
      : core.revokeGrant(grant!.id);
  const active = async () =>
    surface === "background"
      ? core.hasBackgroundConsent(background)
      : !!grant &&
        !!(await core.checkGrant(grant.id, id, {
          reads: ["conversation"],
          outputs: ["reply"],
        }));
  const stored = async () =>
    surface === "background"
      ? (await core.listBackgroundConsents(id)).filter(
          (item) => item.operation === "read",
        )
      : (await core.listGrants(id)).filter((item) => !item.revokedAt);
  return {
    id,
    permissionId,
    ref,
    secrets,
    core,
    events,
    create,
    revoke,
    active,
    stored,
    audit: (callback: typeof audit) => {
      audit = callback;
    },
    changeBinding: () => {
      fingerprint = "changed";
    },
    bindingError: (error: unknown) => {
      bindingError = error;
    },
    readFails: () => {
      readFails = true;
    },
    noIo: () => {
      expect(invokes).toBe(0);
      expect(egress.records).toEqual([]);
    },
  };
}

const collisions = [
  "a",
  "callId",
  "grantId",
  "timestamp",
  "kind",
  "engine",
  "service",
  "phase",
  "grant",
  "revoke",
  "outcome",
  "allowed",
  "executionState",
  "not_started",
  "completed",
  "extensionId",
  "permissionId",
];
it.each(
  surfaces.flatMap((surface) =>
    collisions.map((value) => ({ surface, value })),
  ),
)(
  "preserves generated $surface audit controls when the credential is $value",
  async ({ surface, value }) => {
    const f = await fixture(value, surface);
    await f.create();
    expect(await f.active()).toBe(true);
    const granted = f.events[0]!;
    if (surface === "finite") await f.secrets.set(f.ref, granted.grantId!);
    await f.revoke();
    expect(await f.active()).toBe(false);
    expect(f.events).toHaveLength(2);
    for (const [index, event] of f.events.entries()) {
      expect(event.callId).toMatch(/^[a-f0-9-]{36}$/);
      expect(Number.isFinite(Date.parse(event.timestamp))).toBe(true);
      expect(event.kind).toBe(surface === "finite" ? "engine" : "service");
      expect(event.phase).toBe(index ? "revoke" : "grant");
      expect(event.outcome).toBe(index ? "completed" : "allowed");
      expect(event.executionState).toBe(index ? "completed" : "not_started");
      expect(event.extensionId).toBe(
        redact(f.id, [
          index && surface === "finite" ? granted.grantId! : value,
        ]),
      );
      if (surface === "background")
        expect(event.permissionId).toBe(
          index ? "" : redact(f.permissionId, [value]),
        );
      else expect(event.grantId).toBe(granted.grantId);
      expect(Object.isFrozen(event)).toBe(true);
    }
    expect(f.events[1]!.callId).not.toBe(granted.callId);
    f.noIo();
  },
);

it.each(
  surfaces.flatMap((surface) =>
    ["grant", "revoke"].flatMap((phase) =>
      ["callId", "phase", "completed", "a"].map((value) => ({
        surface,
        phase,
        value,
      })),
    ),
  ),
)(
  "keeps this $surface $phase failure's correlation and committed state for $value",
  async ({ surface, phase, value }) => {
    const f = await fixture(value, surface);
    if (phase === "revoke") await f.create();
    f.audit(() => {
      throw new Error("synthetic-adapter-error " + value);
    });
    const error = await (phase === "grant" ? f.create() : f.revoke()).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(PlumsError);
    expect(error).toMatchObject({
      code: CAPABILITY_FAILED,
      details: {
        callId: f.events.at(-1)!.callId,
        phase: "audit_" + phase,
        executionState: phase === "grant" ? "not_started" : "completed",
      },
    });
    expect(JSON.stringify(error)).not.toContain("synthetic-adapter-error");
    expect(await f.active()).toBe(false);
    expect(await f.stored()).toEqual([]);
    f.noIo();
  },
);

it.each(
  surfaces.flatMap((surface) =>
    ["grant", "revoke"].map((phase) => ({ surface, phase })),
  ),
)(
  "closes $surface $phase when SecretStore cannot be read",
  async ({ surface, phase }) => {
    const f = await fixture("synthetic-secret", surface);
    if (phase === "revoke") await f.create();
    const count = f.events.length;
    f.readFails();
    const error = await (phase === "grant" ? f.create() : f.revoke()).catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ code: "SECRET_NOT_FOUND" });
    expect(JSON.stringify(error)).not.toContain("synthetic-read-failure");
    expect(JSON.stringify(error)).not.toContain("synthetic-secret");
    expect(f.events).toHaveLength(count);
    expect(await f.stored()).toEqual([]);
    f.noIo();
  },
);

it.each(surfaces)(
  "rechecks %s binding after an asynchronous audit",
  async (surface) => {
    const f = await fixture("phase", surface);
    f.audit(async () => {
      await Promise.resolve();
      f.changeBinding();
    });
    await expect(f.create()).rejects.toMatchObject({
      code: surface === "finite" ? "CONSENT_REQUIRED" : "PERMISSION_DENIED",
    });
    expect(await f.stored()).toEqual([]);
    f.noIo();
  },
);

it.each(surfaces)(
  "never trusts a forged same-code failure in %s",
  async (surface) => {
    const f = await fixture("phase", surface);
    f.bindingError(
      new PlumsError({
        code: CAPABILITY_FAILED,
        message: "phase",
        path: "/phase",
        details: JSON.parse(
          '{"callId":"phase","phase":"phase","executionState":"phase","nested":{"phase":"phase"},"__proto__":{"phase":"phase"}}',
        ),
      }),
    );
    const error = await f.create().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(PlumsError);
    expect(error).toMatchObject({ message: REDACTED, path: "/" + REDACTED });
    expect((error as PlumsError).details).toEqual(
      redact(
        JSON.parse(
          '{"callId":"phase","phase":"phase","executionState":"phase","nested":{"phase":"phase"},"__proto__":{"phase":"phase"}}',
        ),
        ["phase"],
      ),
    );
    expect(f.events).toEqual([]);
    expect(await f.stored()).toEqual([]);
    f.noIo();
  },
);

it.each(surfaces)(
  "does not trust a previous %s failure replayed by the adapter",
  async (surface) => {
    const f = await fixture("audit_grant", surface);
    f.audit(() => {
      throw new Error("synthetic");
    });
    const first = await f.create().catch((error: unknown) => error);
    expect(first).toMatchObject({
      code: CAPABILITY_FAILED,
      details: { phase: "audit_grant" },
    });
    f.audit(undefined);
    f.events.length = 0;
    f.bindingError(first);
    const replayed = await f.create().catch((error: unknown) => error);
    expect(replayed).toMatchObject({
      code: CAPABILITY_FAILED,
      details: { phase: REDACTED },
    });
    expect(f.events).toEqual([]);
    expect(await f.stored()).toEqual([]);
    f.noIo();
  },
);

it.each(surfaces)(
  "retains secrets already read during %s audit before adapter failure",
  async (surface) => {
    const f = await fixture("synthetic-removed-secret", surface);
    f.audit(async () => {
      await f.secrets.delete(f.ref);
      f.bindingError(
        new PlumsError({
          code: CAPABILITY_FAILED,
          message: "synthetic-removed-secret",
          details: { phase: "synthetic-removed-secret" },
        }),
      );
    });
    const error = await f.create().catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: CAPABILITY_FAILED,
      message: REDACTED,
      details: { phase: REDACTED },
    });
    expect(await f.stored()).toEqual([]);
    expect(f.events).toHaveLength(1);
    f.noIo();
  },
);

it.each(["grantId", "phase"])(
  "keeps finite save failure controls for %s without publishing a grant",
  async (value) => {
    const f = await fixture(value, "finite");
    vi.spyOn(InstallStore.prototype, "saveGrantIfCurrent").mockImplementation(
      () => {
        throw new Error("synthetic-save-error " + value);
      },
    );
    const error = await f.create().catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: CAPABILITY_FAILED,
      details: {
        grantId: f.events[0]!.grantId,
        phase: "grant_save",
        executionState: "not_started",
      },
    });
    expect(JSON.stringify(error)).not.toContain("synthetic-save-error");
    expect(await f.stored()).toEqual([]);
    f.noIo();
  },
);

it("keeps public redaction of all business keys and nested control-shaped data", () => {
  const value = JSON.parse(
    '{"callId":"callId","phase":"phase","kind":"engine","executionState":"completed","unknown":{"grantId":"grantId"},"__proto__":{"phase":"phase"}}',
  );
  const result = redact(value, [
    "callId",
    "phase",
    "engine",
    "completed",
    "grantId",
  ]);
  expect(result).toEqual(
    JSON.parse(
      '{"[REDACTED]":"[REDACTED]","kind":"[REDACTED]","executionState":"[REDACTED]","unknown":{"[REDACTED]":"[REDACTED]"},"__proto__":{"[REDACTED]":"[REDACTED]"}}',
    ),
  );
  expect(Object.hasOwn(result as object, "__proto__")).toBe(true);
});
