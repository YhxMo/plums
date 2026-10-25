import type {
  CredentialResponse,
  ExtensionDefinition,
  NetworkReadResponse,
} from "@modules/sdk";
import type { ChatService } from "@extensions/contracts";
import { ProviderStore, limits, modelId, presetOf } from "./providers";
import {
  CATALOG_SOURCE,
  CATALOG_URL,
  contextWindow,
  readCatalog,
  type Catalog,
} from "./catalog";
import { modelListPaths, readModelList } from "./addresses";
import { formats, presets, protocols } from "./presets";
import { reasoningLevels } from "./reasoning";
import { readsPictures } from "./vision";
import { failure, readReply, requestBody, type Turn } from "./protocols";

export const MODEL_PAGE = "model-connections";
/** models.dev is read again after an hour, like cc-switch. */
const CATALOG_TTL = 3_600_000;
/** How long a listed model waits for models.dev before showing without it. */
const CATALOG_WAIT = 5000;

/** The value, or undefined when it fails or `ms` pass first; rejects on abort. */
const atMost = <T>(value: Promise<T>, ms: number, signal: AbortSignal) =>
  new Promise<T | undefined>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => resolve(undefined), ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
    void value
      .then(resolve, () => resolve(undefined))
      .finally(() => {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      });
  });

/** A model the service lists, with the window models.dev gives for it. */
export type ListedModel = { name: string; context?: number };

/** What the connection page works with; the page itself is supplied by the app. */
export type ModelConnectionsApi = Pick<
  ProviderStore,
  "list" | "subscribe" | "save" | "remove" | "refresh" | "needsReload"
> & {
  /** Reconciles an uncertain save before allowing more writes or requests. */
  reload(): Promise<void>;
  readonly presets: typeof presets;
  readonly formats: typeof formats;
  /** Sends one short message to one model of a provider and returns the reply. */
  test(provider: string, model: string, signal: AbortSignal): Promise<string>;
  /** Models the provider's service lists, read with its saved key. */
  fetchModels(provider: string, signal: AbortSignal): Promise<ListedModel[]>;
};
type MountPage = (
  container: HTMLElement,
  api: ModelConnectionsApi,
) => () => void | Promise<void>;

const pictures = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length <= 20 &&
    value.every(
      (image) =>
        !!image &&
        ["image/jpeg", "image/png", "image/webp"].includes(image.mime) &&
        typeof image.data === "string" &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(image.data),
    ));

