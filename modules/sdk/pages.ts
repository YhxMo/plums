import { resolveNavigation, type NavigationEntry } from "./navigation";
import { mountViewTree, type ViewNode, type ViewTree } from "./view-tree";

export interface PageContribution {
  id: string;
  route: string;
  label: string;
  priority: number;
  node: ViewNode;
}
export interface PageSnapshot {
  route?: string;
  entries: NavigationEntry[];
  conflicts: { route: string; winner: string; others: string[] }[];
  missing?: string;
  busy: boolean;
  error?: string;
}
export interface PageRouterOptions {
  signal?: AbortSignal;
  initialRoute?: string;
  save?: (route: string) => Promise<void>;
  /** Cancel pending work and await any dispatched commit before leaving. */
  beforeLeave?: () => Promise<void>;
}

/** Optional page controller. Business data and page markup remain extension owned. */
export function createPageRouter(options: PageRouterOptions = {}) {
  const pages = new Map<string, PageContribution>();
  const listeners = new Set<() => void>();
  const history: string[] = [];
  const positions = new Map<
    string,
    { focus?: string; scroll: [string, number][] }
  >();
  let preferred = options.initialRoute;
  let root: HTMLElement | undefined;
  let element: HTMLElement | undefined;
  let tree: ViewTree | undefined;
  let mountedId: string | undefined;
  let closing = false;
  let detaching = 0;
  let closed: Promise<void> | undefined;
  let cleanupFailure: unknown;
  let queue: Promise<unknown> = Promise.resolve();
  let state: PageSnapshot = { entries: [], conflicts: [], busy: false };
  const publish = (patch: Partial<PageSnapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const assertOpen = () => {
    if (closing) throw Error("Page router closed");
    if (cleanupFailure) throw cleanupFailure;
  };
  const serial = <T>(operation: () => Promise<T>) => {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  };
  function remember(returnFocus?: string) {
    if (!element || !state.route) return;
    const active = document.activeElement as HTMLElement | null;
    positions.set(state.route, {
      focus:
        returnFocus ??
        (active && element.contains(active)
          ? active.dataset.pageFocus
          : undefined),
      scroll: [
        ...element.querySelectorAll<HTMLElement>("[data-page-scroll]"),
      ].map((node) => [node.dataset.pageScroll!, node.scrollTop]),
    });
  }
  async function release(returnFocus?: string) {
    if (!tree) return;
    remember(returnFocus);
    try {
      await tree.close();
    } catch (error) {
      cleanupFailure = error;
      throw error;
    }
    element?.remove();
    tree = undefined;
    element = undefined;
    mountedId = undefined;
  }
  async function render() {
    const selected = state.entries.find((entry) => entry.route === state.route);
    if (!root || detaching || selected?.id === mountedId) return;
    await release();
    if (!selected || closing || detaching) return;
    const contribution = pages.get(selected.id)!;
    element = document.createElement("section");
    element.tabIndex = -1;
    element.style.height = "100%";
    element.dataset.pageHost = contribution.route;
    root.append(element);
    tree = mountViewTree(element, contribution.node);
    try {
      await tree.ready;
    } catch (error) {
      // close() retains any cleanup failure and prevents replacement.
      await release();
      throw error;
    }
    mountedId = selected.id;
    const position = positions.get(contribution.route);
    for (const node of element.querySelectorAll<HTMLElement>(
      "[data-page-scroll]",
    )) {
      node.scrollTop =
        position?.scroll.find(
          ([key]) => key === node.dataset.pageScroll,
        )?.[1] ?? 0;
    }
    const focus = position?.focus
      ? [...element.querySelectorAll<HTMLElement>("[data-page-focus]")].find(
          (node) => node.dataset.pageFocus === position.focus,
        )
      : undefined;
    (
      focus ??
      element.querySelector<HTMLElement>("[autofocus], h1, h2") ??
      element
    ).focus({ preventScroll: true });
  }
  async function refresh() {
    const entries = [...pages.values()].map(({ node: _, ...entry }) => ({
      ...entry,
      viewId: entry.id,
    }));
    const choice = resolveNavigation(
      entries,
      entries.some((entry) => entry.route === preferred)
        ? preferred
        : state.route,
    );
    if (tree && choice.selected?.id !== mountedId) {
      await leave();
      await release();
    }
    publish({
      entries: choice.winners,
      conflicts: choice.conflicts,
      route: choice.selected?.route,
      missing:
        preferred && !choice.winners.some((entry) => entry.route === preferred)
          ? preferred
          : undefined,
    });
    await render();
  }
  async function leave() {
    await options.beforeLeave?.();
  }
  async function change(route: string, push: boolean, returnFocus?: string) {
    assertOpen();
    if (!state.entries.some((entry) => entry.route === route))
      throw Error(`Page unavailable: ${route}`);
    if (state.route === route && preferred === route) return;
    publish({ busy: true, error: undefined });
    try {
      await leave();
      assertOpen();
      await options.save?.(route);
      assertOpen();
      const previous = state.route;
      // Capture focus while the old route still owns the DOM.
      await release(returnFocus);
      if (push && previous) history.push(previous);
      preferred = route;
      await refresh();
    } catch (error) {
      publish({ error: String(error) });
      throw error;
    } finally {
      publish({ busy: false });
    }
  }
  // Abort a mount that is still waiting for its scope signal. Scheduling this
  // behind ready would make cooperative asynchronous mounts wait forever.
  function interruptMount() {
    if (tree && !mountedId) void tree.close().catch(() => {});
  }
  function close(): Promise<void> {
    if (closed) return closed;
    closing = true;
    interruptMount();
    closed = serial(async () => {
      await leave();
      await release();
      pages.clear();
      publish({ route: undefined, entries: [], conflicts: [] });
      listeners.clear();
      root = undefined;
      options.signal?.removeEventListener("abort", aborted);
    });
    return closed;
  }
  function aborted() {
    void close().catch(() => {});
  }
  const router = {
    snapshot: () => state,
    subscribe(listener: () => void) {
      assertOpen();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register(input: PageContribution): Promise<() => Promise<void>> {
      return serial(async () => {
        assertOpen();
        if (pages.has(input.id) || typeof input.node?.mount !== "function")
          throw Error(`Invalid or duplicate page: ${input.id}`);
        const contribution = { ...input, node: { ...input.node } };
        resolveNavigation([{ ...contribution, viewId: contribution.id }]);
        pages.set(contribution.id, contribution);
        if (!preferred) preferred = contribution.route;
        try {
          await refresh();
        } catch (error) {
          pages.delete(contribution.id);
          if (!cleanupFailure) await refresh();
          publish({ error: String(error) });
          throw error;
        }
        let removed = false;
        return () =>
          serial(async () => {
            if (removed) return;
            removed = true;
            if (!closing && mountedId === contribution.id) {
              await leave();
              await release();
            }
            pages.delete(contribution.id);
            if (!closing) await refresh();
          });
      });
    },
    navigate: (route: string, returnFocus?: string) =>
      serial(() => change(route, true, returnFocus)),
    reload: () =>
      serial(async () => {
        assertOpen();
        await leave();
        await release();
        await render();
      }),
    back: (fallbackRoute?: string) =>
      serial(async () => {
        assertOpen();
        let index = history.length - 1;
        while (
          index >= 0 &&
          !state.entries.some((entry) => entry.route === history[index])
        )
          index--;
        if (index < 0) {
          if (fallbackRoute) await change(fallbackRoute, false);
          return;
        }
        await change(history[index], false);
        history.splice(index);
      }),
    mount(target: HTMLElement) {
      return serial(async () => {
        assertOpen();
        if (root) throw Error("Page router already mounted");
        root = target;
        await refresh();
      });
    },
    detach() {
      detaching++;
      interruptMount();
      return serial(async () => {
        try {
          await leave();
          await release();
          root = undefined;
        } finally {
          detaching--;
        }
      });
    },
    close,
  };
  options.signal?.addEventListener("abort", aborted, { once: true });
  if (options.signal?.aborted) aborted();
  return router;
}

export type PageRouter = ReturnType<typeof createPageRouter>;
