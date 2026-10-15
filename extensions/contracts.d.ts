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
  transform(input: string, signal: AbortSignal): Promise<string>;
}
export interface Workbench {
  snapshot(): WorkbenchSnapshot;
  subscribe(listener: () => void): () => void;
  run(input: string): Promise<void>;
  cancel(): void;
}
