import type { Named } from "@modules/sdk";
import type { Effort } from "@extensions/contracts";
import { LIMITS, attachmentProblem, imageSize } from "./attachments";
import {
  AVATAR_PROBLEM,
  EFFORTS,
  MAX_MODEL_ID,
  MAX_TEXT,
  extensionIds,
  parseRoleCard,
  text,
  validAvatar,
} from "./validation";
import { unreadReplies } from "./unread";
import type {
  Agent,
  AgentConfig,
  AgentPatch,
  Attachment,
  AgentModel,
  AgentProvider,
  AgentProviderInfo,
  ModelChoice,
  Session,
} from "./contract";

const id = () => crypto.randomUUID();
/** A new session's title, until its first message names it. */
const UNTITLED = "未命名会话";
const newSession = (): Session => ({
  id: id(),
  title: UNTITLED,
  createdAt: Date.now(),
  lastMessageAt: Date.now(),
  messages: [],
});
/** Extension-owned model; writes publish only after a successful receipt. */
export type SaveOptions = { signal?: AbortSignal; onCommit?: () => void };
/** What a reply may draw on besides the new text. */
export type ReplyContext = {
  model?: AgentModel;
  /** The Agent's chosen strength; the provider decides whether the model takes it. */
  effort?: Effort;
  /** The Agent's role description. */
  instructions: string;
  /** The current session's saved messages, oldest first. */
  history: {
    role: "user" | "agent";
    text: string;
    attachments?: Attachment[];
  }[];
  /** Files and pictures sent with the new message. */
  attachments?: Attachment[];
};
/** Marks a session read up to `at`, and every message in it, even one stamped ahead of this clock. */
const readAll = (s: Session, at = Date.now()) => {
  s.lastReadAt = Math.max(at, ...s.messages.map((m) => m.at ?? 0));
};
const DEFAULT_DESCRIPTION = "简洁、友好地回答用户的问题。";
const sameModel = (choice: ModelChoice, model: AgentModel) =>
  choice.provider === model.provider && choice.id === model.model;
