/** Experimental design only. Production PlatformAdapter does not expose document.read. */
export interface SelectedDocumentRequest {
  handle: string;
  /** Maximum UTF-8 response bytes, 1..65536. No silent truncation. */
  maxBytes: number;
}
export type SelectedDocumentResponse =
  | { status: "read"; text: string; bytes: number }
  | {
      status: "rejected";
      reason: "unavailable" | "denied" | "invalid-request" | "too-large";
    }
  | { status: "cancelled" }
  | { status: "unknown" };
