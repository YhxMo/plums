export { VERSION } from "./version.js";

export {
  CONFIRMATION_DENIED,
  CONSENT_REQUIRED,
  DEPENDENCY_MISSING,
  ERROR_CODES,
  FORMAT_UNSUPPORTED,
  IMPORT_INVALID,
  MANIFEST_INVALID,
  PERMISSION_DENIED,
  PlumsError,
  SECRET_NOT_FOUND,
  SHARE_FETCH_FAILED,
} from "./errors.js";
export type { PlumsErrorCode, PlumsErrorOptions } from "./errors.js";

export type {
  Confirm,
  ConfirmRequest,
  EgressRequest,
  EgressResult,
  EgressSink,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  SecretStore,
} from "./types.js";

export { createCore } from "./create-core.js";
export type { Core, CreateCoreOptions, ImportedPackage, UpdatedPackage } from "./create-core.js";

export type { ActionResult, RunActionInput } from "./actions/run-action.js";

export type { ConsentRecord, InstalledPackage } from "./install/store.js";

export { inspectPackage } from "./package/inspect.js";
export type { PackageInspection } from "./package/inspect.js";

export {
  FakeModelProvider,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
} from "./fakes.js";

export { REDACTED, redact } from "./redact.js";
export { secretRef } from "./secrets.js";

export { validatePackage } from "./package/validate.js";
export type { ValidatedPackage } from "./package/validate.js";
export type { ExportInput, ExportOptions } from "./package/export.js";
export {
  DEFAULT_PACKAGE_LIMITS,
  PACKAGE_FORMAT_VERSION,
  SUPPORTED_FORMAT_MAJOR,
} from "./package/types.js";
export type {
  Dependency,
  Manifest,
  PackageContents,
  PackageFiles,
  PackageKind,
  PackageLimits,
  Permission,
  PermissionLevel,
  SettingSpec,
  SettingsSchema,
} from "./package/types.js";
