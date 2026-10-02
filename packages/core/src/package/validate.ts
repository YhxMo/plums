import { importInvalid } from "./entry-path.js";
import { parseManifest } from "./manifest.js";
import { readZipEntries } from "./read-zip.js";
import {
  DEFAULT_PACKAGE_LIMITS,
  MANIFEST_FILE,
  type PackageContents,
  type PackageFiles,
  type PackageLimits,
} from "./types.js";

export interface ValidatedPackage extends PackageContents {
  /** The bytes of `manifest.json` exactly as they were in the zip. */
  manifestBytes: Uint8Array;
}

/**
 * Checks a package without writing any file.
 * Throws IMPORT_INVALID, MANIFEST_INVALID or FORMAT_UNSUPPORTED.
 */
export async function validatePackage(
  input: Uint8Array | string,
  limits: PackageLimits = DEFAULT_PACKAGE_LIMITS,
): Promise<ValidatedPackage> {
  const entries = await readZipEntries(input, limits);
  assertNoFileDirectoryClash(entries.map((entry) => entry.path));
  const manifestEntry = entries.find((entry) => entry.path === MANIFEST_FILE);
  if (manifestEntry === undefined) {
    throw importInvalid(
      "压缩包的根目录里没有 manifest.json。请确认 manifest.json 在压缩包最外层，而不是在子文件夹里。",
    );
  }
  const manifest = parseManifest(manifestEntry.data);
  const files: PackageFiles = Object.fromEntries(
    entries.filter((entry) => entry !== manifestEntry).map((entry) => [entry.path, entry.data]),
  );
  return { manifest, files, manifestBytes: manifestEntry.data };
}

function assertNoFileDirectoryClash(paths: string[]): void {
  const all = new Set(paths);
  for (const path of paths) {
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      const parent = path.slice(0, slash);
      if (all.has(parent)) {
        throw importInvalid(`压缩包里「${parent}」既是文件又是文件夹。`);
      }
    }
  }
}
