import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createCore, FakeModelProvider, isManifestV1, isManifestV2, MemorySecretStore,
  PACKAGE_FORMAT_VERSION, RecordingEgressSink, ScriptedConfirm, secretRef,
  type Core, type CreateCoreOptions, type ManifestV2, type PermissionV2,
} from "@plums/core";
import { afterEach, describe, expect, it } from "vitest";
import { expectPlumsError, listAll, makeCore, manifestZip, validManifest, validManifestV2 } from "./package-helpers.js";

const opened: Core[] = [];
const directories = new Set<string>();
afterEach(() => {
  for (const core of opened.splice(0)) core.close();
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
  directories.clear();
});
function world(extra: Partial<CreateCoreOptions> = {}) {
  const result = makeCore(extra);
  opened.push(result.core);
  directories.add(result.dataDir);
  return result;
}
function restart(dataDir: string, secrets = new MemorySecretStore()) {
  const core = createCore({ dataDir, secrets, model: new FakeModelProvider(), egress: new RecordingEgressSink(), confirm: new ScriptedConfirm() });
  opened.push(core);
  return core;
}

const FS: PermissionV2 = { id: "files", kind: "fs", target: "workspace", reason: "Project files", operations: ["write"] };
const EXEC: PermissionV2 = { id: "test", kind: "exec", target: "test", reason: "Test project", cwdRoots: ["workspace"] };
const SEND: PermissionV2 = { id: "send", kind: "egress", target: "api.example.com", reason: "Send summary" };

