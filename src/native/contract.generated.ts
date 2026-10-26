// Generated from compiled Rust IPC declarations. Do not edit.
export interface NativeCommands {
  credential_supported: {
    args: Record<string, never>;
    response: boolean;
    error: never;
  };
  credential_list: {
    args: { owner: string };
    response: Array<{
      owner: string;
      alias: string;
      source: string;
      version: string;
      declaration: {
        label: string;
        target: string;
        contentType: string;
        headers: Record<string, string>;
        authentication: { type: "bearer" } | { type: "header"; name: string };
      };
      route: { type: "direct" } | { type: "proxy"; url: string };
      revision: number;
      status: "pending" | "ready" | "disabled" | "delete-pending";
    }>;
    error: string;
  };
  credential_inventory: {
    args: Record<string, never>;
    response: Array<{
      owner: string;
      alias: string;
      source: string;
      version: string;
      declaration: {
        label: string;
        target: string;
        contentType: string;
        headers: Record<string, string>;
        authentication: { type: "bearer" } | { type: "header"; name: string };
      };
      route: { type: "direct" } | { type: "proxy"; url: string };
      revision: number;
      status: "pending" | "ready" | "disabled" | "delete-pending";
    }>;
    error: string;
  };
  credential_retain: {
    args: { owner: string };
    response:
      | { status: "saved" }
      | { status: "cancelled" }
      | { status: "rejected"; reason: string }
      | { status: "unknown" };
    error: never;
  };
  credential_configure: {
    args: {
      owner: string;
      alias: string;
      source: string;
      version: string;
      declaration: {
        label: string;
        target: string;
        contentType: string;
        headers: Record<string, string>;
        authentication: { type: "bearer" } | { type: "header"; name: string };
      };
      revision: number;
      key: string;
    };
    response:
      | { status: "saved" }
      | { status: "cancelled" }
      | { status: "rejected"; reason: string }
      | { status: "unknown" };
    error: never;
  };
  credential_route: {
    args: { owner: string; alias: string; revision: number };
    response:
      | { status: "saved" }
      | { status: "cancelled" }
      | { status: "rejected"; reason: string }
      | { status: "unknown" };
    error: never;
  };
  credential_reconcile: {
    args: { owner: string; alias: string; revision: number };
    response:
      | { status: "saved" }
      | { status: "cancelled" }
      | { status: "rejected"; reason: string }
      | { status: "unknown" };
    error: never;
  };
  credential_delete: {
    args: { owner: string; alias: string; revision: number };
    response:
      | { status: "saved" }
      | { status: "cancelled" }
      | { status: "rejected"; reason: string }
      | { status: "unknown" };
    error: never;
  };
  credential_request: {
    args: {
      owner: string;
      id: string;
      binding: string;
      body: string;
      path?: string | null;
    };
    response: { status: number; body: string };
    error: { code: string; outcome: string };
  };
  credential_abort: {
    args: { owner: string; id: string };
    response: null;
    error: never;
  };
  credential_release: { args: { owner: string }; response: null; error: never };
  document_supported: {
    args: Record<string, never>;
    response: boolean;
    error: never;
  };
  document_select: {
    args: { owner: string; multiple: boolean; operationId: string };
    response:
      | {
          status: "selected";
          documents: Array<{ handle: string; name: string }>;
        }
      | { status: "cancelled" }
      | { status: "rejected"; reason: string }
      | { status: "unknown" };
    error: never;
  };
  document_list: {
    args: { owner: string };
    response: Array<{ handle: string; name: string }>;
    error: string;
  };
  document_read: {
    args: {
      owner: string;
      handle: string;
      maxBytes: number;
      operationId: string;
    };
    response:
      | { status: "read"; text: string; bytes: number }
      | { status: "cancelled" }
      | { status: "rejected"; reason: string }
      | { status: "unknown" };
    error: never;
  };
  document_cancel: {
    args: { owner: string; operationId: string };
    response: null;
    error: string;
  };
  document_revoke: {
    args: { owner: string; handle?: string | null };
    response: null;
    error: string;
  };
  network_read: {
    args: { owner: string; id: string; url: string };
    response: { status: number; body: string };
    error: { code: string; outcome: string };
  };
  network_abort: {
    args: { owner: string; id: string };
    response: null;
    error: never;
  };
  network_release: { args: { owner: string }; response: null; error: never };
  link_open: {
    args: { owner: string; url: string };
    response: null;
    error: string;
  };
  file_save: {
    args: { owner: string; name: string; data: string };
    response: string;
    error: string;
  };
  platform_grant: {
    args: { owner: string; capabilities: Array<string> };
    response: null;
    error:
      | "invalid-owner"
      | "invalid-key"
      | "unknown-capability"
      | "grant-lock"
      | "grant-unavailable"
      | "state-lock"
      | "state-too-large"
      | "state-corrupt"
      | "state-schema"
      | "state-read"
      | "missing-revision"
      | "missing-value"
      | "revision-limit"
      | "revision-conflict"
      | "state-directory"
      | "state-write"
      | "state-sync"
      | "permission-denied"
      | "serialization"
      | "invalid-batch"
      | "invalid-collection"
      | "invalid-record"
      | "invalid-query";
  };
  platform_call: {
    args: { owner: string; capability: string; payload?: unknown | null };
    response: unknown;
    error: {
      code:
        | "invalid-owner"
        | "invalid-key"
        | "unknown-capability"
        | "grant-lock"
        | "grant-unavailable"
        | "state-lock"
        | "state-too-large"
        | "state-corrupt"
        | "state-schema"
        | "state-read"
        | "missing-revision"
        | "missing-value"
        | "revision-limit"
        | "revision-conflict"
        | "state-directory"
        | "state-write"
        | "state-sync"
        | "permission-denied"
        | "serialization"
        | "invalid-batch"
        | "invalid-collection"
        | "invalid-record"
        | "invalid-query";
      outcome: "not-committed" | "unknown";
    };
  };
  shell_set_theme: {
    args: { theme: "system" | "light" | "dark" };
    response: null;
    error: string;
  };
}
