import { hostError } from "./lifecycle";
import type { Registry, Service } from "./registry";
import type { Scope } from "./scope";
import { copyTheme } from "../sdk/theme";
import type {
  ExtensionContext,
  Manifest,
  Platform,
  Provider,
  ShellBridge,
} from "../sdk";
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
  const label = (owner: string) => host.shell()?.label?.(owner) ?? owner;
  const required = (name: string) => {
    scope.assertOpen();
    const version = manifest.requires?.[name];
    if (!version)
      throw hostError(`Service not declared or unavailable: ${name}`);
    return { version, live: registry.providers(name, version, host.active) };
  };
  return {
    id,
    signal: scope.controller.signal,
    configuration,
    shell: {
      open: async (action, target) => {
        scope.assertOpen();
        if (!["extensions", "settings", "diagnostics"].includes(action))
          throw hostError("Unknown shell action");
        if (
          target !== undefined &&
          (action !== "extensions" || typeof target !== "string")
        )
          throw hostError("Invalid shell target");
        const bridge = host.shell();
        if (!bridge) throw hostError("Shell controls unavailable");
        await (target === undefined
          ? bridge.open(action, id)
          : bridge.open(action, id, target));
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
      dependencies: () => {
        scope.assertOpen();
        return registry.chain(id).map((owner) => ({
          id: owner,
          label: label(owner),
        }));
      },
      publishUsers: (kind, users, assign) => {
        scope.assertOpen();
        const version = assign && manifest.requires?.[assign.service];
        if (
          typeof kind !== "string" ||
          !Array.isArray(users) ||
          users.some(
            (user) =>
              typeof user?.id !== "string" ||
              typeof user.label !== "string" ||
              (user.uses !== undefined &&
                (!Array.isArray(user.uses) ||
                  user.uses.some((used) => typeof used !== "string"))),
          ) ||
          (assign && (!version || typeof assign.to !== "function"))
        )
          throw hostError("Invalid users");
        const next = {
          kind,
          users: users.map(({ id, label, uses }) =>
            uses ? { id, label, uses: [...uses] } : { id, label },
          ),
          ...(assign && {
            assign: {
              service: assign.service,
              version: version!,
              to: assign.to,
            },
          }),
        };
        // Functions drop out of the comparison, so a changed `to` alone is kept.
        const previous = registry.users.get(id);
        if (
          previous?.assign?.to === next.assign?.to &&
          JSON.stringify(previous) === JSON.stringify(next)
        )
          return;
        if (!registry.users.has(id))
          own(() => {
            registry.users.delete(id);
            host.changed();
          });
        registry.users.set(id, next);
        host.changed();
      },
    },
    use: <T>(name: string) => {
      const [service] = required(name).live;
      if (!service)
        throw hostError(`Service not declared or unavailable: ${name}`);
      let bound = registry.bindings.get(id);
      if (!bound) {
        bound = new Set();
        registry.bindings.set(id, bound);
        own(() => {
          registry.bindings.delete(id);
        });
      }
      bound.add(service.owner);
      return service.value as T;
    },
    providers: <T>(
      name: string,
      onChange?: (providers: Provider<T>[]) => void,
    ) => {
      const { version, live } = required(name);
      const named = (services: Service[]) =>
        services.map(({ owner, value }) => ({
          id: owner,
          label: label(owner),
          value: value as T,
        }));
      if (onChange) {
        const watcher = {
          name,
          version,
          last: live.map((service) => service.owner).join("\n"),
          listener: (services: Service[]) => {
            if (scope.open) onChange(named(services));
          },
        };
        registry.watchers.add(watcher);
        own(() => {
          registry.watchers.delete(watcher);
        });
      }
      return named(live);
    },
    provide: (name, version, value) => {
      scope.assertOpen();
      if (manifest.provides?.[name] !== version)
        throw hostError(`Service not declared: ${name}`);
      const services = registry.services.get(name) ?? [];
      if (services.some((service) => service.owner === id))
        throw hostError(`Service already provided: ${name}`);
      const service = { owner: id, version, value };
      registry.services.set(name, [...services, service]);
      own(() => {
        const rest = (registry.services.get(name) ?? []).filter(
          (entry) => entry !== service,
        );
        if (rest.length) registry.services.set(name, rest);
        else registry.services.delete(name);
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
