import { DocumentAccess } from "./documents";
import { CredentialAccess } from "./credentials";
import { NetworkAccess } from "./network";
import { openLink } from "./links";
import { isTauri } from "@tauri-apps/api/core";
import { invokeNative } from "./native/invoke";
import { BrowserState } from "./browser-state";
import {
  isStateErrorCode,
  stateRejection,
  stateUncertain,
} from "./native/state-errors";
import {
  platformRejection,
  type Platform,
  type Appearance,
} from "@modules/sdk";

function validOwner(owner: string) {
  if (!/^[a-z][a-z0-9.-]{0,95}$/.test(owner) || owner.includes(".."))
    throw stateRejection("invalid-owner");
}

/** Capabilities that write; their native receipt is a commit. */
const writes = new Set(["state.write", "state.batch"]);
const stateCapabilities = [
  "state.read",
  ...writes,
  "records.list",
  "records.search",
  "platform.info",
];

export class PlatformAdapter implements Platform {
  readonly kind = isTauri() ? "native" : "browser";
  readonly credentials = new CredentialAccess();
  readonly network = new NetworkAccess();
  private readonly browserState = new BrowserState();
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
    if (capability === "link.open") return true;
    return stateCapabilities.includes(capability);
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
    if (capability === "link.open")
      return openLink(owner, payload, this.kind === "native");
    if (this.failWrites && writes.has(capability))
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
        if (writes.has(capability))
          throw Object.assign(new Error("Native write receipt unavailable"), {
            outcome: "unknown" as const,
          });
        throw new Error(
          typeof error === "string" ? error : "Native platform call failed",
          { cause: error },
        );
      }
      // A dispatched native write is a non-cancellable commit segment. Its receipt wins.
      if (!writes.has(capability)) signal?.throwIfAborted();
      return value;
    }
    if (capability === "platform.info")
      return {
        os: "browser-preview",
        arch: "unverified",
        storage: "browser-localStorage",
      };
    switch (capability) {
      case "state.read":
        return this.browserState.read(owner, payload);
      case "state.write":
        return this.browserState.write(owner, payload, signal);
      case "state.batch":
        return this.browserState.batch(owner, payload, signal);
      case "records.list":
        return this.browserState.list(owner, payload);
      case "records.search":
        return this.browserState.search(owner, payload);
    }
    throw stateRejection("unknown-capability");
  }
}
