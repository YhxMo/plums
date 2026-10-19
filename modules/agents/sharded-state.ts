import { ContractError } from "../sdk/errors";
import type { StoredState } from "../sdk";
import type { Agent, Message, Session } from "./contract";
import { restoreAgents, type SaveOptions } from "./store";

type Call = (
  capability: string,
  payload?: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;
type SessionEntry = Omit<Session, "messages"> & { shard: string };
type AgentEntry = Omit<Agent, "sessions"> & { sessions: SessionEntry[] };
/** Main document: Agents and session metadata; messages live in shards. */
export type AgentIndex = { version: 2; agents: AgentEntry[] };
type Shard = { version: 1; messages: Message[] };

const corrupt = () =>
  new ContractError("state.corrupt", "agents", "Agent 配置损坏");
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Agent persistence over keyed `state.*`: one index plus one shard per session,
 * so each 64 KiB cap applies to a single conversation, not to all of them.
 * Shards are written before the index that references them and removed after
 * it stops referencing them; a failed removal only leaves an unreferenced shard.
 */
export class AgentState {
  /** Committed revision per key; `""` is the index. */
  private revisions = new Map<string, number>();
  /** Last committed JSON per key, to skip unchanged shards. */
  private written = new Map<string, string>();
  /** Shard key per `${agentId}\n${sessionId}`. */
  private shards = new Map<string, string>();
  private uncertain = false;
  constructor(
    private readonly call: Call,
    private readonly newShard = () => `s-${crypto.randomUUID()}`,
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
    if (!record(doc) || doc.version !== 2 || !Array.isArray(doc.agents))
      throw corrupt();
    const agents: unknown[] = [];
    for (const entry of doc.agents as unknown[]) {
      if (!record(entry) || !Array.isArray(entry.sessions)) throw corrupt();
      const sessions: unknown[] = [];
      for (const session of entry.sessions as unknown[]) {
        if (!record(session) || typeof session.shard !== "string")
          throw corrupt();
        const { shard, ...meta } = session;
        const stored = (await this.call("state.read", {
          key: shard,
        })) as StoredState | null;
        let messages: unknown = [];
        if (stored) {
          const value = stored.value;
          if (!record(value) || value.version !== 1) throw corrupt();
          messages = value.messages;
          this.revisions.set(shard, stored.revision);
          this.written.set(shard, JSON.stringify(messages));
        }
        this.shards.set(`${String(entry.id)}\n${String(meta.id)}`, shard);
        sessions.push({ ...meta, messages });
      }
      agents.push({ ...entry, sessions });
    }
    const restored = restoreAgents(agents);
    this.written.set("", JSON.stringify(this.index(restored)));
    return restored;
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
    const live = new Set<string>();
    const writes: { key: string; value: unknown; json: string }[] = [];
    for (const agent of agents)
      for (const { id, messages } of agent.sessions) {
        const slot = `${agent.id}\n${id}`;
        let shard = this.shards.get(slot);
        if (!shard) this.shards.set(slot, (shard = this.newShard()));
        live.add(slot);
        const json = JSON.stringify(messages);
        if ((this.written.get(shard) ?? "[]") !== json)
          writes.push({
            key: shard,
            value: { version: 1, messages } satisfies Shard,
            json,
          });
      }
    const index = this.index(agents);
    const json = JSON.stringify(index);
    if (this.written.get("") !== json)
      writes.push({ key: "", value: index, json });
    options?.onCommit?.();
    // Only the first dispatch may be cancelled; later writes finish the commit.
    let signal = options?.signal;
    let committed = false;
    try {
      for (const { key, value, json } of writes) {
        const receipt = (await this.call(
          "state.write",
          {
            ...(key && { key }),
            revision: this.revisions.get(key) ?? 0,
            value,
          },
          signal,
        )) as StoredState;
        signal = undefined;
        this.revisions.set(key, receipt.revision);
        this.written.set(key, json);
        committed = true;
      }
    } catch (error) {
      if (
        committed ||
        (!(error instanceof Error && error.name === "AbortError") &&
          (error as { outcome?: string }).outcome !== "not-committed")
      )
        this.uncertain = true;
      // An earlier write committed: part of this save is stored.
      if (committed)
        throw Object.assign(new Error(this.blocked(), { cause: error }), {
          outcome: "unknown",
        });
      throw error;
    }
    for (const [slot, shard] of [...this.shards]) {
      if (live.has(slot)) continue;
      this.shards.delete(slot);
      const revision = this.revisions.get(shard) ?? 0;
      this.revisions.delete(shard);
      this.written.delete(shard);
      await this.call("state.write", { key: shard, revision, remove: true })
        // An unreferenced shard is inert; never fail a committed change for it.
        .catch(() => {});
    }
  }

  private index(agents: Agent[]): AgentIndex {
    return {
      version: 2,
      agents: agents.map(({ sessions, ...agent }) => ({
        ...agent,
        sessions: sessions.map(({ messages: _messages, ...session }) => ({
          ...session,
          shard: this.shards.get(`${agent.id}\n${session.id}`)!,
        })),
      })),
    };
  }
}
