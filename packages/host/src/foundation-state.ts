import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { open, rename, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import type { FoundationSelection } from "@plums/sdk";
import { parseFoundationSelection } from "@plums/sdk";
import { foundationFailure } from "./foundation-factory.js";
import type { AgentRecord } from "./host.js";
import { checkRecordVersion } from "./assembly.js";
import { isDeepStrictEqual } from "node:util";

export const FOUNDATION_DATA_FORMAT = "org.plums.host-state/1";
export interface AgentFoundationBinding {
  bindingVersion: 1;
  selection: FoundationSelection;
  installationId: string;
  enabled: boolean;
  dataFormat: string;
}
export type FoundationSwitchPhase =
  | "prepare"
  | "stop"
  | "before-commit"
  | "after-commit"
  | "ready"
  | "activate"
  | "after-activate";
export interface FoundationTransaction {
  transactionVersion: 1;
  phase:
    | "prepared"
    | "stopping"
    | "committed"
    | "ready"
    | "activating"
    | "activated";
  before: AgentRecord;
  next: AgentRecord;
}
export function foundationBinding(
  selection: FoundationSelection,
): AgentFoundationBinding {
  return {
    bindingVersion: 1,
    selection: parseFoundationSelection(selection),
    installationId: randomUUID(),
    enabled: true,
    dataFormat: FOUNDATION_DATA_FORMAT,
  };
}
export function validateFoundationBinding(value: AgentFoundationBinding) {
  if (
    !value ||
    value.bindingVersion !== 1 ||
    typeof value.enabled !== "boolean" ||
    !/^[a-f0-9-]{36}$/.test(value.installationId) ||
    value.dataFormat !== FOUNDATION_DATA_FORMAT
  )
    throw foundationFailure("FOUNDATION_INVALID");
  parseFoundationSelection(value.selection);
}
/** Rename and directory fsync make the journal and selection durable before activation. */
export async function durableJson(file: string, value: unknown) {
  const pending = file + "." + randomUUID() + ".pending";
  try {
    const handle = await open(pending, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(pending, file);
    const dir = await open(path.dirname(file), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await rm(pending, { force: true });
  }
}
export async function foundationJournal(
  dir: string,
): Promise<FoundationTransaction | undefined> {
  let t: FoundationTransaction;
  try {
    t = JSON.parse(
      await readFile(path.join(dir, "foundation-transaction.json"), "utf8"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw foundationFailure("FOUNDATION_RECOVERY_FAILED");
  }
  if (
    !t ||
    !t.before ||
    !t.next ||
    t.transactionVersion !== 1 ||
    ![
      "prepared",
      "stopping",
      "committed",
      "ready",
      "activating",
      "activated",
    ].includes(t.phase) ||
    t.before.instanceId !== t.next.instanceId ||
    !t.before.foundation ||
    !t.next.foundation
  )
    throw foundationFailure("FOUNDATION_RECOVERY_FAILED");
  try {
    checkRecordVersion(t.before);
    checkRecordVersion(t.next);
    validateFoundationBinding(t.before.foundation);
    validateFoundationBinding(t.next.foundation);
  } catch {
    throw foundationFailure("FOUNDATION_RECOVERY_FAILED");
  }
  return t;
}
export async function recoverFoundation(dir: string) {
  const t = await foundationJournal(dir);
  if (!t) return;
  let live: AgentRecord;
  try {
    live = JSON.parse(await readFile(path.join(dir, "record.json"), "utf8"));
    checkRecordVersion(live);
    validateFoundationBinding(live.foundation!);
  } catch {
    throw foundationFailure("FOUNDATION_RECOVERY_FAILED");
  }
  if (!isDeepStrictEqual(live, t.before) && !isDeepStrictEqual(live, t.next))
    throw foundationFailure("FOUNDATION_RECOVERY_FAILED");
  // The activation marker is a durable point of no return, even if the process died before sending activate.
  const chosen = ["activating", "activated"].includes(t.phase)
    ? t.next
    : t.before;
  await durableJson(path.join(dir, "record.json"), chosen);
  await durableJson(path.join(dir, "foundation-recovery.json"), {
    transactionVersion: 1,
    outcome:
      chosen === t.next
        ? "kept-committed-selection"
        : "restored-previous-selection",
    phase: t.phase,
    installationId: chosen.foundation!.installationId,
  });
  await rm(path.join(dir, "foundation-transaction.json"));
}
function identity(pid: number): string | undefined {
  try {
    return (
      execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
function trackedAlive(child: { pid: number; identity: string }) {
  const start = identity(child.pid);
  return start === child.identity || (start === undefined && alive(child.pid));
}
/** Shared sessions coexist; destructive changes require exclusive ownership and awaited real cleanup. */
export class FoundationOwnership {
  private db?: DatabaseSync;
  private owner = randomUUID();
  private counts = new Map<string, number>();
  constructor(private root: string) {}
  private connection() {
    if (!this.db) {
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      const file = path.join(this.root, "foundation-state.db"),
        db = new DatabaseSync(file);
      db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
      );
      chmodSync(file, 0o600);
      db.exec(
        "CREATE TABLE IF NOT EXISTS owners(scope TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS participants(scope TEXT NOT NULL, owner TEXT NOT NULL, pid INTEGER NOT NULL, PRIMARY KEY(scope,owner)); CREATE TABLE IF NOT EXISTS switches(scope TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS processes(owner TEXT NOT NULL, scope TEXT NOT NULL, pid INTEGER NOT NULL, identity TEXT NOT NULL, PRIMARY KEY(owner,pid)); CREATE TABLE IF NOT EXISTS snapshots(owner TEXT NOT NULL,scope TEXT NOT NULL,id TEXT PRIMARY KEY);",
      );
      this.db = db;
    }
    return this.db;
  }
  private transaction<T>(fn: () => T): T {
    const db = this.connection();
    db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      db.exec("COMMIT");
      return v;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  async acquire(scope: string, expires = Date.now() + 5000): Promise<void> {
    if (this.counts.has(scope)) {
      this.counts.set(scope, this.counts.get(scope)! + 1);
      return;
    }
    const db = this.connection();
    const row = db
      .prepare("SELECT owner,pid FROM owners WHERE scope=?")
      .get(scope) as { owner: string; pid: number } | undefined;
    if (row && row.owner !== this.owner) {
      if (alive(row.pid)) {
        const deadline = expires;
        while (
          (
            db.prepare("SELECT owner FROM owners WHERE scope=?").get(scope) as
              | { owner: string }
              | undefined
          )?.owner === row.owner &&
          alive(row.pid)
        ) {
          if (Date.now() > deadline) throw foundationFailure("FOUNDATION_BUSY");
          await new Promise((r) => setTimeout(r, 25));
        }
        return this.acquire(scope, expires);
      }
      const children = db
        .prepare("SELECT pid,identity FROM processes WHERE owner=? AND scope=?")
        .all(row.owner, scope) as { pid: number; identity: string }[];
      const deadline = Date.now() + 15000;
      while (children.some(trackedAlive)) {
        if (Date.now() > deadline)
          throw foundationFailure("FOUNDATION_CLEANUP_PENDING");
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    const acquired = this.transaction(() => {
      const current = db
        .prepare("SELECT owner,pid FROM owners WHERE scope=?")
        .get(scope) as { owner: string; pid: number } | undefined;
      if (
        current &&
        current.owner !== this.owner &&
        (current.owner !== row?.owner || alive(current.pid))
      )
        return false;
      if (current)
        db.prepare("DELETE FROM processes WHERE owner=? AND scope=?").run(
          current.owner,
          scope,
        );
      db.prepare("INSERT OR REPLACE INTO owners VALUES(?,?,?)").run(
        scope,
        this.owner,
        process.pid,
      );
      return true;
    });
    if (!acquired) {
      if (Date.now() > expires) throw foundationFailure("FOUNDATION_BUSY");
      await new Promise((r) => setTimeout(r, 25));
      return this.acquire(scope, expires);
    }
    this.counts.set(scope, 1);
  }
  release(scope: string) {
    const n = this.counts.get(scope);
    if (!n) return;
    if (n > 1) {
      this.counts.set(scope, n - 1);
      return;
    }
    this.connection()
      .prepare("DELETE FROM owners WHERE scope=? AND owner=?")
      .run(scope, this.owner);
    this.counts.delete(scope);
  }
  needsRecovery(scope: string) {
    const db = this.connection();
    return (
      !!db.prepare("SELECT owner FROM switches WHERE scope=?").get(scope) ||
      (
        db.prepare("SELECT pid FROM participants WHERE scope=?").all(scope) as {
          pid: number;
        }[]
      ).some((p) => !alive(p.pid))
    );
  }
  enter(scope: string) {
    this.transaction(() => {
      const db = this.connection(),
        blocking = db
          .prepare("SELECT owner FROM switches WHERE scope=?")
          .get(scope);
      if (blocking && blocking.owner !== this.owner)
        throw foundationFailure("FOUNDATION_BUSY");
      const participants = db
        .prepare("SELECT pid FROM participants WHERE scope=?")
        .all(scope) as { pid: number }[];
      if (participants.some((p) => !alive(p.pid)))
        throw foundationFailure("FOUNDATION_CLEANUP_PENDING");
      db.prepare("INSERT OR REPLACE INTO participants VALUES(?,?,?)").run(
        scope,
        this.owner,
        process.pid,
      );
    });
  }
  leave(scope: string) {
    this.connection()
      .prepare("DELETE FROM participants WHERE scope=? AND owner=?")
      .run(scope, this.owner);
  }
  assert(scope: string) {
    const db = this.connection(),
      row = db
        .prepare("SELECT owner FROM participants WHERE scope=? AND owner=?")
        .get(scope, this.owner),
      blocking = db
        .prepare("SELECT owner FROM switches WHERE scope=?")
        .get(scope);
    if (!row || (blocking && blocking.owner !== this.owner))
      throw foundationFailure("FOUNDATION_SELECTION_CHANGED");
  }
  async exclusive(scope: string) {
    const db = this.connection(),
      others = db
        .prepare(
          "SELECT owner,pid FROM participants WHERE scope=? AND owner<>?",
        )
        .all(scope, this.owner) as { owner: string; pid: number }[];
    for (const other of others) {
      if (alive(other.pid)) throw foundationFailure("FOUNDATION_BUSY");
      const children = db
        .prepare("SELECT pid,identity FROM processes WHERE owner=? AND scope=?")
        .all(other.owner, scope) as { pid: number; identity: string }[];
      const deadline = Date.now() + 15000;
      while (children.some(trackedAlive)) {
        if (Date.now() > deadline)
          throw foundationFailure("FOUNDATION_CLEANUP_PENDING");
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    this.transaction(() => {
      for (const other of db
        .prepare(
          "SELECT owner,pid FROM participants WHERE scope=? AND owner<>?",
        )
        .all(scope, this.owner) as { owner: string; pid: number }[]) {
        if (alive(other.pid) || !others.some((o) => o.owner === other.owner))
          throw foundationFailure("FOUNDATION_BUSY");
      }
      db.prepare("INSERT OR REPLACE INTO switches VALUES(?,?,?)").run(
        scope,
        this.owner,
        process.pid,
      );
    });
    try {
      for (const other of others) {
        const snapshots = db
          .prepare("SELECT id FROM snapshots WHERE owner=? AND scope=?")
          .all(other.owner, scope) as { id: string }[];
        for (const snapshot of snapshots) {
          if (!/^[a-f0-9-]{36}$/.test(snapshot.id))
            throw foundationFailure("FOUNDATION_CLEANUP_PENDING");
          await rm(path.join(this.root, "foundation-snapshots", snapshot.id), {
            recursive: true,
            force: true,
          });
        }
      }

      this.transaction(() => {
        for (const other of others) {
          db.prepare("DELETE FROM participants WHERE scope=? AND owner=?").run(
            scope,
            other.owner,
          );
          db.prepare("DELETE FROM processes WHERE scope=? AND owner=?").run(
            scope,
            other.owner,
          );
          db.prepare("DELETE FROM snapshots WHERE scope=? AND owner=?").run(
            scope,
            other.owner,
          );
        }
      });
    } catch {
      this.releaseExclusive(scope);
      throw foundationFailure("FOUNDATION_CLEANUP_PENDING");
    }
  }
  allocateSnapshot(scope: string) {
    this.assert(scope);
    const id = randomUUID(),
      root = path.join(this.root, "foundation-snapshots", id);
    this.connection()
      .prepare("INSERT INTO snapshots VALUES(?,?,?)")
      .run(this.owner, scope, id);
    return {
      root,
      release: () => {
        this.connection()
          .prepare("DELETE FROM snapshots WHERE owner=? AND id=?")
          .run(this.owner, id);
      },
    };
  }

  releaseExclusive(scope: string) {
    this.connection()
      .prepare("DELETE FROM switches WHERE scope=? AND owner=?")
      .run(scope, this.owner);
  }
  track(scope: string, child: ChildProcess) {
    this.assert(scope);
    const pid = child.pid,
      start = pid ? identity(pid) : undefined;
    if (!pid) return;
    if (!start) {
      if (alive(pid)) throw foundationFailure("FOUNDATION_CLEANUP_PENDING");
      return;
    }
    const db = this.connection();
    db.prepare("INSERT INTO processes VALUES(?,?,?,?)").run(
      this.owner,
      scope,
      pid,
      start,
    );
    child.once("close", () => {
      this.connection()
        .prepare("DELETE FROM processes WHERE owner=? AND pid=?")
        .run(this.owner, pid);
    });
  }
  close() {
    if (this.counts.size) return;
    this.db?.close();
    this.db = undefined;
  }
}
