import { invokeNative } from "./native/invoke";
import type { NativeCommands } from "./native/contract.generated";
import { platformRejection } from "@modules/sdk";

export type { SelectedDocument } from "@modules/sdk";
import type { SelectedDocument } from "@modules/sdk";
export type DocumentSelection = NativeCommands["document_select"]["response"];
type DocumentResult =
  DocumentSelection | NativeCommands["document_read"]["response"];

/** Host management entry. Native locations stay in the native broker. */
export class DocumentAccess {
  supported = false;
  initializationError: string | null = null;
  private readonly epochs = new Map<string, number>();
  private readonly pending = new Map<string, Set<() => void>>();
  private readonly mutations = new Map<string, Promise<void>>();
  private readonly faulted = new Set<string>();
  private readonly blocked = new Set<string>();
  constructor(private readonly authorized: (owner: string) => boolean) {}
  async initialize(native: boolean) {
    if (!native) return;
    try {
      this.supported = (await invokeNative("document_supported")) === true;
      this.initializationError = null;
    } catch (error) {
      this.supported = false;
      const message = error instanceof Error ? error.message : String(error);
      this.initializationError = message.trim() || "初始化探测失败";
    }
  }
  private check(owner: string) {
    if (
      !this.supported ||
      !this.authorized(owner) ||
      this.blocked.has(owner) ||
      this.faulted.has(owner)
    )
      throw platformRejection(
        "Permission denied or unavailable: document.read",
      );
  }
  invalidate(owner: string) {
    const epoch = (this.epochs.get(owner) ?? 0) + 1;
    this.epochs.set(owner, epoch);
    for (const cancel of this.pending.get(owner) ?? []) cancel();
    return epoch;
  }
  private mutate(owner: string, run: () => Promise<void>, recover = false) {
    this.blocked.add(owner);
    this.invalidate(owner);
    const work = (this.mutations.get(owner) ?? Promise.resolve())
      .catch(() => {})
      .then(run)
      .then(
        () => {
          if (recover) this.faulted.delete(owner);
        },
        (error) => {
          this.faulted.add(owner);
          throw error;
        },
      )
      .finally(() => {
        if (this.mutations.get(owner) === work) {
          this.mutations.delete(owner);
          this.blocked.delete(owner);
        }
      });
    this.mutations.set(owner, work);
    return work;
  }
  authorize(owner: string, grant: () => Promise<void>) {
    return this.mutate(owner, grant);
  }
  async select(owner: string, multiple = false, signal?: AbortSignal) {
    this.check(owner);
    return this.operation(
      owner,
      (operationId) =>
        invokeNative("document_select", { owner, operationId, multiple }),
      signal,
    );
  }
  async list(owner: string): Promise<SelectedDocument[]> {
    this.check(owner);
    const epoch = this.epochs.get(owner);
    const result = await invokeNative("document_list", { owner });
    if (epoch !== this.epochs.get(owner)) return [];
    return result;
  }
  async read(owner: string, payload: unknown, signal?: AbortSignal) {
    this.check(owner);
    const q = payload as { handle?: unknown; maxBytes?: unknown } | null;
    if (
      !q ||
      typeof q !== "object" ||
      Array.isArray(q) ||
      typeof q.handle !== "string" ||
      !Number.isSafeInteger(q.maxBytes) ||
      Number(q.maxBytes) < 1 ||
      Number(q.maxBytes) > 65536
    )
      return { status: "rejected", reason: "invalid-request" } as const;
    const handle = q.handle,
      maxBytes = Number(q.maxBytes);
    return this.operation(
      owner,
      (operationId) =>
        invokeNative("document_read", { owner, operationId, handle, maxBytes }),
      signal,
    );
  }
  revoke(owner: string, handle?: string) {
    return this.mutate(
      owner,
      async () => {
        if (!this.supported) return;
        try {
          await invokeNative("document_revoke", {
            owner,
            ...(handle === undefined ? {} : { handle }),
          });
        } catch {
          throw Error(
            "文档撤销结果待确认；请撤销全部文档或重新启动应用后再授权。",
          );
        }
      },
      handle === undefined,
    );
  }
  private async operation<R extends DocumentResult>(
    owner: string,
    perform: (operationId: string) => Promise<R>,
    signal?: AbortSignal,
  ): Promise<R | { status: "cancelled" } | { status: "unknown" }> {
    if (signal?.aborted) return { status: "cancelled" };
    const operationId = crypto.randomUUID(),
      epoch = this.epochs.get(owner);
    let cancelled = false;
    let completeCancellation!: (result: { status: "cancelled" }) => void;
    const cancellation = new Promise<{ status: "cancelled" }>((resolve) => {
      completeCancellation = resolve;
    });
    const cancel = () => {
      cancelled = true;
      void invokeNative("document_cancel", { owner, operationId }).catch(
        () => {},
      );
      completeCancellation({ status: "cancelled" });
    };
    const active = this.pending.get(owner) ?? new Set();
    this.pending.set(owner, active);
    active.add(cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    const work = perform(operationId).then(
      async (result) => {
        if (cancelled || epoch !== this.epochs.get(owner)) {
          if (result.status === "selected")
            for (const item of result.documents)
              await invokeNative("document_revoke", {
                owner,
                handle: item.handle,
              }).catch(() => {
                this.faulted.add(owner);
              });
          return { status: "cancelled" } as const;
        }
        return result;
      },
      () => ({ status: "unknown" }) as const,
    );
    try {
      return await Promise.race([work, cancellation]);
    } finally {
      active.delete(cancel);
      if (!active.size) this.pending.delete(owner);
      signal?.removeEventListener("abort", cancel);
    }
  }
}
