import type { ExtensionContext } from "./index";

/** Experimental extension-layer contract; no role-card format enters the host. */
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
/** Optional SDK facade over a normal versioned service, not a kernel API. */
export function withAgents(ctx: ExtensionContext) {
  return { ...ctx, agents: ctx.use<AgentProvider>("agents") };
}