const turns = (value: unknown): value is Turn[] =>
  Array.isArray(value) &&
  value.every(
    (turn) =>
      !!turn &&
      typeof turn === "object" &&
      ["user", "agent"].includes((turn as Turn).role) &&
      typeof (turn as Turn).text === "string" &&
      pictures((turn as Turn).images),
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
        "添加你自己的模型服务商（DeepSeek、OpenAI、Anthropic、Kimi、通义、智谱、OpenRouter 或任何兼容接口）和它的模型，供各个 Agent 选用。密钥只交给本机应用保存，扩展记录里没有它；对话会发送到你选的服务。",
      capabilities: [
        "state.read",
        "state.write",
        "credential.request",
        "credential.connect",
        "network.read",
      ],
      provides: { chat: 1 },
      credentialProtocols: protocols,
      networkSources: [CATALOG_SOURCE],
    },
    async activate(ctx) {
      const store = new ProviderStore((capability, payload) =>
        ctx.platform(capability, payload),
      );
      await store.load();
      // Re-read the connection before each send: a stale view may be ready.
      const sendProblem = async (id: string) => {
        if (store.needsReload)
          return "的保存结果未确认，请在模型连接中重新读取后核对。";
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
              ? "还没有填写 API Key，请在模型连接中填写。"
              : "的连接待核对或已停用，请在模型连接中处理。";
      };
      const reply: ChatService["reply"] = async (request, signal) => {
        signal.throwIfAborted();
        const { model, instructions, history, input, effort, images } =
          request ?? {};
        let chosen =
          typeof model === "string" ? store.resolve(model) : undefined;
        const missingModel = () =>
          failure(
            "所选模型已从模型连接中删除，请在对话输入区重新选择模型。",
            "not-dispatched",
          );
        if (!chosen) throw missingModel();
        const problem = await sendProblem(chosen.provider.id);
        if (problem)
          throw failure(
            `「${chosen.provider.name}」${problem}`,
            "not-dispatched",
          );
        // A save/reload may have changed the selection while readiness was read.
        chosen = store.resolve(model);
        if (!chosen) throw missingModel();
        const { provider } = chosen;
        if (
          typeof input !== "string" ||
          !input.trim() ||
          !turns(history) ||
          !pictures(images) ||
          (instructions !== undefined && typeof instructions !== "string")
        )
          throw failure("对话内容格式无效，未发送。", "not-dispatched");
        const preset = presetOf(provider);
        const body = requestBody(
          {
            ...provider,
            model: chosen.model,
            context: chosen.context,
            thinking: provider.thinking[chosen.model],
            extra:
              preset?.protocol === provider.protocol ? preset.extra : undefined,
          },
          { instructions, history, input, effort, images },
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
      // Shared by every lookup and stopped only with the extension, so a
      // closed form never takes it from another; a failure is retried.
      let catalog: { at: number; value: Promise<Catalog | undefined> } | null =
        null;
      const loadCatalog = () => {
        if (catalog && Date.now() - catalog.at < CATALOG_TTL)
          return catalog.value;
        const value = ctx
          .task(async (lifecycle) => {
            const response = (await ctx.platform(
              "network.read",
              { version: 1, url: CATALOG_URL },
              lifecycle,
            )) as NetworkReadResponse;
            return response.status === 200
              ? readCatalog(response.body)
              : undefined;
          })
          .catch(() => undefined);
        const entry = { at: Date.now(), value };
        catalog = entry;
        void value.then((found) => {
          if (!found && catalog === entry) catalog = null;
        });
        return value;
      };
      /** models.dev's window for a model, within what a provider may use. */
      const windowFor = (
        found: Catalog | undefined,
        base: string,
        name: string,
      ) => {
        const tokens = found && contextWindow(found, base, name);
        return tokens && tokens >= limits.context[0]
          ? Math.min(tokens, limits.context[1])
          : undefined;
      };
      // Reads the list where cc-switch looks for it; only the key's site is reached.
      const listModels = async (id: string, signal: AbortSignal) => {
        const problem = await sendProblem(id);
        const provider = store.find(id);
        if (!provider) throw new Error("该服务商已被删除。");
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
                `服务拒绝了 API Key（HTTP ${response.status}），请核对后重新填写。`,
              );
            const names =
              response.status < 300 ? readModelList(response.body) : [];
            if (names.length) return { names, base: provider.base };
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
      const fetchModels = async (
        id: string,
        signal: AbortSignal,
      ): Promise<ListedModel[]> => {
        signal.throwIfAborted();
        if (store.needsReload)
          throw failure(
            "保存结果未确认，请重新读取连接后核对。",
            "not-dispatched",
          );
        // Read alongside the list; the list never waits long for it.
        const pending = loadCatalog();
        const { names, base } = await listModels(id, signal);
        const found = await atMost(pending, CATALOG_WAIT, signal);
        return names.map((name) => {
          const context = windowFor(found, base, name);
          return context ? { name, context } : { name };
        });
      };
      const models = () =>
        store.list().flatMap((provider) => {
          const label = presetOf(provider)?.label ?? "自定义";
          const description = `${provider.name === label ? label : `${provider.name}，${label}`}${provider.status === "ready" ? "" : "（需要填写 API Key）"}`;
          return provider.models.map((model) => {
            const reasoning = reasoningLevels(
              provider.protocol,
              provider.preset,
              model,
              provider.thinking[model],
            );
            return {
              id: modelId(provider.id, model),
              label: model,
              group: provider.name,
              description,
              ...(reasoning && { reasoning }),
              ...(readsPictures(provider.protocol, model) && { vision: true }),
            };
          });
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
        save: (draft, id, key) => store.save(draft, id, key),
        remove: (id) => store.remove(id),
        refresh: () => store.refresh(),
        reload: () => store.load(),
        get needsReload() {
          return store.needsReload;
        },
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
