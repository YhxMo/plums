import {
  isRecordName,
  type RecordPage,
  type StoredRecord,
  type StoredState,
} from "@modules/sdk";
import { isStateErrorCode, stateRejection } from "./native/state-errors";

/**
 * The browser preview's owner storage in localStorage, with the native
 * Broker's rules and limits (src-tauri/src/storage.rs). Documents keep one
 * key each; an owner's records share one key, so a batch writes a few keys
 * and puts the earlier values back if one of them fails.
 */

/** Largest document, envelope included. */
const MAX_DOCUMENT = 1 << 20;
/** Largest record's value and text. */
const MAX_RECORD = 8 << 20;
/** Values and text one list or search page returns. */
const MAX_PAGE_BYTES = 16 << 20;
const MAX_BATCH_OPERATIONS = 1000;
const MAX_BATCH_BYTES = 16 << 20;

const bytes = (text: string) => new TextEncoder().encode(text).length;
type Payload = Record<string, unknown>;
const fields = (payload: unknown): Payload =>
  payload && typeof payload === "object" ? (payload as Payload) : {};
/** A field that is absent or null. */
const absent = (payload: Payload, field: string) =>
  payload[field] === undefined || payload[field] === null;

/** Same key rule as the native Broker; `+` separates owner and key. */
function documentKey(owner: string, payload: Payload) {
  const key = payload.key;
  if (key === undefined || key === null) return `plums:m1:${owner}`;
  if (typeof key !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(key))
    throw stateRejection("invalid-key");
  return `plums:m1:${owner}+${key}`;
}
const recordsKey = (owner: string) => `plums:m1:${owner}#records`;

function storedDocument(raw: string | null): StoredState | null {
  if (raw === null) return null;
  if (bytes(raw) > MAX_DOCUMENT) throw stateRejection("state-too-large");
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw stateRejection("state-corrupt");
  }
  if (typeof saved !== "object" || saved === null || Array.isArray(saved))
    throw stateRejection("state-corrupt");
  const document = saved as Payload;
  if (
    document.schema !== 1 ||
    !Number.isSafeInteger(document.revision) ||
    Number(document.revision) < 1 ||
    !Object.hasOwn(document, "value")
  )
    throw stateRejection("state-schema");
  return document as unknown as StoredState;
}

type Records = { schema: 1; seq: number; records: StoredRecord[] };
function storedRecords(raw: string | null): Records {
  if (raw === null) return { schema: 1, seq: 0, records: [] };
  try {
    const saved = JSON.parse(raw) as Records;
    if (
      saved.schema === 1 &&
      Number.isSafeInteger(saved.seq) &&
      Array.isArray(saved.records)
    )
      return saved;
  } catch {
    // Reported below.
  }
  throw stateRejection("state-corrupt");
}

function revision(payload: Payload) {
  const revision = payload.revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0)
    throw stateRejection("missing-revision");
  return Number(revision);
}
function value(payload: Payload) {
  if (
    !Object.hasOwn(payload, "value") ||
    ["undefined", "function", "symbol"].includes(typeof payload.value)
  )
    throw stateRejection("missing-value");
  return payload.value;
}
const removal = (payload: Payload) => payload.remove === true;

function name(
  name: unknown,
  code: "invalid-collection" | "invalid-record",
): string {
  if (!isRecordName(name)) throw stateRejection(code);
  return name;
}
function list(payload: Payload, field: string) {
  if (absent(payload, field)) return [];
  if (!Array.isArray(payload[field])) throw stateRejection("invalid-batch");
  return payload[field] as unknown[];
}
function limit(payload: Payload, fallback: number, max: number) {
  if (absent(payload, "limit")) return fallback;
  const limit = payload.limit;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > max)
    throw stateRejection("invalid-query");
  return Number(limit);
}

type DocumentWrite = {
  key: string;
  revision: number;
  value?: { raw: unknown; json: string };
};
function documentWrite(owner: string, payload: Payload): DocumentWrite {
  const key = documentKey(owner, payload);
  const expected = revision(payload);
  if (removal(payload)) return { key, revision: expected };
  const raw = value(payload);
  return { key, revision: expected, value: { raw, json: JSON.stringify(raw) } };
}

