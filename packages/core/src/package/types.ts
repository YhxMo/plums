export type PackageKind = "character" | "extension" | "connector";

export type PermissionLevel = "read" | "write" | "egress";

interface PermissionBase {
  id: string;
  target: string;
  reason: string;
  [key: string]: unknown;
}

/** Generic actions declared by a 1.x package. */
export interface PermissionV1 extends PermissionBase {
  level: PermissionLevel;
}

export type FsOperation = "read" | "write" | "list";

export interface FsPermission extends PermissionBase {
  kind: "fs";
  /** Exact operations: write does not grant read. */
  operations: FsOperation[];
}

export interface ExecPermission extends PermissionBase {
  kind: "exec";
  /** Logical root names registered by the host. */
  cwdRoots: string[];
}

export interface EgressPermission extends PermissionBase {
  kind: "egress";
}

export type PermissionV2 = FsPermission | ExecPermission | EgressPermission;
export type Permission = PermissionV1 | PermissionV2;

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
  /** Shown as the label. Required so a setting can be displayed without inventing a name. */
  title: string;
  /** Shown as the help text. Required so a setting is not a bare field. */
  description: string;
  default?: unknown;
  /** Only meaningful when `type` is `number` or `integer`. */
  minimum?: number;
  /** Only meaningful when `type` is `number` or `integer`. */
  maximum?: number;
  enum?: unknown[];
  /** When true, the saved value must be this field's secretRef. Only a boolean is accepted. */
  "x-secret"?: boolean;
  [key: string]: unknown;
}

export interface SettingsSchema {
  type: "object";
  properties: Record<string, SettingSpec>;
  required?: string[];
  [key: string]: unknown;
}

/** The envelope of `manifest.json`. Unknown fields are kept as they were. */
interface ManifestBase {
  kind: PackageKind;
  id: string;
  name: string;
  version: string;
  description: string;
  license?: string;
  author?: string;
  dependencies: Dependency[];
  settingsSchema?: SettingsSchema;
  /** Kept as-is. T2 neither checks nor produces signatures. */
  signature?: unknown;
  /** Kept as-is. Its meaning depends on `kind` and is not checked here. */
  payload: unknown;
  [key: string]: unknown;
}

export interface ManifestV1 extends ManifestBase {
  formatVersion: `1.${number}`;
  permissions: PermissionV1[];
}

export interface ManifestV2 extends ManifestBase {
  formatVersion: `2.${number}`;
  permissions: PermissionV2[];
}

export type Manifest = ManifestV1 | ManifestV2;

/** Narrow a validated manifest by its envelope, never by unknown permission fields. */
export function isManifestV1(manifest: Manifest): manifest is ManifestV1 {
  return manifest.formatVersion.startsWith("1.");
}

export function isManifestV2(manifest: Manifest): manifest is ManifestV2 {
  return manifest.formatVersion.startsWith("2.");
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

/** Default envelope version for newly created packages. Export preserves the supplied version. */
export const PACKAGE_FORMAT_VERSION = "2.0";
/** The highest readable major, derived from the default envelope version. */
export const SUPPORTED_FORMAT_MAJOR = Number(PACKAGE_FORMAT_VERSION.split(".")[0]);
export const MANIFEST_FILE = "manifest.json";
