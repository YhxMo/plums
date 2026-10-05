import * as mcpV2 from "./mcp/tools-v2.js";
import type { McpApprovalV2 } from "./install/store.js";
import { requireInstalled, requireManifest } from "./install/lifecycle.js";
import type { Manifest } from "./package/types.js";
import { rm } from "node:fs/promises";
import { IMPORT_INVALID, PlumsError, SECRET_NOT_FOUND } from "./errors.js";
import path from "node:path";
import { runAction, type ActionResult, type RunActionInput } from "./actions/run-action.js";
import { runCapability } from "./capabilities/run-capability.js";
import { copyDelegatedInput } from "./capabilities/request.js";
import { DEFAULT_CONFIRM_TIMEOUT_MS, type AuditHandler, type CapabilityResult, type ExecSink, type FsSink, type RunCapabilityInput, type RunDelegatedCapabilityInput } from "./capabilities/types.js";
import * as lifecycle from "./install/lifecycle.js";
import { acceptResidualSettings, refuseOrphanSettings } from "./install/check-settings.js";
import { setSettings, resolveSettings, knownSecrets, describeSettings, type SettingsDescription } from "./install/settings.js";
import { redact } from "./redact.js";
import { InstallStore, type ConsentRecord, type InstalledPackage } from "./install/store.js";
import {
  approveMcpTools,
  authorizeMcpTool,
  checkMcpTools,
  getMcpApprovals,
  uninstallManualServer,
  type McpApproveResult,
  type McpServerState,
  type McpTool,
  type McpToolCheck,
} from "./mcp/tools.js";
import type { PermissionLevel } from "./package/types.js";
import type { Confirm, EgressSink, ModelProvider, SecretStore } from "./types.js";
import { exportPackage, preparePackage, type ExportInput, type ExportOptions } from "./package/export.js";
import { assertSafeEntryPath } from "./package/entry-path.js";
import { fetchSharedPackage, shareToFile, readInstalledFiles } from "./share.js";
import { inspectPackage, type PackageInspection } from "./package/inspect.js";
import { PACKAGES_DIR, publishStaged, stagePackage } from "./package/install.js";
import {
  DEFAULT_PACKAGE_LIMITS,
  MANIFEST_FILE,
  type PackageContents,
  type PackageLimits,
} from "./package/types.js";
import { validatePackage } from "./package/validate.js";
import { VERSION } from "./version.js";

