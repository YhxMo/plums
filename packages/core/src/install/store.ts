import { enginePermissionKey, type EngineTrust } from "./engine-trust.js";
import { randomUUID } from "node:crypto";
import { isManifestV2 } from "../package/types.js";
import { validateEnginePermission } from "../package/engine-permission.js";
import {
  sandboxTier,
  type AgentTierRecord,
  type AgentLocalGrant,
  type LocalAuthorizationMigration,
  type LocalAuthorizationState,
  type LocalAuthorizationCommit,
} from "./local-authorization.js";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  Manifest,
  PackageKind,
  Permission,
  PermissionLevel,
} from "../package/types.js";
import { secretKeys, secretRef } from "../secrets.js";
import {
  lifecycleFailure,
  lifecycleOwnerAlive,
  parseLifecycleRecord,
  type InstallIdentity,
  type LifecycleLease,
  type LifecycleRecord,
} from "./lifecycle-state.js";

import type { Grant } from "../capabilities/grants.js";

import type { BackgroundConsent } from "../capabilities/types.js";
export const DATABASE_FILE = "plums.db";

interface SecretReferenceRow {
  id: string;
  secret_refs: string;
  local_record: string | null;
  reserved_refs: string | null;
}
function ownsLocalCredentialReference(
  packageId: string,
  value: unknown,
): value is string {
  const prefix = "secret:" + packageId + "/";
  return (
    typeof value === "string" &&
    value.startsWith(prefix) &&
    value.length > prefix.length &&
    !/[\0-\x1f\x7f]/.test(value)
  );
}
function localCredentialReferences(
  credential: AgentLocalGrant["credentials"][number],
): string[] {
  return [
    credential.secretRef,
    credential.valueRef,
    credential.usernameRef,
    credential.encodedValueRef,
    credential.encodedUsernameRef,
  ].filter((value): value is string => typeof value === "string");
}
function validLocalCredentialReferences(
  packageId: string,
  credential: AgentLocalGrant["credentials"][number],
): boolean {
  if (
    !ownsLocalCredentialReference(packageId, credential.secretRef) ||
    ["valueRef", "usernameRef", "encodedValueRef", "encodedUsernameRef"].some(
      (key) =>
        Object.hasOwn(credential, key) &&
        typeof credential[key as keyof typeof credential] !== "string",
    )
  )
    return false;
  if (
    Object.keys(credential).some(
      (key) =>
        ![
          "id",
          "kind",
          "host",
          "secretRef",
          "valueRef",
          "usernameRef",
          "encodedValueRef",
          "encodedUsernameRef",
        ].includes(key),
    )
  )
    return false;
  if (
    credential.valueRef === undefined &&
    ["usernameRef", "encodedValueRef", "encodedUsernameRef"].some((key) =>
      Object.hasOwn(credential, key),
    )
  )
    return false;
  if (
    credential.usernameRef !== undefined &&
    !["pip-index-auth", "git-https"].includes(credential.kind)
  )
    return false;
  if (
    credential.encodedUsernameRef !== undefined &&
    !["pip-index-auth", "git-https"].includes(credential.kind)
  )
    return false;
  if (
    credential.encodedUsernameRef !== undefined &&
    credential.usernameRef === undefined
  )
    return false;
  if (
    credential.valueRef !== undefined &&
    credential.kind === "git-https" &&
    credential.usernameRef === undefined
  )
    return false;
  const references = localCredentialReferences(credential);
  return (
    references.length > 0 &&
    new Set(references).size === references.length &&
    references.every((ref) => ownsLocalCredentialReference(packageId, ref))
  );
}
function collectSecretReferences(rows: SecretReferenceRow[]): string[] {
  const references = new Set<string>(),
    packages = new Set<string>();
  for (const row of rows) {
    if (!packages.has(row.id)) {
      packages.add(row.id);
      for (const reference of JSON.parse(row.secret_refs) as string[])
        references.add(reference);
    }
    for (const reference of JSON.parse(row.reserved_refs ?? "[]") as string[])
      if (ownsLocalCredentialReference(row.id, reference))
        references.add(reference);
    if (row.local_record) {
      const grant = JSON.parse(row.local_record) as AgentLocalGrant;
      for (const credential of grant.credentials ?? [])
        for (const reference of localCredentialReferences(credential))
          if (ownsLocalCredentialReference(row.id, reference))
            references.add(reference);
    }
  }
  return [...references];
}

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

