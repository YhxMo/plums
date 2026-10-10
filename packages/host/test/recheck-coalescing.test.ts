import { afterEach, expect, it, vi } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createCore, RecordingEgressSink, secretRef } from "@plums/core";
import { callbackFixture } from "./local-callback-fixture.js";
import { ComponentLibrary } from "../src/library.js";
import { EngineManager } from "../src/engine-manager.js";
import type { Session } from "../src/host.js";

const fixtures: Awaited<ReturnType<typeof callbackFixture>>[] = [];
async function fixture() {
  const f = await callbackFixture();
  fixtures.push(f);
  return f;
}
const session = (f: Awaited<ReturnType<typeof fixture>>) =>
  (f.host as unknown as { sessions: Map<string, Session> }).sessions.get(f.id)!;
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
const success = {
  kind: "result",
  executionState: "completed",
  outcome: { ok: true },
};
// Measured 101 library reads and 131 secret reads; ceil(count * 1.2).
const MAX_LIBRARY_READS = 122,
  MAX_SECRET_READS = 158;
it("a resource write+read chain calls ComponentLibrary.get and SecretStore.get at most N times", async () => {
  const f = await fixture(),
    s = session(f);
  const ref = secretRef(
    "store",
    "local-00000000-0000-4000-8000-000000000001/value",
  );
  const detail = await s.core.getPackage("store");
  expect(
    await s.core.reserveLocalCredentialReferences(
      "store",
      detail.installed.installedAt,
      [ref],
    ),
  ).toBe(true);
  await s.secrets.set(ref, "SYNTHETIC_RECHECK_COUNT_VALUE");
  const library = vi.spyOn(ComponentLibrary.prototype, "get"),
    secrets = vi.spyOn(s.secrets, "get");
  expect(await f.run({ op: "write", value: "synthetic" })).toMatchObject(
    success,
  );
  expect(await f.run({ op: "read" })).toMatchObject(success);
  console.log(
    "coalesced counts",
    library.mock.calls.length,
    secrets.mock.calls.length,
  );
  expect(library.mock.calls.length).toBeLessThanOrEqual(MAX_LIBRARY_READS);
  expect(secrets.mock.calls.length).toBeLessThanOrEqual(MAX_SECRET_READS);
  expect(secrets.mock.calls.length).toBeGreaterThan(0);
});
it("external core disable/enable between two rechecks of one request is observed and denies (not served from memo)", async () => {
  const f = await fixture(),
    other = createCore({
      dataDir: path.join(f.dir, "instances", f.id, "core"),
      instanceId: f.id,
      secrets: f.options.secretStore(f.id),
      egress: new RecordingEgressSink(),
    });
  let changed = false;
  try {
    f.setAudit(async (e) => {
      if (
        e.kind === "resource" &&
        e.phase === "allow" &&
        e.operation === "write"
      ) {
        await other.disable("caller");
        await other.enable("caller");
        changed = true;
      }
    });
    await f.run({ op: "write", value: "forbidden" }).catch(() => undefined);
    expect(changed).toBe(true);
    expect(await f.direct({ op: "read" })).toMatchObject({ exists: false });
    expect(
      f.audit.filter(
        (e) =>
          e.kind === "resource" &&
          e.phase === "result" &&
          e.operation === "write",
      ),
    ).toHaveLength(0);
  } finally {
    other.close();
  }
});
it("external revokeEngineTrust/local grant change between audit and Sink is observed", async () => {
  const f = await fixture(),
    other = createCore({
      dataDir: path.join(f.dir, "instances", f.id, "core"),
      instanceId: f.id,
      secrets: f.options.secretStore(f.id),
      egress: new RecordingEgressSink(),
    });
  let changed = false;
  try {
    f.setAudit(async (e) => {
      if (
        e.kind === "resource" &&
        e.phase === "allow" &&
        e.operation === "write"
      ) {
        await other.revokeEngineTrust("engine-demo", "local");
        changed = true;
      }
    });
    await f.run({ op: "write", value: "forbidden" }).catch(() => undefined);
    expect(changed).toBe(true);
    expect(await f.direct({ op: "read" })).toMatchObject({ exists: false });
  } finally {
    other.close();
  }
});
it("SecretStore enumeration failure still denies before any local request starts (fail closed)", async () => {
  const f = await fixture(),
    s = session(f);
  vi.spyOn(s.core, "listSecretReferences").mockRejectedValue(
    Error("synthetic-enumeration-error"),
  );
  await expect(
    f.run({ op: "write", value: "forbidden" }),
  ).rejects.toMatchObject({ code: "SECRET_NOT_FOUND" });
  expect(
    f.audit.filter((e) => e.kind === "engine" && e.phase === "allow"),
  ).toHaveLength(0);
  expect(JSON.stringify(f.audit)).not.toContain("synthetic-enumeration-error");
});
it("first and last recheck of a request bypass the memo", async () => {
  const f = await fixture(),
    s = session(f),
    matches = vi.spyOn(s.core, "matchesInstalledPackage");
  // Warm the entry so snapshot creation cannot satisfy these assertions.
  expect(await f.run({ op: "read" })).toMatchObject(success);
  matches.mockClear();
  let beforeAllow = 0,
    atResult = 0;
  f.setAudit(async (e) => {
    if (e.kind === "engine" && e.phase === "allow")
      beforeAllow = matches.mock.calls.length;
    if (e.kind === "engine" && e.phase === "result")
      atResult = matches.mock.calls.length;
  });
  expect(await f.run({ op: "read" })).toMatchObject(success);
  expect(beforeAllow).toBeGreaterThanOrEqual(4);
  expect(atResult).toBeGreaterThan(0);
  expect(matches.mock.calls.length - atResult).toBeGreaterThanOrEqual(4);
});

