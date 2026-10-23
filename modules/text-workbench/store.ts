import { ContractError } from "@modules/sdk/errors";
import { string } from "@modules/sdk/validation";
export interface TextResult {
  id: string;
  input: string;
  output: string;
  provider: string;
  created: string;
}
export interface TextItem {
  id: string;
  title: string;
  input: string;
  results: TextResult[];
}
export interface TextState {
  items: TextItem[];
  selected?: string;
  phase:
    | "ready"
    | "running"
    | "saving"
    | "saved"
    | "cancelled"
    | "failed"
    | "uncertain";
  error?: string;
}
export interface TextDocument {
  version: 1;
  items: TextItem[];
  selected?: string;
}
export function readTextDocument(value: unknown): TextDocument {
  if (value === undefined) return { version: 1, items: [] };
  const doc = value as TextDocument | null;
  const ids = new Set<string>();
  if (
    !doc ||
    doc.version !== 1 ||
    !Array.isArray(doc.items) ||
    doc.items.some((item) => {
      if (!item) return true;
      const check = {
        path: "workbench.items",
        label: "工作台状态版本或内容无效",
      };
      string(item.id, "state.corrupt", { ...check, min: 1 });
      if (ids.has(item.id)) return true;
      ids.add(item.id);
      string(item.title, "state.corrupt", { ...check, max: 120 });
      string(item.input, "state.corrupt", check);
      return (
        !Array.isArray(item.results) ||
        item.results.some(
          (result) =>
            !result ||
            !["id", "input", "output", "provider", "created"].every(
              (key) => typeof result[key as keyof TextResult] === "string",
            ),
        )
      );
    }) ||
    (doc.selected !== undefined &&
      !doc.items.some((item) => item.id === doc.selected))
  )
    throw new ContractError(
      "state.corrupt",
      "workbench",
      "工作台状态版本或内容无效",
    );
  return structuredClone(doc);
}

/** Business state belongs to this extension; the Host only manages storage/lifetime. */
export class TextWorkbenchStore {
  private state: TextState;
  private readonly listeners = new Set<() => void>();
  private operation?: AbortController;
  private pending?: Promise<void>;
  private closed = false;
  constructor(
    initial: unknown,
    private readonly provider: string,
    private readonly transform: (
      input: string,
      signal: AbortSignal,
    ) => Promise<string>,
    private readonly persist: (document: TextDocument) => Promise<void>,
  ) {
    const saved = readTextDocument(initial);
    this.state = {
      items: saved.items,
      selected: saved.selected ?? saved.items[0]?.id,
      phase: "ready",
    };
  }
  readonly snapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<TextState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private writable() {
    if (this.closed) throw Error("工作台已停用");
    if (this.pending) throw Error("请等待当前操作结束");
    if (this.state.phase === "uncertain")
      throw Error("保存结果未确认；请重新读取实际状态");
  }
  select(id: string) {
    this.writable();
    if (!this.state.items.some((item) => item.id === id))
      throw Error("处理项不存在");
    this.publish({ selected: id, phase: "ready", error: undefined });
  }
  create() {
    this.writable();
    const item = {
      id: crypto.randomUUID(),
      title: "未命名处理项",
      input: "",
      results: [],
    };
    this.publish({
      items: [...this.state.items, item],
      selected: item.id,
      phase: "ready",
      error: undefined,
    });
    return item.id;
  }
  edit(title: string, input: string) {
    this.writable();
    if (title.length > 120) throw Error("名称不能超过120个字符");
    this.publish({
      items: this.state.items.map((item) =>
        item.id === this.state.selected ? { ...item, title, input } : item,
      ),
      phase: "ready",
      error: undefined,
    });
  }
  private document(items = this.state.items): TextDocument {
    return { version: 1, items, selected: this.state.selected };
  }
  private async commit(document: TextDocument) {
    this.writable();
    const work = this.persist(document);
    this.pending = work;
    this.publish({ phase: "saving", error: undefined });
    try {
      await work;
      this.publish({
        items: document.items,
        selected: document.selected,
        phase: "saved",
      });
    } catch (error) {
      this.failure(error, true);
      throw error;
    } finally {
      this.pending = undefined;
    }
  }
  saveDraft() {
    return this.commit(this.document());
  }
  remove() {
    const items = this.state.items.filter(
      (item) => item.id !== this.state.selected,
    );
    const selected = items[0]?.id;
    return this.commit({ version: 1, items, selected });
  }
  run(): Promise<void> {
    this.writable();
    const item = this.state.items.find(
      (item) => item.id === this.state.selected,
    );
    if (!item || !item.input.trim())
      return Promise.reject(Error("请先输入要处理的文本"));
    const controller = new AbortController();
    this.operation = controller;
    this.publish({ phase: "running", error: undefined });
    // Start on a microtask, so all callbacks observe the pending operation.
    const work = Promise.resolve().then(async () => {
      let writing = false;
      try {
        const output = await this.transform(item.input, controller.signal);
        controller.signal.throwIfAborted();
        if (typeof output !== "string" || output.length > 32000)
          throw Error("转换服务返回无效或过长的文本");
        const result: TextResult = {
          id: crypto.randomUUID(),
          input: item.input,
          output,
          provider: this.provider,
          created: new Date().toISOString(),
        };
        const items = this.state.items.map((entry) =>
          entry.id === item.id
            ? { ...entry, results: [...entry.results, result] }
            : entry,
        );
        writing = true;
        this.publish({ phase: "saving" });
        // A dispatched write is awaited; a successful receipt wins over late cancellation.
        await this.persist(this.document(items));
        this.publish({ items, phase: "saved" });
      } catch (error) {
        if (!writing && controller.signal.aborted)
          this.publish({ phase: "cancelled", error: undefined });
        else this.failure(error, writing);
      } finally {
        this.pending = undefined;
        this.operation = undefined;
      }
    });
    this.pending = work;
    return work;
  }
  private failure(error: unknown, writing: boolean) {
    const known =
      !writing ||
      (error as { outcome?: string })?.outcome === "not-committed" ||
      (error as { name?: string })?.name === "AbortError";
    this.publish({
      phase: known ? "failed" : "uncertain",
      error: known
        ? String(error)
        : "保存结果未确认；请停用后重新启用工作台，读取实际状态。",
    });
  }
  cancel() {
    if (this.state.phase === "running") this.operation?.abort();
  }
  async quiesce() {
    this.cancel();
    // The business operation already records failed/uncertain state.
    // A rejected write receipt is not evidence that resource cleanup failed.
    await this.pending?.catch(() => {});
  }
  async close() {
    this.closed = true;
    await this.quiesce();
    this.listeners.clear();
  }
}
