import { rename, rm } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import {
  CONSENT_REQUIRED,
  DEPENDENCY_MISSING,
  IMPORT_INVALID,
  PERMISSION_DENIED,
  PlumsError,
  SECRET_NOT_FOUND,
} from "../errors.js";
import { acceptResidualSettings, PACKAGE_DATA_DIR } from "./check-settings.js";
import { installPackage, PACKAGES_DIR } from "../package/install.js";
import type { Dependency, Manifest, Permission, PermissionLevel } from "../package/types.js";
import type { ValidatedPackage } from "../package/validate.js";
import { secretKeys, secretRef } from "../secrets.js";
import type { SecretStore } from "../types.js";
import type { ConsentRecord, InstallStore, InstalledPackage } from "./store.js";

export interface InstallContext {
  dataDir: string;
  store: InstallStore;
  secrets: SecretStore;
}

/** Throws PERMISSION_DENIED (details.reason `NOT_INSTALLED`) when the id is not installed. */
export function requireInstalled(ctx: InstallContext, id: string): InstalledPackage {
  const installed = ctx.store.get(id);
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
    permissions: manifest.permissions,
    grantedAt: new Date().toISOString(),
  };
}

export const LEVEL_RANK: Record<PermissionLevel, number> = { read: 0, write: 1, egress: 2 };

/** Why a new permission is not covered by the old list, or `undefined` when it is covered. */
function growth(old: Permission[], next: Permission): string | undefined {
  const sameId = old.filter((p) => p.id === next.id);
  if (sameId.length === 0) {
    return "NEW_PERMISSION";
  }
  const sameTarget = sameId.filter((p) => p.target === next.target);
  if (sameTarget.length === 0) {
    return "TARGET_CHANGED";
  }
  return sameTarget.some((p) => LEVEL_RANK[p.level] >= LEVEL_RANK[next.level]) ? undefined : "LEVEL_RAISED";
}

/**
 * Replaces an installed package with a higher version. Every check runs before anything is
 * written: installed (PERMISSION_DENIED), same kind and a higher version (IMPORT_INVALID),
 * required dependencies of the new version (DEPENDENCY_MISSING), then each new permission
 * against the old list (CONSENT_REQUIRED unless `consent` is true).
 * A leftover settings file is checked against the new manifest before any files move.
 * No settingsSchema leaves that file unread. A mismatch throws before the swap, so the
 * installed package stays. Files are swapped with a backup that is restored if the
 * database write fails.
 * Enabled state stays. An existing consent record is replaced by one for the new list;
 * its `grantedAt` only moves when newly approved permissions were added.
 */
export async function updatePackage(
  ctx: InstallContext,
  pkg: ValidatedPackage,
  consent = false,
): Promise<{ installDir: string; previousVersion: string }> {
  const { manifest } = pkg;
  const installed = requireInstalled(ctx, manifest.id);
  const mismatch = (field: "kind" | "version", from: string, to: string, message: string) =>
    new PlumsError({
      code: IMPORT_INVALID,
      message,
      path: `/${field}`,
      details: { id: installed.id, installed: from, incoming: to },
    });
  if (manifest.kind !== installed.kind) {
    throw mismatch("kind", installed.kind, manifest.kind, `更新不能改变包的类型：已安装的是 ${installed.kind}，新版是 ${manifest.kind}。`);
  }
  if (!semver.gt(manifest.version, installed.version)) {
    throw mismatch("version", installed.version, manifest.version, `新版本 ${manifest.version} 必须高于已安装的 ${installed.version}，不能降级或重复更新。`);
  }
  assertDependencies(ctx, installed, manifest);
  const old = requireManifest(ctx, installed.id).permissions;
  const added = manifest.permissions.flatMap((p, index) => {
    const reason = growth(old, p);
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
        added: added.map(({ index, id, reason }) => ({ path: `/permissions/${index}`, permissionId: id, reason })),
      },
    });
  }

  const activeSecrets = new Set(secretKeys(manifest).map((key) => secretRef(installed.id, key)));
  const droppedSecrets = ctx.store.getSecretRefs(installed.id).filter((ref) => !activeSecrets.has(ref));
  const previous = ctx.store.getConsent(installed.id);
  const record =
    previous === undefined
      ? undefined
      : { ...consentFor(manifest), grantedAt: first === undefined ? previous.grantedAt : new Date().toISOString() };
  // Why before the rename: a settings mismatch must not move the installed files.
  await acceptResidualSettings(ctx.dataDir, manifest);
  const dir = path.join(ctx.dataDir, PACKAGES_DIR, installed.id);
  const backup = path.join(ctx.dataDir, PACKAGES_DIR, `.backup-${installed.id}`);
  await rm(backup, { recursive: true, force: true });
  await rename(dir, backup);
  try {
    await installPackage(ctx.dataDir, pkg);
    ctx.store.recordUpdate(manifest, record);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    await rename(backup, dir);
    throw err;
  }
  await rm(backup, { recursive: true, force: true });
  await deleteSecrets(ctx, installed.id, manifest.version, droppedSecrets);
  return { installDir: dir, previousVersion: installed.version };
}

