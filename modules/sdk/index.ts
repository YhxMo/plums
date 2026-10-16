import type {
  ConfigurationDeclaration,
  ConfigurationValue,
} from "./configuration";
export type {
  Configuration,
  ConfigurationDeclaration,
  ConfigurationField,
  ConfigurationValue,
} from "./configuration";
/** M1 experimental contract. Version 1 is an exact compatibility check, not a stable SDK promise. */
export interface Manifest {
  id: string;
  version: string;
  apiVersion: 1;
  requires?: Record<string, number>;
  provides?: Record<string, number>;
  capabilities?: string[];
  configuration?: ConfigurationDeclaration;
}

export interface Platform {
  readonly kind: "native" | "browser";
  available(capability: string): boolean;
  grant(owner: string, capabilities: string[]): Promise<void>;
  /** A write receipt confirms commit. AbortError / not-committed guarantee no commit;
   * other write failures are unknown. Cancellation cannot revoke a confirmed write. */
  call(
    owner: string,
    capability: string,
    payload?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export interface View {
  id: string;
  label: string;
  /** A rejected disposer remains cleanup-failed; the host does not blindly retry it. */
  mount(root: HTMLElement): () => void | Promise<void>;
}

export interface ExtensionContext {
  readonly id: string;
  readonly signal: AbortSignal;
  readonly configuration: Readonly<Record<string, ConfigurationValue>>;
  use<T>(name: string): T;
  provide<T>(name: string, version: number, service: T): void;
  onDispose(dispose: () => void | Promise<void>): void;
  on(topic: string, handler: (data: unknown) => void): void;
  emit(topic: string, data: unknown): void;
  view(view: View): void;
  task<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Combines operation cancellation with extension lifetime; adapter commit limits apply. */
  platform(
    capability: string,
    payload?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export interface ExtensionDefinition {
  manifest: Manifest;
  activate(context: ExtensionContext): void | Promise<void>;
}

export interface StoredState {
  revision: number;
  value: unknown;
}

export function platformRejection(message: string) {
  return Object.assign(new Error(message), {
    outcome: "not-committed" as const,
  });
}

/** Storage/authorization identity is separate from the public extension id. */
export function extensionOwner(id: string) {
  return `extension.${id}`;
}

export type {
  CredentialRequest,
  CredentialResponse,
  CredentialFailureOutcome,
} from "./credential";
export { migrateState, restorePreviousState } from "./state-migration";
export type {
  StateMigration,
  StateRestore,
  VersionedState,
} from "./state-migration";
export { mountViewTree } from "./view-tree";
export type { ViewNode, ViewTreeScope, ViewTree } from "./view-tree";
export { resolveNavigation } from "./navigation";
export type { NavigationEntry } from "./navigation";
