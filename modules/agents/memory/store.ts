import type { Effort } from "@extensions/contracts";
import {
  OWNER,
  type AgentModel,
  type ModelChoice,
} from "@modules/agents/contract";
import { text } from "@modules/agents/validation";
import type {
  MemoryItem,
  MemoryReport,
  MemoryScope,
  MemoryService,
  MemorySource,
} from "./contract";
import {
  CONSOLIDATION_INSTRUCTIONS,
  applyChanges,
  consolidationInput,
  parseConsolidation,
} from "./consolidate";
import { MAX_ITEM_TEXT, expired, memorySections, sameScope } from "./items";
import type { ConsolidationModel, MemoryData } from "./persistence";

/** How long a conversation rests before what was said is consolidated. */
export const IDLE = 3 * 60_000;
/** Pending conversations wait this long after start, so startup stays quick. */
const START_DELAY = 5_000;
/** Reports kept for undo. */
const REPORTS = 20;

/** Asks a model once, as `chat@1` would, for a consolidation. */
export type Ask = (
  request: {
    provider: string;
    model: string;
    instructions: string;
    input: string;
    effort?: Effort;
  },
  signal: AbortSignal,
) => Promise<string>;
/** What the memory page shows for one Agent. */
export type MemoryAgent = {
  id: string;
  name: string;
  model?: AgentModel;
  /** Its own choice of consolidation model, absent when it follows the default. */
  choice?: ConsolidationModel;
  /** Messages wait to be consolidated. */
  pending: boolean;
  /** Why the last consolidation failed, until one succeeds. */
  problem?: string;
  running: boolean;
};
export type MemorySnapshot = {
  items: readonly MemoryItem[];
  /** The default consolidation model. */
  model: ConsolidationModel;
  agents: readonly MemoryAgent[];
  /** The Agent the page was opened for; null for the shared memory. */
  focus: string | null;
};
type Report = MemoryReport & { before: MemoryItem[]; after: MemoryItem[] };

const own = (agent: string): MemoryScope => ({
  kind: "agent",
  agent,
  person: OWNER,
});
const json = (items: MemoryItem[]) => JSON.stringify(items);
/** A model's thinking kept low: consolidation is short and structured. */
const quiet = (reasoning?: readonly Effort[]) =>
  reasoning?.includes("off")
    ? ("off" as const)
    : reasoning?.includes("low")
      ? ("low" as const)
      : undefined;

/**
 * The built-in memory: items per scope, consolidated from conversations
 * after they rest, by the model each Agent's setting picks. A failed
 * consolidation keeps its messages pending and never falls back to another
 * model, which could change who receives the conversation.
 */
