import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createCore, FakeModelProvider, MemorySecretStore, RecordingEgressSink, RecordingExecSink,
  RecordingFsSink, secretRef, type AuditEvent, type CapabilityRequest, type Core, type CreateCoreOptions,
} from "@plums/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectPlumsError, manifestZip, validManifestV2 } from "./package-helpers.js";

const cores: Core[] = [];
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const core of cores.splice(0)) core.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function world(extra: Partial<CreateCoreOptions> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "plums-performance-"));
  dirs.push(dir);
  const root = path.join(dir, "workspace");
  mkdirSync(root);
  writeFileSync(path.join(root, "file.txt"), "fixture");
  const secrets = new MemorySecretStore();
  const options: CreateCoreOptions = { dataDir: path.join(dir, "data"), model: new FakeModelProvider(),
    egress: new RecordingEgressSink(), fs: new RecordingFsSink(), exec: new RecordingExecSink(),
    roots: { workspace: root }, programs: { test: "/synthetic/program" }, secrets,
    confirm: { async ask() { return true; } }, onAudit() {}, ...extra };
  const core = createCore(options);
  cores.push(core);
  const manifest = validManifestV2();
  manifest.settingsSchema = { type: "object", properties: {
    token: { type: "string", title: "Token", description: "Synthetic secret", "x-secret": true },
  } };
  return { core, options, secrets, manifest };
}

function trackSql() {
  const probe = new Database(":memory:");
  const prototype = Object.getPrototypeOf(probe.prepare("SELECT 1")) as Database.Statement;
  probe.close();
  const counts = { selects: 0, prepares: 0 };
  const prepare = Database.prototype.prepare;
  const get = prototype.get;
  const all = prototype.all;
  vi.spyOn(Database.prototype, "prepare").mockImplementation(function (this: Database.Database, sql: string) {
    counts.prepares++;
    return prepare.call(this, sql);
  });
  vi.spyOn(prototype, "get").mockImplementation(function (this: Database.Statement, ...args: unknown[]) {
    if (/^\s*SELECT\b/i.test(this.source)) counts.selects++;
    return get.apply(this, args);
  });
  vi.spyOn(prototype, "all").mockImplementation(function (this: Database.Statement, ...args: unknown[]) {
    if (/^\s*SELECT\b/i.test(this.source)) counts.selects++;
    return all.apply(this, args);
  });
  return { counts, reset() { counts.selects = 0; counts.prepares = 0; } };
}

const requests: [string, CapabilityRequest, string, number, number][] = [
  ["read", { kind: "fs", operation: "read", path: "file.txt" }, "files", 18, 3],
  ["list", { kind: "fs", operation: "list", path: "." }, "files", 18, 3],
  ["write", { kind: "fs", operation: "write", path: "new.txt", data: new Uint8Array([1]) }, "files", 20, 5],
  ["exec", { kind: "exec", args: [], cwd: { root: "workspace", path: "." } }, "test", 20, 5],
  ["egress", { kind: "egress", url: "https://api.example.com/test" }, "send", 20, 5],
];

describe("capability query work stays independent of installed package count", () => {
  it.each(requests)("%s refreshes secrets and executes a fixed number of selects", async (_name, request, permissionId, selects, scans) => {
    for (const packages of [1, 12]) {
      const w = world();
      await w.core.importPackage(await manifestZip(w.manifest));
      for (let i = 1; i < packages; i++) {
        await w.core.importPackage(await manifestZip({ ...w.manifest, id: `fixture-${i}`,
          kind: "character", permissions: [], payload: "x".repeat(64 * 1024) }));
      }
      for (let i = 0; i < packages; i++) {
        await w.secrets.set(secretRef(i === 0 ? w.manifest.id : `fixture-${i}`, "token"), `FAKE_PERF_${i}`);
      }
      await w.core.grantConsent(w.manifest.id);
      await w.core.enable(w.manifest.id);
      const call = () => w.core.runCapability({ extensionId: w.manifest.id, permissionId, request });
      await call();
      const sql = trackSql();
      const reads = vi.spyOn(w.secrets, "get");
      await call();
      expect(sql.counts).toEqual({ selects, prepares: 0 });
      expect(reads).toHaveBeenCalledTimes(packages * scans);
      vi.restoreAllMocks();
    }
  });
});

