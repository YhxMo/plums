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
  headers?: Record<string, string>;
  /** The host may deliver chunks through its bound event channel. */
  stream?: boolean;
}

export interface EgressResult {
  status: number;
  body: string;
  headers?: Record<string, string>;
  /** Set when the answer is a redirect. The sink must not follow it, and the core does not follow it either. */
  redirectTo?: string;
}

/**
 * The only outbound exit, including share-link downloads.
 * A real sink limits how big a response it will read and how long it will wait.
 * `EgressRequest` has no size or time fields. After DNS resolution the sink also refuses
 * loopback, private-network and link-local addresses. The core does not resolve DNS.
 */
export interface EgressSink {
  send(req: EgressRequest): Promise<EgressResult>;
}

export interface ConfirmRequest {
  /** Fixed trusted-host presentation; ordinary capabilities cannot select this. */
  presentation?: "engine-trust";
  message: string;
  /** Optional presentation fields; never determine authorization. */
  subject?: string;
  action?: string;
  /** Where an egress or share download goes: normalized host, with the port when it is not 443. */
  host?: string;
  /** Why this is being asked. An action uses the manifest permission's `reason`. */
  reason?: string;
}

export interface Confirm {
  ask(req: ConfirmRequest): Promise<boolean>;
}

export interface SecretStore {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}