export interface McpApprovalV2 {
  tool: string;
  fingerprint: string;
  permissionId: string;
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

// Older readers must not mutate packages without lifecycle ownership and recovery.
export const SCHEMA_VERSION = 9;

const INSTALLED_SELECT = `
  SELECT p.id, p.kind, p.name, p.version, p.enabled, p.installed_at, p.enabled_at,
         EXISTS (SELECT 1 FROM consents c WHERE c.package_id = p.id) AS consented,
         (SELECT COALESCE(owner, 'pending') FROM lifecycle_operations WHERE id = p.id) AS lifecycle_owner
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

  get(id: string, lifecycleOwner?: string): InstalledPackage | undefined {
    const row = this.statement(`${INSTALLED_SELECT} WHERE p.id = ?`).get(id) as
      | (InstalledRow & { lifecycle_owner: string | null })
      | undefined;
    if (row?.lifecycle_owner && row.lifecycle_owner !== lifecycleOwner)
      throw lifecycleFailure(id, "LIFECYCLE_BUSY");
    return row === undefined ? undefined : toInstalled(row);
  }

  installationIdentity(id: string): InstallIdentity | null {
    return (
      (this.statement(
        "SELECT installation_id AS installationId, version FROM packages WHERE id=?",
      ).get(id) as InstallIdentity | undefined) ?? null
    );
  }

  pendingLifecycles(): string[] {
    return (
      this.statement(
        "SELECT id FROM lifecycle_operations ORDER BY id",
      ).all() as { id: string }[]
    ).map((row) => row.id);
  }

  lifecycleKind(id: string): LifecycleRecord["kind"] | undefined {
    const row = this.statement(
      "SELECT record FROM lifecycle_operations WHERE id=?",
    ).get(id) as { record: string | null } | undefined;
    return row ? parseLifecycleRecord(id, row.record)?.kind : undefined;
  }

  acquireLifecycle(id: string): LifecycleLease {
    return this.connection()
      .transaction(() => {
        const row = this.statement(
          "SELECT pid, record FROM lifecycle_operations WHERE id=?",
        ).get(id) as { pid: number | null; record: string | null } | undefined;
        if (row && lifecycleOwnerAlive(row.pid))
          throw lifecycleFailure(id, "LIFECYCLE_BUSY");
        const record = row ? parseLifecycleRecord(id, row.record) : null;
        const owner = randomUUID();
        this.statement(
          "INSERT INTO lifecycle_operations(id,owner,pid,record) VALUES(?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,pid=excluded.pid",
        ).run(id, owner, process.pid);
        return { id, owner, record };
      })
      .immediate();
  }

  assertLifecycle(
    lease: LifecycleLease,
    expected?: InstallIdentity | null,
  ): void {
    const row = this.statement(
      "SELECT owner FROM lifecycle_operations WHERE id=?",
    ).get(lease.id) as { owner: string | null } | undefined;
    if (row?.owner !== lease.owner)
      throw lifecycleFailure(lease.id, "INSTALLATION_CHANGED");
    if (expected !== undefined) {
      const current = this.installationIdentity(lease.id);
      if (
        current?.installationId !== expected?.installationId ||
        current?.version !== expected?.version
      )
        throw lifecycleFailure(lease.id, "INSTALLATION_CHANGED");
    }
  }

  saveLifecycle(lease: LifecycleLease, record: LifecycleRecord | null): void {
    if (
      this.statement(
        "UPDATE lifecycle_operations SET record=? WHERE id=? AND owner=?",
      ).run(
        record === null ? null : JSON.stringify(record),
        lease.id,
        lease.owner,
      ).changes !== 1
    )
      throw lifecycleFailure(lease.id, "INSTALLATION_CHANGED");
    lease.record = record;
  }

  refreshLifecycle(lease: LifecycleLease): void {
    const row = this.statement(
      "SELECT owner,record FROM lifecycle_operations WHERE id=?",
    ).get(lease.id) as
      | { owner: string | null; record: string | null }
      | undefined;
    if (row?.owner !== lease.owner)
      throw lifecycleFailure(lease.id, "INSTALLATION_CHANGED");
    lease.record = parseLifecycleRecord(lease.id, row.record);
  }

  releaseLifecycle(lease: LifecycleLease): void {
    // Pending work survives normal exceptions as well as process termination.
    if (lease.record)
      this.statement(
        "UPDATE lifecycle_operations SET owner=NULL,pid=NULL WHERE id=? AND owner=?",
      ).run(lease.id, lease.owner);
    else
      this.statement(
        "DELETE FROM lifecycle_operations WHERE id=? AND owner=?",
      ).run(lease.id, lease.owner);
  }

  list(): InstalledPackage[] {
    const rows = this.statement(
      `${INSTALLED_SELECT} ORDER BY p.id`,
    ).all() as InstalledRow[];
    return rows.map(toInstalled);
  }

  listWithRecovery(): { installed: InstalledPackage[]; pending: string[] } {
    // Include orphaned uninstall journals in the same snapshot, without adding
    // a second SELECT to every steady-state installation list.
    const rows = this.statement(
      `SELECT p.*, NULL AS pending_id FROM (${INSTALLED_SELECT}) p
       UNION ALL
       SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,id FROM lifecycle_operations
       ORDER BY id`,
    ).all() as (InstalledRow & { pending_id: string | null })[];
    return {
      installed: rows.filter((row) => row.pending_id === null).map(toInstalled),
      pending: rows.flatMap((row) =>
        row.pending_id === null ? [] : [row.pending_id],
      ),
    };
  }

  /** The manifest as it was when the package was imported. */
  getManifest(id: string): Manifest | undefined {
    const row = this.statement(
      "SELECT manifest FROM packages WHERE id = ?",
    ).get(id) as { manifest: string } | undefined;
    return row === undefined
      ? undefined
      : (JSON.parse(row.manifest) as Manifest);
  }

  /** Includes removed fields. Why: deletion can fail after an update changes the manifest. */
  getSecretRefs(id: string): string[] {
    return collectSecretReferences(
      this.statement(
        "SELECT p.id,p.secret_refs,l.record AS local_record,NULL AS reserved_refs,0 AS source,l.instance_id,l.engine_id FROM packages p LEFT JOIN agent_local_grants l ON l.package_id=p.id WHERE p.id=? UNION ALL SELECT package_id AS id,'[]' AS secret_refs,NULL AS local_record,json_array(ref) AS reserved_refs,1 AS source,'' AS instance_id,ref AS engine_id FROM local_credential_reservations WHERE package_id=? ORDER BY source,instance_id,engine_id",
      ).all(id, id) as SecretReferenceRow[],
    );
  }

  /** One current-state query covers setting references and local credentials. */
  listSecretRefs(): string[] {
    return collectSecretReferences(
      this.statement(
        "SELECT p.id,p.secret_refs,l.record AS local_record,NULL AS reserved_refs,0 AS source,l.instance_id,l.engine_id FROM packages p LEFT JOIN agent_local_grants l ON l.package_id=p.id UNION ALL SELECT package_id AS id,'[]' AS secret_refs,NULL AS local_record,json_array(ref) AS reserved_refs,1 AS source,'' AS instance_id,ref AS engine_id FROM local_credential_reservations ORDER BY id,source,instance_id,engine_id",
      ).all() as SecretReferenceRow[],
    );
  }

  private retainSecretRefs(id: string, extra: readonly string[] = []): void {
    const references = [...new Set([...this.getSecretRefs(id), ...extra])];
    if (references.length)
      this.statement("UPDATE packages SET secret_refs=? WHERE id=?").run(
        JSON.stringify(references),
        id,
      );
  }

  /** Trusted-host bookkeeping only: reserves unique references before asynchronous value writes. */
  reserveLocalCredentialReferences(
    id: string,
    installedAt: string,
    references: readonly string[],
  ): boolean {
    return this.connection()
      .transaction(() => {
        if (
          this.get(id)?.installedAt !== installedAt ||
          references.length === 0 ||
          references.length > 80 ||
          new Set(references).size !== references.length ||
          references.some((ref) => !ownsLocalCredentialReference(id, ref))
        )
          return false;
        for (const ref of references) {
          const prior = this.statement(
            "SELECT package_id,installed_at FROM local_credential_reservations WHERE ref=?",
          ).get(ref) as
            | { package_id: string; installed_at: string }
            | undefined;
          if (
            prior &&
            (prior.package_id !== id || prior.installed_at !== installedAt)
          )
            return false;
        }
        this.retainSecretRefs(id, references);
        for (const ref of references)
          this.statement(
            "INSERT OR IGNORE INTO local_credential_reservations (ref,package_id,installed_at) VALUES (?,?,?)",
          ).run(ref, id, installedAt);
        return true;
      })
      .immediate();
  }

  /** Delete reservations only after value deletion or an atomically retained, committed grant. */
  releaseLocalCredentialReferences(
    id: string,
    installedAt: string,
    references: readonly string[],
  ): void {
    if (
      references.length > 80 ||
      references.some((ref) => !ownsLocalCredentialReference(id, ref))
    )
      throw new Error("Invalid local references");
    this.connection()
      .transaction(() => {
        for (const ref of references)
          this.statement(
            "DELETE FROM local_credential_reservations WHERE ref=? AND package_id=? AND installed_at=?",
          ).run(ref, id, installedAt);
      })
      .immediate();
  }

  activeLocalCredentialRefs(
    id: string,
    manifest: Manifest,
    owner?: string,
  ): string[] {
    if (!isManifestV2(manifest)) return [];
    const installed = this.get(id, owner),
      engines = manifest.permissions.filter((p) => p.kind === "engine");
    return [
      ...new Set(
        this.listLocalGrants(id).flatMap((grant) => {
          const declaration = engines.find((p) => p.target === grant.engineId);
          if (
            !installed ||
            grant.installedAt !== installed.installedAt ||
            !declaration ||
            grant.permission !== enginePermissionKey(declaration) ||
            grant.tier !== (declaration.tier ?? "machine")
          )
            return [];
          return grant.credentials
            .filter(
              (credential) =>
                validLocalCredentialReferences(id, credential) &&
                declaration.credentials?.some(
                  (d) =>
                    d.id === credential.id &&
                    d.kind === credential.kind &&
                    d.host === credential.host,
                ),
            )
            .flatMap(localCredentialReferences);
        }),
      ),
    ];
  }

  /**
   * Records a fresh install: not enabled, no consent.
   * Why insert only: import already refuses an id that is still installed, so there is
   * no row to replace. Deleting first would wipe consent and the enabled flag.
   * Tool approvals are not touched. Why: uninstall already removed them, and import
   * refuses an id that is still installed, so no approval row can be waiting.
   */
  recordInstall(manifest: Manifest, lease: LifecycleLease): void {
    this.connection()
      .transaction(() => {
        this.assertLifecycle(lease, null);
        this.statement(
          `INSERT INTO packages (id, kind, name, version, manifest, enabled, installed_at, enabled_at, secret_refs, installation_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
        ).run(
          manifest.id,
          manifest.kind,
          manifest.name,
          manifest.version,
          JSON.stringify(manifest),
          new Date().toISOString(),
          JSON.stringify(
            secretKeys(manifest).map((key) => secretRef(manifest.id, key)),
          ),
          lease.record!.token,
        );
        this.saveLifecycle(lease, { ...lease.record!, phase: "committed" });
      })
      .immediate();
  }

  /**
   * Swaps in the new manifest of an installed package in one transaction. The enabled
   * state and `installedAt` stay. A given consent record replaces the old one.
   */
  recordUpdate(
    manifest: Manifest,
    consent: ConsentRecord | undefined,
    lease: LifecycleLease,
  ): void {
    this.connection()
      .transaction(() => {
        this.assertLifecycle(lease, lease.record!.before);
        // Why retain old refs in this transaction: once the manifest changes, it cannot tell
        // redaction or uninstall which removed values still need to be read or deleted.
        const refs = [
          ...new Set([
            ...this.getSecretRefs(manifest.id),
            ...secretKeys(manifest).map((key) => secretRef(manifest.id, key)),
          ]),
        ];
        const changed = this.statement(
          "UPDATE packages SET kind = ?, name = ?, version = ?, manifest = ?, secret_refs = ? WHERE id = ? AND installation_id = ? AND version = ?",
        ).run(
          manifest.kind,
          manifest.name,
          manifest.version,
          JSON.stringify(manifest),
          JSON.stringify(refs),
          manifest.id,
          lease.record!.before!.installationId,
          lease.record!.before!.version,
        );
        if (changed.changes !== 1)
          throw lifecycleFailure(manifest.id, "INSTALLATION_CHANGED");
        this.statement("DELETE FROM mcp_tools_v2 WHERE server_id = ?").run(
          manifest.id,
        );
        this.invalidatePendingEngineTrust();
        for (const trust of this.listLocalGrants(manifest.id)) {
          const permission = manifest.permissions.find(
            (p) =>
              "kind" in p && p.kind === "engine" && p.target === trust.engineId,
          );
          if (
            !permission ||
            enginePermissionKey(permission) !== trust.permission ||
            !("kind" in permission) ||
            permission.kind !== "engine" ||
            trust.tier !== (permission.tier ?? "machine")
          )
            this.removeEngineTrust(manifest.id, trust.engineId);
        }
        if (consent !== undefined) {
          this.saveConsent(consent);
        }
        this.saveLifecycle(lease, { ...lease.record!, phase: "committed" });
      })
      .immediate();
  }

  /** Saves the record, replacing an earlier one for the same package. */
  saveConsent(record: ConsentRecord): void {
    this.statement(
      `INSERT OR REPLACE INTO consents (package_id, version, permissions, granted_at, format_version)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      record.packageId,
      record.version,
      JSON.stringify(record.permissions),
      record.grantedAt,
      record.formatVersion,
    );
  }

  getConsent(id: string): ConsentRecord | undefined {
    const row = this.statement(
      "SELECT * FROM consents WHERE package_id = ?",
    ).get(id) as ConsentRow | undefined;
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
    this.bumpSettingsRevision(id);
    if (enabled) {
      this.statement(
        "UPDATE packages SET enabled = 1, enabled_at = ? WHERE id = ?",
      ).run(new Date().toISOString(), id);
    } else {
      this.statement("UPDATE packages SET enabled = 0 WHERE id = ?").run(id);
    }
  }

  /** Removes the install state, the consent record and the MCP tool approvals of one package. */
  remove(
    id: string,
    lease?: LifecycleLease,
    expected = lease?.record?.before,
  ): void {
    const db = this.connection();
    db.transaction(() => {
      if (lease) this.assertLifecycle(lease, expected);
      this.statement("DELETE FROM mcp_tools WHERE server_id = ?").run(id);
      this.statement("DELETE FROM mcp_tools_v2 WHERE server_id = ?").run(id);
      this.revokeBackgroundConsents(id);
      this.removeEngineTrust(id);
      this.statement("DELETE FROM settings_revisions WHERE package_id = ?").run(
        id,
      );
      this.statement("DELETE FROM consents WHERE package_id = ?").run(id);
      this.statement("DELETE FROM packages WHERE id = ?").run(id);
      if (lease)
        this.saveLifecycle(lease, {
          ...lease.record!,
          phase: lease.record!.kind === "import" ? "aborting" : "committed",
        });
    }).immediate();
  }

  /** Approved MCP tools of one server (a connector id or `manual:<name>`), ordered by tool name. */
  listMcpApprovals(serverId: string): McpApproval[] {
    const rows = this.statement(
      "SELECT tool, fingerprint, level, approved_at FROM mcp_tools WHERE server_id = ? ORDER BY tool",
    ).all(serverId) as McpApprovalRow[];
    return rows.map((r) => ({
      tool: r.tool,
      fingerprint: r.fingerprint,
      level: r.level,
      approvedAt: r.approved_at,
    }));
  }

  /**
   * Reads this server's approvals and deletes names that are not in `keep`, in one transaction.
   * Returns the rows from before the delete, so the caller compares against the same list it dropped.
   * An empty `keep` deletes every tool row for this server only. Package consent is another table.
   * Why one transaction: the drop and the list it was compared with commit together.
   * Why empty deletes: a tool that left the list must not keep a consent that returns with the name.
   */
  dropMcpApprovalsExcept(
    serverId: string,
    keep: readonly string[],
  ): McpApproval[] {
    const db = this.connection();
    const removeAll = this.statement(
      "DELETE FROM mcp_tools WHERE server_id = ?",
    );
    return db.transaction(() => {
      const rows = this.listMcpApprovals(serverId);
      if (keep.length === 0) {
        removeAll.run(serverId);
      } else {
        const marks = keep.map(() => "?").join(", ");
        // Tool counts change the SQL text; keep these statements out of the fixed cache.
        db.prepare(
          `DELETE FROM mcp_tools WHERE server_id = ? AND tool NOT IN (${marks})`,
        ).run(serverId, ...keep);
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
    return this.statement(
      "SELECT tool, fingerprint, permission_id AS permissionId, approved_at AS approvedAt FROM mcp_tools_v2 WHERE server_id = ? ORDER BY tool",
    ).all(serverId) as McpApprovalV2[];
  }
  saveMcpV2(serverId: string, approvals: McpApprovalV2[]): void {
    const insert = this.statement(
      "INSERT OR REPLACE INTO mcp_tools_v2 (server_id, tool, fingerprint, permission_id, approved_at) VALUES (?, ?, ?, ?, ?)",
    );
    this.connection().transaction(() => {
      for (const a of approvals)
        insert.run(
          serverId,
          a.tool,
          a.fingerprint,
          a.permissionId,
          a.approvedAt,
        );
    })();
  }
  checkMcpV2(
    serverId: string,
    tools: { name: string; fingerprint: string }[],
  ): McpApprovalV2[] {
    return this.connection().transaction(() => {
      const rows = this.listMcpV2(serverId);
      for (const row of rows) {
        if (
          !tools.some(
            (t) => t.name === row.tool && t.fingerprint === row.fingerprint,
          )
        ) {
          this.statement(
            "DELETE FROM mcp_tools_v2 WHERE server_id = ? AND tool = ?",
          ).run(serverId, row.tool);
        }
      }
      return rows;
    })();
  }

  listBackgroundConsents(packageId?: string): BackgroundConsent[] {
    const rows = (
      packageId === undefined
        ? this.statement(
            "SELECT record FROM background_consents ORDER BY grant_key",
          ).all()
        : this.statement(
            "SELECT record FROM background_consents WHERE package_id = ? ORDER BY grant_key",
          ).all(packageId)
    ) as { record: string }[];
    return rows.map((row) => JSON.parse(row.record) as BackgroundConsent);
  }

  listGrants(ownerId?: string): Grant[] {
    const rows = (
      ownerId === undefined
        ? this.statement(
            "SELECT record FROM authority_grants ORDER BY id",
          ).all()
        : this.statement(
            "SELECT record FROM authority_grants WHERE owner_id = ? ORDER BY id",
          ).all(ownerId)
    ) as { record: string }[];
    return rows.map((r) => JSON.parse(r.record) as Grant);
  }
  grantRevision(): number {
    return (
      (
        this.statement(
          "SELECT revision FROM authority_grant_revision WHERE id = 1",
        ).get() as { revision: number } | undefined
      )?.revision ?? 0
    );
  }
  /** Only the selected entry participates; unrelated local confirmations cannot invalidate a Grant. */
  engineGrantAuthorization(
    instanceId: string,
    packageId: string,
    engineId: string,
  ): string | undefined {
    if (
      !this.listEngineTrust(packageId).some(
        (g) => g.instanceId === instanceId && g.engineId === engineId,
      )
    )
      return undefined;
    const grant = this.listLocalGrants(packageId).find(
      (g) => g.instanceId === instanceId && g.engineId === engineId,
    );
    return grant ? enginePermissionKey(grant) : undefined;
  }
  /** Frozen compatibility anchors never alter the original finite Grant record. */
  legacyGrantBinding(
    id: string,
    fingerprint: string,
  ): { revision: number; authorization: string } | undefined {
    return this.statement(
      "SELECT revision,authorization FROM authority_grant_legacy WHERE grant_id = ? AND fingerprint = ?",
    ).get(id, fingerprint) as
      | { revision: number; authorization: string }
      | undefined;
  }
  saveGrantIfCurrent(
    grant: Grant,
    revision: number,
    authorization: string | undefined,
  ): boolean {
    return this.connection()
      .transaction(() => {
        if (
          this.grantRevision() !== revision ||
          !authorization ||
          this.engineGrantAuthorization(
            grant.instanceId,
            grant.ownerId,
            grant.engineId,
          ) !== authorization
        )
          return false;
        this.statement(
          "INSERT INTO authority_grants (id, owner_id, record) VALUES (?,?,?)",
        ).run(grant.id, grant.ownerId, JSON.stringify(grant));
        return true;
      })
      .immediate();
  }
  revokeGrant(id: string): void {
    this.connection().transaction(() => {
      this.statement(
        "INSERT INTO authority_grant_revision (id,revision) VALUES (1,1) ON CONFLICT(id) DO UPDATE SET revision = revision + 1",
      ).run();
      const grant = this.listGrants().find((g) => g.id === id);
      if (grant && !grant.revokedAt) {
        grant.revokedAt = new Date().toISOString();
        this.statement(
          "UPDATE authority_grants SET record = ? WHERE id = ?",
        ).run(JSON.stringify(grant), id);
      }
    })();
  }

  /** Compatibility view over effective machine grants; the schema-6 archive is read-only. */
  listEngineTrust(packageId: string): EngineTrust[] {
    return this.listLocalGrants(packageId)
      .filter(
        (r) =>
          r.tier === "machine" &&
          this.agentTier(r.instanceId).ceiling === "machine" &&
          (r.source !== "engine-trust" ||
            this.localMigration(r.instanceId)?.audited === true),
      )
      .map(
        ({
          instanceId,
          packageId,
          engineId,
          installedAt,
          permission,
          grantedAt,
        }) => ({
          instanceId,
          packageId,
          engineId,
          installedAt,
          permission,
          grantedAt,
        }),
      );
  }
  listLocalGrants(packageId?: string): AgentLocalGrant[] {
    return (
      (packageId === undefined
        ? this.statement(
            "SELECT record FROM agent_local_grants ORDER BY instance_id,package_id,engine_id",
          ).all()
        : this.statement(
            "SELECT record FROM agent_local_grants WHERE package_id = ? ORDER BY instance_id,engine_id",
          ).all(packageId)) as { record: string }[]
    ).map((r) => JSON.parse(r.record));
  }
  localMigration(instanceId: string): LocalAuthorizationMigration | undefined {
    const row = this.statement(
      "SELECT record FROM local_authorization_migrations WHERE instance_id = ?",
    ).get(instanceId) as { record: string } | undefined;
    return row ? JSON.parse(row.record) : undefined;
  }
  acknowledgeLocalMigration(instanceId: string, callId: string): void {
    this.connection()
      .transaction(() => {
        const report = this.localMigration(instanceId);
        if (report && report.callId === callId && !report.audited) {
          report.audited = true;
          this.statement(
            "UPDATE local_authorization_migrations SET record = ? WHERE instance_id = ?",
          ).run(JSON.stringify(report), instanceId);
        }
      })
      .immediate();
  }
  private agentTier(instanceId: string): AgentTierRecord {
    const row = this.statement(
      "SELECT record FROM agent_tier WHERE instance_id = ?",
    ).get(instanceId) as { record: string } | undefined;
    return row ? JSON.parse(row.record) : sandboxTier(instanceId);
  }
  localAuthorizationState(instanceId: string): LocalAuthorizationState {
    const rows = this.statement(
      "SELECT record FROM agent_local_grants WHERE instance_id = ? ORDER BY package_id,engine_id",
    ).all(instanceId) as { record: string }[];
    return {
      tier: this.agentTier(instanceId),
      grants: rows.map((r) => JSON.parse(r.record)),
      revision: this.engineTrustRevision(),
      migration: this.localMigration(instanceId),
    };
  }
  engineTrustRevision(): number {
    return (
      (
        this.statement(
          "SELECT revision FROM engine_trust_revision WHERE id = 1",
        ).get() as { revision: number } | undefined
      )?.revision ?? 0
    );
  }
  commitLocalAuthorization(input: LocalAuthorizationCommit): boolean {
    return this.connection()
      .transaction(() => {
        if (input.revision !== this.engineTrustRevision()) return false;
        const assembly = this.list().map((p) => ({
          packageId: p.id,
          installedAt: p.installedAt,
          permissions: enginePermissionKey(this.getManifest(p.id)!.permissions),
        }));
        const sameAssembly = (a: typeof assembly, b: typeof assembly) =>
          enginePermissionKey(
            [...a].sort((x, y) => x.packageId.localeCompare(y.packageId)),
          ) ===
          enginePermissionKey(
            [...b].sort((x, y) => x.packageId.localeCompare(y.packageId)),
          );
        if (!sameAssembly(assembly, input.assembly)) return false;
        const levels = { sandbox: 0, project: 1, machine: 2 };
        if (
          !Object.hasOwn(levels, input.tier.ceiling) ||
          input.tier.components.some(
            (c) =>
              !assembly.some(
                (p) => enginePermissionKey(p) === enginePermissionKey(c),
              ),
          )
        )
          return false;
        const keys = new Set<string>();
        for (const grant of input.grants) {
          const manifest = this.getManifest(grant.packageId),
            installed = this.get(grant.packageId);
          if (
            !manifest ||
            !isManifestV2(manifest) ||
            installed?.installedAt !== grant.installedAt ||
            grant.instanceId !== input.tier.instanceId
          )
            return false;
          const engines = manifest.permissions.filter(
            (p) => p.kind === "engine",
          );
          const declaration = engines.find((p) => p.target === grant.engineId);
          const tier = declaration?.tier ?? "machine";
          if (
            !declaration ||
            grant.permission !== enginePermissionKey(declaration) ||
            grant.tier !== tier ||
            levels[tier] > levels[input.tier.ceiling] ||
            (tier === "project" && input.tier.projects.length === 0) ||
            new Set(grant.hosts).size !== grant.hosts.length ||
            grant.hosts.some((h) => !declaration.network?.hosts.includes(h)) ||
            grant.toolchains.some(
              (t) => !declaration.toolchains?.includes(t.name),
            ) ||
            new Set(grant.credentials.map((c) => c.id)).size !==
              grant.credentials.length ||
            grant.credentials.some(
              (c) =>
                !validLocalCredentialReferences(grant.packageId, c) ||
                !grant.hosts.includes(c.host) ||
                !declaration.credentials?.some(
                  (d) =>
                    d.id === c.id && d.kind === c.kind && d.host === c.host,
                ),
            )
          )
            return false;
          const key = JSON.stringify([grant.packageId, grant.engineId]);
          if (keys.has(key)) return false;
          keys.add(key);
        }
        const priorPackages = this.listLocalGrants()
          .filter((grant) => grant.instanceId === input.tier.instanceId)
          .map((grant) => grant.packageId);
        for (const id of new Set([
          ...priorPackages,
          ...input.grants.map((grant) => grant.packageId),
        ]))
          this.retainSecretRefs(
            id,
            input.grants
              .filter((grant) => grant.packageId === id)
              .flatMap((grant) =>
                grant.credentials.flatMap(localCredentialReferences),
              ),
          );
        this.statement(
          "INSERT OR REPLACE INTO agent_tier (instance_id,record) VALUES (?,?)",
        ).run(input.tier.instanceId, JSON.stringify(input.tier));
        this.statement(
          "DELETE FROM agent_local_grants WHERE instance_id = ?",
        ).run(input.tier.instanceId);
        for (const grant of input.grants)
          this.statement(
            "INSERT INTO agent_local_grants (instance_id,package_id,engine_id,record) VALUES (?,?,?,?)",
          ).run(
            grant.instanceId,
            grant.packageId,
            grant.engineId,
            JSON.stringify(grant),
          );
        this.invalidatePendingEngineTrust();
        return true;
      })
      .immediate();
  }
  invalidatePendingEngineTrust(): void {
    this.statement(
      "INSERT INTO engine_trust_revision (id,revision) VALUES (1,1) ON CONFLICT(id) DO UPDATE SET revision = revision + 1",
    ).run();
  }
  removeEngineTrust(
    packageId: string,
    engineId?: string,
    instanceId?: string,
  ): void {
    this.connection().transaction(() => {
      this.retainSecretRefs(packageId);
      this.invalidatePendingEngineTrust();
      if (instanceId !== undefined) {
        if (engineId === undefined)
          this.statement(
            "DELETE FROM agent_local_grants WHERE instance_id = ? AND package_id = ?",
          ).run(instanceId, packageId);
        else
          this.statement(
            "DELETE FROM agent_local_grants WHERE instance_id = ? AND package_id = ? AND engine_id = ?",
          ).run(instanceId, packageId, engineId);
      } else if (engineId === undefined)
        this.statement(
          "DELETE FROM agent_local_grants WHERE package_id = ?",
        ).run(packageId);
      else
        this.statement(
          "DELETE FROM agent_local_grants WHERE package_id = ? AND engine_id = ?",
        ).run(packageId, engineId);
    })();
  }

  settingsRevision(id: string): number {
    return (
      (
        this.statement(
          "SELECT revision FROM settings_revisions WHERE package_id = ?",
        ).get(id) as { revision: number } | undefined
      )?.revision ?? 0
    );
  }
  bumpSettingsRevision(id: string): void {
    this.statement(
      "INSERT INTO settings_revisions (package_id, revision) VALUES (?, 1) ON CONFLICT(package_id) DO UPDATE SET revision = revision + 1",
    ).run(id);
  }
  saveBackgroundConsent(record: BackgroundConsent): void {
    const key = JSON.stringify([
      record.extensionId,
      record.permissionId,
      record.instanceId,
      record.operation,
      record.binding,
    ]);
    this.statement(
      "INSERT OR REPLACE INTO background_consents (grant_key, package_id, record) VALUES (?, ?, ?)",
    ).run(key, record.extensionId, JSON.stringify(record));
  }
  backgroundRevision(): number {
    return (
      (
        this.statement(
          "SELECT revision FROM background_revisions WHERE package_id = ''",
        ).get() as { revision: number } | undefined
      )?.revision ?? 0
    );
  }
  saveBackgroundConsentIfCurrent(
    record: BackgroundConsent,
    revision: number,
  ): boolean {
    return this.connection().transaction(() => {
      if (this.backgroundRevision() !== revision) return false;
      this.saveBackgroundConsent(record);
      return true;
    })();
  }
  revokeBackgroundConsents(packageId: string, binding?: string): void {
    this.connection().transaction(() => {
      // One monotonic revocation epoch prevents uninstall/reinstall from reviving pending grants,
      // without retaining a deleted package's identity as a database tombstone.
      this.statement(
        "INSERT INTO background_revisions (package_id, revision) VALUES ('', 1) ON CONFLICT(package_id) DO UPDATE SET revision = revision + 1",
      ).run();
      if (binding === undefined) {
        this.statement(
          "DELETE FROM background_consents WHERE package_id = ?",
        ).run(packageId);
      } else {
        const remove = this.statement(
          "DELETE FROM background_consents WHERE grant_key = ?",
        );
        this.connection().transaction(() => {
          for (const record of this.listBackgroundConsents(packageId))
            if (record.binding === binding) {
              remove.run(
                JSON.stringify([
                  record.extensionId,
                  record.permissionId,
                  record.instanceId,
                  record.operation,
                  record.binding,
                ]),
              );
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
  db.transaction(() => {
    // Read the version after taking the writer lock. A second opener must never
    // replay archived trust after another process has migrated and revoked it.
    const current = db.pragma("user_version", { simple: true }) as number;
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `The data directory was written by a newer Plums (database version ${current}, this build reads ${SCHEMA_VERSION}).`,
      );
    }
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
    if (current < 2)
      db.exec(`
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
      db.exec(
        "ALTER TABLE packages ADD COLUMN secret_refs TEXT NOT NULL DEFAULT '[]'",
      );
      const rows = db.prepare("SELECT id, manifest FROM packages").all() as {
        id: string;
        manifest: string;
      }[];
      const save = db.prepare(
        "UPDATE packages SET secret_refs = ? WHERE id = ?",
      );
      for (const row of rows) {
        const manifest = JSON.parse(row.manifest) as Manifest;
        save.run(
          JSON.stringify(
            secretKeys(manifest).map((key) => secretRef(row.id, key)),
          ),
          row.id,
        );
      }
    }
    if (current < 4) {
      // Keep the permissions JSON intact. Persist its format so old levels cannot consent to new capabilities.
      db.exec(
        "ALTER TABLE consents ADD COLUMN format_version TEXT NOT NULL DEFAULT '1.0'",
      );
      const rows = db
        .prepare(
          "SELECT c.package_id, p.manifest FROM consents c JOIN packages p ON p.id = c.package_id",
        )
        .all() as { package_id: string; manifest: string }[];
      const save = db.prepare(
        "UPDATE consents SET format_version = ? WHERE package_id = ?",
      );
      for (const row of rows)
        save.run(
          (JSON.parse(row.manifest) as Manifest).formatVersion,
          row.package_id,
        );
    }
    if (current < 5)
      db.exec(`
        CREATE TABLE mcp_tools_v2 (
          server_id TEXT NOT NULL, tool TEXT NOT NULL, fingerprint TEXT NOT NULL,
          permission_id TEXT NOT NULL, approved_at TEXT NOT NULL,
          PRIMARY KEY (server_id, tool)
        );
      `);
    // Additive service state leaves the public schema-5 records and legacy readers intact.
    db.exec(
      "CREATE TABLE IF NOT EXISTS background_consents (grant_key TEXT PRIMARY KEY, package_id TEXT NOT NULL, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS background_revisions (package_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS settings_revisions (package_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS engine_trust (package_id TEXT NOT NULL, engine_id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(package_id,engine_id)); CREATE TABLE IF NOT EXISTS engine_trust_revision (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL)",
    );
    if (current < 6)
      db.exec(
        "CREATE TABLE IF NOT EXISTS authority_grants (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS authority_grant_revision (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL)",
      );
    // Pending values outlive package removal until the trusted host confirms deletion.
    db.exec(
      "CREATE TABLE IF NOT EXISTS local_credential_reservations (ref TEXT PRIMARY KEY,package_id TEXT NOT NULL,installed_at TEXT NOT NULL)",
    );
    if (current < 7) migrateLocalAuthorization(db);
    if (current < 9) {
      // Some migration fixtures retain newer additive columns while lowering user_version.
      const columns = db.pragma("table_info(packages)") as { name: string }[];
      if (!columns.some((column) => column.name === "installation_id"))
        db.exec(
          "ALTER TABLE packages ADD COLUMN installation_id TEXT NOT NULL DEFAULT ''",
        );
      const assign = db.prepare(
        "UPDATE packages SET installation_id=? WHERE id=?",
      );
      for (const row of db
        .prepare("SELECT id FROM packages WHERE installation_id=''")
        .all() as { id: string }[])
        assign.run(randomUUID(), row.id);
      db.exec(
        "CREATE TABLE IF NOT EXISTS lifecycle_operations(id TEXT PRIMARY KEY,owner TEXT,pid INTEGER,record TEXT)",
      );
    }
    migrateLegacyGrants(db);
    if (current < SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }).immediate();
}

