export interface ModelRequest {
  prompt: string;
}

export interface ModelResponse {
  text: string;
}

export interface ModelProvider {
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export interface EgressRequest {
  url: string;
  method?: string;
  body?: string;
}

export interface EgressResult {
  status: number;
  body: string;
}

/** The only outbound exit, including share-link downloads. */
export interface EgressSink {
  send(req: EgressRequest): Promise<EgressResult>;
}

export interface ConfirmRequest {
  message: string;
}

export interface Confirm {
  ask(req: ConfirmRequest): Promise<boolean>;
}

export interface SecretStore {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}
