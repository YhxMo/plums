import type { Host } from "@modules/extension-host/host";

/** One writer per outlet. Failed roots stay fenced; a fresh recovery root is allowed. */
export function createViewSlot(host: Host) {
  let queue: Promise<void> = Promise.resolve();
  let close: (() => void | Promise<void>) | undefined;
  let currentRoot: HTMLElement | undefined;
  const failedRoots = new WeakMap<HTMLElement, unknown>();
  async function release() {
    const previous = close;
    close = undefined;
    try {
      await previous?.();
    } catch (error) {
      if (currentRoot) failedRoots.set(currentRoot, error);
      throw error;
    }
  }
  return {
    show(id: string, root: HTMLElement) {
      const pending = queue.then(async () => {
        if (failedRoots.has(root)) throw failedRoots.get(root);
        await release();
        currentRoot = root;
        close = host.mountView(id, root);
      });
      queue = pending.catch(() => {});
      return pending;
    },
    clear() {
      const pending = queue.then(release);
      queue = pending.catch(() => {});
      return pending;
    },
  };
}