type RecordWrite = {
  collection: string;
  id: string;
  revision: number;
  put?: { value: unknown; parent: string | null; text: string | null };
  size: number;
};
function recordWrite(payload: Payload): RecordWrite {
  const collection = name(payload.collection, "invalid-collection");
  const id = name(payload.id, "invalid-record");
  const expected = revision(payload);
  if (removal(payload)) return { collection, id, revision: expected, size: 0 };
  const parent = absent(payload, "parent")
    ? null
    : name(payload.parent, "invalid-record");
  if (!absent(payload, "text") && typeof payload.text !== "string")
    throw stateRejection("invalid-record");
  const text = absent(payload, "text") ? null : (payload.text as string);
  const stored = value(payload);
  const size =
    bytes(JSON.stringify(stored)) + (text === null ? 0 : bytes(text));
  if (size > MAX_RECORD) throw stateRejection("state-too-large");
  return {
    collection,
    id,
    revision: expected,
    put: { value: stored, parent, text },
    size,
  };
}

/** `after`: the previous page's `next`. */
function cursor(payload: Payload) {
  if (absent(payload, "after")) return undefined;
  const cursor = payload.after;
  const seq =
    typeof cursor === "string" && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  if (!Number.isSafeInteger(seq) || seq < 1)
    throw stateRejection("invalid-query");
  return seq;
}
/** Up to `count` of `ordered`, ending before `MAX_PAGE_BYTES` but keeping one. */
function page(ordered: StoredRecord[], count: number): RecordPage {
  const records: StoredRecord[] = [];
  let size = 0;
  for (const record of ordered) {
    size +=
      bytes(JSON.stringify(record.value)) +
      (record.text === null ? 0 : bytes(record.text));
    if (records.length === count || (records.length && size > MAX_PAGE_BYTES))
      return { records, next: String(records.at(-1)!.seq) };
    records.push(record);
  }
  return { records, next: null };
}

