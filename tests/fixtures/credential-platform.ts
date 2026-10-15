import type { Platform } from "../../modules/sdk";
import type {
  CredentialFailureOutcome,
  CredentialRequest,
  CredentialResponse,
} from "../../modules/sdk/credential";

/** Test-only model: no fetch, storage, native bridge or real credential input. */
export interface FakeBinding {
  owner: string;
  id: string;
  target: string;
}
export interface FakeDispatch {
  target: string;
  method: "POST";
  authorization: string;
  body: string;
  signal: AbortSignal;
}
export type FakeTransport = (
  input: FakeDispatch,
) => Promise<CredentialResponse>;
const capability = "credential.request";
const bytes = (value: string) => new TextEncoder().encode(value).length;
function failure(outcome: CredentialFailureOutcome) {
  return Object.assign(new Error("Credential request failed"), { outcome });
}
export class FakeCredentialPlatform implements Platform {
  readonly kind = "browser" as const;
  private readonly bindings: FakeBinding[];
  private readonly grants = new Map<string, AbortController>();
  constructor(
    bindings: FakeBinding[],
    private readonly send: FakeTransport,
  ) {
    const keys = new Set<string>();
    this.bindings = bindings.map((binding) => {
      const target = new URL(binding.target);
      const key = JSON.stringify([binding.owner, binding.id]);
      if (
        !/^extension\.[a-z][a-z0-9.-]{0,63}$/.test(binding.owner) ||
        binding.owner.includes("..") ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(binding.id) ||
        target.protocol !== "https:" ||
        !target.hostname.endsWith(".invalid") ||
        target.username ||
        target.password ||
        target.hash ||
        target.search ||
        target.port ||
        keys.has(key)
      )
        throw failure("not-dispatched");
      keys.add(key);
      return { ...binding, target: target.href };
    });
  }
  available(name: string) {
    return name === capability;
  }
  async grant(owner: string, capabilities: string[]) {
    if (capabilities.some((name) => !this.available(name)))
      throw failure("not-dispatched");
    const previous = this.grants.get(owner);
    // Invalidate before notifying abort listeners; reentrant requests cannot reuse it.
    this.grants.delete(owner);
    previous?.abort();
    if (capabilities.includes(capability))
      this.grants.set(owner, new AbortController());
  }
  async call(
    owner: string,
    name: string,
    payload?: unknown,
    signal?: AbortSignal,
  ): Promise<CredentialResponse> {
    const grant = this.grants.get(owner);
    if (name !== capability || !grant || signal?.aborted)
      throw failure("not-dispatched");
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !== "binding,body,version"
    )
      throw failure("not-dispatched");
    const { version, binding: bindingId, body } = payload as CredentialRequest;
    if (
      version !== 1 ||
      typeof bindingId !== "string" ||
      typeof body !== "string" ||
      bytes(body) > 4096
    )
      throw failure("not-dispatched");
    const binding = this.bindings.find(
      (item) => item.owner === owner && item.id === bindingId,
    );
    if (!binding) throw failure("not-dispatched");
    const combined = AbortSignal.any(
      signal ? [signal, grant.signal] : [grant.signal],
    );
    if (combined.aborted || this.grants.get(owner) !== grant)
      throw failure("not-dispatched");
    try {
      const response = await this.send({
        target: binding.target,
        method: "POST",
        authorization: `Bearer fake-only:${owner}:${binding.id}`,
        body,
        signal: combined,
      });
      if (!response) throw failure("unknown");
      const { status, body: responseBody } = response;
      if (
        combined.aborted ||
        this.grants.get(owner) !== grant ||
        !Number.isInteger(status) ||
        status < 200 ||
        status > 599 ||
        (status >= 300 && status < 400) ||
        typeof responseBody !== "string" ||
        bytes(responseBody) > 8192
      )
        throw failure("unknown");
      return { status, body: responseBody };
    } catch {
      throw failure("unknown");
    }
  }
}
