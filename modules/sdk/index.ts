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
  requires?: Record<string, number>;
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
export interface ShellBridge {
  open(action: ShellAction, owner: string): Promise<void>;
  readPage(key: string): string | undefined;
  savePage(key: string, route: string): Promise<void>;
}
export interface ShellAccess {
  open(action: ShellAction): Promise<void>;
  /** Returns undefined for no preference or no connected shell bridge; writes reject instead. */
  readPage(viewId: string): string | undefined;
  savePage(viewId: string, route: string): Promise<void>;
}
export interface ExtensionContext {
  readonly id: string;
  readonly signal: AbortSignal;
  readonly configuration: Readonly<Record<string, ConfigurationValue>>;
  readonly shell: ShellAccess;
  use<T>(name: string): T;
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
