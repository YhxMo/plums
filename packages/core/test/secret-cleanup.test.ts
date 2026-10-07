import { SCHEMA_VERSION } from "../src/install/store.js";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  MemorySecretStore,
  type Core,
  type Manifest,
  secretRef,
} from "@plums/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectPlumsError,
  makeCore,
  manifestZip,
  validManifest,
} from "./package-helpers.js";

const ID = "cleanup.ext";
const REF = secretRef(ID, "token");
const FAKE = "AUDIT_FAKE_REMOVED_SECRET";
const initial: Manifest = {
  ...validManifest("extension"),
  id: ID,
  dependencies: [],
  permissions: [],
  settingsSchema: {
    type: "object",
    properties: {
      token: {
        type: "string",
        title: "Token",
        description: "A secret.",
        "x-secret": true,
      },
    },
  },
};
const next: Manifest = {
  ...initial,
  version: "1.3.0",
  settingsSchema: undefined,
};

let core: Core;
let dataDir: string;
let secrets: MemorySecretStore;
beforeEach(async () => {
  secrets = new MemorySecretStore();
  ({ core, dataDir } = makeCore({ secrets }));
  await core.importPackage(await manifestZip(initial));
  await secrets.set(REF, FAKE);
});
afterEach(() => core.close());

function refuseDelete(afterDeleting = false): () => void {
  const original = secrets.delete.bind(secrets);
  secrets.delete = async (ref) => {
    if (ref !== REF) return original(ref);
    if (afterDeleting) await original(ref);
    throw Object.assign(new Error(`delete failed ${FAKE}`), {
      cause: new Error(FAKE),
      details: { secret: FAKE },
    });
  };
  return () => {
    secrets.delete = original;
  };
}

async function cleanupFailure(): Promise<void> {
  const error = await expectPlumsError(
    core.updatePackage(await manifestZip(next)),
    "SECRET_NOT_FOUND",
  );
  expect(error.details).toEqual({
    id: ID,
    version: "1.3.0",
    reason: "SECRET_CLEANUP_FAILED",
  });
  expect(error.path).toBeUndefined();
  expect(error.cause).toBeUndefined();
  expect(
    [error.message, error.stack, JSON.stringify(error)].join("\n"),
  ).not.toContain(FAKE);
  expect(error.message).toContain("1.3.0");
  expect(await core.listInstalled()).toMatchObject([
    { id: ID, version: "1.3.0" },
  ]);
}

