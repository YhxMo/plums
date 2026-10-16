import { DocumentAccess } from "./documents";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  platformRejection,
  type Platform,
  type StoredState,
} from "../modules/sdk";

function validOwner(owner: string) {
  if (!/^[a-z][a-z0-9.-]{0,95}$/.test(owner) || owner.includes(".."))
    throw platformRejection("Invalid state owner");
}

function browserState(raw: string | null): StoredState | null {
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).length > 65536)
    throw platformRejection("State exceeds experiment limit");
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw platformRejection("State is corrupt; original preserved");
  }
  if (typeof saved !== "object" || saved === null || Array.isArray(saved))
    throw platformRejection("State is corrupt; original preserved");
  const document = saved as {
    schema?: unknown;
    revision?: unknown;
    value?: unknown;
  };
  if (
    document.schema !== 1 ||
    !Number.isSafeInteger(document.revision) ||
    Number(document.revision) < 1 ||
    !Object.hasOwn(document, "value")
  )
    throw platformRejection("Unsupported or corrupt state; original preserved");
  return document as StoredState;
}

export class PlatformAdapter implements Platform {
  readonly kind = isTauri() ? "native" : "browser";
  failWrites = false;
  private readonly grants = new Map<string, Set<string>>();
  private readonly documentAccess = new DocumentAccess(
    (owner) => this.grants.get(owner)?.has("document.read") === true,
  );
  initializeDocuments() {
    return this.documentAccess.initialize(this.kind === "native");
  }
  selectDocuments(owner: string, multiple = false, signal?: AbortSignal) {
    validOwner(owner);
    return this.documentAccess.select(owner, multiple, signal);
  }
  documents(owner: string) {
    validOwner(owner);
    return this.documentAccess.list(owner);
  }
  revokeDocument(owner: string, handle?: string) {
    validOwner(owner);
    return this.documentAccess.revoke(owner, handle);
  }
  release(owner: string) {
    return this.grants.get(owner)?.has("document.read")
      ? this.revokeDocument(owner)
      : Promise.resolve();
  }
  available(capability: string) {
    if (capability === "document.read") return this.documentAccess.supported;
    return ["state.read", "state.write", "platform.info"].includes(capability);
  }
  async grant(owner: string, capabilities: string[]) {
    validOwner(owner);
    if (capabilities.some((cap) => !this.available(cap)))
      throw platformRejection("Unknown capability");
    await this.documentAccess.authorize(owner, async () => {
      if (this.kind === "native")
        await invoke("platform_grant", { owner, capabilities });
      this.grants.set(owner, new Set(capabilities));
    });
  }
  async call(
    owner: string,
    capability: string,
    payload?: unknown,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    validOwner(owner);
    if (!this.grants.get(owner)?.has(capability) || !this.available(capability))
      throw platformRejection(`Permission denied: ${capability}`);
    if (capability === "document.read") {
      if ((payload as { action?: unknown } | null)?.action === "list")
        return this.documentAccess.list(owner);
      return this.documentAccess.read(owner, payload, signal);
    }
    if (this.failWrites && capability === "state.write")
      throw platformRejection("注入的写入故障：原数据保持不变");
    if (this.kind === "native") {
      let value: unknown;
      try {
        value = await invoke("platform_call", {
          owner,
          capability,
          payload: payload ?? null,
        });
      } catch (error) {
        const failure = error as {
          message?: unknown;
          outcome?: unknown;
        } | null;
        if (
          failure?.outcome === "not-committed" &&
          typeof failure.message === "string"
        )
          throw platformRejection(failure.message);
        if (capability === "state.write")
          throw Object.assign(new Error("Native write receipt unavailable"), {
            outcome: "unknown" as const,
          });
        throw new Error(
          typeof error === "string" ? error : "Native platform call failed",
        );
      }
      // A dispatched native write is a non-cancellable commit segment. Its receipt wins.
      if (capability !== "state.write") signal?.throwIfAborted();
      return value;
    }
    if (capability === "platform.info")
      return {
        os: "browser-preview",
        arch: "unverified",
        storage: "browser-localStorage",
      };
    try {
      const key = `plums:m1:${owner}`;
      const saved = browserState(localStorage.getItem(key));
      if (capability === "state.read") return saved;
      const update = payload as StoredState | null;
      if (
        !update ||
        typeof update !== "object" ||
        !Number.isSafeInteger(update.revision) ||
        update.revision < 0 ||
        !Object.hasOwn(update, "value") ||
        ["undefined", "function", "symbol"].includes(typeof update.value)
      )
        throw platformRejection("Invalid state update");
      if (update.revision !== (saved?.revision ?? 0))
        throw platformRejection("State revision conflict; reload before retry");
      if (!Number.isSafeInteger(update.revision + 1))
        throw platformRejection("Revision limit reached");
      const document = {
        schema: 1,
        revision: update.revision + 1,
        value: update.value,
      };
      const encoded = JSON.stringify(document);
      if (new TextEncoder().encode(encoded).length > 65536)
        throw platformRejection("State exceeds experiment limit");
      signal?.throwIfAborted();
      localStorage.setItem(key, encoded);
      return document;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw platformRejection(
        error instanceof Error
          ? error.message
          : "Browser state access failed; original preserved",
      );
    }
  }
}
