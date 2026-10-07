import { PlumsError } from "@plums/core";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CommonJson,
  ResourceOperation,
  ResourceSnapshot,
} from "@plums/sdk";
import { resourceFailure } from "./resource-error.js";

export interface BusinessResource {
  id: string;
  name: string;
  scope: "shared" | "agent";
  ownerAgentId?: string;
  /** Author-defined content contract; the host never migrates the body. */
  contentContract: string;
}
export interface ResourceBindingRecord {
  agentId: string;
  componentId: string;
  requirementId: string;
  resourceId: string;
  installation: string;
}
export interface ResourceQualification {
  resourceId: string;
  agentId: string;
  /** Empty component id denotes the independently chosen Agent qualification. */
  componentId: string;
  operations: ResourceOperation[];
}
export class ResourceStore {
  private db?: DatabaseSync;
  constructor(private directory: string) {}
  private connection(): DatabaseSync {
    if (!this.db) {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      chmodSync(this.directory, 0o700);
      const file = path.join(this.directory, "resources.db");
      const db = new DatabaseSync(file);
      db.exec("PRAGMA busy_timeout=5000;");
      chmodSync(file, 0o600);
      const version = Number(
        db.prepare("PRAGMA user_version").get()?.user_version ?? 0,
      );
      if (version > 1) {
        db.close();
        throw resourceFailure("RUNTIME_UNAVAILABLE");
      }
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
      );
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT UNIQUE, content_contract TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_epochs (agent TEXT PRIMARY KEY, epoch INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS qualifications (resource TEXT NOT NULL REFERENCES spaces(id), agent TEXT NOT NULL, component TEXT NOT NULL, operations TEXT NOT NULL, PRIMARY KEY(resource,agent,component));
        CREATE TABLE IF NOT EXISTS bindings (agent TEXT NOT NULL, component TEXT NOT NULL, requirement TEXT NOT NULL, resource TEXT NOT NULL REFERENCES spaces(id), installation TEXT NOT NULL, PRIMARY KEY(agent,component,requirement));
        CREATE TABLE IF NOT EXISTS entries (resource TEXT NOT NULL REFERENCES spaces(id), key TEXT NOT NULL, revision TEXT NOT NULL, body TEXT, PRIMARY KEY(resource,key));
        CREATE TABLE IF NOT EXISTS commits (call_id TEXT PRIMARY KEY, resource TEXT NOT NULL REFERENCES spaces(id), revision TEXT NOT NULL, operation TEXT NOT NULL);
        PRAGMA user_version=1; COMMIT;`);
      this.db = db;
    }
    return this.db;
  }
  close() {
    this.db?.close();
    this.db = undefined;
  }
  transaction<T>(fn: () => T, coreFile?: string): T {
    const db = this.connection();
    if (coreFile)
      db.prepare("ATTACH DATABASE ? AS authorization").run(coreFile);
    let started = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      started = true;
      const result = fn();
      db.exec("COMMIT");
      started = false;
      return result;
    } catch (error) {
      if (started) db.exec("ROLLBACK");
      if (error instanceof PlumsError) throw error;
      throw resourceFailure("PROVIDER_FAILED");
    } finally {
      if (coreFile) db.exec("DETACH DATABASE authorization");
    }
  }
  ensureAgent(agentId: string, name: string): BusinessResource {
    return this.transaction(() => {
      const existing = this.spaces().find((s) => s.ownerAgentId === agentId);
      if (existing) return existing;
      const resource: BusinessResource = {
        id: randomUUID(),
        name: `${name}的独立资源`,
        scope: "agent",
        ownerAgentId: agentId,
        contentContract: "opaque-json/1",
      };
      this.insert(resource);
      return resource;
    });
  }
  createShared(name: string, contentContract: string): BusinessResource {
    return this.transaction(() => {
      const s: BusinessResource = {
        id: randomUUID(),
        name,
        scope: "shared",
        contentContract,
      };
      this.insert(s);
      return s;
    });
  }
  private insert(s: BusinessResource) {
    this.connection()
      .prepare("INSERT INTO spaces VALUES (?, ?, ?, ?, ?)")
      .run(s.id, s.name, s.scope, s.ownerAgentId ?? null, s.contentContract);
  }
  spaces(): BusinessResource[] {
    return this.connection()
      .prepare("SELECT * FROM spaces ORDER BY name,id")
      .all()
      .map((r) => ({
        id: r.id as string,
        name: r.name as string,
        scope: r.scope as BusinessResource["scope"],
        ...(r.owner ? { ownerAgentId: r.owner as string } : {}),
        contentContract: r.content_contract as string,
      }));
  }
  space(id: string): BusinessResource {
    const s = this.spaces().find((s) => s.id === id);
    if (!s) throw resourceFailure("RESOURCE_NOT_FOUND");
    return s;
  }
  epoch(agentId: string): number {
    return Number(
      this.connection()
        .prepare("SELECT epoch FROM agent_epochs WHERE agent=?")
        .get(agentId)?.epoch ?? 0,
    );
  }
  private bump(agentId: string) {
    this.connection()
      .prepare(
        "INSERT INTO agent_epochs VALUES (?,1) ON CONFLICT(agent) DO UPDATE SET epoch=epoch+1",
      )
      .run(agentId);
  }
  qualifications(): ResourceQualification[] {
    return this.connection()
      .prepare("SELECT * FROM qualifications ORDER BY resource,agent,component")
      .all()
      .map((r) => ({
        resourceId: r.resource as string,
        agentId: r.agent as string,
        componentId: r.component as string,
        operations: JSON.parse(r.operations as string),
      }));
  }
  operations(
    resource: string,
    agent: string,
    component: string,
  ): ResourceOperation[] {
    const r = this.connection()
      .prepare(
        "SELECT operations FROM qualifications WHERE resource=? AND agent=? AND component=?",
      )
      .get(resource, agent, component);
    return r ? JSON.parse(r.operations as string) : [];
  }
  setQualification(q: ResourceQualification, expectedEpoch?: number) {
    this.transaction(() => {
      if (
        expectedEpoch !== undefined &&
        this.epoch(q.agentId) !== expectedEpoch
      )
        throw resourceFailure("STALE_BINDING");
      this.space(q.resourceId);
      this.connection()
        .prepare(
          "INSERT INTO qualifications VALUES (?,?,?,?) ON CONFLICT(resource,agent,component) DO UPDATE SET operations=excluded.operations",
        )
        .run(
          q.resourceId,
          q.agentId,
          q.componentId,
          JSON.stringify(q.operations),
        );
      this.bump(q.agentId);
    });
  }
  bindings(agentId: string): ResourceBindingRecord[] {
    return this.connection()
      .prepare(
        "SELECT * FROM bindings WHERE agent=? ORDER BY component,requirement",
      )
      .all(agentId)
      .map((r) => ({
        agentId,
        componentId: r.component as string,
        requirementId: r.requirement as string,
        resourceId: r.resource as string,
        installation: r.installation as string,
      }));
  }
  bind(b: ResourceBindingRecord, expectedEpoch: number) {
    this.transaction(() => {
      if (this.epoch(b.agentId) !== expectedEpoch)
        throw resourceFailure("STALE_BINDING");
      this.space(b.resourceId);
      this.connection()
        .prepare(
          "INSERT INTO bindings VALUES (?,?,?,?,?) ON CONFLICT(agent,component,requirement) DO UPDATE SET resource=excluded.resource,installation=excluded.installation",
        )
        .run(
          b.agentId,
          b.componentId,
          b.requirementId,
          b.resourceId,
          b.installation,
        );
      this.bump(b.agentId);
    });
  }
  unbind(
    agent: string,
    component: string,
    requirement: string,
    expectedEpoch?: number,
  ) {
    this.transaction(() => {
      if (expectedEpoch !== undefined && this.epoch(agent) !== expectedEpoch)
        throw resourceFailure("STALE_BINDING");
      this.connection()
        .prepare(
          "DELETE FROM bindings WHERE agent=? AND component=? AND requirement=?",
        )
        .run(agent, component, requirement);
      this.bump(agent);
    });
  }
  detachAgent(agent: string) {
    this.transaction(() => {
      this.connection()
        .prepare("DELETE FROM bindings WHERE agent=?")
        .run(agent);
      this.connection()
        .prepare("DELETE FROM qualifications WHERE agent=?")
        .run(agent);
      this.bump(agent);
    });
  }
  remove(id: string) {
    this.transaction(() => {
      const s = this.space(id);
      if (
        s.scope !== "shared" ||
        this.connection()
          .prepare("SELECT 1 FROM bindings WHERE resource=?")
          .get(id)
      )
        throw resourceFailure("NOT_AUTHORIZED");
      for (const q of this.qualifications().filter((q) => q.resourceId === id))
        this.bump(q.agentId);
      for (const table of ["qualifications", "entries", "commits"])
        this.connection()
          .prepare(`DELETE FROM ${table} WHERE resource=?`)
          .run(id);
      this.connection().prepare("DELETE FROM spaces WHERE id=?").run(id);
    });
  }
  read(id: string, key: string): ResourceSnapshot {
    const row = this.connection()
      .prepare("SELECT revision,body FROM entries WHERE resource=? AND key=?")
      .get(id, key);
    if (!row) return { exists: false, revision: "0" };
    return row.body === null
      ? { exists: false, revision: row.revision as string }
      : {
          exists: true,
          revision: row.revision as string,
          value: JSON.parse(row.body as string),
        };
  }
  /** Called only inside an IMMEDIATE transaction, following the final synchronous checkpoint. */
  mutate(
    id: string,
    key: string,
    expected: string,
    value: CommonJson | undefined,
    callId: string,
  ): { revision: string } {
    if (this.read(id, key).revision !== expected)
      throw resourceFailure("RESOURCE_CONFLICT");
    const revision = randomUUID();
    this.connection()
      .prepare(
        "INSERT INTO entries VALUES (?,?,?,?) ON CONFLICT(resource,key) DO UPDATE SET revision=excluded.revision,body=excluded.body",
      )
      .run(
        id,
        key,
        revision,
        value === undefined ? null : JSON.stringify(value),
      );
    this.connection()
      .prepare("INSERT INTO commits VALUES (?,?,?,?)")
      .run(callId, id, revision, value === undefined ? "delete" : "write");
    return { revision };
  }
}
