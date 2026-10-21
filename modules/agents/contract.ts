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
  /** Text extensions switched on for this Agent; replies pass through them in this order. Absent means the first available one. */
  extensions?: string[];
  /** The `chat@1` model that answers this Agent, by provider extension and model id. */
  model?: AgentModel;
  /** Other extensions switched off for this Agent, such as its provider, the interface showing it or its model's connection. */
  off?: string[];
  capabilities: string[];
  sessions: Session[];
  multiSession: boolean;
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
  multiSession?: boolean;
  /** Text extensions to start with, in order; absent picks the provider's default. */
  extensions?: string[];
  /** The model to start with, or `null` for none; absent picks the first one. */
  model?: AgentModel | null;
  /** Other extensions to start switched off, as in `Agent.off`. */
  off?: string[];
};
/** An extension an Agent can switch on, described for the user. */
export type ExtensionChoice = Named & { description: string };
/** The IDs of the available extensions this Agent uses, in order; stopped ones are skipped. */
export const enabledExtensions = (
  agent: Pick<Agent, "extensions">,
  available: readonly Named[],
) =>
  agent.extensions
    ? agent.extensions.filter((id) => available.some((a) => a.id === id))
    : available.slice(0, 1).map(({ id }) => id);
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
  /** Extensions each Agent can switch on, oldest first; added after agents@1 shipped. */
  extensionChoices?(): readonly ExtensionChoice[];
  /** Switches one of `extensionChoices()` on (appended last) or off for one Agent. */
  setExtension?(id: string, extensionId: string, on: boolean): Promise<void>;
  /** Replaces one Agent's extensions with these, in this order. */
  setExtensions?(id: string, extensionIds: string[]): Promise<void>;
  /** Models any Agent can use; added after agents@1 shipped. */
  modelChoices?(): readonly ModelChoice[];
  /** Picks one of `modelChoices()` for an Agent, or none, and switches its connection on. */
  setModel?(id: string, model: AgentModel | null): Promise<void>;
  /** The `chat@1` providers models come from, with models or not. */
  connectors?(): readonly Named[];
  /** Switches any extension other than a text one off or back on for one Agent. */
  setOff?(id: string, extensionId: string, off: boolean): Promise<void>;
  /** Deletes one saved message; added after agents@1 shipped, so optional. */
  removeMessage?(
    id: string,
    sessionId: string,
    messageId: string,
  ): Promise<void>;
}
