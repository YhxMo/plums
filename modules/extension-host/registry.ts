import type { Theme } from "../sdk/theme";
import type { View } from "../sdk";

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
  private viewSequence = 0;
  private themeSequence = 0;
  nextViewGeneration() {
    return ++this.viewSequence;
  }
  nextThemeGeneration() {
    return ++this.themeSequence;
  }
}
