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
 */
export class RecordingEgressSink implements EgressSink {
  readonly records: EgressRequest[] = [];

  constructor(private readonly redirects: Readonly<Record<number, string>> = {}) {}

  async send(req: EgressRequest): Promise<EgressResult> {
    const record: EgressRequest = { url: req.url };
    if (req.method !== undefined) {
      record.method = req.method;
    }
    if (req.body !== undefined) {
      record.body = req.body;
    }
    this.records.push(record);
    const redirectTo = this.redirects[this.records.length];
    return redirectTo === undefined ? { status: 200, body: "" } : { status: 302, body: "", redirectTo };
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
