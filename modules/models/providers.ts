import { ContractError } from "../sdk/errors";
import type { CredentialConnection, StoredState } from "../sdk";
import { chatTarget, normalizeBase } from "./addresses";
import { CUSTOM, presets, type Preset } from "./presets";
import type { Protocol } from "./protocols";

/**
 * One provider the user set up: a service address and key, and the model
 * names the user added for it. Agents pick one provider's model.
 */
export type ModelProvider = {
  id: string;
  /** Credential alias holding the target and key; replaced when re-made. */
  alias: string;
  name: string;
  /** The user's own note, such as which account this is; may be empty. */
  notes: string;
  /** Home page for reference; may be empty. */
  website: string;
  preset: string;
  protocol: Protocol;
  /** Base URL; chat requests go to `chatTarget(protocol, base)`. */
  base: string;
  /** Model names exactly as the service expects them; may be empty. */
  models: string[];
  /** A model's own context window, from models.dev or the user. */
  windows: Record<string, number>;
  /** Longest reply in tokens; null leaves it to the service. */
  maxTokens: number | null;
  /** Context window of models without their own; history is trimmed to fit. */
  context: number;
};
export type ProviderDraft = Omit<ModelProvider, "id" | "alias">;
export type ProviderStatus =
  | CredentialConnection["status"]
  /** No saved key for this provider; it has to be entered again. */
  | "missing"
  /**
   * The confirmed address is not this record's, as when the record failed
   * to save after the panel; nothing is sent until it is saved again.
   */
  | "changed";
export type ProviderView = ModelProvider & { status: ProviderStatus };

export const MAX_PROVIDERS = 16;
export const MAX_MODELS = 32;
export const limits = {
  maxTokens: [1, 128_000],
  context: [16_000, 2_000_000],
} as const;
/** Chat model id offered to Agents: provider id, then the model name. */
export const modelId = (provider: string, model: string) =>
  `${provider}/${model}`;
type Call = (capability: string, payload?: unknown) => Promise<unknown>;
type Result = { alias: string; status: string; reason?: string };

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const corrupt = () =>
  new ContractError("state.corrupt", "providers", "模型连接配置损坏");
const integer = (value: unknown, [min, max]: readonly [number, number]) =>
  Number.isSafeInteger(value) &&
  (value as number) >= min &&
  (value as number) <= max;

