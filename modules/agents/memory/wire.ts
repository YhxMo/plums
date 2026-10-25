import type { ExtensionContext } from "@modules/sdk";
import { OWNER, speaker, type Agent } from "@modules/agents/contract";
import type { AgentStore } from "@modules/agents/store";
import type { MemoryMessage, MemoryService, MemorySource } from "./contract";

const uses = (agent: Pick<Agent, "off">, memory: string) =>
  !agent.off?.includes(memory);

/** An Agent's saved messages after `after`, as memory reads them: text, and files only by name. */
function messages(agent: Agent, after: number): MemoryMessage[] {
  return agent.sessions
    .flatMap((session) =>
      session.messages
        .filter((m) => (m.at ?? 0) > after)
        .map((m) => ({
          id: m.id,
          session: session.id,
          from: speaker(agent, m),
          role: m.role,
          text: [
            m.text,
            ...(m.attachments ?? []).map(
              (a) => `[${a.kind === "image" ? "图片" : "文件"}] ${a.name}`,
            ),
          ]
            .filter(Boolean)
            .join("\n"),
          at: m.at!,
        })),
    )
    .sort((a, b) => a.at - b.at);
}

/**
 * Connects every active `memory@1` provider to the Agents: each reads only
 * the Agents it is switched on for, hears when their conversations change,
 * and adds its sections to their replies.
 */
export function wireMemory(ctx: ExtensionContext, store: AgentStore) {
  const connected = new Map<
    string,
    { value: MemoryService; disconnect: () => void }
  >();
  const source = (memory: string): MemorySource => ({
    agents: () =>
      store
        .list()
        .filter((a) => uses(a, memory))
        .map(({ id, name, model }) => ({ id, name, ...(model && { model }) })),
    messages: (id, after) => {
      const agent = store.list().find((a) => a.id === id);
      return agent && uses(agent, memory) ? messages(agent, after) : [];
    },
    subscribe: store.subscribe,
  });
  const reconnect = () => {
    for (const [id, entry] of connected)
      if (!memories.some((m) => m.id === id && m.value === entry.value)) {
        entry.disconnect();
        connected.delete(id);
      }
    for (const { id, value } of memories)
      if (!connected.has(id))
        connected.set(id, { value, disconnect: value.connect(source(id)) });
  };
  let memories = ctx.providers<MemoryService>("memory", (next) => {
    memories = next;
    reconnect();
    store.sourcesChanged();
  });
  reconnect();
  ctx.onDispose(() => connected.forEach((entry) => entry.disconnect()));
  store.memories = () => memories.map(({ id, label }) => ({ id, label }));
  store.activity = (agentId, event, extensionId) => {
    const agent = store.list().find((a) => a.id === agentId);
    for (const { id, value } of memories) {
      const told =
        event === "on"
          ? id === extensionId
          : event === "removed" || (!!agent && uses(agent, id));
      if (told) value.notify(agentId, event);
    }
  };
  return {
    /** The prompt sections of the memories `agent` uses, answering the person using the app. */
    sections(agent: Pick<Agent, "id" | "off">, now: number, timeZone: string) {
      return memories
        .filter((m) => uses(agent, m.id))
        .flatMap((m) =>
          m.value.context({ agent: agent.id, person: OWNER, now, timeZone }),
        );
    },
    /** The memories `agent` uses, by extension id. */
    used: (agent: Pick<Agent, "off">) =>
      memories.filter((m) => uses(agent, m.id)).map((m) => m.id),
  };
}
