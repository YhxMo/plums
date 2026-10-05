export { VERSION } from "./version.js";

export {
  CAPABILITY_FAILED,
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
  SETTINGS_INVALID,
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
export { MAX_SHARE_BYTES } from "./share.js";

export type { ActionResult, RunActionInput } from "./actions/run-action.js";
export { DEFAULT_CONFIRM_TIMEOUT_MS } from "./capabilities/types.js";
export type {
  AuditEvent, AuditHandler, CapabilityRequest, CapabilityResult, ExecutionState,
  ExecInvocation, ExecRequest, ExecResult, ExecSink, FsEntry, FsLocation, FsRequest,
  FsSink, RunCapabilityInput,
} from "./capabilities/types.js";

export type { ConsentRecord, InstalledPackage, McpApproval } from "./install/store.js";

export { mcpToolFingerprint } from "./mcp/tools.js";
export type { McpApproveResult, McpServerState, McpTool, McpToolCheck, McpToolState } from "./mcp/tools.js";

export { inspectPackage } from "./package/inspect.js";
export type { PackageInspection } from "./package/inspect.js";

export {
  FakeModelProvider,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  RecordingExecSink,
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
  isManifestV1,
  isManifestV2,
} from "./package/types.js";
export type {
  Dependency,
  Manifest,
  ManifestV1,
  ManifestV2,
  PackageContents,
  PackageFiles,
  PackageKind,
  PackageLimits,
  Permission,
  PermissionV1,
  PermissionV2,
  FsPermission,
  FsOperation,
  ExecPermission,
  EgressPermission,
  PermissionLevel,
  SettingSpec,
  SettingsSchema,
} from "./package/types.js";

export { readArchive, readArchiveDetails, createArchive } from "./package/archive.js";
export type { SettingsDescription } from "./install/settings.js";
export type { McpApprovalV2 } from "./install/store.js";
export type { CapabilityCaller, RunDelegatedCapabilityInput } from "./capabilities/types.js";
