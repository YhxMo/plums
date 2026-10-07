import type {
  Dependency,
  PackageKind,
  PackageLimits,
  Permission,
} from "./types.js";
import { DEFAULT_PACKAGE_LIMITS } from "./types.js";
import { validatePackage } from "./validate.js";

/** A package summary. Nothing is installed and no file is written. */
export interface PackageInspection {
  kind: PackageKind;
  /** Envelope version; permissions must be interpreted using this format. */
  formatVersion: string;
  id: string;
  name: string;
  version: string;
  description: string;
  /**
   * The manifest `permissions` list, in that order.
   * 1.x items have level; 2.x items have kind and the complete operations/cwdRoots declaration.
   * Text elsewhere in the package is not a permission.
   */
  permissions: Permission[];
  /** The manifest `dependencies` list, in that order. */
  dependencies: Dependency[];
}

/**
 * Reads a zip (bytes or a file path) and returns its summary.
 * Validation is `validatePackage`, so a bad package throws the same PlumsError.
 */
export async function inspectPackage(
  input: Uint8Array | string,
  limits: PackageLimits = DEFAULT_PACKAGE_LIMITS,
): Promise<PackageInspection> {
  const { manifest } = await validatePackage(input, limits);
  return {
    kind: manifest.kind,
    formatVersion: manifest.formatVersion,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    permissions: manifest.permissions,
    dependencies: manifest.dependencies,
  };
}
