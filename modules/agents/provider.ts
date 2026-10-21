import type { ExtensionDefinition } from "../sdk";
import type { ChatService, Transformer } from "../../extensions/contracts";
import { AgentStore, MAX_MODEL_ID, restoreAgents } from "./store";
import { enabledExtensions } from "./contract";
import { AgentState } from "./sharded-state";

const NONE_AVAILABLE =
  "还没有可用的模型，请在 Agent 详情中添加模型连接，或在扩展管理中启用模型连接扩展。";

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
      // Agents open without any model or text service and say how to add one.
      optional: { chat: 1, "text.transform": 1 },
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
      // Each connector's model list can change while it runs.
      let unwatch: Array<() => void> = [];
      const watchModels = () => {
        unwatch.forEach((stop) => stop());
        unwatch = chats.map(({ value }) =>
          value.subscribe(() => store.sourcesChanged()),
        );
      };
      let chats = ctx.providers<ChatService>("chat", (next) => {
        chats = next;
        watchModels();
        store.sourcesChanged();
      });
      ctx.onDispose(() => unwatch.forEach((stop) => stop()));
      const models = () =>
        chats.flatMap(({ id, label, value }) =>
          value
            .models()
            .filter(({ id: model }) => model.length <= MAX_MODEL_ID)
            .map(({ id: model, label: name, description, group }) => ({
              provider: id,
              providerLabel: label,
              group: group ?? label,
              id: model,
              label: name,
              description,
            })),
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
        (text, signal, extensions, { model, instructions, history }) => {
          if (!model && !extensions.length)
            throw new Error(
              models().length
                ? "请在 Agent 详情中为此 Agent 选择模型。"
                : transformers.length
                  ? "此 Agent 没有开启的扩展，请在 Agent 详情中开启至少一个。"
                  : NONE_AVAILABLE,
            );
          return ctx.task(async () => {
            let output = text;
            if (model) {
              const chat = chats.find((c) => c.id === model.provider);
              if (!chat)
                throw new Error(
                  "此 Agent 的模型连接已停用，请在扩展管理中启用，或在 Agent 详情中换一个模型。",
                );
              output = await chat.value.reply(
                { model: model.model, instructions, history, input: text },
                AbortSignal.any([signal, chat.signal]),
              );
              if (chat.signal.aborted)
                throw new Error("模型连接已停用，本次结果未保存，请重试。");
              if (typeof output !== "string")
                throw new Error("模型必须返回文本；本次结果未保存。");
            }
            for (const id of extensions) {
              const transformer = transformers.find((t) => t.id === id);
              if (!transformer) throw new Error("扩展已停用，请重试。");
              // A service stopping mid-reply cancels the call and saves nothing.
              output = await transformer.value.transform(
                output,
                AbortSignal.any([signal, transformer.signal]),
              );
              if (transformer.signal.aborted)
                throw new Error("扩展已停用，本次结果未保存，请重试。");
              if (typeof output !== "string")
                throw new Error("文本服务必须返回文本；本次结果未保存。");
            }
            return output;
          });
        },
        sources,
        ctx.shell.dependencies(),
        models,
        () => state.blocked(),
        () => chats.map(({ id, label }) => ({ id, label })),
      );
      watchModels();
      // Management lists each Agent under the services it has switched on
      // and can switch any of them on or off. One toggle object lets the
      // host skip republishing when nothing visible changed.
      const toggle = {
        service: "text.transform",
        set: (agentId: string, extensionId: string, on: boolean) =>
          store.setExtension(agentId, extensionId, on),
      };
      const publish = () => {
        if (ctx.signal.aborted) return;
        const choices = sources();
        ctx.shell.publishUsers(
          "Agent",
          store.list().map((agent) => ({
            id: agent.id,
            label: agent.name,
            uses: [
              ...(agent.model && !agent.off?.includes(agent.model.provider)
                ? [agent.model.provider]
                : []),
              ...enabledExtensions(agent, choices),
            ],
          })),
          toggle,
        );
      };
      publish();
      ctx.onDispose(store.subscribe(publish));
      ctx.provide("agents", 1, store);
      ctx.onDispose(() => store.close());
    },
  };
}
