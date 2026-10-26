/** Chrome belongs to a workspace, not to the application-wide window. */
export interface WorkspaceChromeState {
  readonly title?: string;
  /**
   * `own`: the view draws its own cards in the content area, inset by
   * `--pane-gap` with a `--pane-header` tall header at the top right, so
   * the shell leaves the area bare and centres its sidebar button on that
   * header. Absent: the shell frames the view in one card.
   */
  readonly frame?: "own";
  /** Return one level inside the active workspace; absent at its root. */
  readonly back?: () => void;
  /** Extension providing the current workspace entity's contextual sidebar. */
  readonly contextOwner?: string;
  readonly sidebar?: {
    readonly label: string;
    readonly open: boolean;
    toggle(source: HTMLElement): void;
    close(): void;
  };
  /**
   * What files dragged anywhere over the shown workspace do. Absent leaves
   * them refused; without `add` they are refused and `label` says why.
   */
  readonly drop?: {
    readonly label: string;
    add?(files: readonly File[]): void;
  };
  /**
   * What the application menu's workspace commands do here (⌘N, ⌘F). Only
   * the shown workspace is asked, and only when no dialog covers it; a
   * command left out does nothing.
   */
  readonly commands?: {
    /** Start making this workspace's kind of entity. */
    new?(): void;
    /** Move to this workspace's search. */
    find?(): void;
  };
}

export interface WorkspaceChrome {
  /** Stable snapshot until a subscription notification. */
  getSnapshot(): WorkspaceChromeState;
  subscribe(listener: () => void): () => void;
  /** Host-owned workspace visibility; optional for earlier views. */
  readonly visibility?: {
    getSnapshot(): boolean;
    subscribe(listener: () => void): () => void;
    set(visible: boolean): void;
  };
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
  // Standalone mounts remain visible unless their host says otherwise.
  let visible = true;
  const visibilityListeners = new Set<() => void>();
  const publish = (next: WorkspaceChromeState) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    visibility: {
      getSnapshot: () => visible,
      subscribe(listener: () => void) {
        visibilityListeners.add(listener);
        return () => {
          visibilityListeners.delete(listener);
        };
      },
      set(next: boolean) {
        if (visible === next) return;
        visible = next;
        visibilityListeners.forEach((listener) => listener());
      },
    },
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
