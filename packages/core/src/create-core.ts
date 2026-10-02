import path from "node:path";
import type { Confirm, EgressSink, ModelProvider, SecretStore } from "./types.js";
import { exportPackage, type ExportInput, type ExportOptions } from "./package/export.js";
import { inspectPackage, type PackageInspection } from "./package/inspect.js";
import { installPackage } from "./package/install.js";
import {
  DEFAULT_PACKAGE_LIMITS,
  type PackageContents,
  type PackageLimits,
} from "./package/types.js";
import { validatePackage } from "./package/validate.js";
import { VERSION } from "./version.js";

export interface CreateCoreOptions {
  dataDir: string;
  model: ModelProvider;
  egress: EgressSink;
  confirm: Confirm;
  secrets: SecretStore;
  /** Overrides for the package import limits. Anything left out keeps its default. */
  limits?: Partial<PackageLimits>;
}

export interface ImportedPackage extends PackageContents {
  /** Where the package was written: `<dataDir>/packages/<id>`. */
  installDir: string;
}

export interface Core {
  readonly version: string;
  readonly dataDir: string;
  readonly model: ModelProvider;
  readonly egress: EgressSink;
  readonly confirm: Confirm;
  readonly secrets: SecretStore;
  readonly limits: Readonly<PackageLimits>;
  /** Checks a zip (bytes or file path) and returns its content. Writes nothing. */
  validatePackage(input: Uint8Array | string): Promise<PackageContents>;
  /** Returns a package summary and its permission list. Does not install or write any file. */
  inspect(input: Uint8Array | string): Promise<PackageInspection>;
  /** Validates a zip, then writes it to the data directory. Writes nothing if it is invalid. */
  importPackage(input: Uint8Array | string): Promise<ImportedPackage>;
  /** Builds a package zip. Also writes it to `options.outPath` when given. */
  exportPackage(input: ExportInput, options?: ExportOptions): Promise<Uint8Array>;
}

export function createCore(options: CreateCoreOptions): Core {
  if (options === null || typeof options !== "object") {
    throw new TypeError("createCore options are required");
  }
  const dataDir = requireNonEmptyString(options.dataDir, "dataDir");
  requireMethod(options.model, "model", "complete");
  requireMethod(options.egress, "egress", "send");
  requireMethod(options.confirm, "confirm", "ask");
  requireMethod(options.secrets, "secrets", "get");
  requireMethod(options.secrets, "secrets", "set");
  requireMethod(options.secrets, "secrets", "delete");

  const limits = resolveLimits(options.limits);
  const resolvedDataDir = path.resolve(dataDir);

  return {
    version: VERSION,
    dataDir: resolvedDataDir,
    limits,
    async validatePackage(input) {
      const { manifest, files } = await validatePackage(input, limits);
      return { manifest, files };
    },
    inspect(input) {
      return inspectPackage(input, limits);
    },
    async importPackage(input) {
      const validated = await validatePackage(input, limits);
      const installDir = await installPackage(resolvedDataDir, validated);
      return { manifest: validated.manifest, files: validated.files, installDir };
    },
    exportPackage(input, exportOptions) {
      return exportPackage(input, limits, exportOptions);
    },
    model: options.model,
    egress: options.egress,
    confirm: options.confirm,
    secrets: options.secrets,
  };
}

function resolveLimits(overrides: Partial<PackageLimits> | undefined): Readonly<PackageLimits> {
  const limits: PackageLimits = { ...DEFAULT_PACKAGE_LIMITS, ...overrides };
  for (const key of Object.keys(DEFAULT_PACKAGE_LIMITS) as (keyof PackageLimits)[]) {
    const value = limits[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError(`createCore limits.${key} must be a positive integer`);
    }
  }
  return Object.freeze(limits);
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`createCore ${name} must be a non-empty string`);
  }
  return value;
}

function requireMethod(value: unknown, name: string, method: string): void {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>)[method] !== "function"
  ) {
    throw new TypeError(`createCore ${name} must implement ${method}()`);
  }
}
