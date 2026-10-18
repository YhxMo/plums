import { hostError } from "./lifecycle";
import type { Registry } from "./registry";
import type { Scope } from "./scope";
import { copyTheme } from "../sdk/theme";
import type { ExtensionContext, Manifest, Platform, ShellBridge } from "../sdk";
import { extensionOwner, platformRejection } from "../sdk";

/** The Host facts an activation context may consult; everything else stays private. */
export type ContextHost = {
  registry: Registry;
  platform: Platform;
  active(owner: string): boolean;
  granted(id: string, capability: string): boolean;
  shell(): ShellBridge | undefined;
  changed(): void;
};

/** Build the `ctx` handed to `activate`; every registration is owned by `scope`. */
export function createContext(
  host: ContextHost,
  id: string,
  manifest: Manifest,
  configuration: ExtensionContext["configuration"],
  scope: Scope,
): ExtensionContext {
  const { registry, platform } = host;
  const own = (dispose: () => void | Promise<void>) => scope.own(dispose);
  return {
    id,
    signal: scope.controller.signal,
    configuration,
    shell: {
      open: async (action) => {
        scope.assertOpen();
        if (!["extensions", "settings", "diagnostics"].includes(action))
          throw hostError("Unknown shell action");
        const bridge = host.shell();
        if (!bridge) throw hostError("Shell controls unavailable");
        await bridge.open(action, id);
      },
      readPage: (viewId) => {
        scope.assertOpen();
        return host.shell()?.readPage(`${id}/${viewId}`);
      },
      savePage: async (viewId, route) => {
        scope.assertOpen();
        const bridge = host.shell();
        if (!bridge) throw hostError("Shell controls unavailable");
        await bridge.savePage(`${id}/${viewId}`, route);
      },
    },
    use: <T>(name: string) => {
      scope.assertOpen();
      const service = registry.services.get(name);
      if (
        !manifest.requires?.[name] ||
        service?.version !== manifest.requires[name] ||
        !host.active(service.owner)
      )
        throw hostError(`Service not declared or unavailable: ${name}`);
      return service.value as T;
    },
    provide: (name, version, value) => {
      scope.assertOpen();
      if (manifest.provides?.[name] !== version)
        throw hostError(`Service not declared: ${name}`);
      if (registry.services.has(name))
        throw hostError(`Service already provided: ${name}`);
      registry.services.set(name, { owner: id, version, value });
      own(() => {
        registry.services.delete(name);
      });
    },
    onDispose: own,
    on: (topic, handler) => {
      scope.assertOpen();
      let listeners = registry.events.get(topic);
      if (!listeners) {
        listeners = new Set();
        registry.events.set(topic, listeners);
      }
      const listener = (data: unknown) => {
        if (scope.open) handler(data);
      };
      listeners.add(listener);
      own(() => {
        listeners.delete(listener);
        if (!listeners.size) registry.events.delete(topic);
      });
    },
    emit: (topic, data) => {
      for (const listener of [...(registry.events.get(topic) ?? [])]) {
        if (!scope.open) break;
        listener(data);
      }
    },
    theme: (input) => {
      scope.assertOpen();
      const theme = copyTheme(input);
      scope.assertOpen();
      if (registry.themes.has(theme.id))
        throw hostError(`Theme conflict: ${theme.id}`);
      registry.themes.set(theme.id, {
        ...theme,
        owner: id,
        generation: registry.nextThemeGeneration(),
      });
      own(() => {
        registry.themes.delete(theme.id);
      });
      host.changed();
    },
    view: (view) => {
      scope.assertOpen();
      if (registry.views.has(view.id))
        throw hostError(`View conflict: ${view.id}`);
      const registered = {
        ...view,
        owner: id,
        generation: registry.nextViewGeneration(),
        mounts: new Set<() => void | Promise<void>>(),
      };
      registry.views.set(view.id, registered);
      own(async () => {
        const errors: unknown[] = [];
        for (const close of [...registered.mounts]) {
          try {
            await close();
          } catch (error) {
            errors.push(error);
          }
        }
        registry.views.delete(view.id);
        if (errors.length) throw errors[0];
      });
    },
    task: <T>(run: (signal: AbortSignal) => Promise<T>) => {
      scope.assertOpen();
      const task = Promise.resolve().then(() => {
        scope.assertOpen();
        return run(scope.controller.signal);
      });
      scope.tasks.add(task);
      host.changed();
      void task
        .finally(() => {
          scope.tasks.delete(task);
          host.changed();
        })
        .catch(() => {});
      return task;
    },
    platform: async (capability, payload, operationSignal) => {
      if (!scope.open) throw platformRejection("Extension stopped");
      if (!manifest.capabilities?.includes(capability))
        throw platformRejection(`Capability not declared: ${capability}`);
      if (!host.granted(id, capability) || !platform.available(capability))
        throw platformRejection(
          `Permission denied or unavailable: ${capability}`,
        );
      const controller = new AbortController();
      const signals = operationSignal
        ? [scope.controller.signal, operationSignal]
        : [scope.controller.signal];
      const abort = () => controller.abort();
      for (const signal of signals) {
        if (signal.aborted) controller.abort();
        signal.addEventListener("abort", abort, { once: true });
      }
      try {
        controller.signal.throwIfAborted();
        return await platform.call(
          extensionOwner(id),
          capability,
          payload,
          controller.signal,
        );
      } finally {
        for (const signal of signals)
          signal.removeEventListener("abort", abort);
      }
    },
  };
}