describe("format 2.x envelope and complete permissions", () => {
  it.each(["character", "extension", "connector"] as const)("round-trips a %s without rewriting its version or unknown fields", async (kind) => {
    const { core, dataDir } = world();
    const manifest: ManifestV2 = {
      ...validManifestV2(kind), formatVersion: "2.7", future: { keep: [true, null] }, signature: { opaque: true },
      permissions: [
        { ...FS, future: { level: "egress" }, level: "egress" },
        { ...EXEC, future: [1, 2] }, SEND,
      ],
      payload: { permissions: [{ kind: "exec", target: "arbitrary" }], content: "opaque" },
    };
    const bytes = await core.exportPackage({ manifest, files: { "blob.bin": new Uint8Array([0, 255]) } });
    const inspection = await core.inspect(bytes);
    expect(inspection).toMatchObject({ formatVersion: "2.7", permissions: manifest.permissions });
    expect(listAll(dataDir)).toEqual([]);
    const imported = await core.importPackage(bytes);
    expect(imported.manifest).toEqual(manifest);
    expect(isManifestV2(imported.manifest)).toBe(true);
    expect(isManifestV1(imported.manifest)).toBe(false);
    const consent = await core.grantConsent(manifest.id);
    expect(consent).toMatchObject({ formatVersion: "2.7", permissions: manifest.permissions });
    // Mutating caller-owned results must not change the saved consent.
    consent.permissions[0]!.target = "mutated";
    expect((await core.getConsent(manifest.id))?.permissions).toEqual(manifest.permissions);
    await core.enable(manifest.id);
    expect((await core.validatePackage(await core.exportPackage({ manifest, files: imported.files }))).manifest).toEqual(manifest);
    core.close();
    expect(await restart(dataDir).getConsent(manifest.id)).toMatchObject({ formatVersion: "2.7", permissions: manifest.permissions });
  });

  it("keeps 1.x permission interpretation even when unknown fields look like a 2.x capability", async () => {
    const egress = new RecordingEgressSink();
    const confirm = new ScriptedConfirm();
    const { core } = world({ egress, confirm });
    const manifest = { ...validManifest("extension"), dependencies: [], permissions: [{ id: "read", level: "read" as const, kind: "exec", cwdRoots: ["workspace"], target: "notes", reason: "Read" }] };
    const imported = await core.importPackage(await manifestZip(manifest));
    expect(isManifestV1(imported.manifest)).toBe(true);
    await core.grantConsent(manifest.id);
    await core.enable(manifest.id);
    await expect(core.runAction({ extensionId: manifest.id, permissionId: "read" })).resolves.toEqual({ level: "read" });
    expect(egress.records).toEqual([]);
    expect(confirm.asked).toEqual([]);
  });

  const invalid: [string, unknown, string][] = [
    ["no kind", { id: "p", level: "write", target: "workspace", reason: "Files" }, "/kind"],
    ["unknown kind", { ...FS, kind: "mcp" }, "/kind"],
    ["missing id", { kind: "fs", target: "workspace", reason: "Files", operations: ["read"] }, "/id"],
    ["empty target", { ...FS, target: "" }, "/target"],
    ["empty reason", { ...FS, reason: "" }, "/reason"],
    ["missing operations", { id: "p", kind: "fs", target: "workspace", reason: "Files" }, "/operations"],
    ["empty operations", { ...FS, operations: [] }, "/operations"],
    ["operations not array", { ...FS, operations: "read" }, "/operations"],
    ["unknown operation", { ...FS, operations: ["mkdir"] }, "/operations/0"],
    ["duplicate operations", { ...FS, operations: ["read", "read"] }, "/operations"],
    ["missing cwdRoots", { id: "p", kind: "exec", target: "test", reason: "Tests" }, "/cwdRoots"],
    ["empty cwdRoots", { ...EXEC, cwdRoots: [] }, "/cwdRoots"],
    ["cwdRoots not array", { ...EXEC, cwdRoots: "workspace" }, "/cwdRoots"],
    ["empty cwd root", { ...EXEC, cwdRoots: [""] }, "/cwdRoots/0"],
    ["duplicate cwd roots", { ...EXEC, cwdRoots: ["workspace", "workspace"] }, "/cwdRoots"],
    ...["https://api.example.com", "api.example.com/path", "localhost", "127.0.0.1", "*.com", "api.example.com."].map((target): [string, unknown, string] => [`egress ${target}`, { ...SEND, target }, "/target"]),
  ];
  it.each(invalid)("rejects %s before writing package files", async (_name, permission, pointer) => {
    const { core, dataDir } = world();
    await expectPlumsError(core.importPackage(await manifestZip({ ...validManifestV2(), permissions: [permission] })), "MANIFEST_INVALID", `/permissions/0${pointer}`);
    expect(listAll(dataDir)).toEqual([]);
  });
  it("rejects duplicate permission ids across kinds", async () => {
    const { core, dataDir } = world();
    const err = await expectPlumsError(core.importPackage(await manifestZip({ ...validManifestV2(), permissions: [FS, { ...EXEC, id: FS.id }] })), "MANIFEST_INVALID", "/permissions/1/id");
    expect(err.details).toEqual({ reason: "DUPLICATE_PERMISSION_ID" });
    expect(listAll(dataDir)).toEqual([]);
  });
  it("uses 2.0 as the default while continuing to reject major 3", async () => {
    const { core } = world();
    expect(validManifestV2().formatVersion).toBe(PACKAGE_FORMAT_VERSION);
    await expectPlumsError(core.inspect(await manifestZip({ formatVersion: "3.0" })), "FORMAT_UNSUPPORTED", "/formatVersion");
  });
});

describe("legacy action and MCP entry points reject format 2.x", () => {
  it("does not run, confirm or send using a 2.x permission's unknown level", async () => {
    const egress = new RecordingEgressSink();
    const confirm = new ScriptedConfirm([true]);
    const { core } = world({ egress, confirm });
    const manifest = { ...validManifestV2(), permissions: [{ ...SEND, level: "egress" }] };
    await core.importPackage(await manifestZip(manifest));
    await core.grantConsent(manifest.id);
    await core.enable(manifest.id);
    const err = await expectPlumsError(core.runAction({ extensionId: manifest.id, permissionId: SEND.id, request: { url: "https://api.example.com" } }), "PERMISSION_DENIED", "/formatVersion");
    expect(err.details).toMatchObject({ reason: "FORMAT_API_MISMATCH" });
    expect(egress.records).toEqual([]);
    expect(confirm.asked).toEqual([]);
  });
  it("refuses all package MCP entry points before storing an approval", async () => {
    const { core, dataDir } = world();
    const manifest = { ...validManifestV2("connector"), permissions: [{ ...FS, id: "search", level: "read" }] };
    await core.importPackage(await manifestZip(manifest));
    await core.grantConsent(manifest.id);
    await core.enable(manifest.id);
    const tool = { name: "search", description: "Search", inputSchema: { type: "object" } };
    for (const call of [() => core.checkMcpTools(manifest.id, [tool]), () => core.approveMcpTools(manifest.id, [tool]), () => core.authorizeMcpTool(manifest.id, tool), () => core.getMcpApprovals(manifest.id)]) {
      const err = await expectPlumsError(call(), "PERMISSION_DENIED", "/formatVersion");
      expect(err.details).toMatchObject({ reason: "FORMAT_API_MISMATCH" });
    }
    core.close();
    const db = new Database(path.join(dataDir, "plums.db"));
    try { expect(db.prepare("SELECT * FROM mcp_tools").all()).toEqual([]); } finally { db.close(); }
  });
});

