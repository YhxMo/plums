import type { Platform, CredentialResponse } from "../../modules/sdk";
export type Bridge = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
const capability = "credential.request";
const owners = new Map([
  ["extension.probe.alpha", "probe.alpha"],
  ["extension.probe.beta", "probe.beta"],
]);
const bindings = new Map([
  ["text", "echo"],
  ["slow", "delay"],
]);
function failure(outcome: "not-dispatched" | "unknown") {
  return Object.assign(new Error("Experimental transport failed"), { outcome });
}
function normalize(error: unknown) {
  const outcome = (error as { outcome?: unknown } | null)?.outcome;
  return failure(outcome === "not-dispatched" ? "not-dispatched" : "unknown");
}
/** Only imported by isolated tests. Ordinary PlatformAdapter remains unchanged. */
export class ExperimentPlatform implements Platform {
  readonly kind = "native" as const;
  private readonly grants = new Map<string, { allowed: boolean }>();
  private constructor(private readonly bridge: Bridge) {}
  static async connect(bridge: Bridge) {
    try {
      await bridge("probe_info");
    } catch {
      throw failure("not-dispatched");
    }
    return new ExperimentPlatform(bridge);
  }
  available(name: string) {
    return name === capability;
  }
  async grant(owner: string, capabilities: string[]) {
    const nativeOwner = owners.get(owner);
    if (!nativeOwner) {
      if (capabilities.length === 0) return;
      throw failure("not-dispatched");
    }
    if (capabilities.some((name) => name !== capability))
      throw failure("not-dispatched");
    // Pessimistic invalidation: an unknown native receipt never restores old permission.
    const generation = { allowed: false };
    this.grants.set(owner, generation);
    try {
      await this.bridge("probe_grant", {
        owner: nativeOwner,
        allow: capabilities.includes(capability),
      });
    } catch (error) {
      throw normalize(error);
    }
    if (this.grants.get(owner) === generation)
      generation.allowed = capabilities.includes(capability);
  }
  async call(
    owner: string,
    name: string,
    payload?: unknown,
    signal?: AbortSignal,
  ): Promise<CredentialResponse> {
    const nativeOwner = owners.get(owner);
    const generation = this.grants.get(owner);
    if (
      !nativeOwner ||
      !generation?.allowed ||
      name !== capability ||
      signal?.aborted
    )
      throw failure("not-dispatched");
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !== "binding,body,version"
    )
      throw failure("not-dispatched");
    const { version, binding, body } = payload as {
      version: unknown;
      binding: unknown;
      body: unknown;
    };
    const path =
      typeof binding === "string" ? bindings.get(binding) : undefined;
    if (
      version !== 1 ||
      !path ||
      typeof body !== "string" ||
      new TextEncoder().encode(body).length > 4096 ||
      body.includes("\0") ||
      signal?.aborted ||
      this.grants.get(owner) !== generation
    )
      throw failure("not-dispatched");
    const id = crypto.randomUUID();
    const args = { owner: nativeOwner, id };
    let cancellation: Promise<boolean> | undefined;
    const cancel = () =>
      (cancellation ??= this.bridge("probe_cancel", args).then(
        () => true,
        () => false,
      ));
    try {
      await this.bridge("probe_prepare", { ...args, binding: path, body });
    } catch (error) {
      if (normalize(error).outcome === "unknown") await cancel();
      throw normalize(error);
    }
    if (signal?.aborted || this.grants.get(owner) !== generation) {
      const confirmed = await cancel();
      throw failure(confirmed ? "not-dispatched" : "unknown");
    }
    const abort = () => {
      void cancel();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await this.bridge("probe_execute", args);
      const { status, body: responseBody } = (result ?? {}) as {
        status: unknown;
        body: unknown;
      };
      if (
        signal?.aborted ||
        this.grants.get(owner) !== generation ||
        !Number.isInteger(status) ||
        Number(status) < 200 ||
        Number(status) > 599 ||
        (Number(status) >= 300 && Number(status) < 400) ||
        typeof responseBody !== "string" ||
        new TextEncoder().encode(responseBody).length > 8192
      )
        throw failure("unknown");
      return { status: Number(status), body: responseBody };
    } catch (error) {
      await cancel();
      throw normalize(error);
    } finally {
      signal?.removeEventListener("abort", abort);
      await cancellation;
    }
  }
}
