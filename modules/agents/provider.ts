import { ContractError } from "../sdk/errors";
import type { ExtensionDefinition, StoredState } from "../sdk";
import type { Agent } from "./contract";
import type { Transformer } from "../../extensions/contracts";
import { AgentStore, restoreAgents, type SaveOptions } from "./store";

export type AgentDocument = { version: 1; agents: Agent[] };

function readAgentDocument(value: unknown): Agent[] {
  const doc = value as Partial<AgentDocument> | null;
  if (!doc || typeof doc !== "object" || doc.version !== 1)
    throw new ContractError("state.corrupt", "agents", "Agent 配置损坏");
  return restoreAgents(doc.agents ?? []);
}

/**
 * Agents live in this extension's own `state.*` namespace. `legacy` is the
 * pre-namespace `host.shell.agents` field; it is migrated once and then retired
 * by the composition root. Corrupt data fails only this extension and is kept.
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
      const transformer = ctx.use<Transformer>("text.transform");
      const saved = (await ctx.platform("state.read")) as StoredState | null;
      let revision = saved?.revision ?? 0;
      let uncertain = false;
      const persist = async (agents: Agent[], save?: SaveOptions) => {
        save?.signal?.throwIfAborted();
        if (uncertain)
          throw Error("Agent 保存回执未确认，请重新加载应用后再修改。");
        try {
          save?.onCommit?.();
          const value: AgentDocument = { version: 1, agents };
          const receipt = (await ctx.platform(
            "state.write",
            { revision, value },
            save?.signal,
          )) as StoredState;
          revision = receipt.revision;
        } catch (error) {
          if (
            !(error instanceof Error && error.name === "AbortError") &&
            (error as { outcome?: string }).outcome !== "not-committed"
          )
            uncertain = true;
          throw error;
        }
      };
      let initial: Agent[] = [];
      if (saved) initial = readAgentDocument(saved.value);
      else if (options.legacy !== undefined) {
        initial = restoreAgents(options.legacy);
        await persist(initial);
      }
      // A failed retirement is retried on the next start; the copy is inert.
      if (options.legacy !== undefined)
        await options.retireLegacy?.().catch(() => {});
      const store = new AgentStore(initial, persist, (text, signal) =>
        ctx.task(() => transformer.transform(text, signal)),
      );
      ctx.provide("agents", 1, store);
      ctx.onDispose(() => store.close());
    },
  };
}
