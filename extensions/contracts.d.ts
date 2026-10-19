export interface WorkbenchSnapshot {
  input: string;
  output: string;
  runs: number;
  phase:
    | "ready"
    | "running"
    | "saving"
    | "saved"
    | "cancelled"
    | "failed"
    | "uncertain";
  error: string | null;
  provider: string;
}
export interface Transformer {
  name: string;
  /** Plain-language note for users: what produces replies and where text goes. */
  description?: string;
  transform(input: string, signal: AbortSignal): Promise<string>;
}
export interface Workbench {
  snapshot(): WorkbenchSnapshot;
  subscribe(listener: () => void): () => void;
  run(input: string): Promise<void>;
  cancel(): void;
}
/** One model a `chat@1` provider offers; `id` is what `reply` takes. */
export interface ChatModel {
  /** At most 256 characters; Agents are not offered longer ids. */
  id: string;
  label: string;
  /** Plain-language note: which service and model, and whether it is ready. */
  description: string;
  /** Heading the model is listed under, such as its service; defaults to the provider name. */
  group?: string;
}
export interface ChatTurn {
  role: "user" | "agent";
  text: string;
}
/** `chat@1`: multi-turn replies from a model the user picked for an Agent. */
export interface ChatService {
  name: string;
  models(): readonly ChatModel[];
  subscribe(listener: () => void): () => void;
  /**
   * `history` is the conversation so far, oldest first; the provider may
   * send only the newest part. Failures carry `outcome` like platform calls.
   */
  reply(
    request: {
      model: string;
      instructions?: string;
      history: readonly ChatTurn[];
      input: string;
    },
    signal: AbortSignal,
  ): Promise<string>;
}
