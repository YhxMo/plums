/**
 * Experimental: the Mac and Android apps send through a user-confirmed binding;
 * browsers do not provide it. A request POSTs `body` to the bound target, or
 * GETs another plain path on the same site (such as a model list).
 */
export type CredentialRequest =
  | {
      version: 1;
      /** Non-secret alias resolved within the calling extension's platform owner. */
      binding: string;
      /** UTF-8 text, at most 8 MiB; target/method/headers are platform-owned. */
      body: string;
    }
  | {
      version: 1;
      binding: string;
      method: "GET";
      /** Absolute path on the target's host, at most 256 characters: letters, digits and `-._~` segments, no query. */
      path: string;
    };
export interface CredentialResponse {
  status: number;
  /** UTF-8 text, at most 2 MiB. No separate credential field or response headers; remote text may echo secrets. */
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
/**
 * Payload of `credential.connect`. `save` stores the key the user typed with
 * the target shown; `remove` asks for confirmation in a native panel.
 */
export type CredentialConnectRequest =
  | { action: "list" }
  | {
      action: "save";
      /** Omitted for a new connection. */
      alias?: string;
      protocol: string;
      label: string;
      target: string;
      /** Write-only: 1–4096 printable ASCII characters, never returned. */
      key: string;
    }
  | { action: "remove"; alias: string };
export type CredentialConnectResult = {
  alias: string;
  status: "saved" | "cancelled" | "rejected" | "unknown";
  reason?: string;
};
