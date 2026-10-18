/** Experimental: the Mac and Android apps send through a user-confirmed binding; browsers do not provide it. */
export interface CredentialRequest {
  version: 1;
  /** Non-secret alias resolved within the calling extension's platform owner. */
  binding: string;
  /** UTF-8 text, at most 4096 bytes; target/method/headers are platform-owned. */
  body: string;
}
export interface CredentialResponse {
  status: number;
  /** UTF-8 text, at most 8192 bytes. No separate credential field or response headers; remote text may echo secrets. */
  body: string;
}
/** Dispatched failures may already have remote effects; they are never auto-retried. */
export type CredentialFailureOutcome = "not-dispatched" | "unknown";
