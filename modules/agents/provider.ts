import type { ExtensionDefinition } from "@modules/sdk";
import type { ChatService } from "@extensions/contracts";
import { AgentStore } from "./store";
import { MAX_MODEL_ID, restoreAgents } from "./validation";
import { prepareChat } from "./attachments";
import { AgentState } from "./persistence";

/**
 * Agents live in this extension's own storage as an index document plus one
 * record per message. `legacy` is the pre-namespace `host.shell.agents` field;
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
      description:
        "管理 Agent 的角色资料、会话和消息记录，并通过所选模型生成回复。",
      // Agents open without any model and say how to add one.
      optional: { chat: 1 },
      provides: { agents: 1 },
      capabilities: ["state.read", "state.batch", "records.list"],
    },
    async activate(ctx) {
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
            .map(
              ({
                id: model,
                label: name,
                description,
                group,
                reasoning,
                vision,
              }) => ({
                provider: id,
                providerLabel: label,
                group: group ?? label,
                id: model,
                label: name,
                description,
                ...(reasoning?.length && { reasoning }),
                ...(vision && { vision }),
              }),
            ),
        );
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
        (
          text,
          signal,
          { model, effort, instructions, history, attachments },
        ) => {
          if (!model)
            throw new Error(
              models().length
                ? "请为此 Agent 选择模型。"
                : "还没有可用的模型，请先添加模型连接。",
            );
          const chat = chats.find((c) => c.id === model.provider);
          if (!chat)
            throw new Error(
              "此 Agent 的模型连接已停用，请在扩展管理中启用，或换一个模型。",
            );
          // Only a strength the model lists is sent; a kept choice may predate a model change.
          const takes =
            effort &&
            models().find(
              (m) => m.provider === model.provider && m.id === model.model,
            )?.reasoning;
          const conversation = prepareChat(
            history,
            { text, attachments },
            models().find(
              (m) => m.provider === model.provider && m.id === model.model,
            )?.vision === true,
          );
          return ctx.task(async () => {
            // A connection stopping mid-reply cancels the call and saves nothing.
            const output = await chat.value.reply(
              {
                model: model.model,
                instructions,
                history: conversation.history,
                input: conversation.input.text,
                ...(conversation.input.images && {
                  images: conversation.input.images,
                }),
                ...(effort && takes?.includes(effort) && { effort }),
              },
              AbortSignal.any([signal, chat.signal]),
            );
            if (chat.signal.aborted)
              throw new Error("模型连接已停用，本次结果未保存，请重试。");
            if (typeof output !== "string")
              throw new Error("模型必须返回文本；本次结果未保存。");
            return output;
          });
        },
        ctx.shell.dependencies(),
        models,
        () => state.blocked(),
        () => chats.map(({ id, label }) => ({ id, label })),
      );
      watchModels();
      // Management lists each Agent under the connection it uses and can
      // switch it on (taking that connection's first model if the Agent uses
      // another) or off. One toggle object lets the host skip republishing
      // when nothing visible changed.
      const toggle = {
        service: "chat",
        set(agentId: string, connector: string, on: boolean) {
          const agent = store.list().find((a) => a.id === agentId);
          if (!on || agent?.model?.provider === connector)
            return store.setOff(agentId, connector, !on);
          const first = models().find((m) => m.provider === connector);
          if (!first)
            return Promise.reject(
              new Error("这个模型连接还没有可用的模型，请先添加。"),
            );
          return store.setModel(agentId, {
            provider: first.provider,
            model: first.id,
          });
        },
      };
      const publish = () => {
        if (ctx.signal.aborted) return;
        ctx.shell.publishUsers(
          "Agent",
          store.list().map((agent) => ({
            id: agent.id,
            label: agent.name,
            uses:
              agent.model && !agent.off?.includes(agent.model.provider)
                ? [agent.model.provider]
                : [],
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
