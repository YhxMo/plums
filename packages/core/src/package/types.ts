export type PackageKind = "character" | "extension" | "connector";

export type PermissionLevel = "read" | "write" | "egress";

export interface Permission {
  id: string;
  level: PermissionLevel;
  target: string;
  reason: string;
  [key: string]: unknown;
}

export interface Dependency {
  kind: "extension" | "connector";
  id: string;
  /** A semver range such as `^1.2.0`. */
  range: string;
  /** Treated as `false` when left out. The manifest is not rewritten to add it. */
  optional?: boolean;
  [key: string]: unknown;
}

export interface SettingSpec {
  type: "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

export interface SettingsSchema {
  type: "object";
  properties: Record<string, SettingSpec>;
  required?: string[];
  [key: string]: unknown;
}

/** The envelope of `manifest.json`. Unknown fields are kept as they were. */
export interface Manifest {
  formatVersion: string;
  kind: PackageKind;
  id: string;
  name: string;
  version: string;
  description: string;
  license?: string;
  author?: string;
  dependencies: Dependency[];
  permissions: Permission[];
  settingsSchema?: SettingsSchema;
  /** Kept as-is. T2 neither checks nor produces signatures. */
  signature?: unknown;
  /** Kept as-is. Its meaning depends on `kind` and is not checked here. */
  payload: unknown;
  [key: string]: unknown;
}

/** Everything in a package except `manifest.json`, by relative path with `/` separators. */
export type PackageFiles = Record<string, Uint8Array>;

export interface PackageContents {
  manifest: Manifest;
  files: PackageFiles;
}

export interface PackageLimits {
  /** Total size of all entries after decompression, in bytes. */
  maxTotalBytes: number;
  maxFiles: number;
  /** Longest allowed entry path, in characters. */
  maxPathLength: number;
}

export const DEFAULT_PACKAGE_LIMITS: Readonly<PackageLimits> = Object.freeze({
  maxTotalBytes: 20 * 1024 * 1024,
  maxFiles: 1000,
  maxPathLength: 255,
});

/** The highest `formatVersion` major this build can read. */
export const SUPPORTED_FORMAT_MAJOR = 1;
/** The `formatVersion` that `exportPackage` is expected to be given. */
export const PACKAGE_FORMAT_VERSION = "1.0";
export const MANIFEST_FILE = "manifest.json";
