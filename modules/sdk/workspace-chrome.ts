/** Chrome belongs to a workspace, not to the application-wide window. */
export interface WorkspaceChromeState {
  readonly title?: string;
  /** Extension providing the current workspace entity's contextual sidebar. */
  readonly contextOwner?: string;
  readonly sidebar?: {
    readonly label: string;
    readonly open: boolean;
    /** Dialogs can stay local on narrow screens; inline sidebars are exclusive. */
    readonly presentation?: "sidebar" | "dialog";
    toggle(source: HTMLElement): void;
    close(): void;
  };
}

export interface WorkspaceChrome {
  /** Stable snapshot until a subscription notification. */
  getSnapshot(): WorkspaceChromeState;
  subscribe(listener: () => void): () => void;
  readonly navigation?: {
    /** Callers must match the entity type before revealing an ID. */
    readonly entityType: string;
    reveal(id: string): void;
  };
}

/** A view publishes state and connects its local reveal handler while mounted. */
export function createWorkspaceChrome(entityType: string) {
  let snapshot: WorkspaceChromeState = {};
  let reveal: ((id: string) => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: WorkspaceChromeState) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish,
    connect(handler: (id: string) => void) {
      reveal = handler;
      return () => {
        if (reveal === handler) {
          reveal = undefined;
          publish({});
        }
      };
    },
    navigation: {
      entityType,
      reveal(id: string) {
        reveal?.(id);
      },
    },
  };
}

export type WorkspaceChromeController = ReturnType<
  typeof createWorkspaceChrome
>;
