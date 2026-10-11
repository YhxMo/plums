import { rename } from "node:fs/promises";
import semver from "semver";
import {
  CONSENT_REQUIRED,
  DEPENDENCY_MISSING,
  IMPORT_INVALID,
  PERMISSION_DENIED,
  PlumsError,
} from "../errors.js";
import { acceptResidualSettings } from "./check-settings.js";
import { publishStaged, stagePackage } from "../package/install.js";
import {
  isManifestV1,
  type Dependency,
  type Manifest,
  type ManifestV1,
  type Permission,
  type PermissionV1,
  type PermissionV2,
  type PermissionLevel,
} from "../package/types.js";
import type { ValidatedPackage } from "../package/validate.js";
import { secretKeys, secretRef } from "../secrets.js";
import { enginePermissionKey } from "./engine-trust.js";
import type { SecretStore } from "../types.js";
import type { ConsentRecord, InstallStore, InstalledPackage } from "./store.js";
import {
  finishUninstall,
  recoverHeld,
  transactionPaths,
  withLifecycle,
} from "./lifecycle-transaction.js";
import type { LifecycleLease } from "./lifecycle-state.js";

export interface InstallContext {
  dataDir: string;
  store: InstallStore;
  secrets: SecretStore;
  lifecycleOwner?: string;
}

/** Throws PERMISSION_DENIED (details.reason `NOT_INSTALLED`) when the id is not installed. */
export function requireInstalled(
  ctx: InstallContext,
  id: string,
): InstalledPackage {
  const installed = ctx.store.get(id, ctx.lifecycleOwner);
  if (installed === undefined) {
    throw new PlumsError({
      code: PERMISSION_DENIED,
      message: `「${id}」还没有安装，无法进行这个操作。请先导入它。`,
      details: { id, reason: "NOT_INSTALLED" },
    });
  }
  return installed;
}

export function grantConsent(ctx: InstallContext, id: string): ConsentRecord {
  requireInstalled(ctx, id);
  const record = consentFor(requireManifest(ctx, id));
  ctx.store.saveConsent(record);
  return record;
}

function consentFor(manifest: Manifest): ConsentRecord {
  return {
    packageId: manifest.id,
    version: manifest.version,
    formatVersion: manifest.formatVersion,
    permissions: manifest.permissions,
    grantedAt: new Date().toISOString(),
  };
}

export const LEVEL_RANK: Record<PermissionLevel, number> = {
  read: 0,
  write: 1,
  egress: 2,
};

/** Why a new permission is not covered by the old list, or `undefined` when it is covered. */
function growth(
  old: Permission[],
  next: Permission,
  legacy: boolean,
): string | undefined {
  const sameId = old.filter((p) => p.id === next.id);
  if (sameId.length === 0) {
    return "NEW_PERMISSION";
  }
  const sameTarget = sameId.filter((p) => p.target === next.target);
  if (sameTarget.length === 0) {
    return "TARGET_CHANGED";
  }
  if (legacy) {
    return (sameTarget as PermissionV1[]).some(
      (p) => LEVEL_RANK[p.level] >= LEVEL_RANK[(next as PermissionV1).level],
    )
      ? undefined
      : "LEVEL_RAISED";
  }
  const incoming = next as PermissionV2;
  const sameKind = (sameTarget as PermissionV2[]).filter(
    (p) => p.kind === incoming.kind,
  );
  if (sameKind.length === 0) return "KIND_CHANGED";
  if (incoming.kind === "engine")
    return sameKind.some(
      (p) => enginePermissionKey(p) === enginePermissionKey(incoming),
    )
      ? undefined
      : "ENGINE_PERMISSION_CHANGED";
  if (incoming.kind === "service") {
    return sameKind.some(
      (p) =>
        p.kind === "service" &&
        incoming.operations.every((op) => p.operations.includes(op)),
    )
      ? undefined
      : "SERVICE_OPERATIONS_CHANGED";
  }
  if (incoming.kind === "resource") {
    return sameKind.some(
      (p) =>
        p.kind === "resource" &&
        incoming.operations.every((op) => p.operations.includes(op)),
    )
      ? undefined
      : "OPERATIONS_ADDED";
  }
  if (incoming.kind === "fs") {
    return sameKind.some(
      (p) =>
        p.kind === "fs" &&
        incoming.operations.every((op) => p.operations.includes(op)),
    )
      ? undefined
      : "OPERATIONS_ADDED";
  }
  if (incoming.kind === "exec") {
    return sameKind.some(
      (p) =>
        p.kind === "exec" &&
        incoming.cwdRoots.every((root) => p.cwdRoots.includes(root)),
    )
      ? undefined
      : "CWD_ROOTS_ADDED";
  }
  return undefined;
}

