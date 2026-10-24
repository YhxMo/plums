import { vi } from "vitest";
import { Host } from "../../modules/extension-host/host";
import type { ExtensionDefinition, Platform } from "../../modules/sdk";
import {
  importExtensionPackage,
  type ExtensionState,
} from "../../modules/shell/extension-actions";
import {
  packageStore,
  readPackage,
  type PackageFile,
} from "../../modules/shell/extension-package";
import { BrowserState } from "../../src/browser-state";

export const id = "author.echo";
export const manifest = (version = "1") => ({
  id,
  version,
  apiVersion: 1 as const,
});
export const definition = (version = "1"): ExtensionDefinition => ({
  manifest: manifest(version),
  activate() {},
});
/** A package's files, as a folder or a zip yields them. */
export const files = (
  main = "export default { activate() {} };\n",
  manifestText = JSON.stringify(manifest()),
  folder = "",
): PackageFile[] => [
  { path: `${folder}manifest.json`, data: new Blob([manifestText]) },
  { path: `${folder}main.js`, data: new Blob([main]) },
];

/** The shell's storage on the browser preview's rules, in memory. */
export function memory() {
  const storage = new Map<string, string>();
  const state = new BrowserState(
    () =>
      ({
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      }) as Storage,
  );
  const call = vi.fn(async (capability: string, payload?: unknown) => {
    if (capability === "records.list") return state.list("host.shell", payload);
    if (capability === "state.batch") return state.batch("host.shell", payload);
    throw new Error(`unexpected ${capability}`);
  });
  /** Stored packages, by collection. */
  const stored = () => {
    const raw = storage.get("plums:host.shell#records");
    return raw
      ? (JSON.parse(raw) as { records: { collection: string; value: never }[] })
          .records
      : [];
  };
  return { storage, call, packages: packageStore(call), stored };
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
  const old = await readPackage(files("export default 'old';"));
  const { entry } = await importExtensionPackage(
    fixture.host,
    fixture.state,
    old,
    definition("1"),
    fixture.packages,
    async () => {},
  );
  return { ...fixture, old, entry };
}
