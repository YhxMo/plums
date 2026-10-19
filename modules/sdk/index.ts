import type { Theme } from "./theme";
import type { WorkspaceChrome } from "./workspace-chrome";
import type { CredentialBindingDeclaration } from "./credential-bindings";
export type {
  CredentialBindingDeclaration,
  NetworkRoute,
} from "./credential-bindings";
export { createWorkspaceChrome } from "./workspace-chrome";
export type {
  WorkspaceChrome,
  WorkspaceChromeController,
  WorkspaceChromeState,
} from "./workspace-chrome";
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
  /** Display name shown in place of the ID, 1–40 characters. */
  name?: string;
  /** Plain-text description for extension management, at most 500 characters; never rendered as markup. */
  description?: string;
  requires?: Record<string, number>;
  /** Services used when some extension provides them; the extension starts and stays active without them. */
  optional?: Record<string, number>;
  provides?: Record<string, number>;
  capabilities?: string[];
  configuration?: ConfigurationDeclaration;
  /** Host-reviewed connection suggestions; never contain secrets or imply authorization. */
  credentialBindings?: Record<string, CredentialBindingDeclaration>;
}

export interface Platform {
  readonly kind: "native" | "browser";
  available(capability: string): boolean;
  grant(owner: string, capabilities: string[]): Promise<void>;
  /** Releases transient owner resources on extension shutdown; persisted state is retained. */
  release?(owner: string): Promise<void>;
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
  /** Defaults to workspace for existing extensions. Dialogs appear in the app menu; sidebars mount in the right drawer. */
  presentation?: "workspace" | "dialog" | "sidebar";
  /** Deterministic fallback among workspace views; higher wins, then id. */
  priority?: number;
  /** Optional reactive title, contextual sidebar and entity navigation. */
  chrome?: WorkspaceChrome;
  beforeLeave?: () => Promise<void>;
  /** A rejected disposer remains cleanup-failed; the host does not blindly retry it. */
  mount(root: HTMLElement): () => void | Promise<void>;
}

export type ShellAction = "extensions" | "settings" | "diagnostics";
/** Something shown to the user by name, such as an extension or an Agent. */
export type Named = { id: string; label: string };
/** A user of an extension; `uses` names providers it relies on beyond the publisher's `dependencies()`. */
export type User = Named & { uses?: string[] };
/** Lets management switch an active provider of `service`, which the publisher requires or optionally uses, on or off for one user. */
export type UserToggle = {
  service: string;
  set(userId: string, extensionId: string, on: boolean): Promise<void>;
};
/** One active provider of a service, named for the user. */
/** `signal` aborts when this provider stops, e.g. to cancel a call in flight. */
export type Provider<T> = Named & { value: T; signal: AbortSignal };
export interface ShellBridge {
  open(action: ShellAction, owner: string, target?: string): Promise<void>;
  readPage(key: string): string | undefined;
  savePage(key: string, route: string): Promise<void>;
  /** The name the user knows an extension by; the ID when omitted. */
  label?(id: string): string;
}
export interface ShellAccess {
  /** `target` selects one extension in `"extensions"`. */
  open(action: ShellAction, target?: string): Promise<void>;
  /** Returns undefined for no preference or no connected shell bridge; writes reject instead. */
  readPage(viewId: string): string | undefined;
  savePage(viewId: string, route: string): Promise<void>;
  /** This extension, then the providers it took with `use()`, transitively. */
  dependencies(): Named[];
  /** Replaces what this extension serves, e.g. its Agents; management lists them under every extension in `dependencies()` and their `uses`. Cleared on stop. */
  publishUsers(kind: string, users: User[], toggle?: UserToggle): void;
}
export interface ExtensionContext {
  readonly id: string;
  readonly signal: AbortSignal;
  readonly configuration: Readonly<Record<string, ConfigurationValue>>;
  readonly shell: ShellAccess;
  /** The oldest active provider of a required service; this extension restarts when that provider stops. */
  use<T>(name: string): T;
  /** Every active provider of a required service, oldest first; `onChange` gets the new list after one starts or stops. This extension keeps running while one remains. */
  providers<T>(
    name: string,
    onChange?: (providers: Provider<T>[]) => void,
  ): Provider<T>[];
  provide<T>(name: string, version: number, service: T): void;
  onDispose(dispose: () => void | Promise<void>): void;
  on(topic: string, handler: (data: unknown) => void): void;
  emit(topic: string, data: unknown): void;
  view(view: View): void;
  /** Registers semantic colors for this extension lifetime; duplicate ids reject. */
  theme(theme: Theme): void;
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
export type {
  SelectedDocument,
  SelectedDocumentRequest,
  SelectedDocumentResponse,
} from "./selected-document";

export type { Theme, ThemeColors, Appearance } from "./theme";
export { createPageRouter } from "./pages";
export type {
  PageContribution,
  PageSnapshot,
  PageRouter,
  PageRouterOptions,
} from "./pages";