it("keeps validation and error redaction from creating an unused database", async () => {
  const w = world();
  await expectPlumsError(w.core.validatePackage(new Uint8Array()), "IMPORT_INVALID");
  expect(existsSync(w.options.dataDir)).toBe(false);
});

it("recreates statements after closing and reopening the same core", async () => {
  const w = world();
  await w.core.importPackage(await manifestZip(w.manifest));
  const consent = await w.core.grantConsent(w.manifest.id);
  await w.core.enable(w.manifest.id);
  const installed = await w.core.listInstalled();
  await w.core.getConsent(w.manifest.id);
  w.core.close();
  const sql = trackSql();
  expect(await w.core.listInstalled()).toEqual(installed);
  expect(await w.core.getConsent(w.manifest.id)).toEqual(consent);
  expect(sql.counts.prepares).toBeGreaterThan(0);
  sql.reset();
  expect(await w.core.listInstalled()).toEqual(installed);
  expect(await w.core.getConsent(w.manifest.id)).toEqual(consent);
  expect(sql.counts).toEqual({ selects: 3, prepares: 0 });
});

it("reads new state written by another core through an already prepared query", async () => {
  const w = world();
  await w.core.importPackage(await manifestZip(w.manifest));
  await w.core.grantConsent(w.manifest.id);
  await w.core.enable(w.manifest.id);
  expect((await w.core.listInstalled())[0]?.enabled).toBe(true);
  const second = createCore(w.options);
  cores.push(second);
  await second.disable(w.manifest.id);
  expect((await w.core.listInstalled())[0]?.enabled).toBe(false);
  await expectPlumsError(w.core.runCapability({ extensionId: w.manifest.id, permissionId: "send",
    request: { kind: "egress", url: "https://api.example.com/test" } }), "PERMISSION_DENIED");
});

it("retains both earlier and freshly changed secret values during audits", async () => {
  const oldValue = "FAKE_BEFORE_AUDIT";
  const newValue = "FAKE_AFTER_AUDIT";
  const events: AuditEvent[] = [];
  const w = world({ async onAudit(event) {
    events.push(event);
    if (event.phase === "confirmation" && event.outcome === "requested") {
      await w.secrets.set(secretRef(w.manifest.id, "token"), newValue);
    }
  } });
  w.manifest.name = `${oldValue} ${newValue}`;
  await w.core.importPackage(await manifestZip(w.manifest));
  await w.core.grantConsent(w.manifest.id);
  await w.core.enable(w.manifest.id);
  await w.secrets.set(secretRef(w.manifest.id, "token"), oldValue);
  // Permission identifiers enter every audit event, so both values must be redacted.
  const id = `${oldValue}-${newValue}`;
  w.manifest.permissions[2]!.id = id;
  await w.core.updatePackage(await manifestZip({ ...w.manifest, version: "1.2.4" }), { consent: true });
  await w.core.runCapability({ extensionId: w.manifest.id, permissionId: id,
    request: { kind: "egress", url: "https://api.example.com/test" } });
  expect(events).toHaveLength(4);
  const subsequent = JSON.stringify(events.slice(1));
  expect(subsequent).not.toContain(oldValue);
  expect(subsequent).not.toContain(newValue);
  expect(subsequent).toContain("[REDACTED]");
});

it("prepares dynamic MCP deletion SQL for each tool list without retaining it", async () => {
  const w = world();
  await w.core.checkMcpTools("manual:performance", []);
  const sql = trackSql();
  const tools = ["first", "second"].map((name) => ({ name, description: "Synthetic tool", inputSchema: { type: "object" } }));
  await w.core.checkMcpTools("manual:performance", tools.slice(0, 1));
  expect(sql.counts.prepares).toBe(1);
  sql.reset();
  await w.core.checkMcpTools("manual:performance", tools);
  expect(sql.counts.prepares).toBe(1);
  sql.reset();
  await w.core.checkMcpTools("manual:performance", tools);
  expect(sql.counts.prepares).toBe(1);
});
