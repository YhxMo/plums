import { rm } from "node:fs/promises";
import { IMPORT_INVALID, PlumsError } from "./errors.js";
import path from "node:path";
import { runAction, type ActionResult, type RunActionInput } from "./actions/run-action.js";
import * as lifecycle from "./install/lifecycle.js";
import { acceptResidualSettings } from "./install/check-settings.js";
import { setSettings, resolveSettings, knownSecrets } from "./install/settings.js";
import { redact } from "./redact.js";
import { InstallStore, type ConsentRecord, type InstalledPackage } from "./install/store.js";
import type { Confirm, EgressSink, ModelProvider, SecretStore } from "./types.js";
import { exportPackage, type ExportInput, type ExportOptions } from "./package/export.js";
import { fetchSharedPackage, shareToFile } from "./share.js";
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
   * not enabled, no consent. Writes nothing if it is invalid. An id that is already
   * installed is IMPORT_INVALID (`details.reason` is `ALREADY_INSTALLED`) and is left
   * unchanged. Use `updatePackage` to move to a higher version. After uninstall, the
   * same id can be imported again.
   * If `data/<id>/settings.json` is already there, it is checked before any package
   * files are written. A missing required field, a wrong type, or a tighter bound is
   * IMPORT_INVALID at `/settings/<key>`. A file that is not JSON, or a package with no
   * settingsSchema, is IMPORT_INVALID at `/settings` (`details.reason` is `NOT_JSON` or
   * `NO_SCHEMA`; the file is not read when there is no schema). Nothing is written and
   * no install record is created. The leftover file stays. To import a package that
   * declares no settings, delete `data/<id>/settings.json` first.
   */
  importPackage(input: Uint8Array | string): Promise<ImportedPackage>;
  /**
   * Downloads `url` through one `egress.send` and imports it with `importPackage` (not enabled, no consent).
   * The URL uses the same https check as egress, without matching a host: https only, no username or
   * password, and the host must not be an IP literal, a name ending in `.`, or `localhost` / `*.localhost`. `confirm.ask` runs before the download; its
   * message names the host, states the reason, asks 允许吗, and does not include the URL. A missing `ask`, a throw, or any answer other
   * than `true` is CONFIRMATION_DENIED at `/url`.
   * `egress.send` is given `{ url: parsed.href, method: "GET" }`: the parsed URL, not the raw string
   * (host lowercased, default port 443 omitted; query and fragment kept).
   * A `redirectTo` on that single response is SHARE_FETCH_FAILED at `/url`. The core does not follow it.
   * Other download failures use the same code and path, with `details: { url, reason }`.
   * `url` keeps scheme, host, and path: no query, no user info, and no fragment. `reason` is INVALID_URL, NOT_HTTPS, USERINFO, IP_LITERAL,
   * TRAILING_DOT, LOCALHOST, NETWORK, HTTP_STATUS, REDIRECT, TOO_LARGE, or NOT_A_ZIP.
   * An id that is already installed is IMPORT_INVALID with `details.reason` `ALREADY_INSTALLED`
   * and writes nothing.
   * The body is latin1 and must be at most `MAX_SHARE_BYTES` (20 MiB) and start with a zip local-file header.
   * A character above 0xFF is NOT_A_ZIP and is not truncated to a byte.
   * A zip that fails package checks still throws MANIFEST_INVALID, FORMAT_UNSUPPORTED, or IMPORT_INVALID.
   * Nothing is written to the data directory when the call fails.
   */
  importFromUrl(url: string): Promise<ImportedPackage>;
  /**
   * Updates an installed package to a higher version (the id comes from the zip). Throws
   * PERMISSION_DENIED (not installed), IMPORT_INVALID at `/kind` (kind changed) or `/version`
   * (not higher), DEPENDENCY_MISSING (a required dependency of the new version), or
   * CONSENT_REQUIRED at `/permissions/<i>` when the new version adds or raises a permission
   * and `options.consent` is not true. A leftover settings file is checked against this
   * manifest before any files are replaced. No settingsSchema leaves the file unread and
   * the update continues. A mismatch is IMPORT_INVALID and the installed package stays.
   * On success the files are replaced; enabled state stays and an existing consent record
   * is rewritten for the new list.
   */
  updatePackage(input: Uint8Array | string, options?: { consent?: boolean }): Promise<UpdatedPackage>;
  /** Builds a package zip. Also writes it to `options.outPath` when given. */
  exportPackage(input: ExportInput, options?: ExportOptions): Promise<Uint8Array>;
  /**
   * Writes installed package `id` to `path` via `exportPackage` (same secret check) and returns the bytes.
   * The parent directory must already exist. A package that is not installed is PERMISSION_DENIED
   * (`details.reason` is `NOT_INSTALLED`) and the file is not created.
   */
  shareToFile(id: string, path: string): Promise<Uint8Array>;
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
   * (PERMISSION_DENIED); consent (CONSENT_REQUIRED); the egress url against the permission
   * (PERMISSION_DENIED); confirm.ask for write and egress (CONFIRMATION_DENIED); then those
   * checks again. Egress `send` receives the request with `url` set to `new URL(url).href`.
   */
  runAction(input: RunActionInput): Promise<ActionResult>;
  /**
   * Replaces the package's saved settings (`<dataDir>/data/<id>/settings.json`).
   * Values are checked against settingsSchema before anything is written: required and types,
   * then defaults are filled, then minimum/maximum/enum. A failure is SETTINGS_INVALID at
   * `/settings/<key>` (`details` is `{ key, reason }`) and the file is left untouched.
   * The message does not include the rejected value. A field marked `x-secret` must hold
   * exactly `secretRef(id, key)`, and the SecretStore must already hold a value for it.
   * Otherwise throws SECRET_NOT_FOUND at `/settings/<key>` (`details.reason` is
   * `NOT_A_SECRET_REF` or `NOT_FOUND`) and writes nothing.
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
  const importPackage = async (input: Uint8Array | string): Promise<ImportedPackage> => {
    const validated = await validatePackage(input, limits);
    store.open();
    if (store.get(validated.manifest.id) !== undefined) {
      throw new PlumsError({
        code: IMPORT_INVALID,
        message: `「${validated.manifest.name}」已经安装了。要换版本请更新它，不要再次导入。`,
        details: { id: validated.manifest.id, reason: "ALREADY_INSTALLED" },
      });
    }
    // Why before installPackage: a leftover file must not leave a package directory behind.
    // Why "reject": there is no install record yet, so the file is an orphan.
    await acceptResidualSettings(resolvedDataDir, validated.manifest, "reject");
    const installDir = await installPackage(resolvedDataDir, validated);
    try {
      store.recordInstall(validated.manifest);
    } catch (err) {
      await rm(installDir, { recursive: true, force: true });
      throw err;
    }
    return { manifest: validated.manifest, files: validated.files, installDir };
  };

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
    importPackage: guard(importPackage),
    importFromUrl: guard(async (url) => importPackage(await fetchSharedPackage(url, options.egress, options.confirm))),
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
    shareToFile: guard((id, filePath) => shareToFile(ctx, limits, id, filePath)),
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
