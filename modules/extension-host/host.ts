import { validateDefinition } from "./definition";
export { validateDefinition, loadExtension } from "./definition";
import { ContractError } from "../sdk/errors";
import { copyTheme, type Theme } from "../sdk/theme";
import { resolveConfiguration, type Configuration } from "../sdk/configuration";
import type {
  ExtensionContext,
  ExtensionDefinition,
  Platform,
  View,
  ShellBridge,
} from "../sdk";
import { extensionOwner, platformRejection } from "../sdk";

type Status =
  "disabled" | "waiting" | "active" | "stopping" | "failed" | "cleanup-failed";
type RecordState = {
  definition: ExtensionDefinition;
  desired: boolean;
  configuration: Configuration;
  configurationError?: string;
  status: Status;
  error?: string;
  scope?: Scope;
};
type Service = { owner: string; version: number; value: unknown };
type RegisteredView = View & {
  owner: string;
  generation: number;
  mounts: Set<() => void | Promise<void>>;
};
const hostError = (message: string) =>
  new ContractError("host.invalid", "host", message);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function within<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(hostError("cleanup timeout; restart required")),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

class Scope {
  constructor(
    private readonly describe: (error: unknown) => string = message,
  ) {}
  readonly controller = new AbortController();
  readonly tasks = new Set<Promise<unknown>>();
  readonly disposers: (() => void | Promise<void>)[] = [];
  readonly errors = new Set<string>();
  readonly failedMounts = new Set<() => void | Promise<void>>();
  private accepting = true;
  private disposed = false;
  get open() {
    return this.accepting && !this.controller.signal.aborted;
  }
  invalidate() {
    this.accepting = false;
  }
  assertOpen() {
    if (!this.open) throw hostError("Extension stopped");
  }
  async dispose(timeout: number) {
    if (this.disposed) {
      if (this.errors.size) throw new Error([...this.errors].join("; "));
      return;
    }
    this.invalidate();
    this.controller.abort();
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        await within(Promise.resolve().then(dispose), timeout);
      } catch (error) {
        this.errors.add(this.describe(error));
      }
    }
    try {
      await within(Promise.allSettled([...this.tasks]), timeout);
    } catch (error) {
      this.errors.add(this.describe(error));
    }
    this.disposed = true;
    if (this.errors.size) throw new Error([...this.errors].join("; "));
  }
}

