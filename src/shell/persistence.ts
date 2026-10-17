import type { StoredState, ShellBridge } from "../../modules/sdk";
import type { SaveOptions } from "../../modules/agents/store";
import type { PlatformAdapter } from "../platform";
import type { Preferences } from "./persisted-state";

export function createPersistence(
  adapter: PlatformAdapter,
  initial: Preferences,
  revision: number,
) {
  let preferences = initial;
  let queue: Promise<unknown> = Promise.resolve();
  let uncertain = false;
  const save = (patch: Partial<Preferences>, options?: SaveOptions) => {
    const pending = queue.then(async () => {
      options?.signal?.throwIfAborted();
      if (uncertain)
        throw Error("保存回执未确认，请重新加载应用后再修改配置。");
      const next = {
        ...preferences,
        ...patch,
        ...(patch.layout === undefined ? {} : { layoutIntent: "explicit" }),
      };
      try {
        options?.onCommit?.();
        const receipt = (await adapter.call(
          "host.shell",
          "state.write",
          {
            revision,
            value: next,
          },
          options?.signal,
        )) as StoredState;
        revision = receipt.revision;
        preferences = next;
      } catch (error) {
        if (
          !(error instanceof Error && error.name === "AbortError") &&
          (error as { outcome?: string }).outcome !== "not-committed"
        )
          uncertain = true;
        throw error;
      }
    });
    queue = pending.catch(() => {});
    return pending;
  };
  return { save, current: () => preferences };
}

export function createShellBridge(
  persistence: ReturnType<typeof createPersistence>,
  events: EventTarget,
): ShellBridge {
  let pages =
    persistence.current().pages ??
    (Object.create(null) as Record<string, string>);
  let pageQueue: Promise<void> = Promise.resolve();
  return {
    open: async (action) => {
      events.dispatchEvent(new CustomEvent("shell", { detail: action }));
    },
    readPage: (key) => pages[key],
    savePage: (key, route) => {
      const work = pageQueue.then(async () => {
        const next = Object.assign(Object.create(null), pages, {
          [key]: route,
        });
        await persistence.save({ pages: next });
        pages = next;
      });
      pageQueue = work.catch(() => {});
      return work;
    },
  };
}