describe("2.x update consent", () => {
  const growth: [string, PermissionV2, PermissionV2, string][] = [
    ["new permission", FS, EXEC, "NEW_PERMISSION"],
    ["target", FS, { ...FS, target: "other" }, "TARGET_CHANGED"],
    ["kind", FS, { ...EXEC, id: FS.id, target: FS.target }, "KIND_CHANGED"],
    ["read not granted by write", FS, { ...FS, operations: ["read"] }, "OPERATIONS_ADDED"],
    ["additional operation", FS, { ...FS, operations: ["write", "list"] }, "OPERATIONS_ADDED"],
    ["additional cwd root", EXEC, { ...EXEC, cwdRoots: ["workspace", "other"] }, "CWD_ROOTS_ADDED"],
  ];
  it.each(growth)("requires renewed consent for %s; refusal preserves files and state", async (_name, before, after, reason) => {
    const { core, dataDir } = world();
    const manifest = { ...validManifestV2(), permissions: [before] };
    await core.importPackage(await manifestZip(manifest, [{ name: "old.txt", data: "old" }]));
    const consent = await core.grantConsent(manifest.id);
    const enabled = await core.enable(manifest.id);
    const next = { ...manifest, version: "2.0.0", permissions: [after] };
    const err = await expectPlumsError(core.updatePackage(await manifestZip(next, [{ name: "new.txt", data: "new" }])), "CONSENT_REQUIRED", "/permissions/0");
    expect(err.details).toMatchObject({ reason });
    expect(await core.getConsent(manifest.id)).toEqual(consent);
    expect(await core.listInstalled()).toEqual([enabled]);
    const dir = path.join(dataDir, "packages", manifest.id);
    expect(readFileSync(path.join(dir, "old.txt"), "utf8")).toBe("old");
    expect(listAll(dir)).toEqual(["manifest.json", "old.txt"]);
    await core.updatePackage(await manifestZip(next), { consent: true });
    expect(await core.getConsent(manifest.id)).toMatchObject({ version: "2.0.0", formatVersion: PACKAGE_FORMAT_VERSION, permissions: [after] });
    expect(await core.listInstalled()).toMatchObject([{ enabled: true, consented: true, version: "2.0.0" }]);
  });
  it.each([
    [ { ...FS, operations: ["write", "read", "list"] }, { ...FS, operations: ["read"] } ],
    [ { ...EXEC, cwdRoots: ["workspace", "other"] }, EXEC ],
    [ SEND, { ...SEND, reason: "Updated explanation", future: true } ],
  ] as [PermissionV2, PermissionV2][])("permits scope reduction or explanation changes without renewing the consent time", async (before, after) => {
    const { core } = world();
    const manifest = { ...validManifestV2(), permissions: [before] };
    await core.importPackage(await manifestZip(manifest));
    const previous = await core.grantConsent(manifest.id);
    await core.enable(manifest.id);
    await core.updatePackage(await manifestZip({ ...manifest, version: "2.0.0", permissions: [after] }));
    expect(await core.getConsent(manifest.id)).toEqual({ ...previous, version: "2.0.0", permissions: [after] });
  });
  it.each([true, false])("requires consent when crossing formats, including empty lists (%s)", async (fromLegacy) => {
    const { core } = world();
    const old = { ...(fromLegacy ? validManifest("extension") : validManifestV2()), permissions: [], dependencies: [] };
    const next = { ...(fromLegacy ? validManifestV2() : validManifest("extension")), permissions: [], dependencies: [], version: "3.0.0" };
    await core.importPackage(await manifestZip(old));
    await core.grantConsent(old.id);
    await core.enable(old.id);
    const err = await expectPlumsError(core.updatePackage(await manifestZip(next)), "CONSENT_REQUIRED", "/formatVersion");
    expect(err.details).toMatchObject({ reason: "FORMAT_CHANGED" });
    expect((await core.listInstalled())[0]?.version).toBe(old.version);
    await core.updatePackage(await manifestZip(next), { consent: true });
    expect(await core.getConsent(old.id)).toMatchObject({ formatVersion: next.formatVersion, permissions: [] });
  });
});

