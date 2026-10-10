import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  REDACTED,
  redact,
  secretRef,
  type AuditEvent,
  type Core,
  type CreateCoreOptions,
  type ConfirmRequest,
} from "@plumsjs/core";

const cores: Core[] = [],
  directories: string[] = [];
afterEach(async () => {
  cores.splice(0).forEach((core) => core.close());
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(lstat(directory), { code: "ENOENT" });
  }
});

async function fixture(value: string, extra: Partial<CreateCoreOptions> = {}) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-authorization-control-"),
  );
  directories.push(directory);
  const root = path.join(directory, "workspace");
  await mkdir(root);
  await writeFile(path.join(root, "file.txt"), "Synthetic");
  const events: Readonly<AuditEvent>[] = [],
    requests: ConfirmRequest[] = [];
  const secrets = extra.secrets ?? new MemorySecretStore(),
    fs = new RecordingFsSink(),
    egress = new RecordingEgressSink();
  const core = createCore({
    dataDir: path.join(directory, "core"),
    roots: { workspace: root },
    secrets,
    fs,
    egress,
    confirm: {
      ask: async (request) => {
        requests.push(request);
        return true;
      },
    },
    onAudit: (event) => {
      events.push(event);
    },
    ...extra,
  });
  cores.push(core);
  const id = "fixture.authorization-control";
  const manifest = {
    formatVersion: "2.0",
    kind: "extension",
    id,
    name: `Synthetic ${value}`,
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [
      {
        id: "files",
        kind: "fs",
        target: "workspace",
        operations: ["read", "write"],
        reason: `Synthetic ${value}`,
      },
      {
        id: "send",
        kind: "egress",
        target: "synthetic.test",
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
    payload: {},
  };
  await core.importPackage(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
    }),
  );
  await secrets.set(secretRef(id, "token"), value);
  await core.setSettings(id, { token: secretRef(id, "token") });
  await core.grantConsent(id);
  await core.enable(id);
  const write = () =>
    core.runCapability({
      extensionId: id,
      permissionId: "files",
      request: {
        kind: "fs",
        operation: "write",
        path: "file.txt",
        data: new Uint8Array([1]),
      },
    });
  const send = () =>
    core.runCapability({
      extensionId: id,
      permissionId: "send",
      request: {
        kind: "egress",
        url: "https://synthetic.test/",
        body: "Synthetic",
      },
    });
  return {
    core,
    id,
    events,
    requests,
    fs,
    egress,
    secrets,
    write,
    send,
    manifest,
  };
}

it.each([
  "message",
  "subject",
  "action",
  "host",
  "reason",
  "a",
  "synthetic.test",
])(
  "keeps the confirmation schema usable and redacts its text for credential %s",
  async (value) => {
    const f = await fixture(value);
    await f.send();
    expect(f.requests).toHaveLength(1);
    const request = f.requests[0]!;
    expect(Object.keys(request).sort()).toEqual([
      "action",
      "host",
      "message",
      "reason",
      "subject",
    ]);
    expect(request.subject).toBe(redact(f.manifest.name, [value]));
    expect(request.reason).toBe(`Synthetic ${REDACTED}`);
    expect(request.message).toContain(REDACTED);
    expect(request.host).toBe(redact("synthetic.test", [value]));
    expect(f.egress.records).toHaveLength(1);
    expect(f.fs.records).toEqual([]);
    expect(f.events.map((e) => e.phase)).toEqual([
      "confirmation",
      "confirmation",
      "allow",
      "result",
    ]);
  },
);

it.each([false, "true"])(
  "does not turn a colliding confirmation field into approval for %s",
  async (answer) => {
    let request: ConfirmRequest | undefined;
    const f = await fixture("message", {
      confirm: {
        ask: async (r) => {
          request = r;
          return answer as boolean;
        },
      },
    });
    await expect(f.write()).rejects.toMatchObject({
      code: "CONFIRMATION_DENIED",
    });
    expect(request?.message).toContain(REDACTED);
    expect(f.fs.records).toEqual([]);
    expect(f.egress.records).toEqual([]);
  },
);

