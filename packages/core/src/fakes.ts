import type {
  Confirm,
  ConfirmRequest,
  EgressRequest,
  EgressResult,
  EgressSink,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  SecretStore,
} from "./types.js";
import type { ExecInvocation, ExecResult, ExecSink, FsEntry, FsLocation, FsSink } from "./capabilities/types.js";

/** Canned filesystem results and copied call records; performs no filesystem I/O. */
export class RecordingFsSink implements FsSink {
  readonly records: (FsLocation & { operation: "read" | "write" | "list"; data?: Uint8Array })[] = [];
  constructor(private readonly response: { data?: Uint8Array; entries?: FsEntry[]; error?: unknown } = {}) {}
  async read(req: FsLocation): Promise<Uint8Array> {
    this.record(req, "read");
    return new Uint8Array(this.response.data ?? []);
  }
  async write(req: FsLocation & { data: Uint8Array }): Promise<void> {
    this.record(req, "write", req.data);
  }
  async list(req: FsLocation): Promise<FsEntry[]> {
    this.record(req, "list");
    return (this.response.entries ?? []).map((entry) => ({ ...entry }));
  }
  private record(req: FsLocation, operation: "read" | "write" | "list", data?: Uint8Array): void {
    this.records.push({ rootPath: req.rootPath, path: req.path, operation, ...(data ? { data: new Uint8Array(data) } : {}) });
    if (this.response.error !== undefined) throw this.response.error;
  }
}

/** Records the bound program and separate args; never starts a process. */
export class RecordingExecSink implements ExecSink {
  readonly records: ExecInvocation[] = [];
  constructor(private readonly response: Partial<ExecResult> & { error?: unknown } = {}) {}
  async run(req: ExecInvocation): Promise<ExecResult> {
    this.records.push({ ...req, args: [...req.args] });
    if (this.response.error !== undefined) throw this.response.error;
    return { exitCode: this.response.exitCode ?? 0, stdout: this.response.stdout ?? "", stderr: this.response.stderr ?? "" };
  }
}

export class FakeModelProvider implements ModelProvider {
  readonly calls: ModelRequest[] = [];

  constructor(private readonly response: ModelResponse = { text: "" }) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push({ prompt: req.prompt });
    return { text: this.response.text };
  }
}

/**
 * Records `send` calls and returns a local stub. Does not open a socket.
 * `redirects` maps a 1-based call number to a URL: that call answers with `redirectTo`.
 * `response` is the final answer. `error` makes `send` throw after recording.
 * Share downloads read `body` as latin1 (one character, one byte).
 */
export class RecordingEgressSink implements EgressSink {
  readonly records: EgressRequest[] = [];

  constructor(
    private readonly redirects: Readonly<Record<number, string>> = {},
    private readonly response: { status?: number; body?: string; headers?:Record<string,string>; error?: unknown } = {},
  ) {}

  async send(req: EgressRequest): Promise<EgressResult> {
    const record: EgressRequest = { url: req.url };
    if (req.method !== undefined) {
      record.method = req.method;
    }
    if (req.body !== undefined) {
      record.body = req.body;
    }
    if(req.headers!==undefined)record.headers={...req.headers};
    if(req.stream!==undefined)record.stream=req.stream;
    this.records.push(record);
    if (this.response.error !== undefined) {
      throw this.response.error;
    }
    const redirectTo = this.redirects[this.records.length];
    return redirectTo === undefined
      ? { status: this.response.status ?? 200, body: this.response.body ?? "", ...(this.response.headers?{headers:{...this.response.headers}}:{}) }
      : { status: 302, body: "", redirectTo };
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async get(ref: string): Promise<string | undefined> {
    return this.values.get(ref);
  }

  async set(ref: string, value: string): Promise<void> {
    this.values.set(ref, value);
  }

  async delete(ref: string): Promise<void> {
    this.values.delete(ref);
  }
}

/** Returns preset answers in order. Denies when none remain. */
export class ScriptedConfirm implements Confirm {
  readonly asked: ConfirmRequest[] = [];
  private readonly answers: boolean[];

  constructor(answers: readonly boolean[] = []) {
    this.answers = [...answers];
  }

  async ask(req: ConfirmRequest): Promise<boolean> {
    this.asked.push({ ...req });
    const next = this.answers.shift();
    return next ?? false;
  }
}