describe("database migration keeps the 1.x records intact", () => {
  it.each([2, 3])("migrates schema %s to 4, retaining install/enable/consent/MCP and available refs", async (schema) => {
    const secrets = new MemorySecretStore();
    const { core, dataDir } = world({ secrets });
    const manifest = { ...validManifest("connector"), formatVersion: "1.7", dependencies: [], permissions: [{ id: "search", level: "read", target: "notes", reason: "Search" }], future: true,
      settingsSchema: { type: "object", properties: { token: { type: "string", title: "Token", description: "Token", "x-secret": true } } } };
    await core.importPackage(await manifestZip(manifest));
    const consent = await core.grantConsent(manifest.id);
    const installed = await core.enable(manifest.id);
    const tool = { name: "search", description: "Search", inputSchema: { type: "object" } };
    const approved = await core.approveMcpTools(manifest.id, [tool]);
    await core.importPackage(await manifestZip({ ...validManifest("extension"), id: "idle-v1", dependencies: [], permissions: [] }));
    const installs = await core.listInstalled();
    const active = secretRef(manifest.id, "token");
    const historical = secretRef(manifest.id, "removed");
    await secrets.set(active, "fake-active-secret");
    await secrets.set(historical, "fake-removed-secret");
    core.close();
    const db = new Database(path.join(dataDir, "plums.db"));
    const rawPermissions = JSON.stringify(manifest.permissions, null, 2);
    const rawManifest = JSON.stringify(manifest, null, 2);
    try {
      db.prepare("UPDATE packages SET manifest = ?, secret_refs = ? WHERE id = ?").run(rawManifest, JSON.stringify([active, historical]), manifest.id);
      db.prepare("UPDATE consents SET permissions = ? WHERE package_id = ?").run(rawPermissions, manifest.id);
      db.exec("ALTER TABLE consents DROP COLUMN format_version");
      if (schema === 2) db.exec("ALTER TABLE packages DROP COLUMN secret_refs");
      db.pragma(`user_version = ${schema}`);
    } finally { db.close(); }
    const reopened = restart(dataDir, secrets);
    expect(await reopened.listInstalled()).toEqual(installs);
    expect(installs).toContainEqual(installed);
    expect(await reopened.getConsent("idle-v1")).toBeNull();
    expect(await reopened.getConsent(manifest.id)).toEqual(consent);
    expect((await reopened.getMcpApprovals(manifest.id)).tools).toEqual(approved.approved);
    await expect(reopened.authorizeMcpTool(manifest.id, tool)).resolves.toEqual({ level: "read" });
    reopened.close();
    const migrated = new Database(path.join(dataDir, "plums.db"));
    try {
      expect(migrated.pragma("user_version", { simple: true })).toBe(4);
      expect(migrated.prepare("SELECT manifest FROM packages WHERE id = ?").get(manifest.id)).toEqual({ manifest: rawManifest });
      expect(migrated.prepare("SELECT permissions FROM consents WHERE package_id = ?").get(manifest.id)).toEqual({ permissions: rawPermissions });
      const row = migrated.prepare("SELECT secret_refs FROM packages WHERE id = ?").get(manifest.id) as { secret_refs: string };
      expect(JSON.parse(row.secret_refs)).toEqual(schema === 2 ? [active] : [active, historical]);
    } finally { migrated.close(); }
    await reopened.uninstall(manifest.id);
    expect(await secrets.get(active)).toBeUndefined();
    if (schema === 3) expect(await secrets.get(historical)).toBeUndefined();
  });
});
