import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
  type Confirm,
  type Core,
  type EgressSink,
  type Manifest,
  type Permission,
} from "@plums/core";
import { afterEach, beforeEach, expect, vi } from "vitest";

export const FAKE_SECRET = "plums-fake-secret-9f3a7c1e-DO-NOT-USE";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "packages",
);

/** Path of a fixture zip, relative to `fixtures/packages` (for example `valid/extension-min.zip`). */
export const fixturePath = (rel: string): string => path.join(FIXTURES, rel);
export const fixtureBytes = (rel: string): Uint8Array =>
  new Uint8Array(readFileSync(fixturePath(rel)));

export interface World {
  core: Core;
  /** Temp directory that holds `dataDir`, so anything written outside `dataDir` shows up too. */
  parent: string;
  dataDir: string;
  egress: RecordingEgressSink;
  confirm: ScriptedConfirm;
  secrets: MemorySecretStore;
}

export interface WorldOptions {
  /** Answers handed to the ScriptedConfirm, in order. */
  answers?: boolean[];
  /** `RecordingEgressSink` redirect script: 1-based send number to redirect URL. */
  redirects?: Record<number, string>;
  confirm?: Confirm;
  /** Replaces the sink the core sends through. `World.egress` stays the unused recording one. */
  egress?: EgressSink;
}

/** Call once at the top of a test file. Returns a factory for cores with their own temp dataDir. */
export function useWorlds(): (options?: WorldOptions) => World {
  const open: World[] = [];
  afterEach(() => {
    for (const world of open.splice(0)) {
      world.core.close();
      rmSync(world.parent, { recursive: true, force: true });
    }
  });
  return (options = {}) => {
    const parent = mkdtempSync(path.join(tmpdir(), "plums-contract-"));
    const dataDir = path.join(parent, "data");
    const egress = new RecordingEgressSink(options.redirects);
    const confirm = new ScriptedConfirm(options.answers);
    const secrets = new MemorySecretStore();
    const core = createCore({
      dataDir,
      egress: options.egress ?? egress,
      confirm: options.confirm ?? confirm,
      secrets,
    });
    const world = { core, parent, dataDir, egress, confirm, secrets };
    open.push(world);
    return world;
  };
}

/** Imports a fixture and returns its id. Optionally grants consent and enables it. */
export async function install(
  { core }: World,
  rel: string,
  { consent = false, enable = false } = {},
): Promise<string> {
  const { manifest } = await core.importPackage(fixturePath(rel));
  if (consent || enable) await core.grantConsent(manifest.id);
  if (enable) await core.enable(manifest.id);
  return manifest.id;
}

export async function fixtureManifest(
  world: World,
  rel: string,
): Promise<Manifest> {
  return (await world.core.validatePackage(fixturePath(rel))).manifest;
}

/**
 * Everything observable about the install: every file under the world's temp directory
 * (the sqlite file itself excluded), the install list and each consent record.
 * Two equal snapshots mean nothing changed.
 */
export async function snapshot(world: World) {
  // Reading the install list opens the database, so do it first: opening creates dataDir.
  const installed = await world.core.listInstalled();
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (name.startsWith("plums.db")) continue;
      const rel = path.relative(world.parent, full);
      if (statSync(full).isDirectory()) {
        files[`${rel}/`] = "dir";
        walk(full);
      } else {
        files[rel] = createHash("sha1")
          .update(readFileSync(full))
          .digest("hex");
      }
    }
  };
  walk(world.parent);
  const consents = Object.fromEntries(
    await Promise.all(
      installed.map(
        async ({ id }) => [id, await world.core.getConsent(id)] as const,
      ),
    ),
  );
  return { files, installed, consents };
}

/** Rewrites (or with `null` deletes) a stored consent record. The public API cannot make a consent that is out of date. */
export function editConsent(
  { dataDir }: World,
  id: string,
  change: (permissions: Permission[]) => Permission[] | null,
): void {
  const db = new Database(path.join(dataDir, "plums.db"));
  try {
    const row = db
      .prepare("SELECT permissions FROM consents WHERE package_id = ?")
      .get(id) as { permissions: string } | undefined;
    const next = change(JSON.parse(row?.permissions ?? "[]") as Permission[]);
    if (next === null)
      db.prepare("DELETE FROM consents WHERE package_id = ?").run(id);
    else
      db.prepare(
        "UPDATE consents SET permissions = ? WHERE package_id = ?",
      ).run(JSON.stringify(next), id);
  } finally {
    db.close();
  }
}

/** Rewrites the manifest stored at install time. Makes a package the current rules would refuse to import. */
export function editManifest(
  { dataDir }: World,
  id: string,
  change: (manifest: Manifest) => Manifest,
): void {
  const db = new Database(path.join(dataDir, "plums.db"));
  try {
    const row = db
      .prepare("SELECT manifest FROM packages WHERE id = ?")
      .get(id) as { manifest: string };
    db.prepare("UPDATE packages SET manifest = ? WHERE id = ?").run(
      JSON.stringify(change(JSON.parse(row.manifest))),
      id,
    );
  } finally {
    db.close();
  }
}

export function countRows(
  { dataDir }: World,
  table: "packages" | "consents",
): number {
  const db = new Database(path.join(dataDir, "plums.db"), { readonly: true });
  try {
    return (
      db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  } finally {
    db.close();
  }
}

/**
 * Captures console methods plus stdout/stderr writes for redaction assertions.
 * Call once at the top of a test file. `lines` is emptied before each test.
 */
export function captureOutput(): { lines: string[] } {
  const lines: string[] = [];
  beforeEach(() => {
    lines.length = 0;
    for (const target of [console, process.stdout, process.stderr] as const) {
      for (const method of [
        "log",
        "info",
        "warn",
        "error",
        "debug",
        "write",
      ] as const) {
        if (method in target) {
          vi.spyOn(target as never, method as never).mockImplementation(((
            ...args: unknown[]
          ) => {
            lines.push(args.map(String).join(" "));
            return true;
          }) as never);
        }
      }
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  return { lines };
}

/** Everything an error shows a caller, including the whole `cause` chain and extra own properties. */
export function serializeError(
  err: unknown,
  seen = new WeakSet<object>(),
): string {
  if (err === null || typeof err !== "object")
    return JSON.stringify(err) ?? String(err);
  if (seen.has(err)) return "[circular]";
  seen.add(err);
  if (err instanceof Error) {
    const own = Object.fromEntries(
      Object.getOwnPropertyNames(err).map((k) => [k, (err as never)[k]]),
    );
    return JSON.stringify({
      ...Object.fromEntries(
        Object.entries(own).map(([k, v]) => [k, serializeError(v, seen)]),
      ),
      name: err.name,
      message: err.message,
      stack: err.stack,
      cause:
        err.cause === undefined ? undefined : serializeError(err.cause, seen),
    });
  }
  return JSON.stringify(err, (_key, value: unknown) =>
    value instanceof Error ? serializeError(value, seen) : value,
  );
}

/** Awaits a call that must throw an Error and returns it. */
export async function thrown(promise: Promise<unknown>): Promise<Error> {
  const err = await promise.then(
    () => {
      throw new Error("expected the call to throw, but it succeeded");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return err as Error;
}

/** The world's temp directory is still empty: not even `dataDir` or the database was created. */
export function expectNothingWritten(world: World): void {
  expect(readdirSync(world.parent, { recursive: true })).toEqual([]);
}
