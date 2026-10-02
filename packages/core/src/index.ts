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
export type { Core, CreateCoreOptions } from "./create-core.js";

export {
  FakeModelProvider,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
} from "./fakes.js";

export { REDACTED, redact } from "./redact.js";
