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
  /** The `chat@1` model that answers this Agent, by provider extension and model id. */
  model?: AgentModel;
  /** Extensions switched off for this Agent: its provider, the interface showing it or its model's connection. */
  off?: string[];
  sessions: Session[];
  currentSessionId: string;
};
export type AgentModel = { provider: string; model: string };
/** A model an Agent can use, from one `chat@1` provider. */
export type ModelChoice = {
  provider: string;
  providerLabel: string;
  /** Heading in the picker, such as the service the model belongs to. */
  group: string;
  id: string;
  label: string;
  description: string;
};
export type AgentConfig = {
  name: string;
  description?: string;
  /** The model to start with, or `null` for none; absent picks the first one. */
  model?: AgentModel | null;
  /** Other extensions to start switched off, as in `Agent.off`. */
  off?: string[];
};
/** An extension an Agent is composed of, described for the user. */
export type ExtensionChoice = Named & { description: string };
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
  /** Models any Agent can use; added after agents@1 shipped. */
  modelChoices?(): readonly ModelChoice[];
  /** Picks one of `modelChoices()` for an Agent, or none, and switches its connection on. */
  setModel?(id: string, model: AgentModel | null): Promise<void>;
  /** The `chat@1` providers models come from, with models or not. */
  connectors?(): readonly Named[];
  /** Switches one of the Agent's extensions off or back on for one Agent. */
  setOff?(id: string, extensionId: string, off: boolean): Promise<void>;
  /** Deletes one saved message; added after agents@1 shipped, so optional. */
  removeMessage?(
    id: string,
    sessionId: string,
    messageId: string,
  ): Promise<void>;
}
