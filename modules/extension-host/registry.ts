import type { Theme } from "@modules/sdk/theme";
import type { Named, User, UserToggle, View } from "@modules/sdk";
import { hostError } from "./lifecycle";

export type Service = {
  owner: string;
  version: number;
  value: unknown;
  signal: AbortSignal;
};
export type RegisteredView = View & {
  /** Why `icon` was dropped, for management to show. */
  iconProblem?: string;
  owner: string;
  generation: number;
  mounts: Set<() => void | Promise<void>>;
};
export type RegisteredTheme = Theme & { owner: string; generation: number };
type Published = {
  kind: string;
  users: User[];
  toggle?: UserToggle & { version: number };
};
type Watcher = {
  name: string;
  version: number;
  last: string;
  listener: (providers: Service[]) => void;
};
type Active = (owner: string) => boolean;
export type ToggleArgs = [
  owner: string,
  userId: string,
  id: string,
  on: boolean,
];
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
  /**
   * Users of active extensions that rely on `id`, or that `id` is built on
   * (as an interface takes the extension whose users it presents); with
   * `toggle`, `id` can be switched on for `others` and off for users that
   * name it in `uses`.
   */
  usersOf(id: string, active: Active) {
    return [...this.users].flatMap(([owner, { kind, users, toggle }]) => {
      const relies =
        this.chain(owner).includes(id) ||
        (active(id) && this.chain(id).includes(owner));
      const using = (user: User) =>
        relies || !!user.uses?.some((used) => this.chain(used).includes(id));
      const offered =
        !!toggle &&
        this.providers(toggle.service, toggle.version, active).some(
          (service) => service.owner === id,
        );
      const group = {
        owner,
        kind,
        users: users.filter(using).map(named),
        others: offered ? users.filter((user) => !using(user)).map(named) : [],
        toggle: offered,
      };
      return group.users.length || group.others.length ? [group] : [];
    });
  }
  async toggleUser(active: Active, ...[owner, userId, id, on]: ToggleArgs) {
    const published = this.users.get(owner);
    const user = published?.users.find((entry) => entry.id === userId);
    const group = this.usersOf(id, active).find((g) => g.owner === owner);
    const allowed = on
      ? group?.others.some((other) => other.id === userId)
      : user?.uses?.includes(id);
    if (!published?.toggle || !group?.toggle || !allowed)
      throw hostError("Invalid toggle");
    await published.toggle.set(userId, id, on);
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