export class BrowserState {
  /** Read lazily: the native app constructs this but never uses it. */
  constructor(private readonly storage: () => Storage = () => localStorage) {}
  read(owner: string, payload: unknown) {
    return this.guard("state-read", () =>
      storedDocument(
        this.storage().getItem(documentKey(owner, fields(payload))),
      ),
    );
  }
  write(owner: string, payload: unknown, signal?: AbortSignal) {
    return this.guard("state-write", () => {
      const write = documentWrite(owner, fields(payload));
      const document = this.applyDocument(write);
      signal?.throwIfAborted();
      this.commit([[write.key, document && JSON.stringify(document)]]);
      return document;
    });
  }
  batch(owner: string, payload: unknown, signal?: AbortSignal) {
    return this.guard("state-write", () => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw stateRejection("invalid-batch");
      const request = payload as Payload;
      const documents = list(request, "documents").map((item) =>
        documentWrite(owner, fields(item)),
      );
      const clear = list(request, "clear").map((item) =>
        name(item, "invalid-collection"),
      );
      const records = list(request, "records").map((item) =>
        recordWrite(fields(item)),
      );
      const count = documents.length + clear.length + records.length;
      if (count === 0 || count > MAX_BATCH_OPERATIONS)
        throw stateRejection("invalid-batch");
      const unique = (names: string[]) => new Set(names).size === names.length;
      if (
        !unique(documents.map((write) => write.key)) ||
        !unique(clear) ||
        !unique(records.map((write) => `${write.collection}\n${write.id}`))
      )
        throw stateRejection("invalid-batch");
      const size =
        documents.reduce(
          (sum, write) => sum + bytes(write.value?.json ?? ""),
          0,
        ) + records.reduce((sum, write) => sum + write.size, 0);
      if (size > MAX_BATCH_BYTES) throw stateRejection("state-too-large");

      const changes: [string, string | null][] = [];
      const documentReceipts = documents.map((write) => {
        const document = this.applyDocument(write);
        changes.push([write.key, document && JSON.stringify(document)]);
        return document && { revision: document.revision };
      });
      const stored = storedRecords(this.storage().getItem(recordsKey(owner)));
      const cleared = new Set(clear);
      let all = stored.records.filter(
        (record) => !cleared.has(record.collection),
      );
      let seq = stored.seq;
      const recordReceipts = records.map((write) => {
        const index = all.findIndex(
          (record) =>
            record.collection === write.collection && record.id === write.id,
        );
        const current = all[index];
        if (write.revision !== (current?.revision ?? 0))
          throw stateRejection("revision-conflict");
        if (!write.put) {
          if (current) all = all.filter((_, i) => i !== index);
          return null;
        }
        if (!Number.isSafeInteger(write.revision + 1))
          throw stateRejection("revision-limit");
        const record: StoredRecord = {
          collection: write.collection,
          id: write.id,
          seq: current?.seq ?? ++seq,
          revision: write.revision + 1,
          ...write.put,
        };
        if (current) all[index] = record;
        else all.push(record);
        return { seq: record.seq, revision: record.revision };
      });
      if (clear.length || records.length)
        changes.push([
          recordsKey(owner),
          JSON.stringify({ schema: 1, seq, records: all }),
        ]);
      signal?.throwIfAborted();
      this.commit(changes);
      return { documents: documentReceipts, records: recordReceipts };
    });
  }
  list(owner: string, payload: unknown) {
    return this.guard("state-read", () => {
      const request = fields(payload);
      const collection = name(request.collection, "invalid-collection");
      const order = absent(request, "order") ? "asc" : request.order;
      if (order !== "asc" && order !== "desc")
        throw stateRejection("invalid-query");
      const after = cursor(request);
      const count = limit(request, 50, 200);
      return page(
        this.records(owner)
          .filter((record) => record.collection === collection)
          .sort((a, b) => (order === "asc" ? a.seq - b.seq : b.seq - a.seq))
          .filter(
            (record) =>
              after === undefined ||
              (order === "asc" ? record.seq > after : record.seq < after),
          ),
        count,
      );
    });
  }
  search(owner: string, payload: unknown) {
    return this.guard("state-read", () => {
      const request = fields(payload);
      const query =
        typeof request.query === "string" ? request.query.trim() : "";
      if (!query || [...query].length > 256)
        throw stateRejection("invalid-query");
      const collection = absent(request, "collection")
        ? undefined
        : name(request.collection, "invalid-collection");
      const after = cursor(request);
      const count = limit(request, 20, 100);
      const needle = query.toLowerCase();
      return page(
        this.records(owner)
          .filter(
            (record) =>
              (collection === undefined || record.collection === collection) &&
              (after === undefined || record.seq < after) &&
              record.text?.toLowerCase().includes(needle),
          )
          .sort((a, b) => b.seq - a.seq),
        count,
      );
    });
  }

  private records(owner: string) {
    return storedRecords(this.storage().getItem(recordsKey(owner))).records;
  }
  /** The document `write` stores, or null once removed; throws on a conflict. */
  private applyDocument(write: DocumentWrite) {
    const current = storedDocument(this.storage().getItem(write.key));
    if (write.revision !== (current?.revision ?? 0))
      throw stateRejection("revision-conflict");
    if (!write.value) return null;
    if (!Number.isSafeInteger(write.revision + 1))
      throw stateRejection("revision-limit");
    const document = {
      schema: 1,
      revision: write.revision + 1,
      value: write.value.raw,
    };
    if (bytes(JSON.stringify(document)) > MAX_DOCUMENT)
      throw stateRejection("state-too-large");
    return document;
  }
  /** Writes every change, or puts the earlier values back and throws. */
  private commit(changes: [string, string | null][]) {
    const earlier = changes.map(
      ([key]) => [key, this.storage().getItem(key)] as const,
    );
    try {
      for (const [key, value] of changes)
        if (value === null) this.storage().removeItem(key);
        else this.storage().setItem(key, value);
    } catch (error) {
      for (const [key, value] of earlier)
        if (value === null) this.storage().removeItem(key);
        else this.storage().setItem(key, value);
      throw error;
    }
  }
  /** Maps unexpected storage failures to `code`; state rejections and aborts pass. */
  private guard<T>(code: "state-read" | "state-write", run: () => T): T {
    try {
      return run();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (isStateErrorCode((error as { code?: unknown } | null)?.code))
        throw error;
      throw stateRejection(code);
    }
  }
}
