import { ContractError } from "../sdk/errors";
import type { Named } from "../sdk";
import type {
  Agent,
  AgentConfig,
  AgentProvider,
  AgentProviderInfo,
  Session,
} from "./contract";

const id = () => crypto.randomUUID();
const newSession = (): Session => ({
  id: id(),
  title: "未命名会话",
  createdAt: Date.now(),
  lastMessageAt: Date.now(),
  messages: [],
});
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 4000): value is string =>
  typeof value === "string" && value.length <= max;
export function parseRoleCard(raw: string): AgentConfig {
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    !text(value.name, 60) ||
    !value.name.trim() ||
    (value.version !== undefined && value.version !== 1) ||
    (value.description !== undefined && !text(value.description)) ||
    (value.multiSession !== undefined &&
      typeof value.multiSession !== "boolean")
  )
    throw new Error(
      "角色卡格式不支持：需要 name，可选 description、multiSession 和 version: 1。",
    );
  return {
    name: value.name.trim(),
    description: value.description as string | undefined,
    multiSession: value.multiSession as boolean | undefined,
  };
}
export function restoreAgents(value: unknown): Agent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new ContractError("state.corrupt", "agents", "Agent 配置损坏");
  const ids = new Set<string>();
  for (const a of value) {
    if (
      !object(a) ||
      !text(a.id) ||
      ids.has(a.id) ||
      !text(a.name, 60) ||
      !a.name.trim() ||
      !text(a.description) ||
      typeof a.pinned !== "boolean" ||
      typeof a.multiSession !== "boolean" ||
      !text(a.extensionId) ||
      !Array.isArray(a.capabilities) ||
      !a.capabilities.every((c) => text(c)) ||
      !Array.isArray(a.sessions) ||
      a.sessions.length === 0 ||
      !text(a.currentSessionId)
    )
      throw new ContractError("state.corrupt", "agents", "Agent 配置损坏");
    ids.add(a.id);
    const sessions = new Set<string>();
    for (const s of a.sessions) {
      if (
        !object(s) ||
        !text(s.id) ||
        sessions.has(s.id) ||
        !text(s.title) ||
        !Number.isFinite(s.createdAt) ||
        !Number.isFinite(s.lastMessageAt) ||
        !Array.isArray(s.messages) ||
        !s.messages.every(
          (m) =>
            object(m) &&
            text(m.id) &&
            (m.role === "user" || m.role === "agent") &&
            text(m.text, 32000) &&
            (m.at === undefined || Number.isFinite(m.at)),
        )
      )
        throw new ContractError(
          "state.corrupt",
          "agents.sessions",
          "会话配置损坏",
        );
      sessions.add(s.id);
    }
    if (!sessions.has(a.currentSessionId))
      throw new ContractError(
        "state.corrupt",
        "agents.currentSessionId",
        "当前会话不存在",
      );
  }
  return structuredClone(value).map(({ canCancel, pending, ...a }) => ({
    ...a,
    status: "idle",
  }));
}

