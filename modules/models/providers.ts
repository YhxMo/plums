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
  maxTokens: number;
  /** The models' context window in tokens; history is trimmed to fit it. */
  context: number;
  /** Earlier turns sent with each message; 0 sends only the input, null all that fit. */
  turns: number | null;
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
  maxTokens: [1, 8192],
  context: [16_000, 2_000_000],
  turns: [0, 1000],
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
  if (!integer(draft.maxTokens, limits.maxTokens))
    return `最大输出须为 ${limits.maxTokens.join("–")} 的整数。`;
  if (!integer(draft.context, limits.context))
    return `上下文窗口须为 ${limits.context.join("–")} 的整数（token）。`;
  if (draft.turns !== null && !integer(draft.turns, limits.turns))
    return `上下文轮数须为 ${limits.turns.join("–")} 的整数，或留空表示全部。`;
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

function restore(value: unknown): ModelProvider[] {
  if (
    !record(value) ||
    ![2, 3, 4].includes(value.version as number) ||
    !Array.isArray(value.providers)
  )
    throw corrupt();
  const seen = new Set<string>();
  return value.providers.map((raw: unknown) => {
    let entry = raw;
    if (record(entry) && value.version === 2) entry = fromVersion2(entry);
    if (record(entry) && value.version !== 4) entry = fromVersion3(entry);
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

const newId = () => `p-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;

/**
 * The user's model providers: records in this extension's state, keys and
 * targets in credential connections the user confirmed natively. Corrupt
 * state fails the extension and is kept as is.
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
      value: { version: 4, providers: next },
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
      target: chatTarget(draft.protocol, draft.base),
    })) as Result;
    if (result.status === "cancelled") return undefined;
    if (result.status === "rejected")
      throw new Error(`密钥未保存：${result.reason ?? "平台拒绝了请求"}。`);
    // "unknown" may have saved it; the refreshed status shows which.
    return result.alias;
  }
  /**
   * Adds or changes a provider and returns its id, or false when the user
   * cancelled the panel. A new one, a changed address or protocol, or
   * `rekey` asks the user for the key; other edits, models included, only
   * save the record.
   */
  async save(
    input: ProviderDraft,
    id?: string,
    rekey = false,
  ): Promise<string | false> {
    const draft = { ...input, base: normalizeBase(input.protocol, input.base) };
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
      status === "changed" ||
      existing.base !== draft.base ||
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

export const presetOf = (
  provider: Pick<ModelProvider, "preset">,
): Preset | undefined =>
  presets.find((preset) => preset.id === provider.preset);
