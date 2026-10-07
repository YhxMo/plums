import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertNoPathConflict, importInvalid } from "./entry-path.js";
import { MANIFEST_FILE } from "./types.js";
import type { ValidatedPackage } from "./validate.js";

export const PACKAGES_DIR = "packages";

/**
 * Writes the package into a new staging directory under `<dataDir>/packages/`.
 * Does not remove or replace `packages/<id>`.
 * Why a separate directory: the caller can still lose the insert, and then it
 * may delete only this directory.
 */
export async function stagePackage(
  dataDir: string,
  pkg: ValidatedPackage,
): Promise<string> {
  const root = path.join(dataDir, PACKAGES_DIR);
  // Why before any file is written: A.txt and a.txt, or MANIFEST.JSON and manifest.json, overwrite each other on a case-insensitive disk.
  // Why before mkdir(root): a failed check must not leave any directory behind.
  assertNoPathConflict([MANIFEST_FILE, ...Object.keys(pkg.files)]);
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(path.join(root, ".staging-"));
  try {
    await writeInside(staging, MANIFEST_FILE, pkg.manifestBytes);
    for (const [relative, data] of Object.entries(pkg.files)) {
      await writeInside(staging, relative, data);
    }
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
  return staging;
}

/**
 * Replaces `target` with `staging`.
 * Why this deletes `target`: update is putting the new tree back, and import
 * calls this only after that id's insert has won. The import that lost the row
 * must not call this, or it would remove the winner's install directory.
 */
export async function publishStaged(
  staging: string,
  target: string,
): Promise<void> {
  try {
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}

async function writeInside(
  base: string,
  relative: string,
  data: Uint8Array,
): Promise<void> {
  const full = path.resolve(base, ...relative.split("/"));
  if (!full.startsWith(base + path.sep)) {
    throw importInvalid(`文件路径会跑到包目录之外：${relative}`);
  }
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}