/** Capture the old global revision once, and pin each old Grant to its own current entry. */
function migrateLegacyGrants(db: Database.Database): void {
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'authority_grant_legacy'",
      )
      .get()
  )
    return;
  db.exec(
    "CREATE TABLE authority_grant_legacy (grant_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, authorization TEXT NOT NULL)",
  );
  const revision =
    (
      db
        .prepare("SELECT revision FROM engine_trust_revision WHERE id = 1")
        .get() as { revision: number } | undefined
    )?.revision ?? 0;
  const rows = db
    .prepare(
      "SELECT a.id,a.record AS finite_grant,l.record AS local_grant FROM authority_grants a JOIN agent_local_grants l ON l.package_id = a.owner_id",
    )
    .all() as { id: string; finite_grant: string; local_grant: string }[];
  const insert = db.prepare(
    "INSERT INTO authority_grant_legacy (grant_id,fingerprint,revision,authorization) VALUES (?,?,?,?)",
  );
  for (const row of rows) {
    const grant = JSON.parse(row.finite_grant) as Grant,
      local = JSON.parse(row.local_grant) as AgentLocalGrant;
    if (
      grant.instanceId === local.instanceId &&
      grant.ownerId === local.packageId &&
      grant.engineId === local.engineId
    )
      insert.run(
        row.id,
        grant.fingerprint,
        revision,
        enginePermissionKey(local),
      );
  }
}