export interface CreateCoreOptions {
  dataDir: string;
  model?: ModelProvider;
  egress: EgressSink;
  /** Missing confirmation denies every action that needs it. */
  confirm?: Confirm;
  secrets: SecretStore;
  /** Logical directory names to host-selected paths; copied at creation. */
  roots?: Readonly<Record<string, string>>;
  /** Program identifiers to host-selected executable bindings; copied at creation. */
  programs?: Readonly<Record<string, string>>;
  fs?: FsSink;
  exec?: ExecSink;
  /** Required to execute new capabilities. Events contain no request/result content. */
  onAudit?: AuditHandler;
  /** Capability confirmation only. Defaults to 120000 ms. */
  confirmTimeoutMs?: number;
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
  /** Returns formatVersion, a package summary and its full permission declarations. Writes nothing. */
  inspect(input: Uint8Array | string): Promise<PackageInspection>;
  /**
   * Validates a zip, then writes it to the data directory and records it as installed:
   * not enabled, no consent. Writes nothing if it is invalid. An id that is already
   * installed is IMPORT_INVALID (`details.reason` is `ALREADY_INSTALLED`) and is left
   * unchanged. Same-id imports are serialized only in this process and this data
   * directory. Why: the queue is in memory and keyed by data directory plus id, so
   * another data directory must not wait, and a second process is not ordered by it.
   * That process still returns ALREADY_INSTALLED, and it does not remove or replace
   * the winner's install directory. Use `updatePackage` to move to a higher version.
   * After uninstall, the same id can be imported again.
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
   * and `options.consent` is not true. Crossing format majors requires consent even for empty permission lists
   * (CONSENT_REQUIRED at `/formatVersion`, reason FORMAT_CHANGED). For 2.x, added operations,
   * changed kinds/targets and added cwdRoots require consent; write never implies read.
   * A leftover settings file is checked against this
   * manifest before any files are replaced. No settingsSchema leaves the file unread and
   * the update continues. A mismatch is IMPORT_INVALID and the installed package stays.
   * On success the files are replaced; enabled state stays and an existing consent record
   * is rewritten for the new list.
   * If removed secrets cannot be deleted after that commit, SECRET_NOT_FOUND reports
   * `details: { id, version, reason: SECRET_CLEANUP_FAILED }`. The reported version is
   * already installed. References stay for redaction and a later update or uninstall.
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
  /**
   * Removes files, data, settings, consent, MCP tool approvals and secret references,
   * including fields removed by earlier updates. A failed secret deletion is SECRET_NOT_FOUND
   * with `reason: SECRET_CLEANUP_FAILED`; the install record stays for a retry.
   * The id can then be imported again.
   * A hand-added id (`manual:<name>`) only drops that service's tool approvals. Why: those rows are its
   * fingerprints and its consent, and there is no package to remove.
   */
  uninstall(id: string): Promise<void>;
  listInstalled(): Promise<InstalledPackage[]>;
  getSecretReferences(id: string): Promise<string[]>;
  getPackageContents(id: string): Promise<PackageContents>;
  getPackage(id: string): Promise<{ installed: InstalledPackage; manifest: Manifest }>;
  describeSettings(id: string): Promise<SettingsDescription>;
  runDelegatedCapability(input: RunDelegatedCapabilityInput): Promise<CapabilityResult>;
  checkMcpToolsV2(id: string, tools: McpTool[]): Promise<McpToolCheck[]>;
  approveMcpToolsV2(id: string, permissionId: string, tools: McpTool[]): Promise<McpApprovalV2[]>;
  authorizeMcpToolV2(id: string, permissionId: string, tool: McpTool): Promise<void>;
  getMcpApprovalsV2(id: string): Promise<McpApprovalV2[]>;
  /**
   * Runs one permission-checked action of an installed 1.x extension. A 2.x package is
   * PERMISSION_DENIED at `/formatVersion` (reason FORMAT_API_MISMATCH).
   * The level (read, write,
   * egress) comes from the extension's manifest. Check order: installed, enabled and declared
   * (PERMISSION_DENIED); consent (CONSENT_REQUIRED); the egress url against the permission
   * (PERMISSION_DENIED); confirm.ask for write and egress (CONFIRMATION_DENIED); then those
   * checks again. Egress `send` receives the request with `url` set to `new URL(url).href`.
   * A write whose level changes during confirmation is PERMISSION_DENIED at
   * `/permissions/<i>` with `reason: LEVEL_MISMATCH`.
   */
  runAction(input: RunActionInput): Promise<ActionResult>;
  /**
   * Executes one 2.x extension capability through an injected sink. Validates and copies
   * the request, checks installation/enabling/declaration/consent and scope, asks for each
   * write/exec/egress call, rechecks authorization and real paths, audits allow, executes
   * once and audits the result. 1.x uses runAction. Read/list do not prompt.
   * Missing/failing pre-execution audit prevents execution. CAPABILITY_FAILED includes callId, phase
   * and executionState; completed or unknown must never be automatically retried.
   * Filesystem checks read metadata only; the host sink enforces boundaries during I/O.
   */
  runCapability(input: RunCapabilityInput): Promise<CapabilityResult>;
  /**
   * MCP tools. The core never connects to a server: the host passes the tool list it read.
   * Package MCP APIs only accept 1.x connectors; 2.x returns PERMISSION_DENIED at
   * `/formatVersion` with reason FORMAT_API_MISMATCH. Hand-added services are unchanged.
   * `serverId` is an installed connector package id, or `manual:<lowercase-name>` for a service the
   * user added by hand (unverified: read-only until a tool is granted one by one).
   * A tool name is 1-128 characters of `A-Za-z0-9_.-`, otherwise TypeError. For a connector the tool
   * name must equal a manifest permission id, which sets its level.
   * Why a hash: a changed name, description, or inputSchema can change what a tool does, so it counts as a new permission.
   *
   * Compares `tools` with the approvals. `ADDED`: never approved. `CHANGED`: the name, description, or inputSchema hash differs.
   * A renamed tool is a new name (`ADDED`). A tool that is not in this list loses its approval, and an
   * empty list drops every tool approval for this server. Package consent and other servers stay. A list
   * that fails validation is not applied. Why: the old consent must not come back when that name returns,
   * and a failed check is not a new list. The returned list does not include a tool that was dropped.
   * The host must pass the full list. Do not pass `[]` or a subset when a fetch fails or only the first
   * page arrived, or the other tools lose their fingerprint and consent. This call deletes tools that
   * have disappeared (it has a delete side effect).
   */
  checkMcpTools(serverId: string, tools: McpTool[]): Promise<McpToolCheck[]>;
  /**
   * Records each tool's current fingerprint: the user's (re)consent to that name, description, and inputSchema. The host must
   * call this only after the user has agreed. Why: the kernel does not connect to an MCP server, so it
   * cannot check that agreement itself. `enable` and `grantConsent` do not record fingerprints.
   * Replaces an earlier approval of the same tool. A connector tool without a matching manifest permission
   * is skipped (`NOT_DECLARED`). A hand-added tool above `read` is skipped (`UNVERIFIED_READ_ONLY`)
   * unless its name is in `allowNonRead` (a name not in `tools` is TypeError).
   */
  approveMcpTools(serverId: string, tools: McpTool[], allowNonRead?: string[]): Promise<McpApproveResult>;
  /**
   * Checks one call, runs nothing. Connector order: installed, enabled, declared, consented (as
   * `runAction`); then the tool's hash. No approval is CONSENT_REQUIRED `reason: 'TOOL_ADDED'`, a different
   * hash is `TOOL_CHANGED`; path `/tools/<name>`, details `{ id, tool, reason, fingerprint, approvedFingerprint? }`.
   * Hand-added: an unapproved tool above `read` is PERMISSION_DENIED `UNVERIFIED_READ_ONLY`. After approval
   * the recorded level is used; a different `level` on the call is PERMISSION_DENIED
   * (`details.reason` is `LEVEL_MISMATCH`) and does not skip confirm. Then `confirm.ask` for write and
   * egress (CONFIRMATION_DENIED). If the level changes before the second check, PERMISSION_DENIED with
   * the same `LEVEL_MISMATCH` and the call does not succeed. Returns the level from that second
   * check. The description and inputSchema are never shown in the confirm message.
   */
  authorizeMcpTool(serverId: string, tool: McpTool): Promise<{ level: PermissionLevel }>;
  /** What is approved for the server, and whether it is unverified. Read-only. */
  getMcpApprovals(serverId: string): Promise<McpServerState>;
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
  if (options.model !== undefined) requireMethod(options.model, "model", "complete");
  requireMethod(options.egress, "egress", "send");
  if (options.confirm !== undefined) requireMethod(options.confirm, "confirm", "ask");
  requireMethod(options.secrets, "secrets", "get");
  requireMethod(options.secrets, "secrets", "set");
  requireMethod(options.secrets, "secrets", "delete");
  if (options.fs !== undefined) {
    for (const method of ["read", "write", "list"]) requireMethod(options.fs, "fs", method);
  }
  if (options.exec !== undefined) requireMethod(options.exec, "exec", "run");
  if (options.onAudit !== undefined && typeof options.onAudit !== "function") throw new TypeError("createCore onAudit must be a function");
  const confirmTimeoutMs = options.confirmTimeoutMs === undefined ? DEFAULT_CONFIRM_TIMEOUT_MS : options.confirmTimeoutMs;
  if (!Number.isInteger(confirmTimeoutMs) || confirmTimeoutMs <= 0 || confirmTimeoutMs > 2_147_483_647) throw new TypeError("createCore confirmTimeoutMs must be a positive timer integer");
  const roots = copyBindings(options.roots, "roots", true);
  const programs = copyBindings(options.programs, "programs", false);
  const confirm: Confirm = options.confirm ?? { async ask() { return false; } };

