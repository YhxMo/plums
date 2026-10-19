import type { Host } from "../extension-host/host";
import { captureComposition, type Composition } from "./composition";
import type { ImportedExtension } from "./uninstall";
import { uninstallImport } from "./uninstall";
import { saveConfiguration } from "./configuration";
import { loadExtension } from "../extension-host/definition";
import { sameOrigin } from "../sdk/validation";
import { extensionOwner } from "../sdk";
import type { ConfigurationValue } from "../sdk/configuration";
import type { ExtensionDefinition } from "../sdk";
import {
  isFileImport,
  loadExtensionSource,
  type ExtensionFile,
  type LoadSource,
  type SourceStore,
} from "./file-import";

export type ExtensionSavePatch = {
  imports?: ImportedExtension[];
  configurations?: Record<string, unknown>;
  composition?: Composition;
  layout?: string;
};

export type ExtensionState = {
  imports: ImportedExtension[];
  catalog: ImportedExtension[];
  configurations: Record<string, unknown>;
  composition?: Composition;
  save(patch: ExtensionSavePatch): Promise<void>;
};

type Loader = (
  url: string,
  id: string,
) => Promise<Parameters<Host["install"]>[0]>;

export async function installExtension(
  host: Pick<Host, "ids" | "install">,
  state: Pick<
    ExtensionState,
    "imports" | "catalog" | "configurations" | "save"
  >,
  input: { id: string; url: string; baseUrl: string },
  load: Loader = loadExtension,
) {
  const target = sameOrigin(input.url, input.baseUrl);
  if (!target)
    throw Error(
      "当前 M1 仅加载本地可信 ESM 模块。请将扩展放入应用目录后填写模块路径。",
    );
  const definition = await load(target.href, input.id);
  if (host.ids().includes(input.id)) throw Error("此扩展 ID 已存在。");
  const entry: ImportedExtension = {
    id: input.id,
    url: target.pathname + target.search,
    label: input.id,
  };
  const imports = [
    ...state.imports.filter((saved) => saved.id !== input.id),
    entry,
  ];
  await state.save({ imports });
  state.imports = imports;
  host.install(definition, state.configurations[input.id]);
  state.catalog.push(entry);
  return entry;
}

type RemovalHost = Pick<Host, "ids" | "manifest">;
type RemovalState = Pick<ExtensionState, "imports" | "composition" | "save">;
type PrepareUninstall = (owner: string, declared: boolean) => Promise<void>;
const notCommitted = (error: unknown) =>
  (error as { outcome?: string } | null)?.outcome === "not-committed";

/**
 * Installs a file the user imported, or replaces an earlier import with the
 * same ID, including one whose code failed to load. The source is stored
 * before the shell record that references it. A replaced extension is
 * stopped, its grants revoked, its credential bindings disabled and its
 * entry dropped from the saved composition first; it stays disabled until
 * the user enables and authorizes the new code.
 */
export async function importExtensionFile(
  host: RemovalHost & Pick<Host, "install" | "stop" | "grant" | "uninstall">,
  state: RemovalState & Pick<ExtensionState, "catalog" | "configurations">,
  file: ExtensionFile,
  definition: ExtensionDefinition,
  sources: SourceStore,
  prepareUninstall: PrepareUninstall,
) {
  const id = definition.manifest.id;
  const previous = state.imports.find((entry) => entry.id === id);
  const installed = host.ids().includes(id);
  if (!previous && installed)
    throw Error("此 ID 属于内置扩展，不能用导入的文件替换。");
  const replacing = !!previous && installed;
  await sources.write(file);
  // The new source goes again when no record referencing it was saved.
  const discard = async () => {
    if (previous?.url !== file.url) await sources.remove(file.url);
  };
  if (replacing) {
    await host.stop(id);
    await host.grant(id, []);
  }
  const entry: ImportedExtension = { id, url: file.url, label: id };
  const imports = [...state.imports.filter((saved) => saved.id !== id), entry];
  if (previous)
    try {
      await prepareUninstall(extensionOwner(id), declared(host, id));
    } catch (error) {
      await discard();
      throw error;
    }
  try {
    await (previous
      ? saveWithout(state, id, imports)
      : state.save({ imports }));
  } catch (error) {
    if (notCommitted(error)) await discard();
    throw error;
  }
  state.imports = imports;
  if (replacing) await host.uninstall(id);
  host.install(definition, state.configurations[id]);
  const index = state.catalog.findIndex((saved) => saved.id === id);
  if (index === -1) state.catalog.push(entry);
  else state.catalog[index] = entry;
  if (previous && isFileImport(previous.url) && previous.url !== file.url)
    await sources.remove(previous.url);
  return { entry, replaced: !!previous };
}

