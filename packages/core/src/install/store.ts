import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Manifest, PackageKind, Permission, PermissionLevel } from "../package/types.js";
import { secretKeys, secretRef } from "../secrets.js";

import type { BackgroundConsent } from "../capabilities/types.js";
export const DATABASE_FILE = "plums.db";

/** A package that is in the install list. */
export interface InstalledPackage {
  id: string;
  kind: PackageKind;
  name: string;
  version: string;
  enabled: boolean;
  /** ISO 8601 time of the import. */
  installedAt: string;
  /** ISO 8601 time of the last enable. `null` while the package has never been enabled. */
  enabledAt: string | null;
  /** True when a consent record exists for the package. */
  consented: boolean;
}

/**
 * What the user agreed to: the permission list exactly as the installed
 * manifest declares it, copied at the moment of consent.
 */
export interface ConsentRecord {
  packageId: string;
  version: string;
  formatVersion: Manifest["formatVersion"];
  /** Full permission declarations, including operations/cwdRoots and unknown fields. */
  permissions: Permission[];
  /** ISO 8601 time. */
  grantedAt: string;
}

/** What the user approved for one MCP tool: the fingerprint of its name, description, and inputSchema. */
export interface McpApproval {
  tool: string;
  /** SHA-256 hex of the name, description, and inputSchema at the moment of approval. */
  fingerprint: string;
  /** The level the user approved. For a connector it is the manifest permission's level. */
  level: PermissionLevel;
  /** ISO 8601 time. */
  approvedAt: string;
}

export interface McpApprovalV2 { tool: string; fingerprint: string; permissionId: string; approvedAt: string }

interface McpApprovalRow {
  tool: string;
  fingerprint: string;
  level: PermissionLevel;
  approved_at: string;
}

interface InstalledRow {
  id: string;
  kind: PackageKind;
  name: string;
  version: string;
  enabled: number;
  installed_at: string;
  enabled_at: string | null;
  consented: number;
}

interface ConsentRow {
  package_id: string;
  version: string;
  permissions: string;
  granted_at: string;
  format_version: Manifest["formatVersion"];
}

const SCHEMA_VERSION = 5;

const INSTALLED_SELECT = `
  SELECT p.id, p.kind, p.name, p.version, p.enabled, p.installed_at, p.enabled_at,
         EXISTS (SELECT 1 FROM consents c WHERE c.package_id = p.id) AS consented
  FROM packages p`;

/**
 * Install state and consent records, kept in `<dataDir>/plums.db`.
 * The file is opened on first use, so a core that never touches it writes nothing.
 */
export class InstallStore {
  private db: Database.Database | undefined;
  private readonly statements = new Map<string, Database.Statement>();

  constructor(private readonly dataDir: string) {}

  /** Changes on commits by another connection, including disable/re-enable ABA. */
  externalChangeVersion(): number {
    return this.connection().pragma("data_version", { simple: true }) as number;
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
    this.statements.clear();
  }

  /** Opens the database now, so callers can fail before they write anything else. */
  open(): void {
    this.connection();
  }

  get(id: string): InstalledPackage | undefined {
    const row = this.statement(`${INSTALLED_SELECT} WHERE p.id = ?`).get(id) as
      | InstalledRow
      | undefined;
    return row === undefined ? undefined : toInstalled(row);
  }

  list(): InstalledPackage[] {
    const rows = this.statement(`${INSTALLED_SELECT} ORDER BY p.id`).all() as InstalledRow[];
    return rows.map(toInstalled);
  }

  /** The manifest as it was when the package was imported. */
  getManifest(id: string): Manifest | undefined {
    const row = this.statement("SELECT manifest FROM packages WHERE id = ?").get(id) as
      | { manifest: string }
      | undefined;
    return row === undefined ? undefined : (JSON.parse(row.manifest) as Manifest);
  }

  /** Includes removed fields. Why: deletion can fail after an update changes the manifest. */
  getSecretRefs(id: string): string[] {
    const row = this.statement("SELECT secret_refs FROM packages WHERE id = ?").get(id) as
      | { secret_refs: string }
      | undefined;
    return row === undefined ? [] : JSON.parse(row.secret_refs) as string[];
  }

  /** All current and historical references, in the same order as list() then getSecretRefs(). */
  listSecretRefs(): string[] {
    const rows = this.statement("SELECT secret_refs FROM packages ORDER BY id").all() as { secret_refs: string }[];
    return rows.flatMap((row) => JSON.parse(row.secret_refs) as string[]);
  }

