/** Experimental: the Mac and Android apps send through a user-confirmed binding; browsers do not provide it. */
export interface CredentialRequest {
  version: 1;
  /** Non-secret alias resolved within the calling extension's platform owner. */
  binding: string;
  /** UTF-8 text, at most 65536 bytes; target/method/headers are platform-owned. */
  body: string;
}
export interface CredentialResponse {
  status: number;
  /** UTF-8 text, at most 8192 bytes. No separate credential field or response headers; remote text may echo secrets. */
  body: string;
}
/** Dispatched failures may already have remote effects; they are never auto-retried. */
export type CredentialFailureOutcome = "not-dispatched" | "unknown";
/** A connection an extension made from one of its `credentialProtocols`. */
export interface CredentialConnection {
  alias: string;
  /** The template it matches; absent if the template no longer exists. */
  protocol?: string;
  label: string;
  target: string;
  status: "pending" | "ready" | "disabled" | "delete-pending";
}
/** Payload of `credential.connect`. `save` and `remove` ask the user in a native panel. */
export type CredentialConnectRequest =
  | { action: "list" }
  | {
      action: "save";
      /** Omitted for a new connection. */
      alias?: string;
      protocol: string;
      label: string;
      target: string;
    }
  | { action: "remove"; alias: string };
export type CredentialConnectResult = {
  alias: string;
  status: "saved" | "cancelled" | "rejected" | "unknown";
  reason?: string;
};
