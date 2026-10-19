import type { ExtensionDefinition } from "../sdk";
import type { ChatService } from "../../extensions/contracts";
import { ProviderStore, modelId, presetOf } from "./providers";
import { presets, protocols } from "./presets";
import { failure, readReply, requestBody, type Turn } from "./protocols";

export const MODEL_PAGE = "model-connections";

/** What the connection page works with; the page itself is supplied by the app. */
export type ModelConnectionsApi = Pick<
  ProviderStore,
  "list" | "subscribe" | "save" | "remove" | "refresh"
> & {
  readonly presets: typeof presets;
  /** Sends one short message to one model of a provider and returns the reply. */
  test(provider: string, model: string, signal: AbortSignal): Promise<string>;
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
 * Built-in model connector: the user's model providers over the
 * OpenAI-compatible and Anthropic protocols, each with the model names the
 * user added, offered to Agents as `chat@1`. Keys and targets stay behind
 * credential connections.
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
        "添加你自己的模型服务商（DeepSeek、OpenAI、Anthropic、Kimi、通义、智谱、OpenRouter 或任何兼容接口）和它的模型，供各个 Agent 选用。密钥只保存在系统凭据库；对话会发送到你选的服务。",
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
      const store = new ProviderStore((capability, payload) =>
        ctx.platform(capability, payload),
      );
      await store.load();
      const reply: ChatService["reply"] = async (request, signal) => {
        signal.throwIfAborted();
        const { model, instructions, history, input } = request ?? {};
        const chosen =
          typeof model === "string" ? store.resolve(model) : undefined;
        if (!chosen)
          throw failure(
            "所选模型已从模型连接中删除，请在 Agent 详情中重新选择模型。",
            "not-dispatched",
          );
        const { provider } = chosen;
        if (
          typeof input !== "string" ||
          !input.trim() ||
          !turns(history) ||
          (instructions !== undefined && typeof instructions !== "string")
        )
          throw failure("对话内容格式无效，未发送。", "not-dispatched");
        const preset = presetOf(provider);
        const body = requestBody(
          {
            ...provider,
            model: chosen.model,
            extra:
              preset?.protocol === provider.protocol ? preset.extra : undefined,
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
              { version: 1, binding: provider.alias, body },
              combined,
            );
          } catch (error) {
            const outcome = (error as { outcome?: string })?.outcome;
            if (outcome === "not-dispatched" || outcome === "not-committed")
              throw failure(
                `「${provider.name}」请求未发送：${(error as Error).message}`,
                outcome,
              );
            throw failure(
              `「${provider.name}」请求结果未确认；重试可能产生重复调用或计费。`,
              "unknown",
            );
          }
          if (combined.aborted)
            throw failure(
              "请求已取消；远端结果未确认，重试可能产生重复调用或计费。",
              "unknown",
            );
          return readReply(provider.protocol, response);
        });
      };
      const models = () =>
        store.list().flatMap((provider) => {
          const label = presetOf(provider)?.label ?? "自定义";
          const description = `${provider.name === label ? label : `${provider.name} · ${label}`}${provider.status === "ready" ? "" : "（需要录入密钥）"}`;
          return provider.models.map((model) => ({
            id: modelId(provider.id, model),
            label: model,
            group: provider.name,
            description,
          }));
        });
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
        test: (provider, model, signal) =>
          reply(
            {
              model: modelId(provider, model),
              history: [],
              input: "请只回复四个字：连接成功",
            },
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
