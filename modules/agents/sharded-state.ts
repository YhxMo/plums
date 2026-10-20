import { ContractError } from "../sdk/errors";
import type { StoredState } from "../sdk";
import type { Agent, Session } from "./contract";
import { restoreAgents, type SaveOptions } from "./store";

type Call = (
  capability: string,
  payload?: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;
type SessionEntry = Omit<Session, "messages"> & { pages: string[] };
type AgentEntry = Omit<Agent, "sessions"> & { sessions: SessionEntry[] };
/** Main document: Agents, session metadata and the keys of each session's pages. */
export type AgentIndex = { version: 3; agents: AgentEntry[] };
type Page = { version: 2; part: string };
/** A session as last committed: its messages' JSON, split into pages. */
type Stored = { json: string; parts: string[]; keys: string[] };

/**
 * UTF-8 bytes a page's text may take once stored as a JSON string, leaving
 * room for the envelope under the platform's 64 KiB document cap.
 */
const PAGE_BYTES = 60_000;

/**
 * Splits a session's JSON into page texts. Each cut depends only on the text
 * before it, so appending messages rewrites the last page and adds new ones.
 */
export function paginate(json: string) {
  const parts: string[] = [];
  let start = 0;
  let size = 0;
  for (let i = 0; i < json.length;) {
    const code = json.codePointAt(i)!;
    const cost =
      code === 0x22 || code === 0x5c
        ? 2
        : code < 0x80
          ? 1
          : code < 0x800
            ? 2
            : code < 0x10000
              ? 3
              : 4;
    if (size + cost > PAGE_BYTES) {
      parts.push(json.slice(start, i));
      start = i;
      size = 0;
    }
    size += cost;
    i += code > 0xffff ? 2 : 1;
  }
  parts.push(json.slice(start));
  return parts;
}

const corrupt = () =>
  new ContractError("state.corrupt", "agents", "Agent 配置损坏");
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const outcome = (error: unknown) => (error as { outcome?: string })?.outcome;

/**
 * Agent persistence over keyed `state.*`: one index plus each session's pages,
 * so a conversation can grow to many MB while every document stays under
 * 64 KiB. Pages are written under new keys before the index that names them,
 * so the index write alone commits a save; pages it no longer names are
 * removed after it, and a failed save removes the pages it wrote.
 */
export class AgentState {
  /** Committed revision per key; `""` is the index. */
  private revisions = new Map<string, number>();
  /** Last committed index JSON, to skip an unchanged index. */
  private written = "";
  /** Committed pages per `${agentId}\n${sessionId}`. */
  private stored = new Map<string, Stored>();
  /** Version 2 shards, removed once a version 3 index is committed. */
  private legacy: string[] = [];
  private uncertain = false;
  constructor(
    private readonly call: Call,
    private readonly newPage = () =>
      `p-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
  ) {}

  /** Stored Agents, or null when this extension has saved nothing yet. */
  async load(): Promise<Agent[] | null> {
    const saved = (await this.call("state.read")) as StoredState | null;
    if (!saved) return null;
    this.revisions.set("", saved.revision);
    const doc = saved.value;
    if (record(doc) && doc.version === 1) {
      if (!Array.isArray(doc.agents)) throw corrupt();
      const agents = restoreAgents(doc.agents);
      await this.save(agents);
      return agents;
    }
    if (
      !record(doc) ||
      (doc.version !== 2 && doc.version !== 3) ||
      !Array.isArray(doc.agents)
    )
      throw corrupt();
    // All pages are read at once: a long conversation has dozens, and
    // activation must finish within the Host's time limit.
    const agents = await Promise.all(
      (doc.agents as unknown[]).map(async (entry) => {
        if (!record(entry) || !Array.isArray(entry.sessions)) throw corrupt();
        const sessions = await Promise.all(
          (entry.sessions as unknown[]).map(async (session) => {
            if (!record(session)) throw corrupt();
            const { shard, pages, ...meta } = session;
            const messages =
              doc.version === 2
                ? await this.readShard(shard)
                : await this.readPages(
                    `${String(entry.id)}\n${String(meta.id)}`,
                    pages,
                  );
            return { ...meta, messages };
          }),
        );
        return { ...entry, sessions };
      }),
    );
    const restored = restoreAgents(agents);
    if (doc.version === 3) this.written = JSON.stringify(this.index(restored));
    return restored;
  }
  private async read(key: string) {
    const stored = (await this.call("state.read", {
      key,
    })) as StoredState | null;
    if (stored) this.revisions.set(key, stored.revision);
    return stored?.value;
  }
  private async readShard(key: unknown) {
    if (typeof key !== "string") throw corrupt();
    const value = await this.read(key);
    if (value === undefined) return [];
    if (!record(value) || value.version !== 1) throw corrupt();
    this.legacy.push(key);
    return value.messages;
  }
  private async readPages(slot: string, keys: unknown) {
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string"))
      throw corrupt();
    const parts = await Promise.all(
      keys.map(async (key) => {
        const value = await this.read(key);
        if (
          !record(value) ||
          value.version !== 2 ||
          typeof value.part !== "string"
        )
          throw corrupt();
        return value.part;
      }),
    );
    const json = parts.join("");
    this.stored.set(slot, { json, parts, keys });
    try {
      return json ? JSON.parse(json) : [];
    } catch {
      throw corrupt();
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
    const next = new Map<string, Stored>();
    const pages: { key: string; part: string }[] = [];
    for (const agent of agents)
      for (const { id, messages } of agent.sessions) {
        const slot = `${agent.id}\n${id}`;
        const json = messages.length ? JSON.stringify(messages) : "";
        const old = this.stored.get(slot);
        if (old?.json === json) {
          next.set(slot, old);
          continue;
        }
        const parts = json ? paginate(json) : [];
        const keys = parts.map((part, i) => {
          if (old?.parts[i] === part) return old.keys[i];
          const key = this.newPage();
          pages.push({ key, part });
          return key;
        });
        next.set(slot, { json, parts, keys });
      }
    const index = this.index(agents, next);
    const json = JSON.stringify(index);
    if (json === this.written) return;
    options?.onCommit?.();
    const signal = options?.signal;
    const written: string[] = [];
    try {
      for (const { key, part } of pages) {
        written.push(key);
        let receipt: StoredState;
        try {
          receipt = (await this.call(
            "state.write",
            { key, revision: 0, value: { version: 2, part } satisfies Page },
            signal,
          )) as StoredState;
        } catch (error) {
          // The page may exist, but nothing names it: the save did not happen.
          if (outcome(error) !== "unknown") throw error;
          throw Object.assign(
            new Error((error as Error).message, { cause: error }),
            { outcome: "not-committed" },
          );
        }
        this.revisions.set(key, receipt.revision);
      }
      let receipt: StoredState;
      try {
        receipt = (await this.call(
          "state.write",
          { revision: this.revisions.get("") ?? 0, value: index },
          signal,
        )) as StoredState;
      } catch (error) {
        if (
          !(error instanceof Error && error.name === "AbortError") &&
          outcome(error) !== "not-committed"
        )
          this.uncertain = true;
        throw error;
      }
      this.revisions.set("", receipt.revision);
    } catch (error) {
      // An index that may name the new pages keeps them.
      if (!this.uncertain) await this.discard(written);
      throw error;
    }
    this.written = json;
    const live = new Set([...next.values()].flatMap(({ keys }) => keys));
    const gone = [...this.stored.values()]
      .flatMap(({ keys }) => keys)
      .filter((key) => !live.has(key));
    this.stored = next;
    await this.discard([...gone, ...this.legacy.splice(0)]);
  }
  /** Removes unreferenced documents; one left behind is inert. */
  private async discard(keys: string[]) {
    for (const key of keys) {
      const revision = this.revisions.get(key) ?? 1;
      this.revisions.delete(key);
      await this.call("state.write", { key, revision, remove: true }).catch(
        () => {},
      );
    }
  }

  private index(
    agents: Agent[],
    stored: Map<string, Stored> = this.stored,
  ): AgentIndex {
    return {
      version: 3,
      agents: agents.map(({ sessions, ...agent }) => ({
        ...agent,
        sessions: sessions.map(({ messages: _messages, ...session }) => ({
          ...session,
          pages: stored.get(`${agent.id}\n${session.id}`)?.keys ?? [],
        })),
      })),
    };
  }
}