export class Host {
  private shellBridge?: ShellBridge;
  /** Attach host-owned controls; an absent bridge explicitly rejects requests. */
  connectShell(bridge: ShellBridge) {
    if (this.shellBridge) throw hostError("Shell bridge already connected");
    this.shellBridge = bridge;
    return () => {
      if (this.shellBridge === bridge) this.shellBridge = undefined;
    };
  }
  private readonly records = new Map<string, RecordState>();
  private readonly services = new Map<string, Service>();
  private readonly registeredThemes = new Map<
    string,
    Theme & { owner: string; generation: number }
  >();
  private readonly registeredViews = new Map<string, RegisteredView>();
  private readonly events = new Map<string, Set<(data: unknown) => void>>();
  private readonly grants = new Map<string, Set<string>>();
  private readonly subscribers = new Set<() => void>();
  private sequence = 0;
  private viewSequence = 0;
  private themeSequence = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly platform: Platform,
    private readonly cleanupTimeout = 800,
    private readonly describe: (error: unknown) => string = message,
  ) {}
  readonly subscribe = (listener: () => void) => {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  };
  readonly snapshot = () => this.sequence;
  private changed() {
    this.sequence++;
    for (const listener of this.subscribers) listener();
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private record(id: string) {
    const record = this.records.get(id);
    if (!record) throw hostError(`Unknown extension: ${id}`);
    return record;
  }
  install(definition: ExtensionDefinition, configuration?: unknown) {
    validateDefinition(definition);
    const id = definition.manifest.id;
    if (this.records.has(id))
      throw hostError(`Extension already installed: ${id}`);
    let resolved: Configuration;
    let configurationError: string | undefined;
    try {
      resolved = resolveConfiguration(
        definition.manifest.configuration,
        configuration,
      );
    } catch (error) {
      resolved = resolveConfiguration(
        definition.manifest.configuration,
        undefined,
      );
      configurationError = this.describe(error);
    }
    this.records.set(id, {
      definition,
      desired: false,
      status: "disabled",
      configuration: resolved,
      configurationError,
    });
    this.changed();
  }
  configuration(id: string) {
    const record = this.record(id);
    return {
      value: {
        version: record.configuration.version,
        values: record.configuration.values,
      },
      error: record.configurationError,
    };
  }
  configure(id: string, input: unknown) {
    return this.serial(async () => {
      const record = this.record(id);
      if (record.desired || record.status !== "disabled")
        throw hostError("Stop extension before configuring");
      const value = resolveConfiguration(
        record.definition.manifest.configuration,
        input,
      );
      record.configuration = value;
      record.configurationError = undefined;
      this.changed();
    });
  }
  ids() {
    return [...this.records.keys()];
  }
  /** Removes only a cleanly stopped registration. Stored data and module files remain. */
  uninstall(id: string) {
    return this.serial(async () => {
      const record = this.record(id);
      if (record.desired || record.status !== "disabled")
        throw hostError("Stop extension successfully before uninstall");
      await this.platform.grant(extensionOwner(id), []);
      this.grants.delete(id);
      this.records.delete(id);
      this.changed();
    });
  }
  manifest(id: string) {
    return this.record(id).definition.manifest;
  }
  inspect(id: string) {
    const record = this.record(id);
    return {
      status: record.status,
      error: record.error,
      desired: record.desired,
      resources:
        (record.scope?.disposers.length ?? 0) +
        (record.scope?.failedMounts.size ?? 0),
      tasks: record.scope?.tasks.size ?? 0,
    };
  }
  serviceNames() {
    return [...this.services.keys()];
  }
  peekService<T>(name: string, version = 1): T | undefined {
    const entry = this.services.get(name);
    if (
      !entry ||
      entry.version !== version ||
      this.record(entry.owner).status !== "active"
    )
      return undefined;
    return entry.value as T;
  }
  themes() {
    return [...this.registeredThemes.values()]
      .filter(
        (t) =>
          this.record(t.owner).status === "active" &&
          this.record(t.owner).scope?.open,
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((t) => ({ ...t, colors: { ...t.colors } }));
  }
  views() {
    return [...this.registeredViews.values()]
      .filter((view) => this.record(view.owner).status === "active")
      .map(
        ({ id, label, owner, generation, presentation, priority, chrome }) => ({
          id,
          label,
          owner,
          generation,
          presentation: presentation ?? "workspace",
          priority: priority ?? 0,
          ...(chrome ? { chrome } : {}),
        }),
      );
  }
  async leaveView(id: string) {
    await this.registeredViews.get(id)?.beforeLeave?.();
  }
  mountView(id: string, root: HTMLElement): () => void | Promise<void> {
    const view = this.registeredViews.get(id);
    if (!view || this.record(view.owner).status !== "active")
      throw hostError(`View unavailable: ${id}`);
    const record = this.record(view.owner);
    const scope = record.scope!;
    scope.assertOpen();
    const unmount = view.mount(root);
    let closed = false;
    let failure: Error | undefined;
    let pending: Promise<void> | undefined;
    const released = () => {
      closed = true;
      view.mounts.delete(close);
    };
    const failed = (error: unknown): never => {
      failure = new Error(this.describe(error));
      scope.errors.add(failure.message);
      scope.failedMounts.add(close);
      record.status = "cleanup-failed";
      record.error = failure.message;
      this.invalidate(view.owner);
      this.changed();
      void this.serial(async () => {
        // Individual records retain cleanup errors; continue invalidating other dependents.
        await this.deactivate(view.owner, new Set()).catch(() => {});
        await this.reconcile();
      });
      throw failure;
    };
    const close = () => {
      if (failure) throw failure;
      if (pending) return pending;
      if (!closed) {
        try {
          const result = unmount();
          if (result) {
            pending = Promise.resolve(result).then(released, failed);
            return pending;
          }
          released();
        } catch (error) {
          return failed(error);
        }
      }
    };
    view.mounts.add(close);
    return close;
  }
  start(id: string) {
    return this.serial(async () => {
      const record = this.record(id);
      if (record.status === "cleanup-failed")
        throw hostError("Cleanup incomplete; restart required");
      if (record.status === "failed") {
        record.status = "disabled";
        record.scope = undefined;
      }
      record.desired = true;
      await this.reconcile();
    });
  }
  stop(id: string) {
    return this.serial(async () => {
      this.record(id).desired = false;
      this.invalidate(id);
      await this.deactivate(id, new Set());
      await this.reconcile();
    });
  }
  grant(id: string, capabilities: string[]) {
    return this.serial(async () => {
      const record = this.record(id);
      if (
        capabilities.some(
          (cap) => !record.definition.manifest.capabilities?.includes(cap),
        )
      )
        throw hostError("Capability not declared");
      await this.platform.grant(extensionOwner(id), capabilities);
      this.grants.set(id, new Set(capabilities));
      if (record.status === "active" && this.waitReason(id)) {
        this.invalidate(id);
        await this.deactivate(id, new Set());
      }
      await this.reconcile();
    });
  }
  private cycle(id: string, path = new Set<string>()): boolean {
    if (path.has(id)) return true;
    const next = new Set(path).add(id);
    const manifest = this.manifest(id);
    for (const name of Object.keys(manifest.requires ?? {})) {
      const providers = [...this.records].filter(
        ([, entry]) =>
          entry.desired && entry.definition.manifest.provides?.[name],
      );
      if (
        !this.services.has(name) &&
        providers.some(([provider]) => this.cycle(provider, next))
      )
        return true;
    }
    return false;
  }
  private waitReason(id: string) {
    if (this.record(id).configurationError)
      return `Configuration invalid: ${this.record(id).configurationError}`;
    const manifest = this.manifest(id);
    for (const cap of manifest.capabilities ?? []) {
      if (!this.platform.available(cap))
        return `Capability unavailable: ${cap}`;
      if (!this.grants.get(id)?.has(cap)) return `Permission required: ${cap}`;
    }
    for (const [name, version] of Object.entries(manifest.requires ?? {})) {
      if (
        this.services.get(name)?.version !== version ||
        this.record(this.services.get(name)!.owner).status !== "active"
      )
        return this.cycle(id)
          ? "Dependency cycle"
          : `Dependency unavailable: ${name}@${version}`;
    }
  }
  private async reconcile() {
    let progress: boolean;
    do {
      progress = false;
      for (const [id, record] of this.records) {
        if (
          !record.desired ||
          ["active", "stopping", "failed", "cleanup-failed"].includes(
            record.status,
          )
        )
          continue;
        const reason = this.waitReason(id);
        if (reason) {
          record.status = "waiting";
          record.error = reason;
          continue;
        }
        const scope = new Scope(this.describe);
        if (this.platform.release) {
          let released: Promise<void> | undefined;
          const release = () =>
            (released ??= Promise.resolve().then(() =>
              this.platform.release!(extensionOwner(id)),
            ));
          scope.controller.signal.addEventListener(
            "abort",
            () => {
              void release().catch(() => {});
            },
            { once: true },
          );
          scope.disposers.push(release);
        }
        record.scope = scope;
        try {
          await within(
            Promise.resolve(
              record.definition.activate(this.context(id, scope)),
            ),
            this.cleanupTimeout,
          );
          record.status = "active";
          record.error = undefined;
          progress = true;
        } catch (error) {
          record.status = "failed";
          record.error = this.describe(error);
          try {
            await scope.dispose(this.cleanupTimeout);
          } catch (cleanup) {
            record.status = "cleanup-failed";
            record.error += `; ${this.describe(cleanup)}`;
          }
          this.changed();
          throw new Error(record.error);
        }
      }
    } while (progress);
    this.changed();
  }
  private dependents(id: string) {
    return [...this.records]
      .filter(
        ([, entry]) =>
          ["active", "stopping", "cleanup-failed"].includes(entry.status) &&
          Object.keys(entry.definition.manifest.requires ?? {}).some(
            (name) => this.services.get(name)?.owner === id,
          ),
      )
      .map(([dependent]) => dependent);
  }
  private invalidate(id: string) {
    const affected = new Set<string>();
    const visit = (owner: string) => {
      if (affected.has(owner)) return;
      affected.add(owner);
      for (const dependent of this.dependents(owner)) visit(dependent);
    };
    visit(id);
    for (const owner of affected) {
      const record = this.record(owner);
      if (record.status === "active") record.status = "stopping";
      record.scope?.invalidate();
    }
    for (const owner of affected) this.record(owner).scope?.controller.abort();
    this.changed();
  }
  private async deactivate(id: string, visited: Set<string>) {
    if (visited.has(id)) return;
    visited.add(id);
    const record = this.record(id);
    const errors: string[] = [];
    for (const dependent of this.dependents(id)) {
      try {
        await this.deactivate(dependent, visited);
      } catch (error) {
        errors.push(this.describe(error));
      }
    }
    if (
      record.scope &&
      ["active", "stopping", "cleanup-failed"].includes(record.status)
    ) {
      try {
        await record.scope.dispose(this.cleanupTimeout);
        record.status = record.desired ? "waiting" : "disabled";
        record.error = undefined;
      } catch (error) {
        record.status = "cleanup-failed";
        record.error = this.describe(error);
        errors.push(record.error);
      }
    } else if (!record.desired && record.status !== "cleanup-failed")
      record.status = "disabled";
    this.changed();
    if (errors.length) throw new Error(errors.join("; "));
  }
  private context(id: string, scope: Scope): ExtensionContext {
    const manifest = this.manifest(id);
    const own = (dispose: () => void | Promise<void>) => {
      scope.assertOpen();
      scope.disposers.push(dispose);
    };
    return {
      id,
      signal: scope.controller.signal,
      configuration: this.record(id).configuration.values,
      shell: {
        open: async (action) => {
          scope.assertOpen();
          if (!["extensions", "settings", "diagnostics"].includes(action))
            throw hostError("Unknown shell action");
          if (!this.shellBridge) throw hostError("Shell controls unavailable");
          await this.shellBridge.open(action, id);
        },
        readPage: (viewId) => {
          scope.assertOpen();
          return this.shellBridge?.readPage(`${id}/${viewId}`);
        },
        savePage: async (viewId, route) => {
          scope.assertOpen();
          if (!this.shellBridge) throw hostError("Shell controls unavailable");
          await this.shellBridge.savePage(`${id}/${viewId}`, route);
        },
      },
      use: <T>(name: string) => {
        scope.assertOpen();
        const service = this.services.get(name);
        if (
          !manifest.requires?.[name] ||
          service?.version !== manifest.requires[name] ||
          this.record(service.owner).status !== "active"
        )
          throw hostError(`Service not declared or unavailable: ${name}`);
        return service.value as T;
      },
      provide: (name, version, value) => {
        scope.assertOpen();
        if (manifest.provides?.[name] !== version)
          throw hostError(`Service not declared: ${name}`);
        if (this.services.has(name))
          throw hostError(`Service already provided: ${name}`);
        this.services.set(name, { owner: id, version, value });
        own(() => {
          this.services.delete(name);
        });
      },
      onDispose: own,
      on: (topic, handler) => {
        scope.assertOpen();
        let listeners = this.events.get(topic);
        if (!listeners) {
          listeners = new Set();
          this.events.set(topic, listeners);
        }
        const listener = (data: unknown) => {
          if (scope.open) handler(data);
        };
        listeners.add(listener);
        own(() => {
          listeners.delete(listener);
          if (!listeners.size) this.events.delete(topic);
        });
      },
      emit: (topic, data) => {
        for (const listener of [...(this.events.get(topic) ?? [])]) {
          if (!scope.open) break;
          listener(data);
        }
      },
      theme: (input) => {
        scope.assertOpen();
        const theme = copyTheme(input);
        scope.assertOpen();
        if (this.registeredThemes.has(theme.id))
          throw hostError(`Theme conflict: ${theme.id}`);
        this.registeredThemes.set(theme.id, {
          ...theme,
          owner: id,
          generation: ++this.themeSequence,
        });
        own(() => {
          this.registeredThemes.delete(theme.id);
        });
        this.changed();
      },
      view: (view) => {
        scope.assertOpen();
        if (this.registeredViews.has(view.id))
          throw hostError(`View conflict: ${view.id}`);
        const registered = {
          ...view,
          owner: id,
          generation: ++this.viewSequence,
          mounts: new Set<() => void | Promise<void>>(),
        };
        this.registeredViews.set(view.id, registered);
        own(async () => {
          const errors: unknown[] = [];
          for (const close of [...registered.mounts]) {
            try {
              await close();
            } catch (error) {
              errors.push(error);
            }
          }
          this.registeredViews.delete(view.id);
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
        this.changed();
        void task
          .finally(() => {
            scope.tasks.delete(task);
            this.changed();
          })
          .catch(() => {});
        return task;
      },
      platform: async (capability, payload, operationSignal) => {
        if (!scope.open) throw platformRejection("Extension stopped");
        if (!manifest.capabilities?.includes(capability))
          throw platformRejection(`Capability not declared: ${capability}`);
        if (
          !this.grants.get(id)?.has(capability) ||
          !this.platform.available(capability)
        )
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
          return await this.platform.call(
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
}
