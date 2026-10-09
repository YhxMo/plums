import { createHash } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import type { Core, GrantInput } from "../src/index.js";

/** Frozen schema-6 fingerprint, independent of the current Grant implementation. */
export async function legacyGrantFingerprint(
  core: Core,
  dataDir: string,
  raw: GrantInput,
): Promise<string> {
  const value: GrantInput = {
    ownerId: raw.ownerId,
    engineId: raw.engineId,
    scope: {
      reads: [...raw.scope.reads].sort(),
      outputs: [...raw.scope.outputs].sort(),
      services: raw.scope.services
        .map((s) => ({
          packageId: s.packageId,
          permissionId: s.permissionId,
          operation: s.operation,
          binding: s.binding,
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    },
  };
  const installed = await core.listInstalled(),
    state = await core.localAuthorizationState(),
    local = state.grants.find(
      (g) => g.packageId === value.ownerId && g.engineId === value.engineId,
    )!;
  const trust = {
    instanceId: local.instanceId,
    packageId: local.packageId,
    engineId: local.engineId,
    installedAt: local.installedAt,
    permission: local.permission,
    grantedAt: local.grantedAt,
  };
  const db = new Database(path.join(dataDir, "plums.db"));
  try {
    const settingsRevision = (id: string) =>
      (
        db
          .prepare(
            "SELECT revision FROM settings_revisions WHERE package_id = ?",
          )
          .get(id) as { revision: number } | undefined
      )?.revision ?? 0;
    const scopes = [];
    for (const s of value.scope.services) {
      const consent = (await core.listBackgroundConsents(s.packageId)).find(
        (g) =>
          g.permissionId === s.permissionId &&
          g.binding === s.binding &&
          g.operation === s.operation,
      )!;
      scopes.push([
        s,
        installed.find((p) => p.id === s.packageId),
        (await core.getPackage(s.packageId)).manifest,
        await core.getConsent(s.packageId),
        settingsRevision(s.packageId),
        consent.fingerprint,
        consent.revision,
      ]);
    }
    const revision =
      (
        db
          .prepare("SELECT revision FROM engine_trust_revision WHERE id = 1")
          .get() as { revision: number } | undefined
      )?.revision ?? 0;
    return createHash("sha256")
      .update(
        JSON.stringify([
          local.instanceId,
          value,
          installed.find((p) => p.id === value.ownerId),
          (await core.getPackage(value.ownerId)).manifest,
          await core.getConsent(value.ownerId),
          settingsRevision(value.ownerId),
          trust,
          revision,
          scopes,
        ]),
      )
      .digest("hex");
  } finally {
    db.close();
  }
}
