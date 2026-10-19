import type { ExtensionDefinition } from "../sdk";
import type { Transformer } from "../../extensions/contracts";
import { AgentStore, restoreAgents } from "./store";
import { replySourceOf } from "./contract";
import { AgentState } from "./sharded-state";

/**
 * Agents live in this extension's own `state.*` namespace as an index plus one
 * shard per session. `legacy` is the pre-namespace `host.shell.agents` field;
 * it is migrated once and then retired by the composition root. Corrupt data
 * fails only this extension and is kept.
 */
export function agentExtension(
  options: { legacy?: unknown; retireLegacy?: () => Promise<void> } = {},
): ExtensionDefinition {
  return {
    manifest: {
      id: "agents.local",
      apiVersion: 1,
      version: "0.0.4",
      requires: { "text.transform": 1 },
      provides: { agents: 1 },
      capabilities: ["state.read", "state.write"],
    },
    async activate(ctx) {
      // Every active text service can write replies; each Agent picks one.
      let transformers = ctx.providers<Transformer>(
        "text.transform",
        (next) => {
          transformers = next;
          store.sourcesChanged();
        },
      );
      const sources = () =>
        transformers.map(({ id, label, value }) => ({
          id,
          label,
          description: value.description ?? `回复由「${value.name}」生成。`,
        }));
      const state = new AgentState((capability, payload, signal) =>
        ctx.platform(capability, payload, signal),
      );
      let initial = await state.load();
      if (!initial) {
        initial = restoreAgents(options.legacy);
        if (options.legacy !== undefined) await state.save(initial);
      }
      // A failed retirement is retried on the next start; the copy is inert.
      if (options.legacy !== undefined)
        await options.retireLegacy?.().catch(() => {});
      const store = new AgentStore(
        initial,
        (agents, save) => state.save(agents, save),
        (text, signal, source) => {
          const chosen = replySourceOf({ replySource: source }, sources());
          const transformer = transformers.find(({ id }) => id === chosen?.id);
          if (!transformer)
            throw new Error("没有可用的回复来源，请启用文本服务。");
          return ctx.task(() => transformer.value.transform(text, signal));
        },
        sources,
        ctx.shell.dependencies(),
      );
      // Management lists each Agent under the service writing its replies
      // and can move it onto another one.
      const publish = () => {
        if (ctx.signal.aborted) return;
        ctx.shell.publishUsers(
          "Agent",
          store.list().map((agent) => ({
            id: agent.id,
            label: agent.name,
            uses: [replySourceOf(agent, sources())?.id].filter(
              (id): id is string => !!id,
            ),
          })),
          {
            service: "text.transform",
            to: (agentId, extensionId) =>
              store.setReplySource(agentId, extensionId),
          },
        );
      };
      publish();
      ctx.onDispose(store.subscribe(publish));
      ctx.provide("agents", 1, store);
      ctx.onDispose(() => store.close());
    },
  };
}