export function getConsent(ctx: InstallContext, id: string): ConsentRecord | null {
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
 * Removes the package's secret values, then its install state, consent and MCP tool
 * approvals, then its files and data folder. Secret references include fields removed
 * by earlier updates. The record goes before the files, so the package does not stay
 * listed once its files are gone.
 * A crash midway stops in one of two places: the secrets are already deleted but the
 * package still shows as installed, or the record is deleted and the files are still there.
 * A settings file left behind with no install record is handled by import: it is checked
 * against the new settingsSchema, and a package with no settingsSchema is refused until
 * `data/<id>/settings.json` is deleted. An update that drops settingsSchema ignores that
 * file: it is not read and not deleted, and the update succeeds.
 */
export async function uninstall(ctx: InstallContext, id: string): Promise<void> {
  const installed = requireInstalled(ctx, id);
  await deleteSecrets(ctx, id, installed.version, ctx.store.getSecretRefs(id));
  ctx.store.remove(id);
  await rm(path.join(ctx.dataDir, PACKAGES_DIR, id), { recursive: true, force: true });
  await rm(path.join(ctx.dataDir, PACKAGE_DATA_DIR, id), { recursive: true, force: true });
}

async function deleteSecrets(ctx: InstallContext, id: string, version: string, refs: readonly string[]): Promise<void> {
  // Why wait for every deletion: a partial failure must not leave more deletions racing
  // the error handler or a retry. References stay until uninstall removes the record.
  const results = await Promise.allSettled(refs.map(async (ref) => ctx.secrets.delete(ref)));
  if (results.some((result) => result.status === "rejected")) {
    // Why no underlying error: a store can delete a value and then throw it in an error,
    // leaving nothing that knownSecrets could read back for redaction.
    throw new PlumsError({
      code: SECRET_NOT_FOUND,
      message: `「${id}」当前安装版本为 ${version}。密钥未能全部清理，已保留引用，请在后续版本更新时清理，或重试卸载。`,
      details: { id, version, reason: "SECRET_CLEANUP_FAILED" },
    });
  }
}

export function requireManifest(ctx: InstallContext, id: string): Manifest {
  const manifest = ctx.store.getManifest(id);
  if (manifest === undefined) {
    throw new Error(`The install record of ${id} has no manifest.`);
  }
  return manifest;
}

function assertDependencies(ctx: InstallContext, installed: InstalledPackage, manifest: Manifest): void {
  const problems: { path: string; message: string; dependency: Dependency }[] = [];
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

function dependencyProblem(ctx: InstallContext, dependency: Dependency): string | undefined {
  const found = ctx.store.get(dependency.id);
  if (found === undefined || found.kind !== dependency.kind) {
    return `「${dependency.id}」（版本要满足 ${dependency.range}）没有安装。Plums 不会自动下载，请先导入这个依赖。`;
  }
  if (!semver.satisfies(found.version, dependency.range)) {
    return `「${dependency.id}」的版本要满足 ${dependency.range}，但已安装的是 ${found.version}。请换成合适的版本。`;
  }
  return undefined;
}
