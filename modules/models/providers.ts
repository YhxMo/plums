import { ContractError } from "../sdk/errors";
import type { CredentialConnection, StoredState } from "../sdk";
import { presets, type Preset } from "./presets";
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
  preset: string;
  protocol: Protocol;
  target: string;
  /** Model names exactly as the service expects them; may be empty. */
  models: string[];
  maxTokens: number;
  /** Earlier user turns sent with each message; 0 sends only the input. */
  turns: number;
};
export type ProviderDraft = Omit<ModelProvider, "id" | "alias">;
export type ProviderStatus =
  | CredentialConnection["status"]
  /** No saved key for this provider; it has to be entered again. */
  | "missing";
export type ProviderView = ModelProvider & { status: ProviderStatus };

export const MAX_PROVIDERS = 16;
export const MAX_MODELS = 32;
export const limits = { maxTokens: [1, 8192], turns: [0, 50] } as const;
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

/** Plain-language problem with a draft, or undefined when it can be saved. */
export function draftProblem(draft: ProviderDraft) {
  if (!draft.name.trim() || draft.name.length > 40)
    return "名称须为 1–40 个字符。";
  if (!presets.some((preset) => preset.id === draft.preset))
    return "请选择服务商。";
  if (!/^https:\/\/[^/?#:@]+(?:\/[^?#]*)?$/.test(draft.target))
    return "服务地址须是 https:// 开头、不带端口与查询参数的完整地址。";
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
  if (!integer(draft.maxTokens, limits.maxTokens))
    return `最大输出须为 ${limits.maxTokens.join("–")} 的整数。`;
  if (!integer(draft.turns, limits.turns))
    return `上下文轮数须为 ${limits.turns.join("–")} 的整数。`;
  return undefined;
}

function restore(value: unknown): ModelProvider[] {
  if (!record(value) || value.version !== 2 || !Array.isArray(value.providers))
    throw corrupt();
  const seen = new Set<string>();
  return value.providers.map((entry: unknown) => {
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
      [entry.name, entry.preset, entry.target].some(
        (field) => typeof field !== "string",
      )
    )
      throw corrupt();
    seen.add(entry.id);
    const provider = entry as ModelProvider;
    // A preset dropped from a later version leaves the record usable.
    if (draftProblem({ ...provider, preset: presets[0].id })) throw corrupt();
    return provider;
  });
}

const newId = () => `p-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;

/**
 * The user's model providers: records in this extension's state, keys and
 * targets in credential connections the user confirmed natively. Corrupt
 * state fails the extension and is kept as is.
 */
export class ProviderStore {
  private providers: ModelProvider[] = [];
  private credentials: CredentialConnection[] = [];
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
    this.credentials = (await this.call("credential.connect", {
      action: "list",
    })) as CredentialConnection[];
    this.emit();
  }
  list(): readonly ProviderView[] {
    return this.snapshot;
  }
  find(id: string) {
    return this.providers.find((provider) => provider.id === id);
  }
  /** The provider and model behind a chat model id, if both still exist. */
  resolve(id: string) {
    const split = id.indexOf("/");
    const provider = split > 0 ? this.find(id.slice(0, split)) : undefined;
    const model = id.slice(split + 1);
    return provider?.models.includes(model) ? { provider, model } : undefined;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  private emit() {
    this.snapshot = this.providers.map((provider) => ({
      ...provider,
      status:
        this.credentials.find((item) => item.alias === provider.alias)
          ?.status ?? "missing",
    }));
    for (const listener of this.listeners) listener();
  }
  private async write(next: ModelProvider[]) {
    const receipt = (await this.call("state.write", {
      revision: this.revision,
      value: { version: 2, providers: next },
    })) as StoredState;
    this.revision = receipt.revision;
    this.providers = next;
  }
  /** Opens the native panel for target and key; resolves false when cancelled. */
  private async connect(draft: ProviderDraft, alias?: string) {
    const result = (await this.call("credential.connect", {
      action: "save",
      ...(alias && { alias }),
      protocol: draft.protocol,
      label: draft.name,
      target: draft.target,
    })) as Result;
    if (result.status === "cancelled") return undefined;
    if (result.status === "rejected")
      throw new Error(`密钥未保存：${result.reason ?? "平台拒绝了请求"}。`);
    // "unknown" may have saved it; the refreshed status shows which.
    return result.alias;
  }
  /**
   * Adds or changes a provider. A new one, a changed address or protocol, or
   * `rekey` asks the user for the key; other edits, models included, only
   * save the record.
   */
  async save(draft: ProviderDraft, id?: string, rekey = false) {
    const problem = draftProblem(draft);
    if (problem) throw new Error(problem);
    const existing = id === undefined ? undefined : this.find(id);
    if (id !== undefined && !existing) throw new Error("该服务商已被删除。");
    if (!existing && this.providers.length >= MAX_PROVIDERS)
      throw new Error(`最多保存 ${MAX_PROVIDERS} 个服务商。`);
    const status = this.snapshot.find((item) => item.id === id)?.status;
    let alias = existing?.alias;
    if (
      !existing ||
      rekey ||
      status === "missing" ||
      existing.target !== draft.target ||
      existing.protocol !== draft.protocol
    ) {
      alias = await this.connect(
        draft,
        status === "missing" ? undefined : alias,
      );
      if (!alias) return false;
    }
    const next = {
      ...draft,
      models: [...draft.models],
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
    return true;
  }
  /** Deletes the key natively, then the record; cancelling keeps both. */
  async remove(id: string) {
    const existing = this.find(id);
    if (!existing) return true;
    if (this.credentials.some((item) => item.alias === existing.alias)) {
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

export const presetOf = (
  provider: Pick<ModelProvider, "preset">,
): Preset | undefined =>
  presets.find((preset) => preset.id === provider.preset);
