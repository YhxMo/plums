import type { ExtensionDefinition } from "../sdk";
import type { ChatService } from "../../extensions/contracts";
import { ConnectionStore, presetOf } from "./connections";
import { presets, protocols } from "./presets";
import { failure, readReply, requestBody, type Turn } from "./protocols";

export const MODEL_PAGE = "model-connections";

/** What the connection page works with; the page itself is supplied by the app. */
export type ModelConnectionsApi = Pick<
  ConnectionStore,
  "list" | "subscribe" | "save" | "remove" | "refresh"
> & {
  readonly presets: typeof presets;
  /** Sends one short message through the connection and returns the reply. */
  test(id: string, signal: AbortSignal): Promise<string>;
};
type MountPage = (
  container: HTMLElement,
  api: ModelConnectionsApi,
) => () => void | Promise<void>;

const turns = (value: unknown): value is Turn[] =>
  Array.isArray(value) &&
  value.every(
    (turn) =>
      !!turn &&
      typeof turn === "object" &&
      ["user", "agent"].includes((turn as Turn).role) &&
      typeof (turn as Turn).text === "string",
  );

/**
 * Built-in model connector: the user's connections to model services over
 * the OpenAI-compatible and Anthropic protocols, offered to Agents as
 * `chat@1`. Keys and targets stay behind credential connections.
 */
export function modelConnector({
  mountPage,
}: {
  mountPage: MountPage;
}): ExtensionDefinition {
  return {
    manifest: {
      id: "connector.models",
      version: "0.1.0",
      apiVersion: 1,
      description:
        "连接你自己的模型服务（DeepSeek、OpenAI、Anthropic、Kimi、通义、智谱、OpenRouter 或任何兼容接口），供各个 Agent 选用。密钥只保存在系统凭据库；对话会发送到你选的服务。",
      capabilities: [
        "state.read",
        "state.write",
        "credential.request",
        "credential.connect",
      ],
      provides: { chat: 1 },
      credentialProtocols: protocols,
    },
    async activate(ctx) {
      const store = new ConnectionStore((capability, payload) =>
        ctx.platform(capability, payload),
      );
      await store.load();
      const reply: ChatService["reply"] = async (request, signal) => {
        signal.throwIfAborted();
        const { model, instructions, history, input } = request ?? {};
        const connection =
          typeof model === "string" ? store.find(model) : undefined;
        if (!connection)
          throw failure(
            "所选模型连接已删除，请在 Agent 详情中重新选择模型。",
            "not-dispatched",
          );
        if (
          typeof input !== "string" ||
          !input.trim() ||
          !turns(history) ||
          (instructions !== undefined && typeof instructions !== "string")
        )
          throw failure("对话内容格式无效，未发送。", "not-dispatched");
        const preset = presetOf(connection);
        const body = requestBody(
          {
            ...connection,
            extra:
              preset?.protocol === connection.protocol
                ? preset.extra
                : undefined,
          },
          { instructions, history, input },
        );
        return ctx.task(async (lifecycle) => {
          const combined = AbortSignal.any([signal, lifecycle]);
          combined.throwIfAborted();
          let response: unknown;
          try {
            response = await ctx.platform(
              "credential.request",
              { version: 1, binding: connection.alias, body },
              combined,
            );
          } catch (error) {
            const outcome = (error as { outcome?: string })?.outcome;
            if (outcome === "not-dispatched" || outcome === "not-committed")
              throw failure(
                `「${connection.name}」请求未发送：${(error as Error).message}`,
                outcome,
              );
            throw failure(
              `「${connection.name}」请求结果未确认；重试可能产生重复调用或计费。`,
              "unknown",
            );
          }
          if (combined.aborted)
            throw failure(
              "请求已取消；远端结果未确认，重试可能产生重复调用或计费。",
              "unknown",
            );
          return readReply(connection.protocol, response);
        });
      };
      const models = () =>
        store.list().map(({ id, name, model, preset, status }) => ({
          id,
          label: name,
          description: `${presets.find((p) => p.id === preset)?.label ?? "自定义"} · ${model}${status === "ready" ? "" : "（需要录入密钥）"}`,
        }));
      const service: ChatService = {
        name: "模型连接",
        models,
        subscribe: (listener) => store.subscribe(listener),
        reply,
      };
      ctx.provide("chat", 1, service);
      const api: ModelConnectionsApi = {
        presets,
        list: () => store.list(),
        subscribe: (listener) => store.subscribe(listener),
        save: (draft, id, rekey) => store.save(draft, id, rekey),
        remove: (id) => store.remove(id),
        refresh: () => store.refresh(),
        test: (id, signal) =>
          reply(
            { model: id, history: [], input: "请只回复四个字：连接成功" },
            signal,
          ),
      };
      ctx.view({
        id: MODEL_PAGE,
        label: "模型连接",
        presentation: "dialog",
        mount: (container) => mountPage(container, api),
      });
    },
  };
}
