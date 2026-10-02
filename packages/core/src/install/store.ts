import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Manifest, PackageKind, Permission, PermissionLevel } from "../package/types.js";

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
  /** Full permission items (`id`, `level`, `target`, `reason`), in manifest order. */
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
  manifest: string;
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
}

const SCHEMA_VERSION = 2;

const INSTALLED_SELECT = `
  SELECT p.id, p.kind, p.name, p.version, p.manifest, p.enabled, p.installed_at, p.enabled_at,
         EXISTS (SELECT 1 FROM consents c WHERE c.package_id = p.id) AS consented
  FROM packages p`;

/**
 * Install state and consent records, kept in `<dataDir>/plums.db`.
 * The file is opened on first use, so a core that never touches it writes nothing.
 */
export class InstallStore {
  private db: Database.Database | undefined;

  constructor(private readonly dataDir: string) {}

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  /** Opens the database now, so callers can fail before they write anything else. */
  open(): void {
    this.connection();
  }

  get(id: string): InstalledPackage | undefined {
    const row = this.connection().prepare(`${INSTALLED_SELECT} WHERE p.id = ?`).get(id) as
      | InstalledRow
      | undefined;
    return row === undefined ? undefined : toInstalled(row);
  }

  list(): InstalledPackage[] {
    const rows = this.connection().prepare(`${INSTALLED_SELECT} ORDER BY p.id`).all() as InstalledRow[];
    return rows.map(toInstalled);
  }

  /** The manifest as it was when the package was imported. */
  getManifest(id: string): Manifest | undefined {
    const row = this.connection().prepare("SELECT manifest FROM packages WHERE id = ?").get(id) as
      | { manifest: string }
      | undefined;
    return row === undefined ? undefined : (JSON.parse(row.manifest) as Manifest);
  }

  /**
   * Records a fresh install: not enabled, no consent.
   * An earlier record of the same id, and its consent, is dropped.
   * Tool approvals are not deleted here. Why: uninstall already removed them, and import
   * refuses an id that is still installed, so no approval row can be waiting.
   */
  recordInstall(manifest: Manifest): void {
    const db = this.connection();
    db.transaction(() => {
      db.prepare("DELETE FROM consents WHERE package_id = ?").run(manifest.id);
      db.prepare("DELETE FROM packages WHERE id = ?").run(manifest.id);
      db.prepare(
        `INSERT INTO packages (id, kind, name, version, manifest, enabled, installed_at, enabled_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, NULL)`,
      ).run(
        manifest.id,
        manifest.kind,
        manifest.name,
        manifest.version,
        JSON.stringify(manifest),
        new Date().toISOString(),
      );
    })();
  }

  /**
   * Swaps in the new manifest of an installed package in one transaction. The enabled
   * state and `installedAt` stay. A given consent record replaces the old one.
   */
  recordUpdate(manifest: Manifest, consent?: ConsentRecord): void {
    this.connection().transaction(() => {
      this.connection()
        .prepare("UPDATE packages SET kind = ?, name = ?, version = ?, manifest = ? WHERE id = ?")
        .run(manifest.kind, manifest.name, manifest.version, JSON.stringify(manifest), manifest.id);
      if (consent !== undefined) {
        this.saveConsent(consent);
      }
    })();
  }

  /** Saves the record, replacing an earlier one for the same package. */
  saveConsent(record: ConsentRecord): void {
    this.connection()
      .prepare(
        `INSERT OR REPLACE INTO consents (package_id, version, permissions, granted_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(record.packageId, record.version, JSON.stringify(record.permissions), record.grantedAt);
  }

  getConsent(id: string): ConsentRecord | undefined {
    const row = this.connection().prepare("SELECT * FROM consents WHERE package_id = ?").get(id) as
      | ConsentRow
      | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      packageId: row.package_id,
      version: row.version,
      permissions: JSON.parse(row.permissions) as Permission[],
      grantedAt: row.granted_at,
    };
  }

  setEnabled(id: string, enabled: boolean): void {
    const db = this.connection();
    if (enabled) {
      db.prepare("UPDATE packages SET enabled = 1, enabled_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        id,
      );
    } else {
      db.prepare("UPDATE packages SET enabled = 0 WHERE id = ?").run(id);
    }
  }

  /** Removes the install state, the consent record and the MCP tool approvals of one package. */
  remove(id: string): void {
    const db = this.connection();
    db.transaction(() => {
      db.prepare("DELETE FROM mcp_tools WHERE server_id = ?").run(id);
      db.prepare("DELETE FROM consents WHERE package_id = ?").run(id);
      db.prepare("DELETE FROM packages WHERE id = ?").run(id);
    })();
  }

  /** Approved MCP tools of one server (a connector id or `manual:<name>`), ordered by tool name. */
  listMcpApprovals(serverId: string): McpApproval[] {
    const rows = this.connection()
      .prepare("SELECT tool, fingerprint, level, approved_at FROM mcp_tools WHERE server_id = ? ORDER BY tool")
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
    const select = db.prepare(
      "SELECT tool, fingerprint, level, approved_at FROM mcp_tools WHERE server_id = ? ORDER BY tool",
    );
    const removeAll = db.prepare("DELETE FROM mcp_tools WHERE server_id = ?");
    return db.transaction(() => {
      const rows = (select.all(serverId) as McpApprovalRow[]).map((row) => ({
        tool: row.tool,
        fingerprint: row.fingerprint,
        level: row.level,
        approvedAt: row.approved_at,
      }));
      if (keep.length === 0) {
        removeAll.run(serverId);
      } else {
        const marks = keep.map(() => "?").join(", ");
        db.prepare(`DELETE FROM mcp_tools WHERE server_id = ? AND tool NOT IN (${marks})`).run(serverId, ...keep);
      }
      return rows;
    })();
  }

  /** Saves the approvals in one transaction. A tool that already has one is replaced. */
  saveMcpApprovals(serverId: string, approvals: McpApproval[]): void {
    const db = this.connection();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO mcp_tools (server_id, tool, fingerprint, level, approved_at) VALUES (?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      for (const a of approvals) {
        insert.run(serverId, a.tool, a.fingerprint, a.level, a.approvedAt);
      }
    })();
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
  if (current < SCHEMA_VERSION) {
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
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }
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
