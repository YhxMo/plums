import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createCore,
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  PlumsError,
  REDACTED,
  redact,
  secretRef,
  type AuditEvent,
  type Core,
  type CreateCoreOptions,
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
    path.join(os.tmpdir(), "plums-control-audit-"),
  );
  directories.push(directory);
  const root = path.join(directory, "workspace");
  await mkdir(root);
  await writeFile(path.join(root, "file.txt"), "Synthetic fixture");
  const events: Readonly<AuditEvent>[] = [],
    secrets = extra.secrets ?? new MemorySecretStore(),
    fs = new RecordingFsSink(),
    egress = new RecordingEgressSink();
  const core = createCore({
    dataDir: path.join(directory, "core"),
    roots: { workspace: root },
    fs,
    egress,
    secrets,
    confirm: { ask: async () => true },
    onAudit: (event) => {
      events.push(event);
    },
    ...extra,
  });
  cores.push(core);
  const id = "fixture.control-metadata";
  await core.importPackage(
    await createArchive({
      "manifest.json": Buffer.from(
        JSON.stringify({
          formatVersion: "2.0",
          kind: "extension",
          id,
          name: "Synthetic control",
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
  const ref = secretRef(id, "token");
  await secrets.set(ref, value);
  await core.setSettings(id, { token: ref });
  await core.grantConsent(id);
  await core.enable(id);
  const run = (operation: "read" | "write" = "read") =>
    core.runCapability({
      extensionId: id,
      permissionId: "files",
      request:
        operation === "read"
          ? { kind: "fs", operation, path: "file.txt" }
          : {
              kind: "fs",
              operation,
              path: "file.txt",
              data: new Uint8Array([1]),
            },
    });
  return { core, events, fs, egress, run, id, secrets };
}

it.each(["phase", "callId", "executionState", "completed", "result", "a"])(
  "preserves generated audit correlation and states when the credential is %s",
  async (value) => {
    const f = await fixture(value);
    const result = await f.run();
    expect(f.events).toHaveLength(2);
    expect(
      f.events.map((event) => [
        event.phase,
        event.outcome,
        event.executionState,
      ]),
    ).toEqual([
      ["allow", "allowed", "not_started"],
      ["result", "completed", "completed"],
    ]);
    expect(f.events.every((event) => event.callId === result.callId)).toBe(
      true,
    );
    expect(f.events.every(Object.isFrozen)).toBe(true);
    expect(
      f.events.every((event) => Number.isFinite(Date.parse(event.timestamp))),
    ).toBe(true);
    expect(f.fs.records).toHaveLength(1);
    expect(f.egress.records).toEqual([]);
    // Coincident names at business paths keep the ordinary redactor's protection.
    const business = {
      [value]: value,
      nested: { callId: value, phase: value },
    };
    const safe = redact(business, [value]);
    expect(JSON.stringify(safe).replaceAll(REDACTED, "")).not.toContain(value);
    expect(business[value]).toBe(value);
  },
);

it.each([
  "phase",
  "callId",
  "executionState",
  "completed",
  "audit_result",
  "a",
])(
  "retains trusted completed failure metadata after result audit fails for %s",
  async (value) => {
    const events: Readonly<AuditEvent>[] = [];
    const f = await fixture(value, {
      onAudit: (event) => {
        events.push(event);
        if (event.phase === "result") throw new Error(value);
      },
    });
    const error = await f.run().catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: "CAPABILITY_FAILED",
      details: {
        callId: events[0]!.callId,
        phase: "audit_result",
        executionState: "completed",
      },
    });
    expect(events).toHaveLength(2);
    expect(events[1]!.callId).toBe(events[0]!.callId);
    expect(f.fs.records).toHaveLength(1);
    expect(JSON.stringify(error)).not.toContain(`Error: ${value}`);
    expect((error as Error).stack).not.toContain(`Error: ${value}`);
  },
);

it("keeps a confirmation failure not_started with zero Sink calls", async () => {
  const f = await fixture("not_started", {
    confirm: { ask: async () => true },
    onAudit: (event) => {
      if (event.phase === "confirmation") throw new Error("not_started");
    },
  });
  await expect(f.run("write")).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      callId: expect.any(String),
      phase: "audit_confirmation",
      executionState: "not_started",
    },
  });
  expect(f.fs.records).toEqual([]);
});

