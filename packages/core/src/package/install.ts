import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { importInvalid } from "./entry-path.js";
import { MANIFEST_FILE } from "./types.js";
import type { ValidatedPackage } from "./validate.js";

export const PACKAGES_DIR = "packages";

/**
 * Writes an already validated package to `<dataDir>/packages/<id>/`.
 * Files go to a staging directory first and are moved into place at the end,
 * so a failure never leaves a half-written package. An existing install of the
 * same id is replaced.
 */
export async function installPackage(dataDir: string, pkg: ValidatedPackage): Promise<string> {
  const root = path.join(dataDir, PACKAGES_DIR);
  const target = path.join(root, pkg.manifest.id);
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(path.join(root, ".staging-"));
  try {
    await writeInside(staging, MANIFEST_FILE, pkg.manifestBytes);
    for (const [relative, data] of Object.entries(pkg.files)) {
      await writeInside(staging, relative, data);
    }
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
  return target;
}

async function writeInside(base: string, relative: string, data: Uint8Array): Promise<void> {
  const full = path.resolve(base, ...relative.split("/"));
  if (!full.startsWith(base + path.sep)) {
    throw importInvalid(`文件路径会跑到包目录之外：${relative}`);
  }
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}
