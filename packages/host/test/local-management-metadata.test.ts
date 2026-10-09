import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  REDACTED,
  redact,
  type AuditEvent,
  type SecretStore,
} from "@plums/core";
import { DesktopHost } from "../src/host.js";
import {
  MACHINE_AUTHORIZATION_COPY,
  type TierSelection,
} from "../src/local-authorization.js";

const hosts: DesktopHost[] = [],
  directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) await host.close();
  for (const dir of directories.splice(0)) {
    await rm(dir, { recursive: true, force: true });
    await assert.rejects(lstat(dir), { code: "ENOENT" });
  }
});
async function fixture(value: string, store?: SecretStore) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-local-management-metadata-"),
  );
  directories.push(directory);
  const secrets = store ?? new MemorySecretStore(),
    egress = new RecordingEgressSink();
  const confirm = { ask: vi.fn(async (_request: { message: string }) => true) },
    events: Readonly<AuditEvent>[] = [];
  let auditHook:
    | ((e: Readonly<AuditEvent>) => Promise<void> | void)
    | undefined;
  const options = {
    dataDir: directory,
    secretStore: () => secrets,
    egress,
    confirm,
    audit: async (_id: string, e: Readonly<AuditEvent>) => {
      events.push(e);
      await auditHook?.(e);
    },
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  const manifest = {
    formatVersion: "2.0",
    kind: "extension",
    id: "fixture.local-management",
    name: `Synthetic ${value}`,
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [
      {
        id: "local",
        kind: "engine",
        target: "local",
        reason: `Synthetic ${value}`,
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
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        engines: [
          {
            id: "local",
            title: "Synthetic",
            entry: "engine.mjs",
            runtime: "node",
            platforms: [process.platform + "-" + process.arch],
            protocol: "jsonrpc-jsonl-v1",
          },
        ],
      },
    },
  };
  const item = await host.importLibrary(
    (
      (await host.preview(
        await createArchive({
          "manifest.json": Buffer.from(JSON.stringify(manifest)),
          "main.js": Buffer.from("export function activate(){}"),
          "engine.mjs": Buffer.from(
            "// Declaration-only fixture; never started.\n",
          ),
        }),
      )) as { token: string }
    ).token,
  );
  const agent = await host.createAgent("Synthetic", [item.digest]);
  await host.setSettings(agent.instanceId, manifest.id, {}, { token: value });
  const selection: TierSelection = {
    ceiling: "machine",
    projects: [],
    readOnly: [],
    components: [manifest.id],
  };
  const approve = async () => {
    const plan = await host.tierPlan(agent.instanceId, selection);
    return host.confirmTier(agent.instanceId, plan.fingerprint, selection);
  };
  return {
    host,
    agent,
    manifest,
    selection,
    approve,
    confirm,
    events,
    egress,
    options,
    directory,
    secrets,
    setAudit: (hook: typeof auditHook) => {
      auditHook = hook;
    },
  };
}

it.each(["message", "action", "subject", "a"])(
  "keeps local summary confirmation fields and redacts declaration text for %s",
  async (value) => {
    const f = await fixture(value);
    expect(await f.approve()).toBe(true);
    expect(f.confirm.ask).toHaveBeenCalledTimes(1);
    const request = f.confirm.ask.mock.calls[0]![0];
    expect(Object.keys(request).sort()).toEqual([
      "action",
      "message",
      "presentation",
      "subject",
    ]);
    expect(request.message).toContain(`Synthetic ${REDACTED}`);
    expect(request.message).toContain(
      redact(MACHINE_AUTHORIZATION_COPY, [value]),
    );
    expect(f.egress.records).toEqual([]);
  },
);

it.each(["phase", "callId", "grant", "a"])(
  "keeps local grant/revoke audit schema and freezes scope for %s",
  async (value) => {
    const f = await fixture(value);
    await f.approve();
    await f.host.lowerTier(f.agent.instanceId, "sandbox");
    expect(
      f.events.map((e) => [e.phase, e.outcome, e.executionState, e.tier]),
    ).toEqual([
      ["grant", "allowed", "not_started", "machine"],
      ["revoke", "allowed", "not_started", "sandbox"],
    ]);
    expect(f.events.map((e) => e.reason)).toEqual([
      "LOCAL_AUTHORIZATION_CONFIRMED",
      "LOCAL_TIER_LOWERED",
    ]);
    for (const e of f.events) {
      expect(e.callId).toEqual(expect.any(String));
      expect(Number.isFinite(Date.parse(e.timestamp))).toBe(true);
      expect(e.agentId).toBe(f.agent.instanceId);
      expect(e.kind).toBe("engine");
      expect(e.localScope).toEqual({
        roots: [],
        readOnlyRoots: [],
        componentIds: [redact(f.manifest.id, [value])],
        hostCount: 0,
      });
      expect(Object.isFrozen(e)).toBe(true);
      expect(Object.isFrozen(e.localScope)).toBe(true);
      expect(Object.isFrozen(e.localScope?.componentIds)).toBe(true);
    }
    expect(f.events[0]!.callId).not.toBe(f.events[1]!.callId);
    expect(f.egress.records).toEqual([]);
  },
);

