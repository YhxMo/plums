import type { ExtensionDefinition } from "../sdk";
import type { Agent } from "./contract";
import type { Transformer } from "../../extensions/contracts";
import { AgentStore, type SaveOptions } from "./store";

export function agentExtension(
  initial: Agent[],
  persist: (agents: Agent[], options?: SaveOptions) => Promise<void>,
): ExtensionDefinition {
  return {
    manifest: {
      id: "agents.local",
      apiVersion: 1,
      version: "0.0.4",
      requires: { "text.transform": 1 },
      provides: { agents: 1 },
    },
    activate(ctx) {
      const transformer = ctx.use<Transformer>("text.transform");
      const store = new AgentStore(
        initial,
        async (agents, options) => {
          await persist(agents, options);
          initial = agents;
        },
        (text, signal) => ctx.task(() => transformer.transform(text, signal)),
      );
      ctx.provide("agents", 1, store);
      ctx.onDispose(() => store.close());
    },
  };
}
