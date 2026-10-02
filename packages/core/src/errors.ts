export const MANIFEST_INVALID = "MANIFEST_INVALID" as const;
export const FORMAT_UNSUPPORTED = "FORMAT_UNSUPPORTED" as const;
export const DEPENDENCY_MISSING = "DEPENDENCY_MISSING" as const;
export const CONSENT_REQUIRED = "CONSENT_REQUIRED" as const;
export const PERMISSION_DENIED = "PERMISSION_DENIED" as const;
export const CONFIRMATION_DENIED = "CONFIRMATION_DENIED" as const;
export const SECRET_NOT_FOUND = "SECRET_NOT_FOUND" as const;
export const IMPORT_INVALID = "IMPORT_INVALID" as const;
export const SHARE_FETCH_FAILED = "SHARE_FETCH_FAILED" as const;

export const ERROR_CODES = Object.freeze([
  MANIFEST_INVALID,
  FORMAT_UNSUPPORTED,
  DEPENDENCY_MISSING,
  CONSENT_REQUIRED,
  PERMISSION_DENIED,
  CONFIRMATION_DENIED,
  SECRET_NOT_FOUND,
  IMPORT_INVALID,
  SHARE_FETCH_FAILED,
] as const);

export type PlumsErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export interface PlumsErrorOptions {
  code: PlumsErrorCode;
  message: string;
  /** JSON Pointer with a leading slash, for example `/permissions/0/level`. */
  path?: string;
  details?: unknown;
}

export class PlumsError extends Error {
  readonly code: PlumsErrorCode;
  readonly path?: string;
  readonly details?: unknown;

  constructor(options: PlumsErrorOptions) {
    if (options === null || typeof options !== "object" || typeof options.message !== "string") {
      throw new TypeError("PlumsError message must be a string");
    }
    if (!ERROR_CODE_SET.has(options.code)) {
      throw new TypeError(`Unknown PlumsError code: ${String(options.code)}`);
    }
    super(options.message);
    this.name = "PlumsError";
    this.code = options.code;
    if (options.path !== undefined) {
      assertJsonPointer(options.path);
      this.path = options.path;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

function assertJsonPointer(path: string): void {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError(
      "PlumsError.path must be a JSON Pointer starting with '/' (for example '/permissions/0/level')",
    );
  }
}
