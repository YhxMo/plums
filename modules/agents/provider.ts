import type { ExtensionDefinition } from "../sdk";
import type { Transformer } from "../../extensions/contracts";
import { AgentStore, restoreAgents } from "./store";
import { enabledExtensions } from "./contract";
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
      // Every active text service is offered; each Agent switches its own on.
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
        (text, signal, extensions) => {
          if (!extensions.length)
            throw new Error(
              "此 Agent 没有开启的扩展，请在 Agent 详情中开启至少一个。",
            );
          return ctx.task(async () => {
            let output = text;
            for (const id of extensions) {
              const transformer = transformers.find((t) => t.id === id);
              if (!transformer) throw new Error("扩展已停用，请重试。");
              output = await transformer.value.transform(output, signal);
              // A service stopped mid-reply leaves nothing to save.
              if (!transformers.includes(transformer))
                throw new Error("扩展已停用，本次结果未保存，请重试。");
              if (typeof output !== "string")
                throw new Error("文本服务必须返回文本；本次结果未保存。");
            }
            return output;
          });
        },
        sources,
        ctx.shell.dependencies(),
      );
      // Management lists each Agent under the services it has switched on
      // and can switch any of them on or off.
      const publish = () => {
        if (ctx.signal.aborted) return;
        ctx.shell.publishUsers(
          "Agent",
          store.list().map((agent) => ({
            id: agent.id,
            label: agent.name,
            uses: enabledExtensions(agent, sources()),
          })),
          {
            service: "text.transform",
            set: (agentId, extensionId, on) =>
              store.setExtension(agentId, extensionId, on),
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
