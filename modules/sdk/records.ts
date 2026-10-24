/** A document write in `state.batch`, shaped like a `state.write` payload. */
export interface DocumentWrite {
  /** Omitted or null for the main document. */
  key?: string | null;
  /** The current revision; 0 when the document does not exist yet. */
  revision: number;
  value?: unknown;
  remove?: true;
}

/** A record write in `state.batch`; `revision` is checked like a document's. */
export interface RecordWrite {
  collection: string;
  id: string;
  revision: number;
  value?: unknown;
  /** Another record's id, kept as is; branching views use it. */
  parent?: string | null;
  /** The text `records.search` finds this record by; not derived from `value`. */
  text?: string | null;
  remove?: true;
}

/**
 * Committed together or not at all: documents first, then the `clear`ed
 * collections are emptied, then records are written.
 */
export interface StateBatch {
  documents?: DocumentWrite[];
  clear?: string[];
  records?: RecordWrite[];
}

/** Receipts in request order; null for a removal. */
export interface StateBatchReceipt {
  documents: ({ revision: number } | null)[];
  records: ({ seq: number; revision: number } | null)[];
}

export interface StoredRecord {
  collection: string;
  id: string;
  /** Position in the owner's storage; a new record comes after every earlier one. */
  seq: number;
  parent: string | null;
  revision: number;
  value: unknown;
  text: string | null;
}

export interface RecordListRequest {
  collection: string;
  /** `next` from the previous page. */
  after?: string | null;
  /** 1–200, default 50. */
  limit?: number;
  /** By `seq`; default "asc". */
  order?: "asc" | "desc";
}

/** A page also ends before its values and text pass 16 MiB, keeping at least one record. */
export interface RecordPage {
  records: StoredRecord[];
  /** Pass as `after` for the following page; null on the last page. */
  next: string | null;
}

/** Pages newest first, like `records.list` with `order: "desc"`. */
export interface RecordSearchRequest {
  /** Trimmed; 1–256 characters. Matches inside words; ASCII letters ignore case. */
  query: string;
  collection?: string | null;
  after?: string | null;
  /** 1–100, default 20. */
  limit?: number;
}

/** Whether `name` can be a collection, record id or `parent`. */
export const isRecordName = (name: unknown): name is string =>
  typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(name);