export class AgentStore implements AgentProvider {
  private agents: Agent[];
  private listeners = new Set<() => void>();
  private running = new Map<string, AbortController>();
  private pending = new Map<
    string,
    { sessionId: string; text: string; attachments?: Attachment[] }
  >();
  private structural = new Set<string>();
  private committing = new Set<string>();
  /** The Agent on screen, as told by `view`. */
  private viewed: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(
    initial: Agent[],
    private persist: (agents: Agent[], options?: SaveOptions) => Promise<void>,
    /** Asks the Agent's model. */
    private reply: (
      text: string,
      signal: AbortSignal,
      context: ReplyContext,
    ) => Promise<string>,
    private extensions: readonly Named[] = [],
    /** Models an Agent can use, the default first. */
    readonly modelChoices: () => readonly ModelChoice[] = () => [],
    /** Why saving cannot succeed now, checked before asking a model. */
    private saveBlocked: () => string | undefined = () => undefined,
    readonly connectors: () => readonly Named[] = () => [],
  ) {
    this.agents = initial;
  }
  get info(): AgentProviderInfo {
    return {
      label: "Agent 核心",
      version: "0.0.4",
      description:
        "回复由此 Agent 选择的模型生成；对话与角色说明会一起发送到该模型服务。",
      extensions: this.extensions,
      attachments: true,
    };
  }
  /** Re-renders Agents after their model connections start, stop or change. */
  sourcesChanged = () => this.emit();
  setOff(agentId: string, extensionId: string, off: boolean) {
    if (!text(extensionId, 64))
      return Promise.reject(new Error("扩展 ID 无效。"));
    return this.change((agents) => {
      const a = this.find(agents, agentId);
      const rest = (a.off ?? []).filter((id) => id !== extensionId);
      if (off) a.off = [...rest, extensionId];
      else if (rest.length) a.off = rest;
      else delete a.off;
    });
  }
  setModel(agentId: string, model: AgentModel | null) {
    if (
      model &&
      (!text(model.model, MAX_MODEL_ID) ||
        !this.modelChoices().some((choice) => sameModel(choice, model)))
    )
      return Promise.reject(new Error("模型不可用，请先在模型连接中添加它。"));
    return this.change((agents) => {
      const a = this.find(agents, agentId);
      if (!model) delete a.model;
      else {
        a.model = { provider: model.provider, model: model.model };
        const off = a.off?.filter((id) => id !== model.provider);
        if (off?.length) a.off = off;
        else delete a.off;
      }
    });
  }
  setEffort(agentId: string, effort: Effort | null) {
    if (effort !== null && !EFFORTS.includes(effort))
      return Promise.reject(new Error("思考强度无效。"));
    return this.change((agents) => {
      const a = this.find(agents, agentId);
      if (effort === null) return void delete a.effort;
      const choice =
        a.model && this.modelChoices().find((m) => sameModel(m, a.model!));
      if (!choice?.reasoning?.includes(effort))
        throw new Error("此模型不支持这个思考强度。");
      a.effort = effort;
    });
  }
  list = () => this.agents;
  view(agentId: string | null) {
    this.viewed = agentId;
    const a = this.agents.find((a) => a.id === agentId);
    const s = a?.sessions.find((s) => s.id === a.currentSessionId);
    if (!s || !unreadReplies(s)) return;
    // Being read again on the next view is all a failed save costs.
    this.change((agents) => {
      const a = agents.find((a) => a.id === agentId);
      const s = a?.sessions.find((s) => s.id === a.currentSessionId);
      if (s) readAll(s);
    }).catch(() => {});
  }
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
    if (config.off !== undefined && !extensionIds(config.off))
      throw new Error("扩展 ID 无效。");
    if (
      config.model &&
      !this.modelChoices().some((m) => sameModel(m, config.model!))
    )
      throw new Error("模型不可用，请先在模型连接中添加它。");
    const [first] = this.modelChoices();
    const model =
      config.model === undefined
        ? first && { provider: first.provider, model: first.id }
        : config.model && {
            provider: config.model.provider,
            model: config.model.model,
          };
    const session = newSession();
    const agent: Agent = {
      id: id(),
      name: clean.name,
      description: clean.description?.trim() || DEFAULT_DESCRIPTION,
      ...(clean.avatar && { avatar: clean.avatar }),
      status: "idle",
      pinned: false,
      extensionId: "agents.local",
      ...(model && { model }),
      ...(config.off?.length && { off: [...new Set(config.off)] }),
      sessions: [session],
      currentSessionId: session.id,
    };
    await this.change((agents) => {
      agents.push(agent);
    });
    return agent;
  }
  update(agentId: string, patch: AgentPatch) {
    return this.change((agents) => {
      const a = this.find(agents, agentId);
      if (patch.avatar === null) delete a.avatar;
      else if (patch.avatar !== undefined) {
        if (!validAvatar(patch.avatar)) throw new Error(AVATAR_PROBLEM);
        a.avatar = patch.avatar;
      }
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
    if (this.structural.has(agentId))
      return Promise.reject(new Error("请等待保存完成，再切换会话。"));
    // Other sessions stay usable while one waits for its reply.
    if (
      action === "delete" &&
      this.pending.get(agentId)?.sessionId === sessionId
    )
      return Promise.reject(
        new Error("正在等待这个会话的回复，请等它回复或先停止，再删除。"),
      );
    this.structural.add(agentId);
    this.emit();
    return this.change((agents) => {
      const a = this.find(agents, agentId);
      if (action === "create") {
        const s = newSession();
        a.sessions.push(s);
        a.currentSessionId = s.id;
      } else {
        if (!a.sessions.some((s) => s.id === sessionId))
          throw new Error("会话不存在。");
        if (action === "select") {
          a.currentSessionId = sessionId!;
          const s = a.sessions.find((s) => s.id === sessionId)!;
          if (this.viewed === agentId && unreadReplies(s)) readAll(s);
        } else {
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
  async send(agentId: string, input: string, attachments?: Attachment[]) {
    if (!input.trim() || input.length > MAX_TEXT)
      throw new Error(`请输入 1–${MAX_TEXT} 个字符。`);
    const problem = attachmentProblem(attachments);
    if (problem) throw new Error(problem);
    const files = attachments?.length ? attachments : undefined;
    const filesText = (files ?? []).reduce(
      (sum, a) => sum + (a.kind === "text" ? a.text.length : 0),
      0,
    );
    if (input.length + filesText > MAX_TEXT)
      throw new Error("文字与文件合计过长，请减少文件或缩短文字。");
    if (this.running.has(agentId))
      throw new Error(
        "正在等待此 Agent 的另一条回复，请等它回复或先停止，再发送。",
      );
    if (this.closed || this.structural.has(agentId))
      throw new Error("Agent 暂不可运行。");
    // The reply could not be saved, and asking again may be billed again.
    const blocked = this.saveBlocked();
    if (blocked) throw new Error(blocked);
    const a = this.find(this.agents, agentId);
    const off = (id: string) => a.off?.includes(id);
    const label = (id: string, known: readonly Named[]) =>
      known.find((e) => e.id === id)?.label ?? id;
    if (off(a.extensionId))
      throw new Error(
        `此 Agent 已关闭「${label(a.extensionId, this.extensions)}」，在详情的组成扩展中开启后才能回复。`,
      );
    if (a.model && off(a.model.provider))
      throw new Error(
        `此 Agent 已关闭「${label(a.model.provider, this.connectors())}」，在详情的组成扩展中开启后才能回复。`,
      );
    const model = a.model;
    const sessionId = a.currentSessionId;
    const saved = a.sessions.find((s) => s.id === sessionId)!.messages;
    if (
      imageSize(saved) + imageSize([{ attachments: files }]) >
      LIMITS.sessionImages
    )
      throw new Error("此会话的图片已达上限，请新建会话或删除带图片的消息。");
    const history = saved.map(({ role, text, attachments }) => ({
      role,
      text,
      ...(attachments && { attachments }),
    }));
    const sentAt = Date.now();
    const controller = new AbortController();
    this.running.set(agentId, controller);
    this.pending.set(agentId, {
      sessionId,
      text: input,
      ...(files && { attachments: files }),
    });
    this.emit();
    try {
      const output = await this.reply(input, controller.signal, {
        model,
        ...(a.effort && { effort: a.effort }),
        instructions: a.description,
        history,
        ...(files && { attachments: files }),
      });
      controller.signal.throwIfAborted();
      if (!text(output, MAX_TEXT))
        throw new Error(
          `模型必须返回不超过 ${MAX_TEXT} 个字符的文本；本次结果未保存。`,
        );
      await this.change(
        (agents) => {
          controller.signal.throwIfAborted();
          const current = this.find(agents, agentId);
          const s = current.sessions.find((s) => s.id === sessionId);
          if (!s) throw new Error("会话已被移除。");
          // Sending reads what came before; the reply sorts after all of
          // it, also within the same millisecond.
          readAll(s, sentAt);
          const repliedAt = Math.max(Date.now(), s.lastReadAt! + 1);
          s.messages.push(
            {
              id: id(),
              role: "user",
              text: input,
              ...(files && { attachments: files }),
              at: sentAt,
            },
            { id: id(), role: "agent", text: output, at: repliedAt },
          );
          s.lastMessageAt = repliedAt;
          if (this.viewed === agentId && current.currentSessionId === sessionId)
            s.lastReadAt = repliedAt;
          // The first message names the session, unless it was named already.
          if (s.messages.length === 2 && s.title === UNTITLED)
            s.title = input.slice(0, 24);
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
  renameSession(agentId: string, sessionId: string, title: string) {
    const name = title.trim();
    if (!name || name.length > 60)
      return Promise.reject(new Error("会话名称需要 1–60 个字符。"));
    return this.change((agents) => {
      const s = this.find(agents, agentId).sessions.find(
        (s) => s.id === sessionId,
      );
      if (!s) throw new Error("会话不存在。");
      s.title = name;
    });
  }
  removeMessage(agentId: string, sessionId: string, messageId: string) {
    if (
      this.pending.get(agentId)?.sessionId === sessionId ||
      this.structural.has(agentId)
    )
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