  /**
   * Records a fresh install: not enabled, no consent.
   * Why insert only: import already refuses an id that is still installed, so there is
   * no row to replace. Deleting first would wipe consent and the enabled flag.
   * Tool approvals are not touched. Why: uninstall already removed them, and import
   * refuses an id that is still installed, so no approval row can be waiting.
   */
  recordInstall(manifest: Manifest): void {
    this.statement(
      `INSERT INTO packages (id, kind, name, version, manifest, enabled, installed_at, enabled_at, secret_refs)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?)`,
    )
      .run(
        manifest.id,
        manifest.kind,
        manifest.name,
        manifest.version,
        JSON.stringify(manifest),
        new Date().toISOString(),
        JSON.stringify(secretKeys(manifest).map((key) => secretRef(manifest.id, key))),
      );
  }

  /**
   * Swaps in the new manifest of an installed package in one transaction. The enabled
   * state and `installedAt` stay. A given consent record replaces the old one.
   */
  recordUpdate(manifest: Manifest, consent?: ConsentRecord): void {
    this.connection().transaction(() => {
      // Why retain old refs in this transaction: once the manifest changes, it cannot tell
      // redaction or uninstall which removed values still need to be read or deleted.
      const refs = [...new Set([
        ...this.getSecretRefs(manifest.id),
        ...secretKeys(manifest).map((key) => secretRef(manifest.id, key)),
      ])];
      this.statement("UPDATE packages SET kind = ?, name = ?, version = ?, manifest = ?, secret_refs = ? WHERE id = ?")
        .run(manifest.kind, manifest.name, manifest.version, JSON.stringify(manifest), JSON.stringify(refs), manifest.id);
      this.statement("DELETE FROM mcp_tools_v2 WHERE server_id = ?").run(manifest.id);
      if (consent !== undefined) {
        this.saveConsent(consent);
      }
    })();
  }

  /** Saves the record, replacing an earlier one for the same package. */
  saveConsent(record: ConsentRecord): void {
    this.statement(
      `INSERT OR REPLACE INTO consents (package_id, version, permissions, granted_at, format_version)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .run(record.packageId, record.version, JSON.stringify(record.permissions), record.grantedAt, record.formatVersion);
  }

  getConsent(id: string): ConsentRecord | undefined {
    const row = this.statement("SELECT * FROM consents WHERE package_id = ?").get(id) as
      | ConsentRow
      | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      packageId: row.package_id,
      version: row.version,
      formatVersion: row.format_version,
      permissions: JSON.parse(row.permissions) as Permission[],
      grantedAt: row.granted_at,
    };
  }

  setEnabled(id: string, enabled: boolean): void {
    if (enabled) {
      this.statement("UPDATE packages SET enabled = 1, enabled_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        id,
      );
    } else {
      this.statement("UPDATE packages SET enabled = 0 WHERE id = ?").run(id);
    }
  }

  /** Removes the install state, the consent record and the MCP tool approvals of one package. */
  remove(id: string): void {
    const db = this.connection();
    db.transaction(() => {
      this.statement("DELETE FROM mcp_tools WHERE server_id = ?").run(id);
      this.statement("DELETE FROM mcp_tools_v2 WHERE server_id = ?").run(id);
      this.revokeBackgroundConsents(id);
      this.statement("DELETE FROM consents WHERE package_id = ?").run(id);
      this.statement("DELETE FROM packages WHERE id = ?").run(id);
    })();
  }

  /** Approved MCP tools of one server (a connector id or `manual:<name>`), ordered by tool name. */
  listMcpApprovals(serverId: string): McpApproval[] {
    const rows = this.statement("SELECT tool, fingerprint, level, approved_at FROM mcp_tools WHERE server_id = ? ORDER BY tool")
      .all(serverId) as McpApprovalRow[];
    return rows.map((r) => ({ tool: r.tool, fingerprint: r.fingerprint, level: r.level, approvedAt: r.approved_at }));
  }

  /**
   * Reads this server's approvals and deletes names that are not in `keep`, in one transaction.
   * Returns the rows from before the delete, so the caller compares against the same list it dropped.
   * An empty `keep` deletes every tool row for this server only. Package consent is another table.
   * Why one transaction: the drop and the list it was compared with commit together.
   * Why empty deletes: a tool that left the list must not keep a consent that returns with the name.
   */
  dropMcpApprovalsExcept(serverId: string, keep: readonly string[]): McpApproval[] {
    const db = this.connection();
    const removeAll = this.statement("DELETE FROM mcp_tools WHERE server_id = ?");
    return db.transaction(() => {
      const rows = this.listMcpApprovals(serverId);
      if (keep.length === 0) {
        removeAll.run(serverId);
      } else {
        const marks = keep.map(() => "?").join(", ");
        // Tool counts change the SQL text; keep these statements out of the fixed cache.
        db.prepare(`DELETE FROM mcp_tools WHERE server_id = ? AND tool NOT IN (${marks})`).run(serverId, ...keep);
      }
      return rows;
    })();
  }

  /** Saves the approvals in one transaction. A tool that already has one is replaced. */
  saveMcpApprovals(serverId: string, approvals: McpApproval[]): void {
    const db = this.connection();
    const insert = this.statement(
      `INSERT OR REPLACE INTO mcp_tools (server_id, tool, fingerprint, level, approved_at) VALUES (?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      for (const a of approvals) {
        insert.run(serverId, a.tool, a.fingerprint, a.level, a.approvedAt);
      }
    })();
  }

