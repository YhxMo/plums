/** Experimental, session-only native document access. Host picker owns locations. */
export interface SelectedDocumentRequest {
  handle: string;
  /** Maximum UTF-8 response bytes, 1..65536. No silent truncation. */
  maxBytes: number;
}
export type SelectedDocumentResponse =
  | { status: "read"; text: string; bytes: number }
  | {
      status: "rejected";
      reason:
        | "unavailable"
        | "denied"
        | "invalid-request"
        | "too-large"
        | "io"
        | "encoding"
        | "resource-limit"
        | "busy";
    }
  | { status: "cancelled" }
  | { status: "unknown" };

export interface SelectedDocument {
  handle: string;
  name: string;
}
