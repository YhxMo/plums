import { rm } from "node:fs/promises";
import path from "node:path";
import { runAction, type ActionResult, type RunActionInput } from "./actions/run-action.js";
import * as lifecycle from "./install/lifecycle.js";
import { setSettings, resolveSettings, knownSecrets } from "./install/settings.js";
import { redact } from "./redact.js";
import { InstallStore, type ConsentRecord, type InstalledPackage } from "./install/store.js";
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

export interface UpdatedPackage extends ImportedPackage {
  previousVersion: string;
}

export interface Core {
  readonly version: string;
  readonly dataDir: string;
  readonly limits: Readonly<PackageLimits>;
  /** Checks a zip (bytes or file path) and returns its content. Writes nothing. */
  validatePackage(input: Uint8Array | string): Promise<PackageContents>;
  /** Returns a package summary and its permission list. Does not install or write any file. */
  inspect(input: Uint8Array | string): Promise<PackageInspection>;
  /**
   * Validates a zip, then writes it to the data directory and records it as installed:
   * not enabled, no consent. Writes nothing if it is invalid. Importing an id that is
   * already installed replaces it and resets it to that same state.
   */
  importPackage(input: Uint8Array | string): Promise<ImportedPackage>;
  /**
   * Updates an installed package to a higher version (the id comes from the zip). Throws
   * PERMISSION_DENIED (not installed), IMPORT_INVALID at `/kind` (kind changed) or `/version`
   * (not higher), DEPENDENCY_MISSING (a required dependency of the new version), or
   * CONSENT_REQUIRED at `/permissions/<i>` when the new version adds or raises a permission
   * and `options.consent` is not true. A failed update changes nothing. On success the files
   * are replaced; enabled state and consent stay (the consent record is rewritten for the new list).
   */
  updatePackage(input: Uint8Array | string, options?: { consent?: boolean }): Promise<UpdatedPackage>;
  /** Builds a package zip. Also writes it to `options.outPath` when given. */
  exportPackage(input: ExportInput, options?: ExportOptions): Promise<Uint8Array>;
  /** Saves the user's consent to the package's current permission list. Replaces an earlier record. */
  grantConsent(id: string): Promise<ConsentRecord>;
  /** The consent record, or `null` when the package was never consented to. */
  getConsent(id: string): Promise<ConsentRecord | null>;
  /** Needs consent and every required dependency. Throws CONSENT_REQUIRED or DEPENDENCY_MISSING. */
  enable(id: string): Promise<InstalledPackage>;
  /** Turns the package off. Install and consent stay. */
  disable(id: string): Promise<InstalledPackage>;
  /** Removes files, data, settings, consent and secret references. The id can then be imported again. */
  uninstall(id: string): Promise<void>;
  listInstalled(): Promise<InstalledPackage[]>;
  /**
   * Runs one permission-checked action of an installed extension. The level (read, write,
   * egress) comes from the extension's manifest. Check order: installed, enabled and declared
   * (PERMISSION_DENIED); consent (CONSENT_REQUIRED); confirm.ask for write and egress
   * (CONFIRMATION_DENIED); then, for egress only, `egress.send(request)`.
   */
  runAction(input: RunActionInput): Promise<ActionResult>;
  /**
   * Replaces the package's saved settings (`<dataDir>/data/<id>/settings.json`). A field marked
   * `x-secret` in its settingsSchema must hold exactly `secretRef(id, key)`, and the SecretStore
   * must already hold a value for it. Otherwise throws SECRET_NOT_FOUND at `/settings/<key>`
   * (`details.reason` is `NOT_A_SECRET_REF` or `NOT_FOUND`) and writes nothing.
   */
  setSettings(id: string, values: Record<string, unknown>): Promise<void>;
  /** The saved settings with every secret ref replaced by its value (`{}` when none). Throws SECRET_NOT_FOUND like `setSettings`. */
  resolveSettings(id: string): Promise<Record<string, unknown>>;
  /** Closes the database. Calling any method later opens it again. */
  close(): void;
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
  const store = new InstallStore(resolvedDataDir);
  const ctx = { dataDir: resolvedDataDir, store, secrets: options.secrets };

  const guard =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (err) {
        let secrets: string[];
        try {
          secrets = await knownSecrets(ctx);
        } catch {
          throw err;
        }
        throw secrets.length > 0 ? redact(err, secrets) : err;
      }
    };

  return {
    version: VERSION,
    dataDir: resolvedDataDir,
    limits,
    validatePackage: guard(async (input) => {
      const { manifest, files } = await validatePackage(input, limits);
      return { manifest, files };
    }),
    inspect: guard((input) => inspectPackage(input, limits)),
    importPackage: guard(async (input) => {
      const validated = await validatePackage(input, limits);
      store.open();
      const installDir = await installPackage(resolvedDataDir, validated);
      try {
        store.recordInstall(validated.manifest);
      } catch (err) {
        await rm(installDir, { recursive: true, force: true });
        throw err;
      }
      return { manifest: validated.manifest, files: validated.files, installDir };
    }),
    updatePackage: guard(async (input, updateOptions) => {
      const validated = await validatePackage(input, limits);
      const { installDir, previousVersion } = await lifecycle.updatePackage(
        ctx,
        validated,
        updateOptions?.consent === true,
      );
      return { manifest: validated.manifest, files: validated.files, installDir, previousVersion };
    }),
    exportPackage: guard(async (input, exportOptions) =>
      exportPackage(input, limits, exportOptions, await knownSecrets(ctx)),
    ),
    grantConsent: guard(async (id) => lifecycle.grantConsent(ctx, id)),
    getConsent: guard(async (id) => lifecycle.getConsent(ctx, id)),
    enable: guard(async (id) => lifecycle.enable(ctx, id)),
    disable: guard(async (id) => lifecycle.disable(ctx, id)),
    uninstall: guard((id) => lifecycle.uninstall(ctx, id)),
    listInstalled: guard(async () => store.list()),
    runAction: guard((input) => runAction({ ...ctx, egress: options.egress, confirm: options.confirm }, input)),
    setSettings: guard((id, values) => setSettings(ctx, id, values)),
    resolveSettings: guard((id) => resolveSettings(ctx, id)),
    close() {
      store.close();
    },
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