const plainText = (value: unknown, max: number) =>
  typeof value === "string" &&
  value.length <= max &&
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  !/[\u0000-\u001f\u007f]/.test(value);
const httpsAddress = /^https:\/\/[^/?#:@\s]+(?:\/[^?#\s]*)?$/;

/** Plain-language problem with a draft, or undefined when it can be saved. */
export function draftProblem(draft: ProviderDraft) {
  if (!draft.name.trim() || !plainText(draft.name, 40))
    return "名称须为 1–40 个字符。";
  if (!plainText(draft.notes, 80)) return "备注最多 80 个字符。";
  if (
    !plainText(draft.website, 200) ||
    (draft.website && !/^https?:\/\/\S+$/.test(draft.website))
  )
    return "官网链接须以 http:// 或 https:// 开头。";
  const preset = presets.find((item) => item.id === draft.preset);
  if (!preset) return "请选择服务商。";
  if (preset.id !== CUSTOM && preset.protocol !== draft.protocol)
    return "API 格式与服务商不符。";
  if (!httpsAddress.test(draft.base))
    return "请求地址须是 https:// 开头、不带端口与查询参数的地址。";
  if (draft.models.length > MAX_MODELS)
    return `每个服务商最多添加 ${MAX_MODELS} 个模型。`;
  if (
    draft.models.some(
      (model) =>
        typeof model !== "string" ||
        !model ||
        model.length > 120 ||
        model !== model.trim(),
    )
  )
    return "模型名须为 1–120 个字符，不含首尾空格。";
  if (new Set(draft.models).size !== draft.models.length) return "模型名重复。";
  if (
    !record(draft.windows) ||
    Object.entries(draft.windows).some(
      ([model, tokens]) =>
        !draft.models.includes(model) || !integer(tokens, limits.context),
    )
  )
    return `模型的上下文窗口须为 ${limits.context.join("–")} 的整数（token）。`;
  if (draft.maxTokens !== null && !integer(draft.maxTokens, limits.maxTokens))
    return `最大输出须为 ${limits.maxTokens.join("–")} 的整数，或留空由服务决定。`;
  if (!integer(draft.context, limits.context))
    return `上下文窗口须为 ${limits.context.join("–")} 的整数（token）。`;
  if (draft.maxTokens !== null && draft.maxTokens >= draft.context)
    return "最大输出须小于默认上下文窗口。";
  const small = Object.entries(draft.windows).find(
    ([, tokens]) => draft.maxTokens !== null && draft.maxTokens >= tokens,
  );
  if (small) return `最大输出须小于 ${small[0]} 的上下文窗口。`;
  return undefined;
}

/** Version 2 kept the full chat address and one preset per custom format. */
function fromVersion2({ target, ...entry }: Record<string, unknown>) {
  return {
    ...entry,
    notes: "",
    website: "",
    preset: String(entry.preset).startsWith("custom-") ? CUSTOM : entry.preset,
    base:
      typeof target === "string"
        ? normalizeBase(entry.protocol as Protocol, target)
        : undefined,
  };
}
/** Version 3 had no context window; its preset's is the best guess. */
const fromVersion3 = (entry: Record<string, unknown>) => ({
  ...entry,
  context: (
    presets.find((preset) => preset.id === entry.preset) ??
    presets.find((preset) => preset.id === CUSTOM)!
  ).context,
});

/**
 * Version 4 limited the turns sent, and its form defaulted to 1024 output
 * tokens; now the whole conversation goes and the service sets the length.
 */
function fromVersion4({ turns: _turns, ...entry }: Record<string, unknown>) {
  return {
    ...entry,
    maxTokens: entry.maxTokens === 1024 ? null : entry.maxTokens,
  };
}

/** Version 5 had one context window for all of a provider's models. */
const fromVersion5 = (entry: Record<string, unknown>) => ({
  ...entry,
  windows: {},
});

function restore(value: unknown): ModelProvider[] {
  if (
    !record(value) ||
    ![2, 3, 4, 5, 6].includes(value.version as number) ||
    !Array.isArray(value.providers)
  )
    throw corrupt();
  const version = value.version as number;
  const seen = new Set<string>();
  return value.providers.map((raw: unknown) => {
    let entry = raw;
    if (record(entry) && version === 2) entry = fromVersion2(entry);
    if (record(entry) && version < 4) entry = fromVersion3(entry);
    if (record(entry) && version < 5) entry = fromVersion4(entry);
    if (record(entry) && version < 6) entry = fromVersion5(entry);
    if (
      !record(entry) ||
      typeof entry.id !== "string" ||
      !/^p-[a-z0-9]{8}$/.test(entry.id) ||
      !Array.isArray(entry.models) ||
      seen.has(entry.id) ||
      typeof entry.alias !== "string" ||
      !["openai-chat", "anthropic-messages"].includes(
        entry.protocol as string,
      ) ||
      [entry.name, entry.notes, entry.website, entry.preset, entry.base].some(
        (field) => typeof field !== "string",
      )
    )
      throw corrupt();
    seen.add(entry.id);
    const provider = entry as ModelProvider;
    // A preset dropped from a later version leaves the record usable.
    if (draftProblem({ ...provider, preset: CUSTOM })) throw corrupt();
    return provider;
  });
}

/** What native storage accepts: printable ASCII without spaces. */
const validKey = (key: string) => /^[\x21-\x7e]{1,4096}$/.test(key);

const newId = () => `p-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;

/**
 * The user's model providers: records in this extension's state; keys and
 * targets in credential connections, where the key is stored natively and
 * never read back. Corrupt state fails the extension and is kept as is.
 */
export class ProviderStore {
  private providers: ModelProvider[] = [];
  /** Undefined when the last re-read failed: every status is then unknown. */
  private credentials: CredentialConnection[] | undefined = [];
  private revision = 0;
  private listeners = new Set<() => void>();
  private snapshot: ProviderView[] = [];
  constructor(private readonly call: Call) {}

  async load() {
    const saved = (await this.call("state.read")) as StoredState | null;
    if (saved) {
      this.providers = restore(saved.value);
      this.revision = saved.revision;
    }
    await this.refresh();
  }
  /** Re-reads which providers hold a key. */
  async refresh() {
    try {
      this.credentials = (await this.call("credential.connect", {
        action: "list",
      })) as CredentialConnection[];
    } catch (error) {
      this.credentials = undefined;
      throw error;
    } finally {
      this.emit();
    }
  }
  list(): readonly ProviderView[] {
    return this.snapshot;
  }
  find(id: string) {
    return this.providers.find((provider) => provider.id === id);
  }
  /** The provider, model and its window behind a chat model id, if both still exist. */
  resolve(id: string) {
    const split = id.indexOf("/");
    const provider = split > 0 ? this.find(id.slice(0, split)) : undefined;
    const model = id.slice(split + 1);
    return provider?.models.includes(model)
      ? { provider, model, context: windowOf(provider, model) }
      : undefined;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  private emit() {
    this.snapshot = this.providers.map((provider) => {
      const credential = this.credentials?.find(
        (item) => item.alias === provider.alias,
      );
      return {
        ...provider,
        status: !this.credentials
          ? "pending"
          : !credential
            ? "missing"
            : credential.target !== chatTarget(provider.protocol, provider.base)
              ? "changed"
              : credential.status,
      };
    });
    for (const listener of this.listeners) listener();
  }
  private async write(next: ModelProvider[]) {
    const receipt = (await this.call("state.write", {
      revision: this.revision,
      value: { version: 6, providers: next },
    })) as StoredState;
    this.revision = receipt.revision;
    this.providers = next;
  }
  /**
   * A connection no provider uses, left when a new provider's key was saved
   * but its record was not. Reusing it keeps failed saves from using up the
   * connection limit, without a native delete prompt.
   */
  private spare() {
    return this.credentials?.find(
      (item) =>
        item.status !== "pending" &&
        item.status !== "delete-pending" &&
        !this.providers.some((provider) => provider.alias === item.alias),
    )?.alias;
  }
  /** Saves the key for the draft's target, under `alias` when given. */
  private async connect(draft: ProviderDraft, key: string, alias?: string) {
    const result = (await this.call("credential.connect", {
      action: "save",
      ...(alias && { alias }),
      protocol: draft.protocol,
      label: draft.name,
      target: chatTarget(draft.protocol, draft.base),
      key,
    })) as Result;
    if (result.status === "rejected" || result.status === "cancelled")
      throw new Error(
        `密钥未保存：${result.reason === "invalid-key" ? "API Key 格式无效" : (result.reason ?? "平台拒绝了请求")}。`,
      );
    // "unknown" may have saved it; the refreshed status shows which.
    return result.alias;
  }
  /**
   * Adds or changes a provider and returns its id. A new one, or a changed
   * address or protocol, needs `key`; given for an existing one, it replaces
   * the saved key. Other edits, models included, only save the record.
   */
  async save(input: ProviderDraft, id?: string, key?: string): Promise<string> {
    const draft = {
      ...input,
      base: normalizeBase(input.protocol, input.base),
      // A removed model takes its window with it.
      windows: Object.fromEntries(
        Object.entries(input.windows ?? {}).filter(([model]) =>
          input.models.includes(model),
        ),
      ),
    };
    const problem = draftProblem(draft);
    if (problem) throw new Error(problem);
    if (key && !validKey(key))
      throw new Error("API Key 须为 1–4096 个字符，不含空格与中文。");
    const existing = id === undefined ? undefined : this.find(id);
    if (id !== undefined && !existing) throw new Error("该服务商已被删除。");
    if (!existing && this.providers.length >= MAX_PROVIDERS)
      throw new Error(`最多保存 ${MAX_PROVIDERS} 个服务商。`);
    const status = this.snapshot.find((item) => item.id === id)?.status;
    let alias = existing?.alias;
    if (
      !existing ||
      status === "missing" ||
      status === "changed" ||
      existing.base !== draft.base ||
      existing.protocol !== draft.protocol
    ) {
      if (!key) throw new Error("请填写 API Key。");
    }
    if (key)
      alias = await this.connect(
        draft,
        key,
        !existing || status === "missing" ? this.spare() : alias,
      );
    const next = {
      ...draft,
      models: [...draft.models],
      windows: { ...draft.windows },
      id: existing?.id ?? newId(),
      alias: alias!,
    };
    try {
      await this.write(
        existing
          ? this.providers.map((item) => (item.id === next.id ? next : item))
          : [...this.providers, next],
      );
    } finally {
      await this.refresh();
    }
    return next.id;
  }
  /** Deletes the key natively, then the record; cancelling keeps both. */
  async remove(id: string) {
    const existing = this.find(id);
    if (!existing) return true;
    await this.refresh();
    if (this.credentials!.some((item) => item.alias === existing.alias)) {
      const result = (await this.call("credential.connect", {
        action: "remove",
        alias: existing.alias,
      })) as Result;
      if (result.status === "cancelled") return false;
      if (result.status === "rejected")
        throw new Error(`未删除：${result.reason ?? "平台拒绝了请求"}。`);
    }
    try {
      await this.write(this.providers.filter((item) => item.id !== id));
    } finally {
      await this.refresh();
    }
    return true;
  }
}

/** The model's own window, or its provider's. */
export const windowOf = (
  provider: Pick<ModelProvider, "windows" | "context">,
  model: string,
) =>
  Object.hasOwn(provider.windows, model)
    ? provider.windows[model]
    : provider.context;

export const presetOf = (
  provider: Pick<ModelProvider, "preset">,
): Preset | undefined =>
  presets.find((preset) => preset.id === provider.preset);
