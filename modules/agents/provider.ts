import type { ExtensionDefinition } from "../sdk";
import type { Transformer } from "../../extensions/contracts";
import { AgentStore, restoreAgents } from "./store";
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
      const transformer = ctx.use<Transformer>("text.transform");
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
        (text, signal) => ctx.task(() => transformer.transform(text, signal)),
        transformer,
      );
      ctx.provide("agents", 1, store);
      ctx.onDispose(() => store.close());
    },
  };
}