it.each(["a", "tier", "grants", "machine", "confirmation", "local"])(
  "returns usable local authorization status and plan current for %s",
  async (value) => {
    const f = await fixture(value);
    await f.approve();
    const status = await f.host.tierStatus(f.agent.instanceId);
    expect(status.tier).toMatchObject({
      instanceId: f.agent.instanceId,
      ceiling: "machine",
      projects: [],
      readOnly: [],
    });
    expect(status.grants).toHaveLength(1);
    expect(status.grants[0]).toMatchObject({
      instanceId: f.agent.instanceId,
      packageId: f.manifest.id,
      engineId: "local",
      tier: "machine",
      source: "confirmation",
      authorizationId: expect.any(String),
      installedAt: expect.any(String),
      grantedAt: expect.any(String),
      hosts: [],
      toolchains: [],
      configuration: [],
      credentials: [],
    });
    expect(status.grants[0]!.permission).toContain(REDACTED);
    const plan = await f.host.tierPlan(f.agent.instanceId, f.selection);
    expect(plan.current).toEqual(status);
    expect(plan.entries[0]!.engines[0]!.state).toBe("confirmed");
    expect(f.egress.records).toEqual([]);
  },
);

it("keeps confirmed identities across restart when a generated authorization id equals a credential", async () => {
  const f = await fixture("SYNTHETIC_INITIAL_VALUE");
  await f.approve();
  const before = await f.host.tierStatus(f.agent.instanceId);
  await f.host.setSettings(
    f.agent.instanceId,
    f.manifest.id,
    {},
    { token: before.grants[0]!.authorizationId! },
  );
  await f.host.close();
  await f.host.initialize();
  const after = await f.host.tierStatus(f.agent.instanceId);
  expect(after.grants[0]!.authorizationId).toBe(
    before.grants[0]!.authorizationId,
  );
  expect(after.grants[0]!.installedAt).toBe(before.grants[0]!.installedAt);
  expect(after.tier.ceiling).toBe("machine");
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});

it("redacts unknown authority metadata and generated configuration values at business paths", async () => {
  const f = await fixture("tier");
  await f.approve();
  const core = createCore({
    dataDir: path.join(f.directory, "instances", f.agent.instanceId, "core"),
    instanceId: f.agent.instanceId,
    secrets: f.secrets,
    egress: f.egress,
  });
  try {
    const state = await core.localAuthorizationState();
    const future = JSON.parse(
      '{"tier":"tier","authorizationId":"tier","__proto__":{"tier":"tier"}}',
    );
    expect(
      await core.commitLocalAuthorization({
        ...state,
        assembly: state.tier.components,
        grants: state.grants.map((g) => ({
          ...g,
          future,
          configuration: [
            { tool: "tier", field: "tier", value: "tier", future },
          ],
        })),
      }),
    ).toBe(true);
    const status = await f.host.tierStatus(f.agent.instanceId);
    const grant = status.grants[0]! as (typeof status.grants)[0] & {
      future: unknown;
    };
    expect(grant.future).toEqual({
      [REDACTED]: REDACTED,
      authorizationId: REDACTED,
      ["__proto__"]: { [REDACTED]: REDACTED },
    });
    expect(grant.configuration[0]).toEqual({
      tool: REDACTED,
      field: REDACTED,
      value: REDACTED,
      future: grant.future,
    });
    expect(grant.authorizationId).toBe(state.grants[0]!.authorizationId);
    expect(status.tier.ceiling).toBe("machine");
    expect(future.tier).toBe("tier");
  } finally {
    core.close();
  }
});

it("does not publish local authority when audit fails with a colliding field", async () => {
  const f = await fixture("phase");
  f.setAudit(() => {
    throw new Error("phase");
  });
  await expect(f.approve()).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      callId: expect.any(String),
      phase: "local_authorization_audit",
      executionState: "not_started",
    },
  });
  expect(f.events[0]?.phase).toBe("grant");
  const status = await f.host.tierStatus(f.agent.instanceId);
  expect(status.grants).toEqual([]);
  expect(status.tier.ceiling).toBe("sandbox");
  expect(f.egress.records).toEqual([]);
});

it("refuses nonboolean confirmation without local grants", async () => {
  const f = await fixture("message");
  f.confirm.ask.mockResolvedValue("true" as unknown as boolean);
  expect(await f.approve()).toBe(false);
  expect(f.confirm.ask.mock.calls[0]![0].message).toContain(REDACTED);
  expect((await f.host.tierStatus(f.agent.instanceId)).grants).toEqual([]);
  expect(f.events[0]).toMatchObject({
    phase: "grant",
    outcome: "denied",
    reason: "LOCAL_AUTHORIZATION_DENIED",
  });
});

it("hides credential read failures before status or summary presentation", async () => {
  const backing = new MemorySecretStore(),
    value = "SYNTHETIC_LOCAL_SECRET_READ_FAILURE";
  let fail = false;
  const f = await fixture(value, {
    get: async (ref) => {
      if (fail) throw new Error(value);
      return backing.get(ref);
    },
    set: (ref, v) => backing.set(ref, v),
    delete: (ref) => backing.delete(ref),
  });
  const plan = await f.host.tierPlan(f.agent.instanceId, f.selection);
  fail = true;
  for (const read of [
    () => f.host.tierStatus(f.agent.instanceId),
    () => f.host.confirmTier(f.agent.instanceId, plan.fingerprint, f.selection),
  ]) {
    const error = await read().catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "SECRET_NOT_FOUND" });
    expect(JSON.stringify(error)).not.toContain(value);
  }
  expect(f.confirm.ask).not.toHaveBeenCalled();
  expect(f.events).toEqual([]);
});
