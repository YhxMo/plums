/** Shared contract error codes. UI copy for these codes lives in src/shell/messages.ts. */
export type ErrorCode =
  | "state.version"
  | "state.corrupt"
  | "state.imports"
  | "state.pages"
  | "state.composition"
  | "host.invalid"
  | "extension.invalid";

export class ContractError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail = "",
    message: string = code,
  ) {
    super(message);
  }
}
