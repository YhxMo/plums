import { validateDefinition } from "./definition";
import { describeWait, hostError, within, type WaitReason } from "./lifecycle";
import { Scope, message } from "./scope";
import { Registry, type ToggleArgs } from "./registry";
import { createContext, type ContextHost } from "./context";
import {
  resolveConfiguration,
  type Configuration,
} from "@modules/sdk/configuration";
import type { ExtensionDefinition, Platform, ShellBridge } from "@modules/sdk";
import { extensionOwner } from "@modules/sdk";

type Status =
  "disabled" | "waiting" | "active" | "stopping" | "failed" | "cleanup-failed";
type RecordState = {
  definition: ExtensionDefinition;
  desired: boolean;
  configuration: Configuration;
  configurationError?: string;
  status: Status;
  error?: string;
  wait?: WaitReason;
  scope?: Scope;
};

export class Host {
  private shellBridge?: ShellBridge;
  /** Attach host-owned controls; open/savePage reject while readPage reports no preference. */
  connectShell(bridge: ShellBridge) {
    if (this.shellBridge) throw hostError("Shell bridge already connected");
    this.shellBridge = bridge;
    return () => {
      if (this.shellBridge === bridge) this.shellBridge = undefined;
    };
  }
  private readonly records = new Map<string, RecordState>();
  private readonly registry = new Registry();
  private readonly grants = new Map<string, Set<string>>();
  private readonly subscribers = new Set<() => void>();
  private sequence = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly platform: Platform,
    private readonly cleanupTimeout = 800,
    private readonly describe: (error: unknown) => string = message,
  ) {
    this.contextHost = {
      registry: this.registry,
      platform,
      active: (owner) => this.record(owner).status === "active",
      granted: (id, capability) => !!this.grants.get(id)?.has(capability),
      shell: () => this.shellBridge,
      changed: () => this.changed(),
    };
  }
  private readonly contextHost: ContextHost;
  readonly subscribe = (listener: () => void) => {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  };
  readonly snapshot = () => this.sequence;
  private changed() {
    this.registry.notify(this.active);
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
      wait: record.status === "waiting" ? record.wait : undefined,
      desired: record.desired,
      resources:
        (record.scope?.disposers.length ?? 0) +
        (record.scope?.failedMounts.size ?? 0),
      tasks: record.scope?.tasks.size ?? 0,
    };
  }
  readonly serviceNames = () => [...this.registry.services.keys()];
  /** Users of active extensions that rely on `id`, and those it could be switched on for. */
  readonly users = (id: string) => this.registry.usersOf(id, this.active);
  /** Switches `extensionId` on or off for one published user; see `usersOf`. */
  readonly toggleUser = (...args: ToggleArgs) =>
    this.registry.toggleUser(this.active, ...args);
  peekService<T>(name: string, version = 1): T | undefined {
    return this.registry.providers(name, version, this.active)[0]?.value as T;
  }
  private readonly active = (owner: string) =>
    this.record(owner).status === "active";
  themes() {
    return [...this.registry.themes.values()]
      .filter(
        (t) =>
          this.record(t.owner).status === "active" &&
          this.record(t.owner).scope?.open,
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((t) => ({ ...t, colors: { ...t.colors } }));
  }
  views() {
    return [...this.registry.views.values()]
      .filter((view) => this.record(view.owner).status === "active")
      .map(
        ({
          id,
          label,
          owner,
          generation,
          presentation,
          priority,
          chrome,
          icon,
          iconProblem,
        }) => ({
          id,
          label,
          owner,
          generation,
          presentation: presentation ?? "workspace",
          priority: priority ?? 0,
          ...(chrome ? { chrome } : {}),
          ...(icon === undefined ? {} : { icon }),
          ...(iconProblem === undefined ? {} : { iconProblem }),
        }),
      );
  }
  async leaveView(id: string) {
    await this.registry.views.get(id)?.beforeLeave?.();
  }
  mountView(id: string, root: HTMLElement): () => void | Promise<void> {
    const view = this.registry.views.get(id);
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
  /** Capabilities currently granted to `id`. */
  granted = (id: string) => [...(this.grants.get(id) ?? [])];
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
        !this.registry.services.get(name)?.length &&
        providers.some(([provider]) => this.cycle(provider, next))
      )
        return true;
    }
    return false;
  }
  private waitReason(id: string): WaitReason | undefined {
    const configurationError = this.record(id).configurationError;
    if (configurationError)
      return { kind: "configuration", message: configurationError };
    const manifest = this.manifest(id);
    for (const capability of manifest.capabilities ?? []) {
      if (!this.platform.available(capability))
        return { kind: "capability-unavailable", capability };
      if (!this.grants.get(id)?.has(capability))
        return { kind: "permission", capability };
    }
    for (const [service, version] of Object.entries(manifest.requires ?? {})) {
      if (!this.registry.providers(service, version, this.active).length)
        return this.cycle(id)
          ? { kind: "cycle" }
          : { kind: "dependency", service, version };
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
          record.wait = reason;
          record.error = describeWait(reason);
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
              record.definition.activate(
                createContext(
                  this.contextHost,
                  id,
                  record.definition.manifest,
                  record.configuration.values,
                  scope,
                ),
              ),
            ),
            this.cleanupTimeout,
            "activation timeout; retry allowed",
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
          throw new Error(record.error, { cause: error });
        }
      }
    } while (progress);
    this.changed();
  }
  private dependents(id: string) {
    return [...this.records]
      .filter(
        ([consumer, entry]) =>
          ["active", "stopping", "cleanup-failed"].includes(entry.status) &&
          this.registry.relies(
            consumer,
            entry.definition.manifest.requires ?? {},
            id,
            this.active,
          ),
      )
      .map(([dependent]) => dependent);
  }
  private invalidate(id: string) {
    const affected = new Set<string>();
    // Marking each owner first lets a consumer whose providers all fail here count as dependent.
    const visit = (owner: string) => {
      if (affected.has(owner)) return;
      affected.add(owner);
      const record = this.record(owner);
      if (record.status === "active") record.status = "stopping";
      for (const dependent of this.dependents(owner)) visit(dependent);
    };
    visit(id);
    for (const owner of affected) this.record(owner).scope?.invalidate();
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
}