  const limits = resolveLimits(options.limits);
  const resolvedDataDir = path.resolve(dataDir);
  const store = new InstallStore(resolvedDataDir);
  const ctx = { dataDir: resolvedDataDir, store, secrets: options.secrets };
  const capabilityCtx = { ...ctx, roots, programs, fs: options.fs, exec: options.exec,
    egress: options.egress, confirm: options.confirm, confirmTimeoutMs, onAudit: options.onAudit };
  const importPackage = async (input: Uint8Array | string): Promise<ImportedPackage> => {
    const validated = await validatePackage(input, limits);
    // Why a per-id chain, and only inside this process: the map lives in memory
    // and is keyed by data directory plus id, so it orders callers that share
    // this process and this data directory. Another data directory must not wait.
    // The later caller gets ALREADY_INSTALLED. Two processes both pass the check below.
    return enqueueById(resolvedDataDir, validated.manifest.id, async () => {
      store.open();
      // Why before mkdir of packages/ or a staging directory: an id that is already
      // installed is refused, and that refusal must not create an install root.
      if (store.get(validated.manifest.id) !== undefined) {
        throw alreadyInstalled(validated.manifest);
      }
      // Why before any package file is written: a leftover settings file must not
      // leave a package directory behind.
      if (validated.manifest.settingsSchema === undefined) {
        refuseOrphanSettings(resolvedDataDir, validated.manifest.id);
      } else {
        await acceptResidualSettings(resolvedDataDir, validated.manifest);
      }
      const staging = await stagePackage(resolvedDataDir, validated);
      try {
        store.recordInstall(validated.manifest);
      } catch (err) {
        // Why only the staging directory: packages/<id> may already be the winner's
        // installDir. Deleting that path left a row whose directory was gone.
        await rm(staging, { recursive: true, force: true });
        if (isInstallKeyConflict(err)) throw alreadyInstalled(validated.manifest);
        throw err;
      }
      const installDir = path.join(resolvedDataDir, PACKAGES_DIR, validated.manifest.id);
      try {
        // Why after the insert: only the process that owns the row may replace
        // packages/<id>. The loser never reaches this line.
        await publishStaged(staging, installDir);
      } catch (err) {
        // Why drop the row: the insert was ours and the files did not land, so a
        // later import is not stuck with a record and no directory.
        store.remove(validated.manifest.id);
        throw err;
      }
      return { manifest: validated.manifest, files: validated.files, installDir };
    });
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
          // Why neither error: the failed read and the original error can both quote a secret.
          throw new PlumsError({
            code: SECRET_NOT_FOUND,
            message: "读取密钥失败，原来的错误已隐藏，以免带出密钥。",
          });
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
    importFromUrl: guard(async (url) => importPackage(await fetchSharedPackage(url, options.egress, confirm))),
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
    uninstall: guard(async (id) => {
      if (typeof id === "string" && id.startsWith("manual:")) {
        uninstallManualServer(ctx, id);
        return;
      }
      return lifecycle.uninstall(ctx, id);
    }),
    listInstalled: guard(async () => store.list()),
    getSecretReferences: guard(async (id) => { requireInstalled(ctx, id); return store.getSecretRefs(id); }),
    getPackageContents: guard(async (id) => {
      requireInstalled(ctx, id);
      const manifest = requireManifest(ctx, id);
      const files = await readInstalledFiles(path.join(resolvedDataDir, PACKAGES_DIR, id));
      const checked = preparePackage({ manifest, files }, limits, await knownSecrets(ctx));
      assertSafeEntryPath(MANIFEST_FILE, limits);
      return { manifest: checked.manifest, files: Object.fromEntries(checked.files.map(([name, data]) => [name, new Uint8Array(data)])) };
    }),
    getPackage: guard(async (id) => ({ installed: requireInstalled(ctx, id), manifest: requireManifest(ctx, id) })),
    describeSettings: guard((id) => describeSettings(ctx, id)),
    runDelegatedCapability: (raw) => {
      const input = copyDelegatedInput(raw);
      const gate = input.mcpTool ? () => mcpV2.authorizeMcpToolV2(ctx, input.packageId, input.permissionId, input.mcpTool!) : undefined;
      return runCapability(capabilityCtx, { extensionId: input.packageId, permissionId: input.permissionId, request: input.request }, input.callers, true, gate);
    },
    checkMcpToolsV2: guard(async (id, tools) => mcpV2.checkMcpToolsV2(ctx, id, tools)),
    approveMcpToolsV2: guard(async (id, permissionId, tools) => mcpV2.approveMcpToolsV2(ctx, id, permissionId, tools)),
    authorizeMcpToolV2: guard(async (id, permissionId, tool) => mcpV2.authorizeMcpToolV2(ctx, id, permissionId, tool)),
    getMcpApprovalsV2: guard(async (id) => { requireInstalled(ctx, id); return store.listMcpV2(id); }),
    runAction: guard((input) => runAction({ ...ctx, egress: options.egress, confirm }, input)),
    // This entry point owns its redaction so an audit failure cannot obscure executionState.
    runCapability: (input) => runCapability(capabilityCtx, input),
    checkMcpTools: guard(async (serverId, tools) => checkMcpTools(ctx, serverId, tools)),
    approveMcpTools: guard(async (serverId, tools, allowNonRead) => approveMcpTools(ctx, serverId, tools, allowNonRead)),
    authorizeMcpTool: guard((serverId, tool) => authorizeMcpTool({ ...ctx, confirm }, serverId, tool)),
    getMcpApprovals: guard(async (serverId) => getMcpApprovals(ctx, serverId)),
    setSettings: guard((id, values) => setSettings(ctx, id, values)),
    resolveSettings: guard((id) => resolveSettings(ctx, id)),
    close() {
      store.close();
    },
  };
}

