import type { Theme } from "../sdk/theme";
import type { Named, View } from "../sdk";

export type Service = { owner: string; version: number; value: unknown };
export type RegisteredView = View & {
  owner: string;
  generation: number;
  mounts: Set<() => void | Promise<void>>;
};
export type RegisteredTheme = Theme & { owner: string; generation: number };

/** Contributions registered by active extensions, keyed by their public ids. */
export class Registry {
  readonly services = new Map<string, Service>();
  readonly themes = new Map<string, RegisteredTheme>();
  readonly views = new Map<string, RegisteredView>();
  readonly events = new Map<string, Set<(data: unknown) => void>>();
  /** `dependencies()` IDs from each extension's latest activation, itself first. */
  readonly dependencies = new Map<string, string[]>();
  readonly users = new Map<string, { kind: string; users: Named[] }>();
  private viewSequence = 0;
  private themeSequence = 0;
  /** Users published by active extensions that rely on `id`. */
  usersOf(id: string) {
    return [...this.users]
      .filter(([owner]) => this.dependencies.get(owner)?.includes(id))
      .map(([owner, published]) => ({ owner, ...published }));
  }
  nextViewGeneration() {
    return ++this.viewSequence;
  }
  nextThemeGeneration() {
    return ++this.themeSequence;
  }
}