/** Schema-6 trust is copied only to its own matching machine entry, never to component coverage. */
function migrateLocalAuthorization(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tier (instance_id TEXT PRIMARY KEY, record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_local_grants (instance_id TEXT NOT NULL, package_id TEXT NOT NULL, engine_id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(instance_id,package_id,engine_id));
    CREATE TABLE IF NOT EXISTS local_authorization_migrations (instance_id TEXT PRIMARY KEY, record TEXT NOT NULL);
  `);
  const reports = new Map<string, LocalAuthorizationMigration>();
  const rows = db
    .prepare(
      "SELECT t.package_id,t.engine_id,t.record,p.manifest,p.installed_at FROM engine_trust t LEFT JOIN packages p ON p.id=t.package_id",
    )
    .all() as {
    package_id: string;
    engine_id: string;
    record: string;
    manifest: string | null;
    installed_at: string | null;
  }[];
  const saveGrant = db.prepare(
    "INSERT OR IGNORE INTO agent_local_grants (instance_id,package_id,engine_id,record) VALUES (?,?,?,?)",
  );
  const saveTier = db.prepare(
    "INSERT OR IGNORE INTO agent_tier (instance_id,record) VALUES (?,?)",
  );
  for (const row of rows) {
    let trust: EngineTrust;
    try {
      trust = JSON.parse(row.record);
    } catch {
      continue;
    }
    if (!trust || typeof trust.instanceId !== "string" || !trust.instanceId)
      continue;
    let report = reports.get(trust.instanceId);
    if (!report) {
      report = {
        instanceId: trust.instanceId,
        callId: randomUUID(),
        timestamp: new Date().toISOString(),
        migrated: 0,
        skipped: 0,
        audited: false,
      };
      reports.set(trust.instanceId, report);
    }
    let permission;
    try {
      const manifest = JSON.parse(row.manifest ?? "null") as Manifest | null;
      if (!manifest || !isManifestV2(manifest))
        throw new Error("Not a 2.x declaration");
      permission = validateEnginePermission(
        manifest?.permissions.find(
          (p) =>
            "kind" in p && p.kind === "engine" && p.target === row.engine_id,
        ),
      );
    } catch {
      /* Invalid or removed declarations cannot become local authority. */
    }
    if (
      !permission ||
      (permission.tier ?? "machine") !== "machine" ||
      trust.packageId !== row.package_id ||
      trust.engineId !== row.engine_id ||
      trust.installedAt !== row.installed_at ||
      typeof trust.grantedAt !== "string" ||
      trust.permission !== enginePermissionKey(permission)
    ) {
      report.skipped++;
      continue;
    }
    const grant: AgentLocalGrant = {
      ...trust,
      tier: "machine",
      hosts: [],
      toolchains: [],
      configuration: [],
      credentials: [],
      source: "engine-trust",
    };
    saveGrant.run(
      trust.instanceId,
      trust.packageId,
      trust.engineId,
      JSON.stringify(grant),
    );
    const tier: AgentTierRecord = {
      ...sandboxTier(trust.instanceId),
      ceiling: "machine",
    };
    saveTier.run(trust.instanceId, JSON.stringify(tier));
    report.migrated++;
  }
  const saveReport = db.prepare(
    "INSERT OR IGNORE INTO local_authorization_migrations (instance_id,record) VALUES (?,?)",
  );
  for (const report of reports.values())
    saveReport.run(report.instanceId, JSON.stringify(report));
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