export class MemoryStore implements MemoryService {
  readonly info = {
    label: "记忆",
    description:
      "记住你在对话里说过的事，会话停下后由所选模型整理；你可以查看、修改和删除。",
  };
  private data: MemoryData;
  private sources = new Set<MemorySource>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private problems = new Map<string, string>();
  private running: string | null = null;
  private recent: Report[] = [];
  private focus: string | null = null;
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private runs: Promise<unknown> = Promise.resolve();
  private stop = new AbortController();
  private snap: MemorySnapshot | undefined;
  constructor(
    initial: MemoryData,
    private persist: (data: MemoryData, signal?: AbortSignal) => Promise<void>,
    private ask: Ask,
    /** Models a consolidation can use. */
    readonly models: () => readonly ModelChoice[],
    private openPage: () => Promise<void>,
    private clock = {
      now: () => Date.now(),
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  ) {
    this.data = initial;
  }

  /** Re-renders after model connections start, stop or change. */
  sourcesChanged = () => this.emit();
  context(request: Parameters<MemoryService["context"]>[0]) {
    return memorySections(this.data.items, request);
  }
  count(agent: string, person: string) {
    const now = this.clock.now();
    return this.data.items.filter(
      (item) =>
        sameScope(item.scope, { kind: "agent", agent, person }) &&
        !expired(item, now),
    ).length;
  }
  reports(): readonly MemoryReport[] {
    return this.recent;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  private emit() {
    this.snap = undefined;
    this.listeners.forEach((listener) => listener());
  }
  open(agent?: string) {
    this.focus = agent ?? null;
    this.emit();
    return this.openPage();
  }

  connect(source: MemorySource) {
    this.sources.add(source);
    const unwatch = source.subscribe(() => this.emit());
    // Memory starts with what is said from now on: earlier conversations
    // are not sent anywhere just because memory was added.
    const fresh = source
      .agents()
      .filter((a) => this.data.marks[a.id] === undefined)
      .map((a) => [a.id, this.latest(source, a.id)] as const);
    if (fresh.length)
      void this.change((data) => {
        for (const [id, mark] of fresh) data.marks[id] ??= mark;
      }).catch(() => {});
    source.agents().forEach((a, i) => {
      if (this.pending(a.id)) this.schedule(a.id, START_DELAY + i * 1000);
    });
    this.emit();
    return () => {
      unwatch();
      this.sources.delete(source);
      this.emit();
    };
  }
  notify(agent: string, event: "saved" | "left" | "on" | "removed") {
    if (event === "saved") {
      this.schedule(agent, IDLE);
      return this.emit();
    }
    if (event === "left") {
      if (this.timers.has(agent)) this.schedule(agent, 0);
      return;
    }
    clearTimeout(this.timers.get(agent));
    this.timers.delete(agent);
    const found = this.source(agent);
    const mark = found ? this.latest(found.source, agent) : this.clock.now();
    void this.change((data) => {
      if (event === "on") data.marks[agent] = mark;
      else {
        data.items = data.items.filter(
          (item) => item.scope.kind !== "agent" || item.scope.agent !== agent,
        );
        delete data.marks[agent];
        delete data.settings.agents[agent];
      }
    }).catch(() => {});
  }

  /** The page's view of memory; the same object until something changes. */
  snapshot = (): MemorySnapshot => {
    this.snap ??= {
      items: this.data.items,
      model: this.data.settings.model,
      focus: this.focus,
      agents: [...this.sources]
        .flatMap((source) => source.agents())
        .map((a) => ({
          id: a.id,
          name: a.name,
          ...(a.model && { model: a.model }),
          ...(this.data.settings.agents[a.id] && {
            choice: this.data.settings.agents[a.id],
          }),
          pending: this.pending(a.id),
          ...(this.problems.has(a.id) && { problem: this.problems.get(a.id) }),
          running: this.running === a.id,
        })),
    };
    return this.snap;
  };
  add(scope: MemoryScope, fields: Pick<MemoryItem, "text" | "at" | "until">) {
    const now = this.clock.now();
    return this.change((data) => {
      data.items.push(
        this.checked({
          id: crypto.randomUUID(),
          scope,
          ...fields,
          createdAt: now,
          updatedAt: now,
          by: "person",
        }),
      );
    });
  }
  update(id: string, fields: Pick<MemoryItem, "text" | "at" | "until">) {
    return this.change((data) => {
      const index = data.items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("这条记忆已不存在。");
      const { at: _at, until: _until, ...rest } = data.items[index];
      data.items[index] = this.checked({
        ...rest,
        ...fields,
        updatedAt: this.clock.now(),
      });
    });
  }
  remove(id: string) {
    return this.change((data) => {
      data.items = data.items.filter((item) => item.id !== id);
    });
  }
  /** Sets the default model (`agent` null) or one Agent's own (`choice` null follows the default). */
  setModel(agent: string | null, choice: ConsolidationModel | null) {
    return this.change((data) => {
      if (agent === null) data.settings.model = choice ?? "agent";
      else if (choice === null) delete data.settings.agents[agent];
      else data.settings.agents[agent] = choice;
    }).then(() => {
      if (agent) this.problems.delete(agent);
      this.emit();
    });
  }
  /** Consolidates an Agent's pending messages now. */
  consolidate(agent: string) {
    clearTimeout(this.timers.get(agent));
    this.timers.delete(agent);
    return this.run(agent);
  }
  undo(reportId: string) {
    const report = this.recent.find((r) => r.id === reportId);
    if (!report) return Promise.reject(new Error("没有可撤销的整理。"));
    return this.change((data) => {
      const scope = own(report.agent);
      const current = data.items.filter((item) => sameScope(item.scope, scope));
      if (json(current) !== json(report.after))
        throw new Error("记忆已有新的变化，这次整理无法撤销。");
      data.items = [
        ...data.items.filter((item) => !sameScope(item.scope, scope)),
        ...report.before,
      ];
    }).then(() => {
      this.recent = this.recent.filter((r) => r !== report);
      this.emit();
    });
  }
  async close() {
    this.stop.abort();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    await Promise.all([this.writes, this.runs]).catch(() => {});
    this.listeners.clear();
  }

  private checked(item: MemoryItem) {
    const trimmed = item.text.trim();
    if (!trimmed || !text(trimmed, MAX_ITEM_TEXT))
      throw new Error(`记忆内容须是 1–${MAX_ITEM_TEXT} 个字符。`);
    if (
      (item.at !== undefined && !Number.isFinite(item.at)) ||
      (item.until !== undefined && !Number.isFinite(item.until))
    )
      throw new Error("时间无效。");
    return { ...item, text: trimmed };
  }
  private change<T>(mutate: (data: MemoryData) => T): Promise<T> {
    const next = this.writes.then(async () => {
      if (this.stop.signal.aborted) throw new Error("记忆扩展已停用。");
      const draft = structuredClone(this.data);
      const result = mutate(draft);
      draft.items = draft.items.map((item) =>
        Object.fromEntries(
          Object.entries(item).filter(([, value]) => value !== undefined),
        ),
      ) as MemoryItem[];
      await this.persist(draft, this.stop.signal);
      this.data = draft;
      this.emit();
      return result;
    });
    this.writes = next.catch(() => {});
    return next;
  }
  private source(agent: string) {
    for (const source of this.sources) {
      const found = source.agents().find((a) => a.id === agent);
      if (found) return { source, agent: found };
    }
    return undefined;
  }
  /** The time of an Agent's last saved message, which what follows comes after. */
  private latest(source: MemorySource, agent: string) {
    return source.messages(agent, 0).at(-1)?.at ?? 0;
  }
  /** Where an Agent's pending messages start: an Agent created after memory has all of them. */
  private mark(agent: string) {
    return this.data.marks[agent] ?? 0;
  }
  private pending(agent: string) {
    const found = this.source(agent);
    return (
      !!found &&
      found.source
        .messages(agent, this.mark(agent))
        .some((message) => message.role === "user")
    );
  }
  private schedule(agent: string, delay: number) {
    clearTimeout(this.timers.get(agent));
    this.timers.set(
      agent,
      setTimeout(() => {
        this.timers.delete(agent);
        void this.run(agent);
      }, delay),
    );
  }
  private run(agent: string) {
    const next = this.runs.then(() => this.consolidateNow(agent));
    this.runs = next.catch(() => {});
    return next;
  }
  /** The model this Agent's consolidation uses, or why there is none. */
  private target(agent: string, own?: AgentModel) {
    const choice = this.data.settings.agents[agent] ?? this.data.settings.model;
    const model = choice === "agent" ? own : choice;
    if (!model) return "这个 Agent 还没有选择模型，整理用的模型跟随它。";
    const option = this.models().find(
      (m) => m.provider === model.provider && m.id === model.model,
    );
    return (
      option ??
      `整理用的模型「${model.model}」现在不可用，请在记忆页换一个模型或重新启用它的连接。`
    );
  }
  private async consolidateNow(agent: string) {
    // Marks queued before this run, such as memory switched back on, apply.
    await this.writes;
    const found = this.source(agent);
    const mark = this.mark(agent);
    if (this.stop.signal.aborted || !found) return;
    const messages = found.source.messages(agent, mark);
    if (!messages.some((m) => m.role === "user")) return;
    const option = this.target(agent, found.agent.model);
    if (typeof option === "string") {
      this.problems.set(agent, option);
      return this.emit();
    }
    this.running = agent;
    this.emit();
    try {
      const now = this.clock.now();
      const timeZone = this.clock.timeZone();
      const scope = own(agent);
      const before = this.data.items
        .filter((item) => sameScope(item.scope, scope))
        .sort((a, b) => a.createdAt - b.createdAt);
      const output = await this.ask(
        {
          provider: option.provider,
          model: option.id,
          instructions: CONSOLIDATION_INSTRUCTIONS,
          input: consolidationInput({
            name: found.agent.name,
            shared: this.data.items.filter(
              (item) =>
                sameScope(item.scope, { kind: "person", person: OWNER }) &&
                !expired(item, now),
            ),
            own: before,
            messages,
            now,
            timeZone,
          }),
          ...(quiet(option.reasoning) && { effort: quiet(option.reasoning) }),
        },
        this.stop.signal,
      );
      if (typeof output !== "string") throw new Error("模型必须返回文本。");
      const changes = parseConsolidation(output, before, timeZone);
      let report: Report | undefined;
      await this.change((data) => {
        // Edits made while the model was answering win: only items it saw change.
        const before = data.items.filter((item) =>
          sameScope(item.scope, scope),
        );
        const result = applyChanges(before, changes, { scope, now });
        data.items = [
          ...data.items.filter((item) => !sameScope(item.scope, scope)),
          ...result.items,
        ];
        data.marks[agent] = Math.max(mark, messages.at(-1)!.at);
        report = {
          id: crypto.randomUUID(),
          agent,
          at: now,
          ...result.report,
          before,
          after: result.items,
        };
      });
      this.problems.delete(agent);
      const { added, changed, removed } = report!;
      if (added.length || changed.length || removed.length)
        this.recent = [report!, ...this.recent].slice(0, REPORTS);
    } catch (error) {
      if (!this.stop.signal.aborted)
        this.problems.set(
          agent,
          `整理失败，对话会在下次整理时再试：${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      this.running = null;
      this.emit();
    }
  }
}