export type ImportLoaders = {
  load?: Loader;
  sources?: SourceStore;
  loadSource?: LoadSource;
};

export async function retryImport(
  host: Pick<Host, "install">,
  state: Pick<ExtensionState, "imports" | "catalog" | "configurations">,
  id: string,
  baseUrl: string,
  retry: number,
  {
    load = loadExtension,
    sources,
    loadSource = loadExtensionSource,
  }: ImportLoaders = {},
) {
  const entry = state.imports.find((item) => item.id === id)!;
  let definition: ExtensionDefinition;
  if (isFileImport(entry.url)) {
    if (!sources) throw Error("导入的扩展文件暂不可读取。");
    definition = await loadSource(await sources.read(entry.url), id);
  } else {
    const target = new URL(entry.url, baseUrl);
    target.searchParams.set("_retry", String(retry));
    definition = await load(target.href, id);
  }
  host.install(definition, state.configurations[id]);
  state.catalog.push(entry);
  return entry;
}

const declared = (host: RemovalHost, id: string) =>
  host.ids().includes(id) && !!host.manifest(id).credentialBindings;

/** Saves `imports` with `id` dropped from the saved composition. */
async function saveWithout(
  state: RemovalState,
  id: string,
  imports: ImportedExtension[],
) {
  const composition = state.composition && {
    ...state.composition,
    enabled: state.composition.enabled.filter((entry) => entry.id !== id),
  };
  await state.save({ imports, ...(composition ? { composition } : {}) });
  state.composition = composition;
}

async function saveRemovedImport(
  host: RemovalHost,
  state: RemovalState,
  id: string,
  imports: ImportedExtension[],
  prepareUninstall: PrepareUninstall,
) {
  await prepareUninstall(extensionOwner(id), declared(host, id));
  await saveWithout(state, id, imports);
}

export async function uninstallExtension(
  host: RemovalHost & Pick<Host, "stop" | "grant" | "uninstall">,
  state: RemovalState & Pick<ExtensionState, "catalog">,
  id: string,
  prepareUninstall: PrepareUninstall,
  sources?: SourceStore,
) {
  const removed = state.imports.find((entry) => entry.id === id);
  const imports = await uninstallImport(host, id, state.imports, (next) =>
    saveRemovedImport(host, state, id, next, prepareUninstall),
  );
  state.imports = imports;
  if (removed && isFileImport(removed.url)) await sources?.remove(removed.url);
  const index = state.catalog.findIndex((entry) => entry.id === id);
  if (index !== -1) state.catalog.splice(index, 1);
  return imports;
}

export async function removeFailedImport(
  host: RemovalHost,
  state: RemovalState,
  id: string,
  prepareUninstall: PrepareUninstall,
  sources?: SourceStore,
) {
  const removed = state.imports.find((entry) => entry.id === id);
  const imports = state.imports.filter((entry) => entry.id !== id);
  await saveRemovedImport(host, state, id, imports, prepareUninstall);
  state.imports = imports;
  if (removed && isFileImport(removed.url)) await sources?.remove(removed.url);
  return imports;
}

export async function saveComposition(
  host: Pick<Host, "ids" | "inspect" | "manifest">,
  state: Pick<ExtensionState, "save" | "composition">,
  layout: string,
) {
  const composition = captureComposition(host);
  // Appearance owns theme fields; a composition save must not carry a stale copy.
  await state.save({ composition, layout });
  state.composition = composition;
  return composition;
}

export async function configureExtension(
  host: Pick<Host, "manifest" | "inspect" | "stop" | "configure" | "start">,
  state: Pick<ExtensionState, "save" | "configurations">,
  id: string,
  values: Record<string, ConfigurationValue>,
) {
  await saveConfiguration(
    host,
    id,
    { version: host.manifest(id).configuration!.version, values },
    async (value) => {
      const configurations = Object.assign(
        Object.create(null),
        state.configurations,
        {
          [id]: value,
        },
      );
      await state.save({ configurations });
      state.configurations = configurations;
    },
  );
}
