import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingExecSink,
  RecordingFsSink,
  type Core,
  type CreateCoreOptions,
  type AuditEvent,
  type CapabilityRequest,
  type LocalCoverage,
} from "../src/index.js";
import { manifestZip, validManifestV2 } from "./package-helpers.js";

const cores: Core[] = [],
  dirs: string[] = [];
afterEach(() => {
  cores.splice(0).forEach((c) => c.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
async function fixture(extra: Partial<CreateCoreOptions> = {}) {
  const dir = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "plums-local-coverage-")),
  );
  dirs.push(dir);
  const root = path.join(dir, "project");
  mkdirSync(root);
  const fs = new RecordingFsSink(),
    exec = new RecordingExecSink(),
    confirm = { ask: vi.fn(async () => true) },
    events: Readonly<AuditEvent>[] = [];
  const core = createCore({
    dataDir: path.join(dir, "core"),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
    roots: { workspace: root },
    programs: { test: "/fixture/bin/test" },
    fs,
    exec,
    confirm,
    capabilityApproval: "task-or-confirm",
    onAudit: (e) => {
      events.push(e);
    },
    ...extra,
  });
  cores.push(core);
  const manifest = validManifestV2();
  await core.importPackage(await manifestZip(manifest));
  await core.grantConsent(manifest.id);
  await core.enable(manifest.id);
  const call = (
    request: CapabilityRequest,
    permissionId = request.kind === "fs"
      ? "files"
      : request.kind === "exec"
        ? "test"
        : "send",
  ) => core.runCapability({ extensionId: manifest.id, permissionId, request });
  return { core, manifest, call, root, fs, exec, confirm, events };
}
const write: CapabilityRequest = {
  kind: "fs",
  operation: "write",
  path: "file",
  data: new Uint8Array([1]),
};
const command: CapabilityRequest = {
  kind: "exec",
  cwd: { root: "workspace", path: "." },
  args: ["fixture"],
};
it.each([write, command])(
  "covered $kind preserves allow/result audit without asking",
  async (request) => {
    const check = vi.fn(() => ({
      tier: "project" as const,
      authorizationId: "confirmed-scope",
    }));
    const f = await fixture({ localCoverage: check });
    await f.call(request);
    expect(f.confirm.ask).not.toHaveBeenCalled();
    expect(f.events.map((e) => e.phase)).toEqual(["allow", "result"]);
    for (const e of f.events)
      expect(e).toMatchObject({
        tier: "project",
        localAuthorizationId: "confirmed-scope",
      });
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        rootPath: f.root,
        principals: [
          {
            packageId: f.manifest.id,
            permissionId: request.kind === "fs" ? "files" : "test",
          },
        ],
      }),
    );
    expect(JSON.stringify(f.events)).not.toContain(f.root);
  },
);
it("an uncovered request retains single-use confirmation", async () => {
  const f = await fixture({ localCoverage: () => undefined });
  await f.call(write);
  expect(f.confirm.ask).toHaveBeenCalledOnce();
  expect(f.fs.records).toHaveLength(1);
});
it("coverage cannot grant an undeclared operation", async () => {
  const check = vi.fn(() => ({ tier: "project" as const })),
    f = await fixture({ localCoverage: check });
  const next = {
    ...f.manifest,
    version: "1.2.4",
    permissions: [
      {
        id: "files",
        kind: "fs" as const,
        target: "workspace",
        operations: ["read" as const],
        reason: "Read only",
      },
    ],
  };
  await f.core.updatePackage(await manifestZip(next));
  await f.core.grantConsent(next.id);
  await expect(f.call(write)).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  expect(check).not.toHaveBeenCalled();
  expect(f.fs.records).toHaveLength(0);
});
it.each(["revoked", "reconfirmed", "lowered"])(
  "a scope %s during allow audit prevents the sink",
  async (change) => {
    let coverage: LocalCoverage | undefined = {
      tier: "machine",
      authorizationId: "first",
    };
    const f = await fixture({
      localCoverage: () => coverage,
      onAudit: async (e) => {
        if (e.phase === "allow")
          coverage =
            change === "revoked"
              ? undefined
              : {
                  tier: change === "lowered" ? "project" : "machine",
                  authorizationId: "second",
                };
      },
    });
    await expect(f.call(write)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      details: { reason: "LOCAL_COVERAGE_CHANGED" },
    });
    expect(f.fs.records).toHaveLength(0);
    expect(f.confirm.ask).not.toHaveBeenCalled();
  },
);
it("does not trust a mutable coverage result retained by the host", async () => {
  const value: LocalCoverage = { tier: "project", authorizationId: "first" };
  let calls = 0;
  const f = await fixture({
    localCoverage: () => {
      if (++calls === 2) value.authorizationId = "changed";
      return value;
    },
  });
  await expect(f.call(write)).rejects.toMatchObject({
    details: { reason: "LOCAL_COVERAGE_CHANGED" },
  });
  expect(f.fs.records).toHaveLength(0);
});
it("HTTPS/service requests still ask and never invoke local coverage", async () => {
  const check = vi.fn(() => ({ tier: "machine" as const }));
  const f = await fixture({
    localCoverage: check,
    services: {
      https: {
        operations: { request: "egress" },
        getBinding: () => ({
          fingerprint: "fixture",
          sources: [],
          host: "api.example.com",
        }),
        invoke: async () => null,
      },
    },
  });
  const manifest = {
    ...f.manifest,
    version: "1.2.4",
    permissions: [
      ...f.manifest.permissions,
      {
        id: "https",
        kind: "service" as const,
        target: "https",
        operations: ["request"],
        reason: "fixture",
      },
    ],
  };
  await f.core.updatePackage(await manifestZip(manifest), { consent: true });
  await f.core.grantConsent(manifest.id);
  await f.core.grantBackgroundConsent({
    extensionId: manifest.id,
    permissionId: "https",
    operation: "request",
    binding: "fixture",
    sources: [],
  });
  await f.call(
    {
      kind: "service",
      operation: "request",
      binding: "fixture",
      sources: [],
      input: {},
    },
    "https",
  );
  expect(check).not.toHaveBeenCalled();
  expect(f.confirm.ask).toHaveBeenCalledOnce();
});
it("policy deny still wins over confirmed coverage", async () => {
  const gate = vi.fn(async () => {
    throw Error("deny");
  });
  const f = await fixture({
    localCoverage: () => ({ tier: "project" }),
    capabilityGate: gate,
  });
  await expect(f.call(write)).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
  });
  expect(gate).toHaveBeenCalledWith(
    expect.objectContaining({ requiresConfirmation: false }),
  );
  expect(f.fs.records).toHaveLength(0);
});
it("delegated calls expose every principal to the coverage check", async () => {
  const check = vi.fn((input) =>
    input.principals.length === 1 ? { tier: "project" as const } : undefined,
  );
  const f = await fixture({ localCoverage: check });
  const caller = { ...f.manifest, id: "caller" };
  await f.core.importPackage(await manifestZip(caller));
  await f.core.grantConsent(caller.id);
  await f.core.enable(caller.id);
  await f.core.runDelegatedCapability({
    packageId: f.manifest.id,
    permissionId: "files",
    request: write,
    callers: [{ packageId: caller.id, permissionId: "files" }],
  });
  expect(f.confirm.ask).toHaveBeenCalledOnce();
});
