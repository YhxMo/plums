import type {
  RecordPage,
  RecordWrite,
  StateBatch,
  StateBatchReceipt,
  StoredState,
} from "@modules/sdk";
import { ContractError } from "@modules/sdk/errors";
import type { AgentModel } from "@modules/agents/contract";
import { MAX_MODEL_ID, object, text } from "@modules/agents/validation";
import type { MemoryItem } from "./contract";
import { validItem } from "./items";

type Call = (
  capability: string,
  payload?: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;

/** Which model consolidates: the Agent's own, or a chosen one. */
export type ConsolidationModel = "agent" | AgentModel;
export type MemorySettings = {
  /** For every Agent without its own choice. */
  model: ConsolidationModel;
  /** Agents with their own choice. */
  agents: Record<string, ConsolidationModel>;
};
export type MemoryData = {
  items: MemoryItem[];
  settings: MemorySettings;
  /** Per Agent, the time of the last message consolidated; later ones are pending. */
  marks: Record<string, number>;
  /**
   * When memory first met the Agents. Those it met then start from their
   * last message; an Agent without a mark is newer and starts here.
   */
  since?: number;
};
/** Main document; each item is a record in `memories`. */
type MemoryIndex = {
  version: 1;
  settings: MemorySettings;
  marks: Record<string, number>;
  since?: number;
};
const ITEMS = "memories";

const corrupt = () =>
  new ContractError("state.corrupt", "memory", "记忆配置损坏");
const choice = (value: unknown): value is ConsolidationModel =>
  value === "agent" ||
  (object(value) &&
    text(value.provider, 64) &&
    text(value.model, MAX_MODEL_ID));
const outcome = (error: unknown) => (error as { outcome?: string })?.outcome;
const aborted = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export const emptyMemory = (): MemoryData => ({
  items: [],
  settings: { model: "agent", agents: {} },
  marks: {},
});

/**
 * Memory in the extension's own storage: the settings and marks in the
 * main document, one record per item, written together in one
 * `state.batch`. A damaged item is left as it is and not used.
 */
export class MemoryState {
  private index = { revision: 0, json: "" };
  private records = new Map<string, { json: string; revision: number }>();
  private uncertain = false;
  constructor(private readonly call: Call) {}

  async load(): Promise<MemoryData> {
    const saved = (await this.call("state.read")) as StoredState | null;
    if (!saved) return emptyMemory();
    const doc = saved.value;
    if (
      !object(doc) ||
      doc.version !== 1 ||
      !object(doc.settings) ||
      !choice(doc.settings.model) ||
      !object(doc.settings.agents) ||
      !Object.values(doc.settings.agents).every(choice) ||
      !object(doc.marks) ||
      !Object.values(doc.marks).every(Number.isFinite) ||
      (doc.since !== undefined && !Number.isFinite(doc.since))
    )
      throw corrupt();
    const index = doc as MemoryIndex;
    this.index = { revision: saved.revision, json: JSON.stringify(index) };
    const items: MemoryItem[] = [];
    let after: string | null = null;
    do {
      const page = (await this.call("records.list", {
        collection: ITEMS,
        after,
        limit: 200,
      })) as RecordPage;
      for (const { id, value, revision } of page.records) {
        if (!validItem(value) || value.id !== id) continue;
        items.push(value);
        this.records.set(id, { json: JSON.stringify(value), revision });
      }
      after = page.next;
    } while (after);
    return {
      items,
      settings: structuredClone(index.settings),
      marks: { ...index.marks },
      ...(index.since !== undefined && { since: index.since }),
    };
  }

  /** Why saving would fail now, if it would. */
  blocked() {
    return this.uncertain
      ? "记忆保存回执未确认，请重新加载应用后再修改。"
      : undefined;
  }

  async save(data: MemoryData, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const blocked = this.blocked();
    if (blocked) throw new Error(blocked);
    const index: MemoryIndex = {
      version: 1,
      settings: data.settings,
      marks: data.marks,
      ...(data.since !== undefined && { since: data.since }),
    };
    const json = JSON.stringify(index);
    const records: RecordWrite[] = [];
    const next = new Map<string, { json: string; revision: number }>();
    for (const item of data.items) {
      const old = this.records.get(item.id);
      const entry = {
        json: JSON.stringify(item),
        revision: old?.revision ?? 0,
      };
      next.set(item.id, entry);
      if (old?.json !== entry.json)
        records.push({
          collection: ITEMS,
          id: item.id,
          revision: entry.revision,
          value: item,
          text: item.text,
        });
    }
    for (const [id, { revision }] of this.records)
      if (!next.has(id))
        records.push({ collection: ITEMS, id, revision, remove: true });
    const documents =
      json === this.index.json
        ? []
        : [{ revision: this.index.revision, value: index }];
    if (!documents.length && !records.length) return;
    let receipt: StateBatchReceipt;
    try {
      receipt = (await this.call(
        "state.batch",
        { documents, records } satisfies StateBatch,
        signal,
      )) as StateBatchReceipt;
    } catch (error) {
      if (!aborted(error) && outcome(error) !== "not-committed")
        this.uncertain = true;
      throw error;
    }
    records.forEach((write, i) => {
      const written = receipt.records[i];
      if (written) next.get(write.id)!.revision = written.revision;
    });
    if (documents.length)
      this.index = { revision: receipt.documents[0]!.revision, json };
    this.records = next;
  }
}