/**
 * Replaces an installed package with a higher version. Every check runs before anything is
 * written: installed (PERMISSION_DENIED), same kind and a higher version (IMPORT_INVALID),
 * required dependencies of the new version (DEPENDENCY_MISSING), then each new permission
 * against the old list (CONSENT_REQUIRED unless `consent` is true).
 * A leftover settings file is checked against the new manifest before any files move.
 * No settingsSchema leaves that file unread. A mismatch throws before the swap, so the
 * installed package stays. An owned journal restores the old files before the database
 * commit and finishes cleanup after it, including after a process exit.
 * Enabled state stays. An existing consent record is replaced by one for the new list;
 * its `grantedAt` only moves when newly approved permissions were added.
 */
export async function updatePackage(
  ctx: InstallContext,
  pkg: ValidatedPackage,
  consent = false,
): Promise<{ installDir: string; previousVersion: string }> {
  return withLifecycle(ctx, pkg.manifest.id, (owned, lease) =>
    updateOwned(owned, lease, pkg, consent),
  );
}

async function updateOwned(
  ctx: InstallContext,
  lease: LifecycleLease,
  pkg: ValidatedPackage,
  consent: boolean,
): Promise<{ installDir: string; previousVersion: string }> {
  const { manifest } = pkg;
  const installed = requireInstalled(ctx, manifest.id);
  const before = ctx.store.installationIdentity(installed.id);
  const mismatch = (
    field: "kind" | "version",
    from: string,
    to: string,
    message: string,
  ) =>
    new PlumsError({
      code: IMPORT_INVALID,
      message,
      path: `/${field}`,
      details: { id: installed.id, installed: from, incoming: to },
    });
  if (manifest.kind !== installed.kind) {
    throw mismatch(
      "kind",
      installed.kind,
      manifest.kind,
      `更新不能改变包的类型：已安装的是 ${installed.kind}，新版是 ${manifest.kind}。`,
    );
  }
  if (!semver.gt(manifest.version, installed.version)) {
    throw mismatch(
      "version",
      installed.version,
      manifest.version,
      `新版本 ${manifest.version} 必须高于已安装的 ${installed.version}，不能降级或重复更新。`,
    );
  }
  assertDependencies(ctx, installed, manifest);
  const previousManifest = requireManifest(ctx, installed.id);
  const formatChanged =
    isManifestV1(previousManifest) !== isManifestV1(manifest);
  if (formatChanged && !consent) {
    throw new PlumsError({
      code: CONSENT_REQUIRED,
      message: "包格式变化，需要重新同意新版权限后才能更新。旧版本保持不变。",
      path: "/formatVersion",
      details: {
        id: installed.id,
        reason: "FORMAT_CHANGED",
        installed: previousManifest.formatVersion,
        incoming: manifest.formatVersion,
      },
    });
  }
  const old = previousManifest.permissions;
  const added = manifest.permissions.flatMap((p, index) => {
    const reason = formatChanged
      ? "FORMAT_CHANGED"
      : growth(old, p, isManifestV1(manifest));
    return reason === undefined ? [] : [{ index, id: p.id, reason }];
  });
  const first = added[0];
  if (first !== undefined && !consent) {
    throw new PlumsError({
      code: CONSENT_REQUIRED,
      message: `「${installed.name}」的新版本多要了权限「${first.id}」，你还没有同意，所以没有更新。旧版本保持不变。`,
      path: `/permissions/${first.index}`,
      details: {
        id: installed.id,
        permissionId: first.id,
        reason: first.reason,
        added: added.map(({ index, id, reason }) => ({
          path: `/permissions/${index}`,
          permissionId: id,
          reason,
        })),
      },
    });
  }

  const activeSecrets = new Set([
    ...secretKeys(manifest).map((key) => secretRef(installed.id, key)),
    ...ctx.store.activeLocalCredentialRefs(installed.id, manifest, lease.owner),
  ]);
  const droppedSecrets = ctx.store
    .getSecretRefs(installed.id)
    .filter((ref) => !activeSecrets.has(ref));
  const previous = ctx.store.getConsent(installed.id);
  const record =
    previous === undefined
      ? undefined
      : {
          ...consentFor(manifest),
          grantedAt:
            first === undefined && !formatChanged
              ? previous.grantedAt
              : new Date().toISOString(),
        };
  // Why before the rename: a settings mismatch must not move the installed files.
  await acceptResidualSettings(ctx.dataDir, manifest);
  ctx.store.assertLifecycle(lease, before);
  ctx.store.saveLifecycle(lease, {
    format: 1,
    token: lease.owner,
    kind: "update",
    phase: "prepared",
    before,
    version: manifest.version,
    secretRefs: droppedSecrets,
  });
  const { dir, backup } = transactionPaths(ctx, lease);
  try {
    const staging = await stagePackage(ctx.dataDir, pkg, lease.record!.token);
    ctx.store.assertLifecycle(lease, lease.record!.before);
    await rename(dir, backup);
    ctx.store.assertLifecycle(lease, lease.record!.before);
    await publishStaged(staging, dir);
    ctx.store.recordUpdate(manifest, record, lease);
  } catch (err) {
    await recoverHeld(ctx, lease);
    throw err;
  }
  await recoverHeld(ctx, lease);
  return { installDir: dir, previousVersion: installed.version };
}

