import type {
  BundleExtension,
  Manifest,
  ShellBridge,
  StoredState,
} from "@modules/sdk";
import { isPackageImport } from "@modules/shell/extension-package";
export type SaveOptions = { signal?: AbortSignal; onCommit?: () => void };
import type { PlatformAdapter } from "@/platform";
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

/** What a bundle reads from the host and the shell's package records. */
export type BundleSource = {
  manifest(id: string): Manifest | undefined;
  packages: {
    read(url: string): Promise<{ manifestText: string; main: string }>;
  };
};

export function createShellBridge(
  persistence: ReturnType<typeof createPersistence>,
  events: EventTarget,
  /** Installed extensions; imports are added to this list in place. */
  entries: readonly { id: string; label: string }[] = [],
  source?: BundleSource,
): ShellBridge {
  let pages =
    persistence.current().pages ??
    (Object.create(null) as Record<string, string>);
  let pageQueue: Promise<void> = Promise.resolve();
  return {
    open: async (action, _owner, target) => {
      events.dispatchEvent(
        new CustomEvent("shell", { detail: { action, target } }),
      );
    },
    label: (id) => entries.find((entry) => entry.id === id)?.label ?? id,
    async bundle(ids) {
      if (!source) return [];
      const found: BundleExtension[] = [];
      for (const id of ids) {
        const manifest = source.manifest(id);
        if (!manifest) continue;
        const imported = persistence
          .current()
          .imports.find((entry) => entry.id === id);
        const label =
          imported?.label ??
          entries.find((entry) => entry.id === id)?.label ??
          manifest.name ??
          id;
        const pkg =
          imported && isPackageImport(imported.url)
            ? await source.packages.read(imported.url)
            : undefined;
        found.push({
          id,
          version: manifest.version,
          label,
          ...(manifest.author && { author: manifest.author }),
          ...(manifest.license && { license: manifest.license }),
          ...(pkg && {
            package: { manifest: pkg.manifestText, main: pkg.main },
          }),
        });
      }
      return found;
    },
    // Extension management shows each package and asks; with nobody to ask,
    // nothing is installed.
    offerPackages: (owner, packages) =>
      new Promise((settle, fail) => {
        const event = new CustomEvent("offer-packages", {
          cancelable: true,
          detail: { owner, packages, settle },
        });
        if (events.dispatchEvent(event))
          fail(new Error("扩展管理不可用，无法安装 Agent 用到的扩展。"));
      }),
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
