import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createCore,
  MemorySecretStore,
  RecordingFsSink,
  RecordingEgressSink,
  ScriptedConfirm,
  type Core,
  type AuditEvent,
} from "@plums/core";
import { manifestZip, validManifestV2 } from "./package-helpers.js";
const dirs: string[] = [],
  cores: Core[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cores.splice(0).forEach((c) => c.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
async function fixture(requireTaskScope = false) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "plums-task-"));
  dirs.push(dir);
  const root = path.join(dir, "root");
  mkdirSync(root);
  writeFileSync(path.join(root, "task.txt"), "fixture");
  const fs = new RecordingFsSink(),
    egress = new RecordingEgressSink(),
    confirm = new ScriptedConfirm([true, true, true]);
  const events: AuditEvent[] = [];
  let auditHook:
    | ((event: Readonly<AuditEvent>) => void | Promise<void>)
    | undefined;
  const core = createCore({
    dataDir: path.join(dir, "core"),
    ...(requireTaskScope
      ? { capabilityApproval: "task-or-confirm" as const }
      : {}),
    fs,
    egress,
    confirm,
    secrets: new MemorySecretStore(),
    roots: { workspace: root },
    onAudit: async (event) => {
      events.push(event);
      await auditHook?.(event);
    },
  });
  cores.push(core);
  const manifest = validManifestV2();
  await core.importPackage(await manifestZip(manifest));
  await core.grantConsent(manifest.id);
  await core.enable(manifest.id);
  const grant = async (duration = 60_000) =>
    core.grantTaskScope((await core.taskScopePlan()).fingerprint, duration);
  const write = () =>
    core.runCapability({
      extensionId: manifest.id,
      permissionId: "files",
      request: {
        kind: "fs",
        operation: "write",
        path: "new.txt",
        data: new Uint8Array([1]),
      },
    });
  const send = () =>
    core.runCapability({
      extensionId: manifest.id,
      permissionId: "send",
      request: {
        kind: "egress",
        url: "https://api.example.com/send",
        body: "private-body",
      },
    });
  return {
    core,
    manifest,
    fs,
    egress,
    confirm,
    events,
    root,
    grant,
    write,
    send,
    setAudit: (hook: typeof auditHook) => {
      auditHook = hook;
    },
  };
}
it("reuses finite file and HTTPS grants with per-call audit, no repeated confirmation or exec grant", async () => {
  const w = await fixture();
  const plan = await w.core.taskScopePlan();
  expect(
    plan.entries.flatMap((e) => e.permissions).some((p) => p.kind === "exec"),
  ).toBe(false);
  const task = await w.grant();
  await w.write();
  await w.write();
  await w.send();
  await w.send();
  for (const operation of ["read", "list"] as const) {
    for (let i = 0; i < 2; i++)
      await w.core.runCapability({
        extensionId: w.manifest.id,
        permissionId: "files",
        request: {
          kind: "fs",
          operation,
          path: operation === "list" ? "." : "task.txt",
        },
      });
  }
  expect(w.confirm.asked).toHaveLength(0);
  expect(w.fs.records).toHaveLength(6);
  expect(w.egress.records).toHaveLength(2);
  expect(w.events.filter((e) => e.phase === "allow")).toHaveLength(8);
  expect(
    w.events
      .filter((e) => e.phase === "allow")
      .every((e) => e.taskId === task.taskId),
  ).toBe(true);
  expect(JSON.stringify(w.events)).not.toContain(w.root);
  expect(JSON.stringify(w.events)).not.toContain("private-body");
});
it("refuses undeclared destinations, path escapes and read escalation even inside a task", async () => {
  const w = await fixture();
  await w.grant();
  await expect(
    w.core.runCapability({
      extensionId: w.manifest.id,
      permissionId: "send",
      request: { kind: "egress", url: "https://other.example.com/" },
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    w.core.runCapability({
      extensionId: w.manifest.id,
      permissionId: "files",
      request: {
        kind: "fs",
        operation: "write",
        path: "../escape",
        data: new Uint8Array(),
      },
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(w.fs.records).toHaveLength(0);
  expect(w.egress.records).toHaveLength(0);
});
it("isolates Agent instances and falls back to confirmation after revoke or expiry", async () => {
  const a = await fixture(),
    b = await fixture();
  await a.grant(1000);
  await b.write();
  expect(b.confirm.asked).toHaveLength(1);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
  await a.write();
  expect(a.confirm.asked).toHaveLength(1);
  vi.restoreAllMocks();
  await a.grant();
  a.core.revokeTaskScope();
  await a.send();
  expect(a.confirm.asked).toHaveLength(2);
});
it("rejects stale preview, invalid lifetimes and grants after disable/re-enable or upgrade", async () => {
  const w = await fixture(),
    plan = await w.core.taskScopePlan();
  for (const duration of [0, -1, Infinity, 3_600_001])
    await expect(
      w.core.grantTaskScope(plan.fingerprint, duration),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await w.grant();
  await w.core.disable(w.manifest.id);
  await w.core.enable(w.manifest.id);
  await expect(
    w.core.grantTaskScope(plan.fingerprint, 1000),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await w.grant();
  await w.core.updatePackage(
    await manifestZip({ ...w.manifest, version: "1.3.0" }),
  );
  await w.write();
  expect(w.confirm.asked).toHaveLength(1);
});
it("does not execute when revoked during allow audit, and does not publish grants on failed audit", async () => {
  const w = await fixture();
  await w.grant();
  w.setAudit((event) => {
    if (event.phase === "allow") w.core.revokeTaskScope();
  });
  await expect(w.write()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(w.fs.records).toHaveLength(0);
  w.setAudit(() => {
    throw Error("private audit error");
  });
  await expect(w.grant()).rejects.toThrow();
  expect(w.core.taskScopeState()).toBeUndefined();
});
it("keeps uncovered calls single-use and denial fail-closed", async () => {
  const w = await fixture();
  await w.grant();
  // A newly installed principal was never part of this task's approval.
  const next = { ...w.manifest, id: "new-extension" };
  await w.core.importPackage(await manifestZip(next));
  await w.core.grantConsent(next.id);
  await w.core.enable(next.id);
  await w.write();
  expect(w.confirm.asked).toHaveLength(1);
  w.confirm.ask = async () => false;
  await expect(w.send()).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
  expect(w.egress.records).toHaveLength(0);
});
it("requires every principal in a delegated call and preserves declared intersections", async () => {
  const w = await fixture();
  const caller = {
    ...w.manifest,
    id: "caller",
    permissions: w.manifest.permissions.filter((p) => p.kind === "egress"),
  };
  await w.core.importPackage(await manifestZip(caller));
  await w.core.grantConsent(caller.id);
  await w.core.enable(caller.id);
  await w.grant();
  await w.core.runDelegatedCapability({
    packageId: w.manifest.id,
    permissionId: "send",
    callers: [{ packageId: caller.id, permissionId: "send" }],
    request: { kind: "egress", url: "https://api.example.com/" },
  });
  expect(w.confirm.asked).toHaveLength(0);
  await expect(
    w.core.runDelegatedCapability({
      packageId: w.manifest.id,
      permissionId: "files",
      callers: [{ packageId: caller.id, permissionId: "files" }],
      request: {
        kind: "fs",
        operation: "write",
        path: "x",
        data: new Uint8Array(),
      },
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});
it("narrows file operations and services, confirms each uncovered call, and never promotes a single-use answer", async () => {
  const w = await fixture();
  await w.core.grantTaskScope(
    (await w.core.taskScopePlan()).fingerprint,
    60_000,
    [{ packageId: w.manifest.id, permissionId: "files", operation: "write" }],
  );
  await w.write();
  await w.send();
  await w.send();
  expect(w.confirm.asked).toHaveLength(2);
  w.confirm.ask = async () => false;
  await expect(
    w.core.runCapability({
      extensionId: w.manifest.id,
      permissionId: "files",
      request: { kind: "fs", operation: "list", path: "." },
    }),
  ).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
  await w.write();
  expect(w.fs.records.filter((r) => r.operation === "write")).toHaveLength(2);
  await expect(
    w.core.grantTaskScope((await w.core.taskScopePlan()).fingerprint, 60_000, [
      { packageId: w.manifest.id, permissionId: "test", operation: "send" },
    ]),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});
it("invalidates task after another connection disables then re-enables the same package", async () => {
  const w = await fixture();
  await w.grant();
  const other = createCore({
    dataDir: w.core.dataDir,
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  try {
    await other.disable(w.manifest.id);
    await other.enable(w.manifest.id);
  } finally {
    other.close();
  }
  expect(w.core.taskScopeState()).toBeUndefined();
  await w.write();
  expect(w.confirm.asked).toHaveLength(1);
});
it("cannot publish a scope if revoked while its approval audit is pending", async () => {
  const w = await fixture();
  w.setAudit((event) => {
    if (event.phase === "task" && event.outcome === "allowed")
      w.core.revokeTaskScope();
  });
  await expect(w.grant()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(w.core.taskScopeState()).toBeUndefined();
});

it("does not regain implicit read access when a narrowed task expires or is revoked", async () => {
  const w = await fixture();
  await w.core.grantTaskScope(
    (await w.core.taskScopePlan()).fingerprint,
    1,
    [],
  );
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10);
  w.confirm.ask = async () => false;
  const read = () =>
    w.core.runCapability({
      extensionId: w.manifest.id,
      permissionId: "files",
      request: { kind: "fs", operation: "list", path: "." },
    });
  await expect(read()).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
  vi.restoreAllMocks();
  w.core.revokeTaskScope();
  await expect(read()).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
  expect(w.fs.records).toHaveLength(0);
});

it("invalidates an approved directory when its pathname is replaced", async () => {
  const w = await fixture();
  await w.grant();
  renameSync(w.root, w.root + "-old");
  mkdirSync(w.root);
  await w.write();
  expect(w.confirm.asked).toHaveLength(1);
});

it.each([false, true])(
  "preserves standalone legacy reads unless task policy is explicitly %s",
  async (requireTaskScope) => {
    const w = await fixture(requireTaskScope);
    for (const operation of ["read", "list"] as const) {
      await w.core.runCapability({
        extensionId: w.manifest.id,
        permissionId: "files",
        request: {
          kind: "fs",
          operation,
          path: operation === "list" ? "." : "task.txt",
        },
      });
    }
    expect(w.confirm.asked).toHaveLength(requireTaskScope ? 2 : 0);
    expect(w.fs.records).toHaveLength(2);
  },
);

it.each(["read", "list"] as const)(
  "does not promote a single-use %s approval into a task grant",
  async (operation) => {
    const w = await fixture(true);
    await w.core.grantTaskScope(
      (await w.core.taskScopePlan()).fingerprint,
      60_000,
      [{ packageId: w.manifest.id, permissionId: "files", operation: "write" }],
    );
    const request = {
      kind: "fs" as const,
      operation,
      path: operation === "list" ? "." : "task.txt",
    };
    await w.core.runCapability({
      extensionId: w.manifest.id,
      permissionId: "files",
      request,
    });
    w.confirm.ask = async () => false;
    await expect(
      w.core.runCapability({
        extensionId: w.manifest.id,
        permissionId: "files",
        request,
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
    expect(w.fs.records).toHaveLength(1);
    await w.write();
    expect(w.fs.records).toHaveLength(2);
  },
);
it.each([
  ["read", "revoke"],
  ["list", "revoke"],
  ["read", "expire"],
  ["list", "expire"],
] as const)(
  "rejects scoped %s when %s occurs during its allow audit",
  async (operation, change) => {
    const w = await fixture(true);
    await w.grant();
    w.setAudit((event) => {
      if (event.phase !== "allow") return;
      if (change === "revoke") w.core.revokeTaskScope();
      else vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
    });
    await expect(
      w.core.runCapability({
        extensionId: w.manifest.id,
        permissionId: "files",
        request: {
          kind: "fs",
          operation,
          path: operation === "list" ? "." : "task.txt",
        },
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(w.fs.records).toHaveLength(0);
    expect(w.confirm.asked).toHaveLength(0);
  },
);

it("rejects unsupported host approval policies instead of silently restoring legacy access", () => {
  expect(() =>
    createCore({
      dataDir: "/unused",
      egress: new RecordingEgressSink(),
      secrets: new MemorySecretStore(),
      capabilityApproval: "unknown" as never,
    }),
  ).toThrow("createCore capabilityApproval must be legacy or task-or-confirm");
});