  listMcpV2(serverId: string): McpApprovalV2[] {
    return this.statement("SELECT tool, fingerprint, permission_id AS permissionId, approved_at AS approvedAt FROM mcp_tools_v2 WHERE server_id = ? ORDER BY tool").all(serverId) as McpApprovalV2[];
  }
  saveMcpV2(serverId: string, approvals: McpApprovalV2[]): void {
    const insert = this.statement("INSERT OR REPLACE INTO mcp_tools_v2 (server_id, tool, fingerprint, permission_id, approved_at) VALUES (?, ?, ?, ?, ?)");
    this.connection().transaction(() => { for (const a of approvals) insert.run(serverId, a.tool, a.fingerprint, a.permissionId, a.approvedAt); })();
  }
  checkMcpV2(serverId: string, tools: { name: string; fingerprint: string }[]): McpApprovalV2[] {
    return this.connection().transaction(() => {
      const rows = this.listMcpV2(serverId);
      for (const row of rows) {
        if (!tools.some((t) => t.name === row.tool && t.fingerprint === row.fingerprint)) {
          this.statement("DELETE FROM mcp_tools_v2 WHERE server_id = ? AND tool = ?").run(serverId, row.tool);
        }
      }
      return rows;
    })();
  }

  listBackgroundConsents(packageId?: string): BackgroundConsent[] {
    const rows = (packageId === undefined
      ? this.statement("SELECT record FROM background_consents ORDER BY grant_key").all()
      : this.statement("SELECT record FROM background_consents WHERE package_id = ? ORDER BY grant_key").all(packageId)) as { record: string }[];
    return rows.map((row) => JSON.parse(row.record) as BackgroundConsent);
  }

  settingsRevision(id: string): number {
    return (this.statement("SELECT revision FROM settings_revisions WHERE package_id = ?").get(id) as { revision: number } | undefined)?.revision ?? 0;
  }
  bumpSettingsRevision(id: string): void {
    this.statement("INSERT INTO settings_revisions (package_id, revision) VALUES (?, 1) ON CONFLICT(package_id) DO UPDATE SET revision = revision + 1").run(id);
  }
  saveBackgroundConsent(record: BackgroundConsent): void {
    const key = JSON.stringify([record.extensionId, record.permissionId, record.instanceId, record.operation, record.binding]);
    this.statement("INSERT OR REPLACE INTO background_consents (grant_key, package_id, record) VALUES (?, ?, ?)")
      .run(key, record.extensionId, JSON.stringify(record));
  }
  backgroundRevision(): number {
    return (this.statement("SELECT revision FROM background_revisions WHERE package_id = ''").get() as { revision: number } | undefined)?.revision ?? 0;
  }
  saveBackgroundConsentIfCurrent(record: BackgroundConsent, revision: number): boolean {
    return this.connection().transaction(() => {
      if (this.backgroundRevision() !== revision) return false;
      this.saveBackgroundConsent(record); return true;
    })();
  }
  revokeBackgroundConsents(packageId: string, binding?: string): void {
    this.connection().transaction(() => {
      // One monotonic revocation epoch prevents uninstall/reinstall from reviving pending grants,
      // without retaining a deleted package's identity as a database tombstone.
      this.statement("INSERT INTO background_revisions (package_id, revision) VALUES ('', 1) ON CONFLICT(package_id) DO UPDATE SET revision = revision + 1").run();
    if (binding === undefined) {
      this.statement("DELETE FROM background_consents WHERE package_id = ?").run(packageId);
    } else {
      const remove = this.statement("DELETE FROM background_consents WHERE grant_key = ?");
      this.connection().transaction(() => {
        for (const record of this.listBackgroundConsents(packageId)) if (record.binding === binding) {
          remove.run(JSON.stringify([record.extensionId, record.permissionId, record.instanceId, record.operation, record.binding]));
        }
      })();
    }
    })();
  }

