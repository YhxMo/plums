import { vi } from "vitest";
import { Host } from "../../modules/extension-host/host";
import type {
  ExtensionDefinition,
  Platform,
  StoredState,
} from "../../modules/sdk";
import {
  importExtensionFile,
  type ExtensionState,
} from "../../modules/shell/extension-actions";
import {
  readExtensionFile,
  sourceStore,
} from "../../modules/shell/file-import";

export const id = "author.echo";
export const definition = (version = "1"): ExtensionDefinition => ({
  manifest: { id, version, apiVersion: 1 },
  activate() {},
});
export const file = (text: string) =>
  new Blob([text], { type: "text/javascript" });

export function memory() {
  const states = new Map<string, StoredState>();
  const call = vi.fn(async (capability: string, payload?: unknown) => {
    const { key, revision, value, remove } = payload as {
      key: string;
      revision?: number;
      value?: unknown;
      remove?: boolean;
    };
    if (capability === "state.read") return states.get(key) ?? null;
    if (revision !== (states.get(key)?.revision ?? 0))
      throw Object.assign(new Error("conflict"), { outcome: "not-committed" });
    if (remove) {
      states.delete(key);
      return null;
    }
    const next = { revision: revision! + 1, value: structuredClone(value) };
    states.set(key, next);
    return next;
  });
  return { states, call, sources: sourceStore(call) };
}

export function newHost() {
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: vi.fn(async () => {}),
    call: vi.fn(async () => null),
  };
  return new Host(platform);
}
export function setup() {
  const host = newHost();
  const state: ExtensionState = {
    imports: [],
    catalog: [],
    configurations: {},
    save: vi.fn(async () => {}),
  };
  return { host, state, ...memory() };
}

export async function installedImport() {
  const fixture = setup();
  const old = await readExtensionFile(file("export default 'old';"));
  const { entry } = await importExtensionFile(
    fixture.host,
    fixture.state,
    old,
    definition("1"),
    fixture.sources,
    async () => {},
  );
  return { ...fixture, old, entry };
}
