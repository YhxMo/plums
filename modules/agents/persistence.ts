import {
  STATE_LIMITS,
  type DocumentWrite,
  type RecordPage,
  type RecordWrite,
  type StateBatch,
  type StateBatchReceipt,
  type StoredRecord,
  type StoredState,
} from "@modules/sdk";
import type { Agent, Message, Session } from "./contract";
import { readEarlier } from "./earlier-formats";
import type { SaveOptions } from "./store";
import { corrupt, object, restoreAgents, validAvatar } from "./validation";

type Call = (
  capability: string,
  payload?: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;
type SessionEntry = Omit<Session, "messages">;
type AgentEntry = Omit<Agent, "sessions" | "avatar"> & {
  sessions: SessionEntry[];
};
/** Main document: Agents and their sessions, without messages or pictures. */
export type AgentIndex = { version: 4; agents: AgentEntry[] };
/** An Agent's picture, the record `avatars/<Agent id>`. */
type Picture = { version: 1; image: string };

/** Each session's messages, oldest first, with `parent` the one before. */
const sessionRecords = (sessionId: string) => `session:${sessionId}`;
const AVATARS = "avatars";

/** What was committed under a record id, and its revision. */
type Committed = { json: string; revision: number };

const outcome = (error: unknown) => (error as { outcome?: string })?.outcome;
const aborted = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Agent persistence: an index document plus one record per message and per
 * picture, committed together in one `state.batch`, so a save happens whole
 * or not at all. Earlier formats (an inline version 1 document, version 2
 * shards, version 3 pages and picture documents) are read as they are; the
 * first save writes everything as records, in several batches if it must,
 * with the index last, and then removes the earlier documents.
 */
export class AgentState {
  private index = { revision: 0, json: "" };
  /** Committed messages by session id, then message id. */
  private sessions = new Map<string, Map<string, Committed>>();
  /** Committed pictures by Agent id. */
  private avatars = new Map<string, Committed>();
  /** The stored index is not version 4: the next save writes everything. */
  private rewrite = true;
  /** Earlier documents and their revisions, removed after the rewrite. */
  private legacy = new Map<string, number>();
  private uncertain = false;
  constructor(private readonly call: Call) {}

  /** Stored Agents, or null when this extension has saved nothing yet. */
  async load(): Promise<Agent[] | null> {
    const saved = (await this.call("state.read")) as StoredState | null;
    if (!saved) return null;
    this.index.revision = saved.revision;
    const doc = saved.value;
    if (!object(doc) || !Array.isArray(doc.agents)) throw corrupt();
    const entries = doc.agents as unknown[];
    if (!entries.every(object)) throw corrupt();
    if (doc.version === 4) {
      const agents = restoreAgents(await this.readRecords(entries));
      this.rewrite = false;
      this.index.json = JSON.stringify(this.indexOf(agents));
      this.remember(agents);
      return agents;
    }
    if (doc.version === 1) return restoreAgents(entries);
    if (doc.version === 2 || doc.version === 3) {
      const earlier = await readEarlier(this.call, doc.version, entries);
      this.legacy = earlier.documents;
      return restoreAgents(earlier.agents);
    }
    throw corrupt();
  }
  private async list(collection: string) {
    const records: StoredRecord[] = [];
    let after: string | null = null;
    do {
      const page = (await this.call("records.list", {
        collection,
        after,
        limit: 200,
      })) as RecordPage;
      records.push(...page.records);
      after = page.next;
    } while (after);
    return records;
  }
  /** Version 4: each session's messages and the pictures, read together. */
  private async readRecords(entries: Record<string, unknown>[]) {
    // A long store has many sessions, and activation has a time limit.
    const [pictures, agents] = await Promise.all([
      this.list(AVATARS),
      Promise.all(
        entries.map(async (entry) => {
          if (!Array.isArray(entry.sessions)) throw corrupt();
          const sessions = await Promise.all(
            (entry.sessions as unknown[]).map(async (session) => {
              if (!object(session) || typeof session.id !== "string")
                throw corrupt();
              const stored = await this.list(sessionRecords(session.id));
              this.sessions.set(
                session.id,
                new Map(
                  stored.map(({ id, revision }) => [
                    id,
                    { json: "", revision },
                  ]),
                ),
              );
              return {
                ...session,
                messages: chain(stored).map((m) => m.value),
              };
            }),
          );
          return { ...entry, sessions } as Record<string, unknown>;
        }),
      ),
    ]);
    const images = new Map<string, string>();
    for (const { id, value, revision } of pictures) {
      // A damaged picture only costs the picture; the next save replaces it.
      this.avatars.set(id, { json: "", revision });
      if (object(value) && value.version === 1 && validAvatar(value.image))
        images.set(id, value.image);
    }
    return agents.map((agent) => {
      const image = images.get(String(agent.id));
      return { ...agent, ...(image && { avatar: image }) };
    });
  }
  /** What a save would write for what `load` restored, keyed as `changes` keys it. */
  private remember(agents: Agent[]) {
    for (const agent of agents) {
      for (const session of agent.sessions) {
        const committed = this.sessions.get(session.id);
        session.messages.forEach((message, i) => {
          const entry = committed?.get(message.id);
          if (entry) entry.json = messageJson(message, session.messages[i - 1]);
        });
      }
      const picture = this.avatars.get(agent.id);
      if (picture && agent.avatar) picture.json = agent.avatar;
    }
  }

  /** Why saving would fail now, if it would. */
  blocked() {
    return this.uncertain
      ? "Agent 保存回执未确认，请重新加载应用后再修改。"
      : undefined;
  }
  async save(agents: Agent[], options?: SaveOptions) {
    options?.signal?.throwIfAborted();
    const blocked = this.blocked();
    if (blocked) throw Error(blocked);
    const changes = this.changes(agents);
    if (!changes) return;
    options?.onCommit?.();
    const { batch, next } = changes;
    const receipts = this.rewrite
      ? await this.commitInParts(batch, options?.signal)
      : await this.commit(batch, options?.signal);
    // Receipts follow the request order; written entries take their revision.
    batch.records!.forEach((write, i) => {
      const receipt = receipts.records[i];
      if (receipt)
        next.revisions.get(`${write.collection}\n${write.id}`)!.revision =
          receipt.revision;
    });
    if (batch.documents?.length)
      this.index = {
        revision: receipts.documents[0]!.revision,
        json: next.index,
      };
    this.sessions = next.sessions;
    this.avatars = next.avatars;
    if (this.rewrite) {
      this.rewrite = false;
      await this.removeLegacy();
    }
  }
  /** One batch: a definite refusal leaves everything as it was. */
  private async commit(batch: StateBatch, signal?: AbortSignal) {
    try {
      return (await this.call(
        "state.batch",
        batch,
        signal,
      )) as StateBatchReceipt;
    } catch (error) {
      if (!aborted(error) && outcome(error) !== "not-committed")
        this.uncertain = true;
      throw error;
    }
  }
  /**
   * The first save of an earlier format: its records may not fit one batch.
   * Each part empties the collections it is first to write, and only the
   * last part writes the index, so a failed part leaves the earlier format
   * in place and the next save starts over.
   */
  private async commitInParts(batch: StateBatch, signal?: AbortSignal) {
    const parts: StateBatch[] = [];
    let part: Required<StateBatch> | undefined;
    let size = 0;
    const room = (count: number, extra: number) => {
      const used = part
        ? part.documents.length + part.clear.length + part.records.length
        : 0;
      if (
        !part ||
        used + count > STATE_LIMITS.batchOperations ||
        size + extra > STATE_LIMITS.batchBytes
      ) {
        part = { documents: [], clear: [], records: [] };
        parts.push(part);
        size = 0;
      }
      size += extra;
      return part;
    };
    const cleared = new Set<string>();
    for (const write of batch.records!) {
      const first = !cleared.has(write.collection);
      cleared.add(write.collection);
      const target = room(
        first ? 2 : 1,
        bytes(write.value) + bytes(write.text),
      );
      if (first) target.clear.push(write.collection);
      target.records.push(write);
    }
    // Collections the earlier format had no records for are emptied too.
    const rest = batch.clear!.filter((name) => !cleared.has(name));
    for (const name of rest) room(1, 0).clear.push(name);
    room(1, bytes(batch.documents![0].value)).documents.push(
      batch.documents![0],
    );
    const receipts: StateBatchReceipt = { documents: [], records: [] };
    for (const [i, current] of parts.entries()) {
      const last = i === parts.length - 1;
      let receipt: StateBatchReceipt;
      try {
        receipt = last
          ? await this.commit(current, signal)
          : ((await this.call(
              "state.batch",
              current,
              signal,
            )) as StateBatchReceipt);
      } catch (error) {
        // Without the index, a written part is never read: nothing was saved.
        if (last || aborted(error) || outcome(error) === "not-committed")
          throw error;
        throw Object.assign(
          new Error((error as Error).message, { cause: error }),
          { outcome: "not-committed" },
        );
      }
      receipts.documents.push(...receipt.documents);
      receipts.records.push(...receipt.records);
    }
    return receipts;
  }
  /** Earlier documents nothing names any more; one left behind is inert. */
  private async removeLegacy() {
    const keys = [...this.legacy];
    this.legacy.clear();
    for (let i = 0; i < keys.length; i += STATE_LIMITS.batchOperations)
      await this.call("state.batch", {
        documents: keys
          .slice(i, i + STATE_LIMITS.batchOperations)
          .map(([key, revision]) => ({ key, revision, remove: true })),
      }).catch(() => {});
  }

  /** The batch that brings storage to `agents`, and what is committed after it. */
  private changes(agents: Agent[]) {
    const documents: DocumentWrite[] = [];
    const clear: string[] = [];
    const records: RecordWrite[] = [];
    const revisions = new Map<string, Committed>();
    const keep = (
      collection: string,
      before: Map<string, Committed> | undefined,
      wanted: {
        id: string;
        json: string;
        write: Omit<RecordWrite, "revision" | "collection" | "id">;
      }[],
    ) => {
      const after = new Map<string, Committed>();
      for (const { id, json, write } of wanted) {
        const old = before?.get(id);
        const entry = { json, revision: old?.revision ?? 0 };
        after.set(id, entry);
        if (old?.json === json) continue;
        records.push({ collection, id, revision: entry.revision, ...write });
        revisions.set(`${collection}\n${id}`, entry);
      }
      for (const [id, { revision }] of before ?? [])
        if (!after.has(id))
          records.push({ collection, id, revision, remove: true });
      return after;
    };
    const sessions = new Map<string, Map<string, Committed>>();
    for (const agent of agents)
      for (const session of agent.sessions) {
        const collection = sessionRecords(session.id);
        if (this.rewrite) clear.push(collection);
        const before = this.rewrite ? undefined : this.sessions.get(session.id);
        sessions.set(
          session.id,
          keep(
            collection,
            before,
            session.messages.map((message, i) => {
              const parent = session.messages[i - 1];
              return {
                id: message.id,
                json: messageJson(message, parent),
                write: {
                  value: message,
                  parent: parent?.id ?? null,
                  text: message.text,
                },
              };
            }),
          ),
        );
      }
    for (const id of this.sessions.keys())
      if (!sessions.has(id)) clear.push(sessionRecords(id));
    if (this.rewrite) clear.push(AVATARS);
    const avatars = keep(
      AVATARS,
      this.rewrite ? undefined : this.avatars,
      agents.flatMap(({ id, avatar }) =>
        avatar
          ? [
              {
                id,
                json: avatar,
                write: {
                  value: { version: 1, image: avatar } satisfies Picture,
                },
              },
            ]
          : [],
      ),
    );
    const index = this.indexOf(agents);
    const json = JSON.stringify(index);
    if (this.rewrite || json !== this.index.json)
      documents.push({ revision: this.index.revision, value: index });
    if (!documents.length && !clear.length && !records.length) return undefined;
    return {
      batch: { documents, clear, records } satisfies StateBatch,
      next: { index: json, sessions, avatars, revisions },
    };
  }
  private indexOf(agents: Agent[]): AgentIndex {
    return {
      version: 4,
      agents: agents.map(({ sessions, avatar: _avatar, ...agent }) => ({
        ...agent,
        sessions: sessions.map(
          ({ messages: _messages, ...session }) => session,
        ),
      })),
    };
  }
}

/**
 * A session's records in conversation order, following each one's `parent`:
 * storage order is insertion order, and a message put back by undo is
 * inserted again after the rest. Records off the chain keep storage order.
 */
function chain(records: StoredRecord[]) {
  const next = new Map<string | null, StoredRecord>();
  for (const record of records)
    if (!next.has(record.parent)) next.set(record.parent, record);
  const ordered: StoredRecord[] = [];
  const seen = new Set<string>();
  for (let at = next.get(null); at && !seen.has(at.id); at = next.get(at.id)) {
    seen.add(at.id);
    ordered.push(at);
  }
  return [...ordered, ...records.filter((record) => !seen.has(record.id))];
}

/** A message as stored, with its place after `parent`. */
const messageJson = (message: Message, parent: Message | undefined) =>
  `${parent?.id ?? ""}\n${JSON.stringify(message)}`;