export function getConsent(
  ctx: InstallContext,
  id: string,
): ConsentRecord | null {
  requireInstalled(ctx, id);
  return ctx.store.getConsent(id) ?? null;
}

/** Check order: installed, consent, required dependencies. Already enabled is a no-op. */
export function enable(ctx: InstallContext, id: string): InstalledPackage {
  const installed = requireInstalled(ctx, id);
  if (installed.enabled) {
    return installed;
  }
  if (ctx.store.getConsent(id) === undefined) {
    throw new PlumsError({
      code: CONSENT_REQUIRED,
      message: `「${installed.name}」还没有得到你的同意，不能启用。请先看一下它要的权限清单，同意后再启用。`,
      details: { id, version: installed.version },
    });
  }
  assertDependencies(ctx, installed, requireManifest(ctx, id));
  ctx.store.setEnabled(id, true);
  return requireInstalled(ctx, id);
}

/** Keeps the install and the consent. Already disabled is a no-op. */
export function disable(ctx: InstallContext, id: string): InstalledPackage {
  requireInstalled(ctx, id);
  ctx.store.setEnabled(id, false);
  return requireInstalled(ctx, id);
}

/**
 * A durable intent precedes deletion, including secret fields removed by earlier
 * updates. Recovery resumes secret cleanup, quarantines this installation's
 * directories, commits removal of install state, consent and MCP approvals, then
 * removes only its quarantine.
 * A reported secret failure keeps the install and references for explicit retry.
 */
export async function uninstall(
  ctx: InstallContext,
  id: string,
): Promise<void> {
  return withLifecycle(ctx, id, async (owned, lease, recovered) => {
    if (recovered?.kind === "uninstall") return;
    const installed = requireInstalled(owned, id);
    ctx.store.saveLifecycle(lease, {
      format: 1,
      token: lease.owner,
      kind: "uninstall",
      phase: "prepared",
      before: ctx.store.installationIdentity(id),
      version: installed.version,
      secretRefs: ctx.store.getSecretRefs(id),
    });
    try {
      await finishUninstall(owned, lease);
    } catch (error) {
      // A reported secret failure precedes any directory move. Keep normal explicit retry semantics.
      if (
        error instanceof PlumsError &&
        (error.details as { reason?: string } | undefined)?.reason ===
          "SECRET_CLEANUP_FAILED"
      )
        ctx.store.saveLifecycle(lease, null);
      throw error;
    }
  });
}

export function requireManifest(ctx: InstallContext, id: string): Manifest {
  const manifest = ctx.store.getManifest(id);
  if (manifest === undefined) {
    throw new Error(`The install record of ${id} has no manifest.`);
  }
  return manifest;
}

/** Legacy action/MCP APIs must not infer a level from a 2.x permission's unknown fields. */
export function requireLegacyManifest(
  ctx: InstallContext,
  id: string,
): ManifestV1 {
  const manifest = requireManifest(ctx, id);
  if (!isManifestV1(manifest)) {
    throw new PlumsError({
      code: PERMISSION_DENIED,
      message: "这个包使用 2.x 权限，不能通过旧动作或 MCP 授权接口调用。",
      path: "/formatVersion",
      details: {
        id,
        reason: "FORMAT_API_MISMATCH",
        formatVersion: manifest.formatVersion,
      },
    });
  }
  return manifest;
}

function assertDependencies(
  ctx: InstallContext,
  installed: InstalledPackage,
  manifest: Manifest,
): void {
  const problems: { path: string; message: string; dependency: Dependency }[] =
    [];
  manifest.dependencies.forEach((dependency, index) => {
    if (dependency.optional === true) {
      return;
    }
    const message = dependencyProblem(ctx, dependency);
    if (message !== undefined) {
      problems.push({ path: `/dependencies/${index}`, message, dependency });
    }
  });
  const first = problems[0];
  if (first === undefined) {
    return;
  }
  throw new PlumsError({
    code: DEPENDENCY_MISSING,
    message: `依赖不满足：${first.message}`,
    path: first.path,
    details: {
      id: installed.id,
      missing: problems.map(({ path: at, dependency }) => ({
        path: at,
        kind: dependency.kind,
        id: dependency.id,
        range: dependency.range,
      })),
    },
  });
}

function dependencyProblem(
  ctx: InstallContext,
  dependency: Dependency,
): string | undefined {
  const found = ctx.store.get(dependency.id);
  if (found === undefined || found.kind !== dependency.kind) {
    return `「${dependency.id}」（版本要满足 ${dependency.range}）没有安装。Plums 不会自动下载，请先导入这个依赖。`;
  }
  if (!semver.satisfies(found.version, dependency.range)) {
    return `「${dependency.id}」的版本要满足 ${dependency.range}，但已安装的是 ${found.version}。请换成合适的版本。`;
  }
  return undefined;
}
