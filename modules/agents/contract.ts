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
  /** Deletes one saved message; added after agents@1 shipped, so optional. */
  removeMessage?(
    id: string,
    sessionId: string,
    messageId: string,
  ): Promise<void>;
}
