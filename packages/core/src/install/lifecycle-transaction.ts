import { lstat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { PlumsError, SECRET_NOT_FOUND } from "../errors.js";
import { PACKAGES_DIR } from "../package/install.js";
import { PACKAGE_DATA_DIR } from "./check-settings.js";
import type { InstallContext } from "./lifecycle.js";
import {
  lifecycleFailure,
  type LifecycleLease,
  type LifecycleRecord,
} from "./lifecycle-state.js";

export function transactionPaths(ctx: InstallContext, lease: LifecycleLease) {
  const root = path.join(ctx.dataDir, PACKAGES_DIR);
  return {
    dir: path.join(root, lease.id),
    data: path.join(ctx.dataDir, PACKAGE_DATA_DIR, lease.id),
    staging: path.join(root, `.staging-${lease.record!.token}`),
    backup: path.join(root, `.backup-${lease.record!.token}`),
    dataBackup: path.join(root, `.data-${lease.record!.token}`),
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function deleteSecrets(
  ctx: InstallContext,
  id: string,
  version: string,
  refs: readonly string[],
) {
  const results = await Promise.allSettled(
    refs.map(async (ref) => ctx.secrets.delete(ref)),
  );
  if (results.some((result) => result.status === "rejected")) {
    throw new PlumsError({
      code: SECRET_NOT_FOUND,
      message: `「${id}」当前安装版本为 ${version}。密钥未能全部清理，已保留引用，请在后续版本更新时清理，或重试卸载。`,
      details: { id, version, reason: "SECRET_CLEANUP_FAILED" },
    });
  }
}

export async function withLifecycle<T>(
  ctx: InstallContext,
  id: string,
  run: (
    owned: InstallContext,
    lease: LifecycleLease,
    recovered: LifecycleRecord | null,
  ) => Promise<T>,
): Promise<T> {
  const lease = ctx.store.acquireLifecycle(id);
  const owned = { ...ctx, lifecycleOwner: lease.owner };
  try {
    const recovered = lease.record;
    await recoverHeld(owned, lease);
    return await run(owned, lease, recovered);
  } finally {
    ctx.store.releaseLifecycle(lease);
  }
}

export async function recoverLifecycles(
  ctx: InstallContext,
  id?: string,
  pending = ctx.store.pendingLifecycles(),
): Promise<void> {
  for (const packageId of pending) {
    if (id !== undefined && id !== packageId) continue;
    let lease: LifecycleLease;
    try {
      lease = ctx.store.acquireLifecycle(packageId);
    } catch (error) {
      if (
        error instanceof PlumsError &&
        (error.details as { reason?: string } | undefined)?.reason ===
          "LIFECYCLE_BUSY"
      )
        continue;
      throw error;
    }
    try {
      await recoverHeld({ ...ctx, lifecycleOwner: lease.owner }, lease);
    } finally {
      ctx.store.releaseLifecycle(lease);
    }
  }
}

export async function finishUninstall(
  ctx: InstallContext,
  lease: LifecycleLease,
): Promise<void> {
  const record = lease.record!;
  const files = transactionPaths(ctx, lease);
  if (record.phase === "prepared") {
    ctx.store.assertLifecycle(lease, record.before);
    await deleteSecrets(ctx, lease.id, record.version, record.secretRefs);
    ctx.store.assertLifecycle(lease, record.before);
    for (const [from, to] of [
      [files.dir, files.backup],
      [files.data, files.dataBackup],
    ]) {
      if (await exists(from!)) {
        if (await exists(to!))
          throw lifecycleFailure(lease.id, "LIFECYCLE_RECOVERY_REQUIRED");
        ctx.store.assertLifecycle(lease, record.before);
        await rename(from!, to!);
      }
    }
    ctx.store.remove(lease.id, lease);
  }
  ctx.store.assertLifecycle(lease, null);
  await rm(files.backup, { recursive: true, force: true });
  ctx.store.assertLifecycle(lease, null);
  await rm(files.dataBackup, { recursive: true, force: true });
  ctx.store.saveLifecycle(lease, null);
}

/** The database commit marker and unique directory names make every step repeatable. */
export async function recoverHeld(
  ctx: InstallContext,
  lease: LifecycleLease,
): Promise<void> {
  ctx.store.refreshLifecycle(lease);
  const record = lease.record;
  if (!record) return;
  const files = transactionPaths(ctx, lease);
  if (record.kind === "uninstall") return finishUninstall(ctx, lease);
  if (record.kind === "import") {
    const current = ctx.store.installationIdentity(lease.id);
    if (record.phase === "aborting") {
      const expected = current
        ? { installationId: record.token, version: record.version }
        : null;
      ctx.store.assertLifecycle(lease, expected);
      await rm(files.dir, { recursive: true, force: true });
      await rm(files.staging, { recursive: true, force: true });
      if (current) ctx.store.remove(lease.id, lease, expected);
    } else if (record.phase === "committed" && current) {
      ctx.store.assertLifecycle(lease, {
        installationId: record.token,
        version: record.version,
      });
      if (await exists(files.staging)) {
        // A pre-existing directory without an install record is never silently overwritten.
        if (await exists(files.dir))
          throw lifecycleFailure(lease.id, "LIFECYCLE_RECOVERY_REQUIRED");
        await rename(files.staging, files.dir);
      } else if (!(await exists(files.dir))) {
        throw lifecycleFailure(lease.id, "LIFECYCLE_RECOVERY_REQUIRED");
      }
    } else {
      ctx.store.assertLifecycle(lease, null);
      await rm(files.staging, { recursive: true, force: true });
    }
    ctx.store.saveLifecycle(lease, null);
    return;
  }
  if (record.phase === "prepared") {
    ctx.store.assertLifecycle(lease, record.before);
    if (await exists(files.backup)) {
      ctx.store.assertLifecycle(lease, record.before);
      await rm(files.dir, { recursive: true, force: true });
      ctx.store.assertLifecycle(lease, record.before);
      await rename(files.backup, files.dir);
    } else if (!(await exists(files.dir))) {
      throw lifecycleFailure(lease.id, "LIFECYCLE_RECOVERY_REQUIRED");
    }
    await rm(files.staging, { recursive: true, force: true });
    ctx.store.saveLifecycle(lease, null);
    return;
  }
  ctx.store.assertLifecycle(lease, {
    installationId: record.before!.installationId,
    version: record.version,
  });
  if (!(await exists(files.dir)))
    throw lifecycleFailure(lease.id, "LIFECYCLE_RECOVERY_REQUIRED");
  await rm(files.backup, { recursive: true, force: true });
  await rm(files.staging, { recursive: true, force: true });
  // Historical references remain in the committed package row even if deletion fails.
  try {
    await deleteSecrets(ctx, lease.id, record.version, record.secretRefs);
  } finally {
    ctx.store.saveLifecycle(lease, null);
  }
}
