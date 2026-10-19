import type { CredentialResponse, ExtensionDefinition } from "../sdk";
import type { ChatService } from "../../extensions/contracts";
import { ProviderStore, modelId, presetOf } from "./providers";
import { modelListPaths, readModelList } from "./addresses";
import { formats, presets, protocols } from "./presets";
import { failure, readReply, requestBody, type Turn } from "./protocols";

export const MODEL_PAGE = "model-connections";

/** What the connection page works with; the page itself is supplied by the app. */
export type ModelConnectionsApi = Pick<
  ProviderStore,
  "list" | "subscribe" | "save" | "remove" | "refresh"
> & {
  readonly presets: typeof presets;
  readonly formats: typeof formats;
  /** Sends one short message to one model of a provider and returns the reply. */
  test(provider: string, model: string, signal: AbortSignal): Promise<string>;
  /** Model names the provider's service lists, read with its saved key. */
  fetchModels(provider: string, signal: AbortSignal): Promise<string[]>;
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
      // Re-read the connection before each send: a stale view may be ready.
      const sendProblem = async (id: string) => {
        try {
          await store.refresh();
        } catch {
          return "的连接记录暂不可读，未发送。";
        }
        const status = store.list().find((item) => item.id === id)?.status;
        return status === "ready"
          ? undefined
          : status === "changed"
            ? "的请求地址未确认，请在模型连接中重新保存。"
            : status === "missing"
              ? "还没有录入 API Key，请在模型连接中录入。"
              : "的连接待核对或已停用，请在模型连接中处理。";
      };
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
        const problem = await sendProblem(provider.id);
        if (problem)
          throw failure(`「${provider.name}」${problem}`, "not-dispatched");
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
      // Reads the list where cc-switch looks for it; only the key's site is reached.
      const fetchModels = async (id: string, signal: AbortSignal) => {
        const provider = store.list().find((item) => item.id === id);
        if (!provider) throw new Error("该服务商已被删除。");
        const problem = await sendProblem(id);
        if (problem) throw new Error(`「${provider.name}」${problem}`);
        return ctx.task(async (lifecycle) => {
          const combined = AbortSignal.any([signal, lifecycle]);
          let problem = "";
          for (const path of modelListPaths(provider.protocol, provider.base)) {
            let response: CredentialResponse;
            try {
              response = (await ctx.platform(
                "credential.request",
                { version: 1, binding: provider.alias, method: "GET", path },
                combined,
              )) as CredentialResponse;
            } catch (error) {
              throw new Error(
                `获取模型列表失败：${(error as Error).message || "请求未完成"}`,
                { cause: error },
              );
            }
            if (response.status === 401 || response.status === 403)
              throw new Error(
                `服务拒绝了 API Key（HTTP ${response.status}），请核对后重新录入密钥。`,
              );
            const names =
              response.status < 300 ? readModelList(response.body) : [];
            if (names.length) return names;
            problem =
              response.status < 300
                ? "返回内容里没有模型"
                : `HTTP ${response.status}`;
          }
          throw new Error(
            `没有从该服务取到模型列表（${problem}），请按服务商文档手动填写模型名。`,
          );
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
        formats,
        fetchModels,
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
