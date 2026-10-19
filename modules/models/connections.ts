import { ContractError } from "../sdk/errors";
import type { CredentialConnection, StoredState } from "../sdk";
import { presets, type Preset } from "./presets";
import type { Protocol } from "./protocols";

/** One model the user set up: a service address, a model name and its key. */
export type ModelConnection = {
  id: string;
  /** Credential alias holding the target and key; replaced when re-made. */
  alias: string;
  name: string;
  preset: string;
  protocol: Protocol;
  target: string;
  model: string;
  maxTokens: number;
  /** Earlier user turns sent with each message; 0 sends only the input. */
  turns: number;
};
export type ConnectionDraft = Omit<ModelConnection, "id" | "alias">;
export type ConnectionStatus =
  | CredentialConnection["status"]
  /** No saved key for this connection; it has to be entered again. */
  | "missing";
export type ConnectionView = ModelConnection & { status: ConnectionStatus };

export const MAX_CONNECTIONS = 16;
export const limits = { maxTokens: [1, 8192], turns: [0, 50] } as const;
type Call = (capability: string, payload?: unknown) => Promise<unknown>;
type Result = { alias: string; status: string; reason?: string };

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const corrupt = () =>
  new ContractError("state.corrupt", "connections", "模型连接配置损坏");
const integer = (value: unknown, [min, max]: readonly [number, number]) =>
  Number.isSafeInteger(value) &&
  (value as number) >= min &&
  (value as number) <= max;

/** Plain-language problem with a draft, or undefined when it can be saved. */
export function draftProblem(draft: ConnectionDraft) {
  if (!draft.name.trim() || draft.name.length > 40)
    return "名称须为 1–40 个字符。";
  if (!presets.some((preset) => preset.id === draft.preset))
    return "请选择服务商。";
  if (!/^https:\/\/[^/?#:@]+(?:\/[^?#]*)?$/.test(draft.target))
    return "服务地址须是 https:// 开头、不带端口与查询参数的完整地址。";
  if (
    !draft.model.trim() ||
    draft.model.length > 120 ||
    draft.model !== draft.model.trim()
  )
    return "请填写模型名（不含首尾空格）。";
  if (!integer(draft.maxTokens, limits.maxTokens))
    return `最大输出须为 ${limits.maxTokens.join("–")} 的整数。`;
  if (!integer(draft.turns, limits.turns))
    return `上下文轮数须为 ${limits.turns.join("–")} 的整数。`;
  return undefined;
}

function restore(value: unknown): ModelConnection[] {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.connections)
  )
    throw corrupt();
  const seen = new Set<string>();
  return value.connections.map((entry: unknown) => {
    if (
      !record(entry) ||
      typeof entry.id !== "string" ||
      !/^m-[a-z0-9]{8}$/.test(entry.id) ||
      seen.has(entry.id) ||
      typeof entry.alias !== "string" ||
      !["openai-chat", "anthropic-messages"].includes(
        entry.protocol as string,
      ) ||
      [entry.name, entry.preset, entry.target, entry.model].some(
        (field) => typeof field !== "string",
      )
    )
      throw corrupt();
    seen.add(entry.id);
    const connection = entry as ModelConnection;
    // A preset dropped from a later version leaves the record usable.
    if (draftProblem({ ...connection, preset: presets[0].id })) throw corrupt();
    return connection;
  });
}

const newId = () => `m-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;

/**
 * The user's model connections: records in this extension's state, keys and
 * targets in credential connections the user confirmed natively. Corrupt
 * state fails the extension and is kept as is.
 */
export class ConnectionStore {
  private connections: ModelConnection[] = [];
  private credentials: CredentialConnection[] = [];
  private revision = 0;
  private listeners = new Set<() => void>();
  private snapshot: ConnectionView[] = [];
  constructor(private readonly call: Call) {}

  async load() {
    const saved = (await this.call("state.read")) as StoredState | null;
    if (saved) {
      this.connections = restore(saved.value);
      this.revision = saved.revision;
    }
    await this.refresh();
  }
  /** Re-reads which connections hold a key. */
  async refresh() {
    this.credentials = (await this.call("credential.connect", {
      action: "list",
    })) as CredentialConnection[];
    this.emit();
  }
  list(): readonly ConnectionView[] {
    return this.snapshot;
  }
  find(id: string) {
    return this.connections.find((connection) => connection.id === id);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  private emit() {
    this.snapshot = this.connections.map((connection) => ({
      ...connection,
      status:
        this.credentials.find((item) => item.alias === connection.alias)
          ?.status ?? "missing",
    }));
    for (const listener of this.listeners) listener();
  }
  private async write(next: ModelConnection[]) {
    const receipt = (await this.call("state.write", {
      revision: this.revision,
      value: { version: 1, connections: next },
    })) as StoredState;
    this.revision = receipt.revision;
    this.connections = next;
  }
  /** Opens the native panel for target and key; resolves false when cancelled. */
  private async connect(draft: ConnectionDraft, alias?: string) {
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
   * Adds or changes a connection. A new one, a changed address or protocol,
   * or `rekey` asks the user for the key; other edits only save the record.
   */
  async save(draft: ConnectionDraft, id?: string, rekey = false) {
    const problem = draftProblem(draft);
    if (problem) throw new Error(problem);
    const existing = id === undefined ? undefined : this.find(id);
    if (id !== undefined && !existing) throw new Error("该连接已被删除。");
    if (!existing && this.connections.length >= MAX_CONNECTIONS)
      throw new Error(`最多保存 ${MAX_CONNECTIONS} 个模型连接。`);
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
    const next = { ...draft, id: existing?.id ?? newId(), alias: alias! };
    try {
      await this.write(
        existing
          ? this.connections.map((item) => (item.id === next.id ? next : item))
          : [...this.connections, next],
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
      await this.write(this.connections.filter((item) => item.id !== id));
    } finally {
      await this.refresh();
    }
    return true;
  }
}

export const presetOf = (
  connection: Pick<ModelConnection, "preset">,
): Preset | undefined =>
  presets.find((preset) => preset.id === connection.preset);
