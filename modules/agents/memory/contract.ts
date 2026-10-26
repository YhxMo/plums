import type { AgentModel } from "@modules/agents/contract";
import type { PromptSection } from "@modules/agents/instructions";

/**
 * Experimental `memory@1` service contract, owned by the Agent extension
 * like `agents@1`. A memory provider keeps what Agents remember across
 * conversations; the Agent provider asks it for the prompt sections of one
 * Agent talking with one person and tells it when conversations change.
 */

/** Whose memory an item is: isolation follows from asking only for one Agent and one person. */
export type MemoryScope =
  /** About a person, read by every Agent they talk with: the shared layer. */
  | { kind: "person"; person: string }
  /** What one Agent remembers about one person. */
  | { kind: "agent"; agent: string; person: string };

export type MemoryItem = {
  id: string;
  scope: MemoryScope;
  text: string;
  /** When what it is about happens, in ms. */
  at?: number;
  /** When it stops holding; from then on it is not used. Absent means `at`. */
  until?: number;
  createdAt: number;
  updatedAt: number;
  /** Written by the person, or learned from a conversation. */
  by: "person" | "conversation";
};

/** A saved message as memory reads it: text only, files by name. */
export type MemoryMessage = {
  id: string;
  session: string;
  /** As `Message.from`, or `speaker()` for older messages. */
  from: string;
  role: "user" | "agent";
  text: string;
  at: number;
};

/** What an Agent provider lets a memory provider read. */
export interface MemorySource {
  /** Agents with this memory switched on. */
  agents(): readonly { id: string; name: string; model?: AgentModel }[];
  /** An Agent's saved messages sent after `after` (ms), in every session, oldest first. */
  messages(agent: string, after: number): readonly MemoryMessage[];
  /** Calls `listener` when its Agents or their conversations change. */
  subscribe(listener: () => void): () => void;
}

/** What one consolidation changed, for the interface to announce and undo. */
export type MemoryReport = {
  id: string;
  agent: string;
  at: number;
  added: readonly string[];
  changed: readonly string[];
  removed: readonly string[];
};

export interface MemoryService {
  readonly info: { label: string; description: string };
  /** The sections for `agent` answering `person`: what `person` shared with every Agent, then what `agent` remembers about them, nothing else. */
  context(request: {
    agent: string;
    person: string;
    now: number;
    timeZone: string;
  }): readonly PromptSection[];
  /** Lets the provider read an Agent provider's conversations; returns a disconnect. */
  connect(source: MemorySource): () => void;
  /**
   * `saved`: a reply was saved; `left`: the person left the conversation;
   * `on`: memory was switched back on, so what was said while it was off is
   * not learned; `removed`: the Agent is gone, and so is its memory.
   */
  notify(agent: string, event: "saved" | "left" | "on" | "removed"): void;
  /** How many things `agent` remembers about `person`, not counting the shared ones. */
  count(agent: string, person: string): number;
  /** Recent consolidations, newest first, until the provider stops. */
  reports(): readonly MemoryReport[];
  /** Puts back what one consolidation changed, while its items stay as it left them. */
  undo(report: string): Promise<void>;
  subscribe(listener: () => void): () => void;
  /**
   * Where the person sees and edits memory, apart from the service itself;
   * absent when the provider has no page, such as without an interface.
   */
  readonly page?: {
    /** Shows the page: one Agent's memory, or the shared one. */
    open(agent?: string): Promise<void>;
  };
}