  /** Fixed SQL only. Each execution still reads the database's current state. */
  private statement(sql: string): Database.Statement {
    const db = this.connection();
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  private connection(): Database.Database {
    if (this.db === undefined) {
      mkdirSync(this.dataDir, { recursive: true });
      const db = new Database(path.join(this.dataDir, DATABASE_FILE));
      try {
        // Overwrite deleted rows, so an uninstalled package id does not linger in the file.
        db.pragma("secure_delete = ON");
        migrate(db);
      } catch (err) {
        db.close();
        throw err;
      }
      this.db = db;
    }
    return this.db;
  }
}

function migrate(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `The data directory was written by a newer Plums (database version ${current}, this build reads ${SCHEMA_VERSION}).`,
    );
  }
    db.transaction(() => {
      if (current < 1) {
        db.exec(`
          CREATE TABLE packages (
            id           TEXT PRIMARY KEY,
            kind         TEXT NOT NULL,
            name         TEXT NOT NULL,
            version      TEXT NOT NULL,
            manifest     TEXT NOT NULL,
            enabled      INTEGER NOT NULL DEFAULT 0,
            installed_at TEXT NOT NULL,
            enabled_at   TEXT
          );
          CREATE TABLE consents (
            package_id  TEXT PRIMARY KEY,
            version     TEXT NOT NULL,
            permissions TEXT NOT NULL,
            granted_at  TEXT NOT NULL
          );
        `);
      }
      // Why a new table and not a column on consents: hand-added servers have no package row.
      if (current < 2) db.exec(`
        CREATE TABLE mcp_tools (
          server_id   TEXT NOT NULL,
          tool        TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          level       TEXT NOT NULL,
          approved_at TEXT NOT NULL,
          PRIMARY KEY (server_id, tool)
        );
      `);
      if (current < 3) {
        // Why refs rather than values: the SecretStore remains the only place for secret values.
        db.exec("ALTER TABLE packages ADD COLUMN secret_refs TEXT NOT NULL DEFAULT '[]'");
        const rows = db.prepare("SELECT id, manifest FROM packages").all() as { id: string; manifest: string }[];
        const save = db.prepare("UPDATE packages SET secret_refs = ? WHERE id = ?");
        for (const row of rows) {
          const manifest = JSON.parse(row.manifest) as Manifest;
          save.run(JSON.stringify(secretKeys(manifest).map((key) => secretRef(row.id, key))), row.id);
        }
      }
      if (current < 4) {
        // Keep the permissions JSON intact. Persist its format so old levels cannot consent to new capabilities.
        db.exec("ALTER TABLE consents ADD COLUMN format_version TEXT NOT NULL DEFAULT '1.0'");
        const rows = db.prepare("SELECT c.package_id, p.manifest FROM consents c JOIN packages p ON p.id = c.package_id")
          .all() as { package_id: string; manifest: string }[];
        const save = db.prepare("UPDATE consents SET format_version = ? WHERE package_id = ?");
        for (const row of rows) save.run((JSON.parse(row.manifest) as Manifest).formatVersion, row.package_id);
      }
      if (current < 5) db.exec(`
        CREATE TABLE mcp_tools_v2 (
          server_id TEXT NOT NULL, tool TEXT NOT NULL, fingerprint TEXT NOT NULL,
          permission_id TEXT NOT NULL, approved_at TEXT NOT NULL,
          PRIMARY KEY (server_id, tool)
        );
      `);
      // Additive service state leaves the public schema-5 records and legacy readers intact.
      db.exec("CREATE TABLE IF NOT EXISTS background_consents (grant_key TEXT PRIMARY KEY, package_id TEXT NOT NULL, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS background_revisions (package_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)");
      db.exec("CREATE TABLE IF NOT EXISTS settings_revisions (package_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)");
      if (current < SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
}

function toInstalled(row: InstalledRow): InstalledPackage {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    version: row.version,
    enabled: row.enabled === 1,
    installedAt: row.installed_at,
    enabledAt: row.enabled_at,
    consented: row.consented === 1,
  };
}
