import type { ExtensionDefinition } from "@modules/sdk";
import type { ChatService } from "@extensions/contracts";
import { chatModels } from "@modules/agents/models";
import { MemoryState } from "./persistence";
import { MemoryStore } from "./store";

export const MEMORY_PAGE = "memory";

/** What the memory page works with; the page itself is supplied by the app. */
export type MemoryPageApi = Pick<
  MemoryStore,
  | "snapshot"
  | "subscribe"
  | "add"
  | "update"
  | "remove"
  | "clearExpired"
  | "setModel"
  | "consolidate"
  | "models"
  | "takeFocus"
>;
type MountPage = (
  container: HTMLElement,
  api: MemoryPageApi,
) => () => void | Promise<void>;

/**
 * The built-in `memory@1` provider. Consolidation asks a `chat@1` model,
 * so this extension never holds a key; its page opens from the user's
 * avatar (the shared memory) and from an Agent's details (its own).
 */
export function memoryExtension({
  mountPage,
}: { mountPage?: MountPage } = {}): ExtensionDefinition {
  return {
    manifest: {
      id: "memory.local",
      apiVersion: 1,
      version: "0.0.1",
      description:
        "让 Agent 跨会话记得你：保存你写给所有 Agent 的资料和每个 Agent 从对话里记下的事，会话停下后用所选模型整理，可查看、修改和删除。",
      optional: { chat: 1 },
      provides: { memory: 1 },
      capabilities: ["state.read", "state.batch", "records.list"],
    },
    async activate(ctx) {
      let chats = ctx.providers<ChatService>("chat", (next) => {
        chats = next;
        store.sourcesChanged();
      });
      const state = new MemoryState((capability, payload, signal) =>
        ctx.platform(capability, payload, signal),
      );
      const store = new MemoryStore(
        await state.load(),
        (data, signal) => state.save(data, signal),
        ({ provider, model, instructions, input, effort }, signal) => {
          const chat = chats.find((c) => c.id === provider);
          if (!chat) throw new Error("整理用的模型连接已停用。");
          return ctx.task(() =>
            chat.value.reply(
              {
                model,
                instructions,
                history: [],
                input,
                ...(effort && { effort }),
              },
              AbortSignal.any([signal, chat.signal]),
            ),
          );
        },
        () => chatModels(chats),
        () => ctx.shell.open("view", MEMORY_PAGE),
      );
      if (mountPage)
        ctx.view({
          id: MEMORY_PAGE,
          label: "记忆",
          presentation: "dialog",
          entry: "user",
          mount: (container) => mountPage(container, store),
        });
      ctx.provide("memory", 1, store);
      ctx.onDispose(() => store.close());
    },
  };
}