const importQueue = new Map<string, Promise<void>>();

function alreadyInstalled(manifest: { id: string; name: string }): PlumsError {
  // Why this sentence and these details: the installed check already reports
  // IMPORT_INVALID with reason ALREADY_INSTALLED and no path.
  // Why no cause: the SQLite message names the table, and that string must not ride along.
  return new PlumsError({
    code: IMPORT_INVALID,
    message: `「${manifest.name}」已经安装了。要换版本请更新它，不要再次导入。`,
    details: { id: manifest.id, reason: "ALREADY_INSTALLED" },
  });
}

function isInstallKeyConflict(err: unknown): boolean {
  // Why the code only: PRIMARY KEY and UNIQUE are the constraint failures of an
  // id that is already installed. The message is not copied onto the PlumsError.
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = (err as { code?: unknown }).code;
  return code === "SQLITE_CONSTRAINT_PRIMARYKEY" || code === "SQLITE_CONSTRAINT_UNIQUE";
}

function enqueueById<T>(dataDir: string, id: string, task: () => Promise<T>): Promise<T> {
  // Why NUL: a resolved data directory and a package id cannot contain it, so two pairs cannot share a key.
  const key = `${dataDir}\0${id}`;
  const previous = importQueue.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  importQueue.set(key, settled);
  void settled.then(() => {
    if (importQueue.get(key) === settled) importQueue.delete(key);
  });
  return run;
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

function copyBindings(value: Readonly<Record<string, string>> | undefined, name: string, directory: boolean): ReadonlyMap<string, string> {
  if (value === undefined) return new Map();
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`createCore ${name} must be a binding record`);
  const bindings = new Map<string, string>();
  for (const [key, binding] of Object.entries(value)) {
    if (key.trim() === "" || key.includes("\0") || typeof binding !== "string" || binding.trim() === "" || binding.includes("\0")) throw new TypeError(`createCore ${name} must contain non-empty names and bindings`);
    bindings.set(key, directory ? path.resolve(binding) : binding);
  }
  return bindings;
}