it.each([
  "phase",
  "taskScope",
  "operation",
  "allowed",
  "write",
  "a",
  "files",
  "fixture.authorization-control",
])(
  "keeps task grant audit controls and selected operation fields for credential %s",
  async (value) => {
    const f = await fixture(value),
      plan = await f.core.taskScopePlan();
    const task = await f.core.grantTaskScope(plan.fingerprint, 60_000, [
      { packageId: f.id, permissionId: "files", operation: "write" },
    ]);
    expect(f.events.map((e) => [e.phase, e.outcome, e.executionState])).toEqual(
      [
        ["task", "requested", "not_started"],
        ["task", "allowed", "not_started"],
      ],
    );
    for (const event of f.events) {
      expect(event.callId).toBe(task.taskId);
      expect(event.taskId).toBe(task.taskId);
      expect(event.durationMs).toBe(60_000);
      expect(Number.isFinite(Date.parse(event.timestamp))).toBe(true);
      expect(event.taskScope).toEqual([
        {
          packageId: redact(f.id, [value]),
          permissionId: redact("files", [value]),
          operation: "write",
        },
      ]);
      expect(Object.isFrozen(event)).toBe(true);
      expect(Object.isFrozen(event.taskScope)).toBe(true);
      expect(Object.isFrozen(event.taskScope?.[0])).toBe(true);
    }
    await f.write();
    expect(f.requests).toEqual([]);
    expect(f.fs.records).toHaveLength(1);
    expect(f.events.at(-1)?.taskId).toBe(task.taskId);
  },
);

it.each(["phase", "callId", "not_started"])(
  "keeps this task failure's generated metadata and publishes no scope for %s",
  async (value) => {
    const captured: Readonly<AuditEvent>[] = [];
    const f = await fixture(value, {
      onAudit: (e) => {
        captured.push(e);
        throw new Error(value);
      },
    });
    const plan = await f.core.taskScopePlan();
    const error = await f.core
      .grantTaskScope(plan.fingerprint, 60_000)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: "CAPABILITY_FAILED",
      details: {
        callId: captured[0]?.callId,
        phase: "audit_task",
        executionState: "not_started",
      },
    });
    expect(captured).toHaveLength(1);
    expect(f.core.taskScopeState()).toBeUndefined();
    expect(f.fs.records).toEqual([]);
    expect(f.egress.records).toEqual([]);
  },
);

it("redacts unknown task selection fields and nested control names without changing the input", async () => {
  const f = await fixture("operation"),
    plan = await f.core.taskScopePlan();
  const future = JSON.parse(
    '{"operation":"operation","__proto__":{"operation":"operation"}}',
  );
  const chosen = [
    {
      packageId: f.id,
      permissionId: "files",
      operation: "write" as const,
      future,
    },
  ];
  await f.core.grantTaskScope(plan.fingerprint, 60_000, chosen);
  expect(f.events[0]?.taskScope?.[0]).toEqual({
    packageId: f.id,
    permissionId: "files",
    operation: "write",
    future: { [REDACTED]: REDACTED, ["__proto__"]: { [REDACTED]: REDACTED } },
  });
  expect(chosen[0]?.future.operation).toBe("operation");
  expect(
    Object.getPrototypeOf(
      (f.events[0]?.taskScope?.[0] as unknown as { future: object }).future,
    ),
  ).toBe(Object.prototype);
  await f.write();
  expect(f.requests).toEqual([]);
  expect(f.fs.records).toHaveLength(1);
});

it("fails closed if a credential cannot be read before task grant audit", async () => {
  const backing = new MemorySecretStore();
  let fail = false;
  const value = "SYNTHETIC_TASK_SECRET_READ_FAILURE";
  const f = await fixture(value, {
    secrets: {
      get: async (ref) => {
        if (fail) throw new Error(value);
        return backing.get(ref);
      },
      set: (ref, v) => backing.set(ref, v),
      delete: (ref) => backing.delete(ref),
    },
  });
  const plan = await f.core.taskScopePlan();
  fail = true;
  const error = await f.core
    .grantTaskScope(plan.fingerprint, 60_000)
    .catch((error: unknown) => error);
  expect(String(error)).not.toContain(value);
  expect(JSON.stringify(error)).not.toContain(value);
  expect(f.events).toEqual([]);
  expect(f.core.taskScopeState()).toBeUndefined();
});

it("retains credentials already read when the store rotates during task audit", async () => {
  const value = "fixture.authorization-control",
    backing = new MemorySecretStore(),
    captured: Readonly<AuditEvent>[] = [];
  const f = await fixture(value, {
    secrets: backing,
    onAudit: async (e) => {
      captured.push(e);
      if (e.outcome === "requested")
        await backing.set(secretRef(value, "token"), "SYNTHETIC_ROTATED_VALUE");
    },
  });
  await f.core.grantTaskScope(
    (await f.core.taskScopePlan()).fingerprint,
    60_000,
    [{ packageId: f.id, permissionId: "files", operation: "write" }],
  );
  expect(captured).toHaveLength(2);
  expect(captured.map((e) => e.taskScope?.[0]?.packageId)).toEqual([
    REDACTED,
    REDACTED,
  ]);
  expect(f.core.taskScopeState()?.taskId).toBe(captured[1]!.taskId);
});
