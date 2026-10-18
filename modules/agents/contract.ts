import type { Named } from "../sdk";
/** Experimental `agents@1` service contract owned by the Agent extension, not the SDK. */
export type Session = {
  id: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
  messages: Message[];
};
export type Message = { id: string; role: "user" | "agent"; text: string };
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
}
