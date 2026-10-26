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
/** How much a model thinks before replying; `off` asks it not to. */
export type Effort = "off" | "low" | "medium" | "high" | "max";
/** One model a `chat@1` provider offers; `id` is what `reply` takes. */
export interface ChatModel {
  /** At most 256 characters; Agents are not offered longer ids. */
  id: string;
  label: string;
  /** Plain-language note: which service and model, and whether it is ready. */
  description: string;
  /** Heading the model is listed under, such as its service; defaults to the provider name. */
  group?: string;
  /**
   * The thinking strengths this model takes. Absent means it takes none, and
   * Agents show no strength control for it; added after chat@1 shipped.
   */
  reasoning?: readonly Effort[];
  /** The model reads pictures. Absent means it does not: Agents then send none. */
  vision?: boolean;
}
/** A picture sent with a turn, already scaled; `data` is base64 without a prefix. */
export interface ChatImage {
  mime: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}
export interface ChatTurn {
  role: "user" | "agent";
  text: string;
  /** Only for models that list `vision`. */
  images?: readonly ChatImage[];
}
/** `chat@1`: multi-turn replies from a model the user picked for an Agent. */
export interface ChatService {
  name: string;
  /**
   * The id of this provider's own `dialog` view where the user adds or
   * changes its models; Agents offer it when models are to be connected.
   * Added after chat@1 shipped.
   */
  manage?: string;
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
      /** Pictures sent with `input`; only for models that list `vision`. */
      images?: readonly ChatImage[];
      /** One of the model's `reasoning`; absent leaves it to the service. */
      effort?: Effort;
    },
    signal: AbortSignal,
  ): Promise<string>;
}
