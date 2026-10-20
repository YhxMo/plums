import { DocumentAccess } from "./documents";
import { CredentialAccess } from "./credentials";
import { NetworkAccess } from "./network";
import { isTauri } from "@tauri-apps/api/core";
import { invokeNative } from "./native/invoke";
import {
  isStateErrorCode,
  stateRejection,
  stateUncertain,
} from "./native/state-errors";
import {
  platformRejection,
  type Platform,
  type StoredState,
  type Appearance,
} from "../modules/sdk";

function validOwner(owner: string) {
  if (!/^[a-z][a-z0-9.-]{0,95}$/.test(owner) || owner.includes(".."))
    throw stateRejection("invalid-owner");
}

/** Same key rule as the native Broker; `+` separates owner and key. */
function storageKey(owner: string, payload: unknown) {
  const key = (payload as { key?: unknown } | null | undefined)?.key;
  if (key === undefined || key === null) return `plums:m1:${owner}`;
  if (typeof key !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(key))
    throw stateRejection("invalid-key");
  return `plums:m1:${owner}+${key}`;
}

function browserState(raw: string | null): StoredState | null {
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).length > 65536)
    throw stateRejection("state-too-large");
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw stateRejection("state-corrupt");
  }
  if (typeof saved !== "object" || saved === null || Array.isArray(saved))
    throw stateRejection("state-corrupt");
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
    throw stateRejection("state-schema");
  return document as StoredState;
}

export class PlatformAdapter implements Platform {
  readonly kind = isTauri() ? "native" : "browser";
  readonly credentials = new CredentialAccess();
  readonly network = new NetworkAccess();
  failWrites = false;
  async setTheme(theme: Appearance) {
    await invokeNative("shell_set_theme", { theme });
  }
  private readonly grants = new Map<string, Set<string>>();
  private readonly documentAccess = new DocumentAccess(
    (owner) => this.grants.get(owner)?.has("document.read") === true,
  );
  get documentsInitializationError() {
    return this.documentAccess.initializationError;
  }
  get credentialsInitializationError() {
    return this.credentials.initializationError;
  }
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
  async release(owner: string) {
    const granted = this.grants.get(owner);
    await Promise.all([
      granted?.has("document.read") && this.revokeDocument(owner),
      granted?.has("credential.request") && this.credentials.release(owner),
      granted?.has("network.read") && this.network.release(owner),
    ]);
  }
  available(capability: string) {
    if (capability === "document.read") return this.documentAccess.supported;
    if (
      capability === "credential.request" ||
      capability === "credential.connect"
    )
      return this.kind === "native" && this.credentials.supported;
    if (capability === "network.read") return this.kind === "native";
    return ["state.read", "state.write", "platform.info"].includes(capability);
  }
  async grant(owner: string, capabilities: string[]) {
    validOwner(owner);
    if (capabilities.some((cap) => !this.available(cap)))
      throw stateRejection("unknown-capability");
    await this.documentAccess.authorize(owner, async () => {
      if (this.kind === "native") {
        try {
          await invokeNative("platform_grant", { owner, capabilities });
        } catch (error) {
          if (isStateErrorCode(error)) throw stateRejection(error);
          throw error;
        }
      }
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
    if (capability === "credential.request")
      return this.credentials.request(owner, payload, signal);
    if (capability === "credential.connect")
      return this.credentials.connect(owner, payload);
    if (capability === "network.read")
      return this.network.read(owner, payload, signal);
    if (this.failWrites && capability === "state.write")
      throw platformRejection("注入的写入故障：原数据保持不变");
    if (this.kind === "native") {
      let value: unknown;
      try {
        value = await invokeNative("platform_call", {
          owner,
          capability,
          payload: payload ?? null,
        });
      } catch (error) {
        const failure = error as { code?: unknown; outcome?: unknown } | null;
        if (
          failure?.outcome === "not-committed" &&
          isStateErrorCode(failure.code)
        )
          throw stateRejection(failure.code);
        if (failure?.outcome === "unknown" && isStateErrorCode(failure.code))
          throw stateUncertain(failure.code);
        if (capability === "state.write")
          throw Object.assign(new Error("Native write receipt unavailable"), {
            outcome: "unknown" as const,
          });
        throw new Error(
          typeof error === "string" ? error : "Native platform call failed",
          { cause: error },
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
      const key = storageKey(owner, payload);
      const saved = browserState(localStorage.getItem(key));
      if (capability === "state.read") return saved;
      const update = payload as (StoredState & { remove?: unknown }) | null;
      if (
        !update ||
        typeof update !== "object" ||
        !Number.isSafeInteger(update.revision) ||
        update.revision < 0
      )
        throw stateRejection("missing-revision");
      if (update.revision !== (saved?.revision ?? 0))
        throw stateRejection("revision-conflict");
      if (update.remove === true) {
        signal?.throwIfAborted();
        if (saved) localStorage.removeItem(key);
        return null;
      }
      if (
        !Object.hasOwn(update, "value") ||
        ["undefined", "function", "symbol"].includes(typeof update.value)
      )
        throw stateRejection("missing-value");
      if (!Number.isSafeInteger(update.revision + 1))
        throw stateRejection("revision-limit");
      const document = {
        schema: 1,
        revision: update.revision + 1,
        value: update.value,
      };
      const encoded = JSON.stringify(document);
      if (new TextEncoder().encode(encoded).length > 65536)
        throw stateRejection("state-too-large");
      signal?.throwIfAborted();
      localStorage.setItem(key, encoded);
      return document;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (isStateErrorCode((error as { code?: unknown } | null)?.code))
        throw error;
      throw stateRejection(
        capability === "state.write" ? "state-write" : "state-read",
      );
    }
  }
}
