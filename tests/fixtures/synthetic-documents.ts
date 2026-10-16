import type {
  SelectedDocumentRequest,
  SelectedDocumentResponse,
} from "../../modules/sdk";
/** Isolated contract model. No filesystem, OS picker, credentials or production grants. */
export class SyntheticDocuments {
  available = true;
  private readonly bindings = new Map<
    string,
    { owner: string; text: string }
  >();
  select(owner: string, text: string | null): string | null {
    if (!owner.trim()) throw Error("invalid-owner");
    if (text === null) return null;
    if (!this.available) throw Error("unavailable");
    if (
      [...this.bindings.values()].filter((b) => b.owner === owner).length >= 2
    )
      throw Error("resource-limit");
    const handle = crypto.randomUUID();
    this.bindings.set(handle, { owner, text });
    return handle;
  }
  revoke(owner: string, handle: string) {
    if (this.bindings.get(handle)?.owner === owner)
      this.bindings.delete(handle);
  }
  revokeOwner(owner: string) {
    for (const [handle, binding] of this.bindings)
      if (binding.owner === owner) this.bindings.delete(handle);
  }
  async read(
    owner: string,
    request: SelectedDocumentRequest,
    signal?: AbortSignal,
    readBoundary: () => Promise<void> = async () => {},
  ): Promise<SelectedDocumentResponse> {
    if (!this.available) return { status: "rejected", reason: "unavailable" };
    if (!request || typeof request !== "object" || Array.isArray(request))
      return { status: "rejected", reason: "invalid-request" };
    const { handle, maxBytes } = request;
    if (
      typeof handle !== "string" ||
      !handle ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 65536
    )
      return { status: "rejected", reason: "invalid-request" };
    const binding = this.bindings.get(handle);
    if (!binding || binding.owner !== owner)
      return { status: "rejected", reason: "denied" };
    if (signal?.aborted) return { status: "cancelled" };
    try {
      await readBoundary();
    } catch {
      return { status: "unknown" };
    }
    if (!this.available) return { status: "rejected", reason: "unavailable" };
    if (this.bindings.get(handle) !== binding)
      return { status: "rejected", reason: "denied" };
    if (signal?.aborted) return { status: "cancelled" };
    const bytes = new TextEncoder().encode(binding.text).byteLength;
    if (bytes > maxBytes) return { status: "rejected", reason: "too-large" };
    return { status: "read", text: binding.text, bytes };
  }
}