/** Extension-owned model; writes publish only after a successful receipt. */
export type SaveOptions = { signal?: AbortSignal; onCommit?: () => void };
export class AgentStore implements AgentProvider {
  readonly info: AgentProviderInfo;
  private agents: Agent[];
  private listeners = new Set<() => void>();
  private running = new Map<string, AbortController>();
  private pending = new Map<string, { sessionId: string; text: string }>();
  private structural = new Set<string>();
  private committing = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(
    initial: Agent[],
    private persist: (agents: Agent[], options?: SaveOptions) => Promise<void>,
    private reply: (text: string, signal: AbortSignal) => Promise<string>,
    /** The text service that writes replies; described to the user. */
    source: { name: string; description?: string } = { name: "文本服务" },
    extensions: readonly Named[] = [],
  ) {
    this.agents = initial;
    this.info = {
      label: "内置本地 Agent 提供者",
      version: "0.0.4",
      description: source.description ?? `回复由「${source.name}」生成。`,
      extensions,
    };
  }
  list = () => this.agents;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.agents = this.agents.map((a) => ({
      ...a,
      status:
        this.running.has(a.id) || this.structural.has(a.id) ? "busy" : "idle",
      canCancel: this.running.has(a.id) && !this.committing.has(a.id),
      pending: this.pending.get(a.id),
    }));
    this.listeners.forEach((l) => l());
  }
  private change<T>(
    mutate: (agents: Agent[]) => T,
    options?: SaveOptions,
  ): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.closed) throw new Error("Agent 扩展已停用，请重新启用。");
      options?.signal?.throwIfAborted();
      const draft = structuredClone(this.agents).map(
        ({ canCancel, pending, ...a }) => ({
          ...a,
          status: "idle" as const,
        }),
      );
      const result = mutate(draft);
      await this.persist(draft, options);
      this.agents = draft;
      this.emit();
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }
  private find(agents: Agent[], agentId: string) {
    const a = agents.find((a) => a.id === agentId);
    if (!a) throw new Error("Agent 不存在。");
    return a;
  }
  async create(config: AgentConfig) {
    const clean = parseRoleCard(JSON.stringify(config));
    const session = newSession();
    const agent: Agent = {
      id: id(),
      name: clean.name,
      description:
        clean.description ?? "本地文本助手，使用已启用的文本转换服务。",
      status: "idle",
      pinned: false,
      extensionId: "agents.local",
      capabilities: ["本地文本处理", "保存会话"],
      multiSession: clean.multiSession ?? false,
      sessions: [session],
      currentSessionId: session.id,
    };
    await this.change((agents) => {
      agents.push(agent);
    });
    return agent;
  }
  update(
    agentId: string,
    patch: Partial<Pick<Agent, "name" | "description" | "pinned">>,
  ) {
    return this.change((agents) => {
      const a = this.find(agents, agentId);
      if (patch.name !== undefined) {
        if (!patch.name.trim() || patch.name.length > 60)
          throw new Error("名称需要 1–60 个字符。");
        a.name = patch.name.trim();
      }
      if (patch.description !== undefined) {
        if (!text(patch.description))
          throw Error("角色说明不能超过 4000 个字符。");
        a.description = patch.description;
      }
      if (patch.pinned !== undefined) a.pinned = patch.pinned;
    });
  }
  async remove(agentId: string) {
    if (this.running.has(agentId) || this.structural.has(agentId))
      throw new Error("请等待保存或先停止当前任务，再移除 Agent。");
    this.structural.add(agentId);
    this.emit();
    try {
      await this.change((agents) => {
        const index = agents.findIndex((a) => a.id === agentId);
        if (index < 0) throw new Error("Agent 不存在。");
        agents.splice(index, 1);
      });
    } finally {
      this.structural.delete(agentId);
      this.emit();
    }
  }
  session(
    agentId: string,
    action: "create" | "select" | "delete",
    sessionId?: string,
  ) {
    if (this.running.has(agentId) || this.structural.has(agentId))
      return Promise.reject(
        new Error("请等待保存或先停止当前任务，再切换会话。"),
      );
    this.structural.add(agentId);
    this.emit();
    return this.change((agents) => {
      const a = this.find(agents, agentId);
      if (!a.multiSession) throw new Error("此 Agent 仅支持一个会话。");
      if (action === "create") {
        const s = newSession();
        a.sessions.push(s);
        a.currentSessionId = s.id;
      } else {
        if (!a.sessions.some((s) => s.id === sessionId))
          throw new Error("会话不存在。");
        if (action === "select") a.currentSessionId = sessionId!;
        else {
          a.sessions = a.sessions.filter((s) => s.id !== sessionId);
          if (!a.sessions.length) a.sessions.push(newSession());
          if (a.currentSessionId === sessionId)
            a.currentSessionId = a.sessions[0].id;
        }
      }
    }).finally(() => {
      this.structural.delete(agentId);
      this.emit();
    });
  }
  async send(agentId: string, input: string) {
    if (!input.trim() || input.length > 8000)
      throw new Error("请输入 1–8000 个字符。");
    if (
      this.closed ||
      this.running.has(agentId) ||
      this.structural.has(agentId)
    )
      throw new Error("Agent 暂不可运行。");
    const a = this.find(this.agents, agentId);
    const sessionId = a.currentSessionId;
    const sentAt = Date.now();
    const controller = new AbortController();
    this.running.set(agentId, controller);
    this.pending.set(agentId, { sessionId, text: input });
    this.emit();
    try {
      const output = await this.reply(input, controller.signal);
      controller.signal.throwIfAborted();
      if (!text(output, 32000))
        throw new Error(
          "文本服务必须返回不超过 32000 个字符的文本；本次结果未保存。",
        );
      await this.change(
        (agents) => {
          controller.signal.throwIfAborted();
          const s = this.find(agents, agentId).sessions.find(
            (s) => s.id === sessionId,
          );
          if (!s) throw new Error("会话已被移除。");
          const repliedAt = Date.now();
          s.messages.push(
            { id: id(), role: "user", text: input, at: sentAt },
            { id: id(), role: "agent", text: output, at: repliedAt },
          );
          s.lastMessageAt = repliedAt;
          if (s.messages.length === 2) s.title = input.slice(0, 24);
        },
        {
          signal: controller.signal,
          onCommit: () => {
            this.committing.add(agentId);
            this.emit();
          },
        },
      );
    } finally {
      this.committing.delete(agentId);
      this.running.delete(agentId);
      this.pending.delete(agentId);
      this.emit();
    }
  }
  removeMessage(agentId: string, sessionId: string, messageId: string) {
    if (this.running.has(agentId) || this.structural.has(agentId))
      return Promise.reject(
        new Error("请等待回复完成或先停止当前任务，再删除消息。"),
      );
    return this.change((agents) => {
      const s = this.find(agents, agentId).sessions.find(
        (s) => s.id === sessionId,
      );
      const index = s?.messages.findIndex((m) => m.id === messageId) ?? -1;
      if (!s || index < 0) throw new Error("消息不存在。");
      s.messages.splice(index, 1);
    });
  }
  cancel(agentId: string) {
    if (!this.committing.has(agentId)) this.running.get(agentId)?.abort();
  }
  async close() {
    this.closed = true;
    this.running.forEach((c) => c.abort());
    await this.queue;
    this.listeners.clear();
  }
}