it("keeps unknown Sink failure metadata and hides the underlying error", async () => {
  const f = await fixture("unknown", {
    fs: {
      read: async () => {
        throw new Error("unknown");
      },
      write: async () => {},
      list: async () => [],
    },
  });
  await expect(f.run()).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      callId: expect.any(String),
      phase: "sink",
      executionState: "unknown",
    },
  });
  expect(f.events.at(-1)).toMatchObject({
    phase: "result",
    outcome: "failed",
    executionState: "unknown",
  });
});

it("redacts caller/declaration strings without renaming the audit schema fields", async () => {
  const f = await fixture("files");
  await f.run();
  expect(f.events[0]).toMatchObject({
    permissionId: REDACTED,
    target: "workspace",
  });
  expect(Object.hasOwn(f.events[0]!, "permissionId")).toBe(true);
});

it("does not treat an adapter's lookalike CAPABILITY_FAILED details as trusted metadata", async () => {
  const f = await fixture("callId", {
    capabilityGate: async () => {
      throw new PlumsError({
        code: "CAPABILITY_FAILED",
        message: "Synthetic callId",
        details: {
          callId: "callId",
          phase: "callId",
          executionState: "callId",
          nested: { callId: "callId" },
        },
      });
    },
  });
  const error = await f.run().catch((error: unknown) => error);
  expect(error).toMatchObject({
    code: "CAPABILITY_FAILED",
    message: `Synthetic ${REDACTED}`,
  });
  expect(JSON.stringify((error as PlumsError).details)).not.toContain("callId");
  expect(f.fs.records).toEqual([]);
});

it("hides an early adapter failure when the first credential read itself fails", async () => {
  const value = "SYNTHETIC_EARLY_FAILURE",
    backing = new MemorySecretStore();
  let fail = false;
  const f = await fixture(value, {
    secrets: {
      get: async (ref) => {
        if (fail) throw new Error(value);
        return backing.get(ref);
      },
      set: (ref, value) => backing.set(ref, value),
      delete: (ref) => backing.delete(ref),
    },
    capabilityGate: async () => {
      throw new PlumsError({
        code: "CAPABILITY_FAILED",
        message: value,
        details: { callId: value },
      });
    },
  });
  // Store ownership remains with the injected SecretStore.
  await backing.set(secretRef(f.id, "token"), value);
  fail = true;
  const error = await f.run().catch((error: unknown) => error);
  expect(error).toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      callId: expect.any(String),
      phase: "redaction",
      executionState: "not_started",
    },
  });
  expect(String(error)).not.toContain(value);
  expect(JSON.stringify(error)).not.toContain(value);
  expect(f.fs.records).toEqual([]);
});

it("redacts a genuine previous-call failure when an adapter replays it", async () => {
  let previous: PlumsError | undefined;
  const f = await fixture("SYNTHETIC_INITIAL_VALUE", {
    capabilityGate: async () => {
      if (previous) throw previous;
      return undefined;
    },
    onAudit: (event) => {
      if (event.phase === "result") throw new Error("Synthetic");
    },
  });
  previous = (await f.run().catch((error: PlumsError) => error)) as PlumsError;
  const oldCallId = (previous.details as { callId: string }).callId;
  await f.secrets.set(secretRef(f.id, "token"), oldCallId);
  const replay = await f.run().catch((error: unknown) => error);
  expect(replay).toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { callId: REDACTED },
  });
  expect(JSON.stringify(replay)).not.toContain(oldCallId);
  expect(f.fs.records).toHaveLength(1);
});
