export interface ViewNode {
  id: string;
  mount(root: HTMLElement, scope: ViewTreeScope): void | Promise<void>;
}
export interface ViewTreeScope {
  readonly signal: AbortSignal;
  /** Register before creating effects. Disposers run in reverse order. */
  onDispose(dispose: () => void | Promise<void>): void;
  mount(node: ViewNode, root: HTMLElement): Promise<void>;
}
export interface ViewTree {
  ready: Promise<void>;
  close(): Promise<void>;
}
const occupied = new WeakMap<HTMLElement, object>();

/** Opt-in fixed tree composition; callers own rendering and recovery UI. */
export function mountViewTree(root: HTMLElement, node: ViewNode): ViewTree {
  const controller = new AbortController();
  const token = {};
  const roots: HTMLElement[] = [];
  const disposers: (() => void | Promise<void>)[] = [];
  let closing = false;
  let cleaning = false;
  let cleanup: Promise<void> | undefined;
  const open = () => {
    if (closing) throw Error("View tree closed");
  };
  async function mount(
    current: ViewNode,
    target: HTMLElement,
    path: string[],
  ): Promise<void> {
    open();
    if (!current.id || path.includes(current.id))
      throw Error(`View nesting cycle: ${current.id}`);
    if (occupied.has(target)) throw Error("View root conflict");
    occupied.set(target, token);
    roots.push(target);
    const children: Promise<void>[] = [];
    let failed: unknown;
    let didFail = false;
    let rendering = true;
    try {
      await current.mount(target, {
        signal: controller.signal,
        onDispose(dispose) {
          if (cleaning || !rendering) throw Error("View registration closed");
          disposers.push(dispose);
        },
        mount(child, childRoot) {
          open();
          if (!rendering) throw Error("View registration closed");
          if (childRoot === target || !target.contains(childRoot))
            throw Error("Child root outside parent");
          const pending = mount(child, childRoot, [...path, current.id]);
          children.push(pending);
          // The tree observes even children a renderer forgets to await.
          void pending.catch(() => {
            closing = true;
            controller.abort();
          });
          return pending;
        },
      });
    } catch (error) {
      failed = error;
      didFail = true;
      closing = true;
      controller.abort();
    } finally {
      rendering = false;
    }
    const settled = await Promise.allSettled(children);
    if (didFail) throw failed;
    const rejected = settled.find((r) => r.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
  }
  const work = Promise.resolve().then(() => mount(node, root, []));
  function close(): Promise<void> {
    if (cleanup) return cleanup;
    closing = true;
    cleanup = (async () => {
      await work.catch(() => {});
      cleaning = true;
      const errors: unknown[] = [];
      for (const dispose of disposers.reverse()) {
        try {
          await dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          "View cleanup failed; restart required",
        );
      for (const target of roots)
        if (occupied.get(target) === token) occupied.delete(target);
    })();
    controller.abort();
    return cleanup;
  }
  const ready = work
    .then(() => {
      if (closing) throw Error("View tree closed");
    })
    .catch(async (error) => {
      try {
        await close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "View mount and cleanup failed",
        );
      }
      throw error;
    });
  return { ready, close };
}