describe("removed secret references survive a failed cleanup", () => {
  it("keeps errors and later exports secret-free, then retries on uninstall after reopening", async () => {
    const restore = refuseDelete();
    await cleanupFailure();
    expect(await secrets.get(REF)).toBe(FAKE);
    core.close();
    core = makeCore({ dataDir, secrets }).core;
    const error = await expectPlumsError(
      core.exportPackage({ manifest: { ...next, payload: FAKE } }),
      "IMPORT_INVALID",
    );
    expect(error.message).not.toContain(FAKE);
    expect(
      readFileSync(path.join(dataDir, "plums.db"), "latin1"),
    ).not.toContain(FAKE);
    restore();
    await core.uninstall(ID);
    expect(await secrets.get(REF)).toBeUndefined();
    expect(await core.listInstalled()).toEqual([]);
  });

  it("retries removed references on a later update", async () => {
    const restore = refuseDelete();
    await cleanupFailure();
    restore();
    await core.updatePackage(await manifestZip({ ...next, version: "1.4.0" }));
    expect(await secrets.get(REF)).toBeUndefined();
    expect(await core.listInstalled()).toMatchObject([
      { id: ID, version: "1.4.0" },
    ]);
  });

  it("hides the deletion error even when deletion happened before the throw", async () => {
    const restore = refuseDelete(true);
    await cleanupFailure();
    expect(await secrets.get(REF)).toBeUndefined();
    restore();
    await core.uninstall(ID);
  });

  it("hides a synchronous deletion throw after the value has been deleted", async () => {
    const original = secrets.delete.bind(secrets);
    secrets.delete = (ref) => {
      void original(ref);
      throw new Error(`synchronous deletion failure ${FAKE}`);
    };
    await cleanupFailure();
    expect(await secrets.get(REF)).toBeUndefined();
    secrets.delete = original;
    await core.uninstall(ID);
  });

  it("preserves a reference that a later version declares again", async () => {
    const restore = refuseDelete();
    await cleanupFailure();
    restore();
    await core.updatePackage(
      await manifestZip({ ...initial, version: "1.4.0" }),
    );
    expect(await secrets.get(REF)).toBe(FAKE);
    await core.setSettings(ID, { token: REF });
    expect(await core.resolveSettings(ID)).toEqual({ token: FAKE });
    await core.uninstall(ID);
    expect(await secrets.get(REF)).toBeUndefined();
  });

  it("keeps the install record and hides errors when uninstall deletion fails", async () => {
    const restore = refuseDelete(true);
    const error = await expectPlumsError(
      core.uninstall(ID),
      "SECRET_NOT_FOUND",
    );
    expect(error.details).toEqual({
      id: ID,
      version: initial.version,
      reason: "SECRET_CLEANUP_FAILED",
    });
    expect(
      [error.message, error.stack, JSON.stringify(error)].join("\n"),
    ).not.toContain(FAKE);
    expect(await core.listInstalled()).toMatchObject([
      { id: ID, version: initial.version },
    ]);
    restore();
    await core.uninstall(ID);
    expect(await core.listInstalled()).toEqual([]);
  });
});

it("migrates schema 2 without losing an installed package, consent or enabled state", async () => {
  core.close();
  dataDir = mkdtempSync(path.join(tmpdir(), "plums-schema2-"));
  const file = path.join(dataDir, "plums.db");
  const db = new Database(file);
  try {
    db.exec(`
      CREATE TABLE packages (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
        version TEXT NOT NULL, manifest TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
        installed_at TEXT NOT NULL, enabled_at TEXT);
      CREATE TABLE consents (package_id TEXT PRIMARY KEY, version TEXT NOT NULL,
        permissions TEXT NOT NULL, granted_at TEXT NOT NULL);
      CREATE TABLE mcp_tools (server_id TEXT NOT NULL, tool TEXT NOT NULL,
        fingerprint TEXT NOT NULL, level TEXT NOT NULL, approved_at TEXT NOT NULL,
        PRIMARY KEY (server_id, tool));
      PRAGMA user_version = 2;
    `);
    db.prepare("INSERT INTO packages VALUES (?, ?, ?, ?, ?, 1, ?, ?)").run(
      ID,
      initial.kind,
      initial.name,
      initial.version,
      JSON.stringify(initial),
      "installed",
      "enabled",
    );
    db.prepare("INSERT INTO consents VALUES (?, ?, ?, ?)").run(
      ID,
      initial.version,
      "[]",
      "agreed",
    );
  } finally {
    db.close();
  }
  const packageDir = path.join(dataDir, "packages", ID);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    path.join(packageDir, "manifest.json"),
    JSON.stringify(initial),
  );
  core = makeCore({ dataDir, secrets }).core;
  expect(await core.listInstalled()).toMatchObject([
    { id: ID, enabled: true, consented: true },
  ]);
  expect(await core.getConsent(ID)).toMatchObject({
    version: initial.version,
    grantedAt: "agreed",
  });
  const restore = refuseDelete();
  await cleanupFailure();
  restore();
  core.close();
  core = makeCore({ dataDir, secrets }).core;
  await core.uninstall(ID);
  expect(await secrets.get(REF)).toBeUndefined();
  const migrated = new Database(file);
  try {
    expect(migrated.pragma("user_version", { simple: true })).toBe(
      SCHEMA_VERSION,
    );
  } finally {
    migrated.close();
  }
});
