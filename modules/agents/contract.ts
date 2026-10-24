import type { Named } from "@modules/sdk";
import type { Effort } from "@extensions/contracts";
export type { Effort };
/** Experimental `agents@1` service contract owned by the Agent extension, not the SDK. */
export type Session = {
  id: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
  /** Replies after it are unread; absent on sessions saved before it was added, which count none. */
  lastReadAt?: number;
  messages: Message[];
};
/** A file or picture attached to a message, kept with it in the conversation. */
export type Attachment =
  | { kind: "text"; name: string; text: string }
  | {
      kind: "image";
      name: string;
      mime: "image/jpeg" | "image/png" | "image/webp";
      /** Base64 of the already-scaled picture, without a data-URL prefix. */
      data: string;
    };
export type Message = {
  id: string;
  role: "user" | "agent";
  text: string;
  attachments?: Attachment[];
  /** Send or reply time in ms; absent on messages saved before it was added. */
  at?: number;
};
export type Agent = {
  id: string;
  name: string;
  description: string;
  /** A small `data:image/(png|jpeg|webp);base64,` picture; absent shows the name's first letter. */
  avatar?: string;
  status: "online" | "idle" | "busy";
  pinned: boolean;
  canCancel?: boolean;
  /** Text being sent and not yet saved with its reply; never persisted. */
  pending?: { sessionId: string; text: string; attachments?: Attachment[] };
  extensionId: string;
  /** The `chat@1` model that answers this Agent, by provider extension and model id. */
  model?: AgentModel;
  /** How much its model thinks; absent leaves it to the service. Kept when the model changes, sent only if the model lists it. */
  effort?: Effort;
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
  /** Thinking strengths the model takes; absent for none. */
  reasoning?: readonly Effort[];
  /** The model reads pictures. */
  vision?: boolean;
};
/** What `update` can change; `avatar: null` removes the picture. */
export type AgentPatch = Partial<
  Pick<Agent, "name" | "description" | "pinned">
> & { avatar?: string | null };
export type AgentConfig = {
  name: string;
  description?: string;
  /** Starting avatar, as in `Agent.avatar`. */
  avatar?: string;
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
  /** Messages can carry text files and pictures; added after agents@1 shipped. */
  attachments?: boolean;
};
export interface AgentProvider {
  readonly info: AgentProviderInfo;
  list(): Agent[];
  subscribe(listener: () => void): () => void;
  create(config: AgentConfig): Promise<Agent>;
  update(id: string, patch: AgentPatch): Promise<void>;
  remove(id: string): Promise<void>;
  session(
    id: string,
    action: "create" | "select" | "delete",
    sessionId?: string,
  ): Promise<void>;
  send(id: string, text: string, attachments?: Attachment[]): Promise<void>;
  cancel(id: string): void;
  /**
   * The Agent whose current session is on screen, or `null` for none: its
   * unread replies become read, and so do replies arriving while it stays.
   * Added after agents@1 shipped, so optional.
   */
  view?(id: string | null): void;
  /** Models any Agent can use; added after agents@1 shipped. */
  modelChoices?(): readonly ModelChoice[];
  /** Picks one of `modelChoices()` for an Agent, or none, and switches its connection on. */
  setModel?(id: string, model: AgentModel | null): Promise<void>;
  /** Sets how much an Agent's model thinks, or clears it; added after agents@1 shipped. */
  setEffort?(id: string, effort: Effort | null): Promise<void>;
  /** The `chat@1` providers models come from, with models or not. */
  connectors?(): readonly Named[];
  /** Switches one of the Agent's extensions off or back on for one Agent. */
  setOff?(id: string, extensionId: string, off: boolean): Promise<void>;
  /** Names a session, 1–60 characters; added after agents@1 shipped. */
  renameSession?(id: string, sessionId: string, title: string): Promise<void>;
  /** Deletes one saved message; added after agents@1 shipped, so optional. */
  removeMessage?(
    id: string,
    sessionId: string,
    messageId: string,
  ): Promise<void>;
}
