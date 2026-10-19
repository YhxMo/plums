import type { Theme } from "../sdk/theme";
import type { Assignment, Named, User, View } from "../sdk";
import { hostError } from "./lifecycle";

export type Service = { owner: string; version: number; value: unknown };
export type RegisteredView = View & {
  owner: string;
  generation: number;
  mounts: Set<() => void | Promise<void>>;
};
export type RegisteredTheme = Theme & { owner: string; generation: number };
type Published = {
  kind: string;
  users: User[];
  assign?: Assignment & { version: number };
};
type Watcher = {
  name: string;
  version: number;
  last: string;
  listener: (providers: Service[]) => void;
};
type Active = (owner: string) => boolean;
const named = ({ id, label }: Named) => ({ id, label });

/** Contributions registered by active extensions, keyed by their public ids. */
export class Registry {
  /** Providers of each service, oldest first. */
  readonly services = new Map<string, Service[]>();
  readonly themes = new Map<string, RegisteredTheme>();
  readonly views = new Map<string, RegisteredView>();
  readonly events = new Map<string, Set<(data: unknown) => void>>();
  /** Providers each extension took with `use()`. */
  readonly bindings = new Map<string, Set<string>>();
  readonly users = new Map<string, Published>();
  readonly watchers = new Set<Watcher>();
  private viewSequence = 0;
  private themeSequence = 0;
  providers(name: string, version: number, active: Active) {
    return (this.services.get(name) ?? []).filter(
      (service) => service.version === version && active(service.owner),
    );
  }
  /** Whether `consumer` must stop with `id`: it took `id` with `use()`, or `id` is its last provider. */
  relies(
    consumer: string,
    requires: Record<string, number>,
    id: string,
    active: Active,
  ) {
    if (this.bindings.get(consumer)?.has(id)) return true;
    return Object.entries(requires).some(([name, version]) => {
      const live = this.providers(name, version, (o) => o === id || active(o));
      return (
        live.some((s) => s.owner === id) && live.every((s) => s.owner === id)
      );
    });
  }
  /** `id` followed by the providers it took with `use()`, transitively. */
  chain(id: string) {
    const seen = new Set<string>();
    const visit = (owner: string) => {
      if (seen.has(owner)) return;
      seen.add(owner);
      for (const provider of this.bindings.get(owner) ?? []) visit(provider);
    };
    visit(id);
    return [...seen];
  }
  /** Users of active extensions that rely on `id`, those that could be moved onto it, and where they go if `id` stops. */
  usersOf(id: string, active: Active) {
    return [...this.users].flatMap(([owner, { kind, users, assign }]) => {
      const relies = this.chain(owner).includes(id);
      const using = (user: User) =>
        relies || !!user.uses?.some((used) => this.chain(used).includes(id));
      const live = assign
        ? this.providers(assign.service, assign.version, active)
        : [];
      const offered = live.some((service) => service.owner === id);
      const group = {
        owner,
        kind,
        users: users.filter(using).map(named),
        others: offered ? users.filter((user) => !using(user)).map(named) : [],
        fallback: live.find((service) => service.owner !== id)?.owner,
      };
      return group.users.length || group.others.length ? [group] : [];
    });
  }
  async assign(owner: string, userId: string, id: string, active: Active) {
    const group = this.usersOf(id, active).find(
      (entry) => entry.owner === owner,
    );
    const assign = this.users.get(owner)?.assign;
    if (!assign || !group?.others.some((user) => user.id === userId))
      throw hostError("Invalid assignment");
    await assign.to(userId, id);
  }
  /** Calls watchers whose provider list changed. */
  notify(active: Active) {
    for (const watcher of this.watchers) {
      const providers = this.providers(watcher.name, watcher.version, active);
      const key = providers.map((service) => service.owner).join("\n");
      if (key === watcher.last) continue;
      watcher.last = key;
      try {
        watcher.listener(providers);
      } catch {
        // A consumer's failing listener must not stop the host's bookkeeping.
      }
    }
  }
  nextViewGeneration() {
    return ++this.viewSequence;
  }
  nextThemeGeneration() {
    return ++this.themeSequence;
  }
}