it("a library or installed-file change that bypasses Core between the allow audit and the Sink denies the request", async () => {
  const f = await fixture(),
    s = session(f);
  await f.run({ op: "read" });
  const pin = s.record.components!.find((p) => p.packageId === "store")!;
  const file = path.join(f.dir, "library", "objects", pin.digest + ".zip");
  const bytes = await readFile(file);
  const sink = vi.spyOn(EngineManager.prototype, "request");
  let changed = false;
  f.setAudit(async (e) => {
    if (e.kind === "engine" && e.phase === "allow") {
      changed = true;
      await writeFile(file, Buffer.from("synthetic-invalid-archive"));
    }
  });
  try {
    await expect(
      f.run({ op: "write", value: "forbidden" }),
    ).rejects.toMatchObject({
      code: "IMPORT_INVALID",
      details: { executionState: "not_started" },
    });
    expect(changed).toBe(true);
    expect(sink).not.toHaveBeenCalled();
  } finally {
    f.setAudit(async () => {});
    await writeFile(file, bytes);
  }
  expect(await f.direct({ op: "read" })).toMatchObject({ exists: false });
});
it("a SecretStore read failure at the post-allow recheck denies before the Sink", async () => {
  const f = await fixture(),
    s = session(f);
  const ref = secretRef(
    "store",
    "local-00000000-0000-4000-8000-000000000002/value",
  );
  const detail = await s.core.getPackage("store");
  await s.core.reserveLocalCredentialReferences(
    "store",
    detail.installed.installedAt,
    [ref],
  );
  await s.secrets.set(ref, "SYNTHETIC_POST_ALLOW_VALUE");
  await f.run({ op: "read" });
  const get = vi.spyOn(s.secrets, "get"),
    sink = vi.spyOn(EngineManager.prototype, "request");
  let changed = false;
  f.setAudit(async (e) => {
    if (e.kind === "engine" && e.phase === "allow") {
      changed = true;
      get.mockRejectedValueOnce(Error("synthetic-post-allow-read-error"));
    }
  });
  const error = await f
    .run({ op: "write", value: "forbidden" })
    .catch((e) => e);
  expect(changed).toBe(true);
  expect(error).toMatchObject({
    code: "SECRET_NOT_FOUND",
    details: { executionState: "not_started" },
  });
  expect(JSON.stringify(error)).not.toContain(
    "synthetic-post-allow-read-error",
  );
  expect(sink).not.toHaveBeenCalled();
  f.setAudit(async () => {});
  expect(await f.direct({ op: "read" })).toMatchObject({ exists: false });
});
