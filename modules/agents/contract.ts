import type { Named } from "../sdk";
/** Experimental `agents@1` service contract owned by the Agent extension, not the SDK. */
export type Session = {
  id: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
  messages: Message[];
};
export type Message = {
  id: string;
  role: "user" | "agent";
  text: string;
  /** Send or reply time in ms; absent on messages saved before it was added. */
  at?: number;
};
export type Agent = {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  status: "online" | "idle" | "busy";
  pinned: boolean;
  canCancel?: boolean;
  /** Text being sent and not yet saved with its reply; never persisted. */
  pending?: { sessionId: string; text: string };
  extensionId: string;
  /** Extension chosen to write replies; the first reply source is used while it is absent or stopped. */
  replySource?: string;
  capabilities: string[];
  sessions: Session[];
  multiSession: boolean;
  currentSessionId: string;
};
export type AgentConfig = {
  name: string;
  description?: string;
  multiSession?: boolean;
};
/** An extension that can write replies, described for the user. */
export type ReplySource = Named & { description: string };
/** The source that writes this Agent's next reply. */
export const replySourceOf = (
  agent: Pick<Agent, "replySource">,
  sources: readonly ReplySource[],
) => sources.find((source) => source.id === agent.replySource) ?? sources[0];
export type AgentProviderInfo = {
  label: string;
  version: string;
  description: string;
  /** Extensions the replies rely on, this provider first; added after agents@1 shipped. */
  extensions?: readonly Named[];
};
export interface AgentProvider {
  readonly info: AgentProviderInfo;
  list(): Agent[];
  subscribe(listener: () => void): () => void;
  create(config: AgentConfig): Promise<Agent>;
  update(
    id: string,
    patch: Partial<Pick<Agent, "name" | "description" | "pinned">>,
  ): Promise<void>;
  remove(id: string): Promise<void>;
  session(
    id: string,
    action: "create" | "select" | "delete",
    sessionId?: string,
  ): Promise<void>;
  send(id: string, text: string): Promise<void>;
  cancel(id: string): void;
  /** Extensions that can write replies, the default first; added after agents@1 shipped. */
  replySources?(): readonly ReplySource[];
  /** Chooses which of `replySources()` writes this Agent's replies. */
  setReplySource?(id: string, extensionId: string): Promise<void>;
  /** Deletes one saved message; added after agents@1 shipped, so optional. */
  removeMessage?(
    id: string,
    sessionId: string,
    messageId: string,
  ): Promise<void>;
}
