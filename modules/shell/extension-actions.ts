import type { Host } from "../extension-host/host";
import { captureComposition, type Composition } from "./composition";
import type { ImportedExtension } from "./uninstall";
import { uninstallImport } from "./uninstall";
import { saveConfiguration } from "./configuration";
import { loadExtension } from "../extension-host/definition";
import { extensionOwner } from "../sdk";
import type { ConfigurationValue } from "../sdk/configuration";

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
  const target = new URL(input.url, input.baseUrl);
  if (target.origin !== new URL(input.baseUrl).origin)
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

export async function retryImport(
  host: Pick<Host, "install">,
  state: Pick<ExtensionState, "imports" | "catalog" | "configurations">,
  id: string,
  baseUrl: string,
  retry: number,
  load: Loader = loadExtension,
) {
  const entry = state.imports.find((item) => item.id === id)!;
  const target = new URL(entry.url, baseUrl);
  target.searchParams.set("_retry", String(retry));
  host.install(await load(target.href, id), state.configurations[id]);
  state.catalog.push(entry);
  return entry;
}

type RemovalHost = Pick<Host, "ids" | "manifest">;
type RemovalState = Pick<ExtensionState, "imports" | "composition" | "save">;
type PrepareUninstall = (owner: string, declared: boolean) => Promise<void>;

async function saveRemovedImport(
  host: RemovalHost,
  state: RemovalState,
  id: string,
  imports: ImportedExtension[],
  prepareUninstall: PrepareUninstall,
) {
  await prepareUninstall(
    extensionOwner(id),
    host.ids().includes(id) && !!host.manifest(id).credentialBindings,
  );
  const composition = state.composition && {
    ...state.composition,
    enabled: state.composition.enabled.filter((entry) => entry.id !== id),
  };
  await state.save({ imports, ...(composition ? { composition } : {}) });
  state.composition = composition;
}

export async function uninstallExtension(
  host: RemovalHost & Pick<Host, "stop" | "grant" | "uninstall">,
  state: RemovalState & Pick<ExtensionState, "catalog">,
  id: string,
  prepareUninstall: PrepareUninstall,
) {
  const imports = await uninstallImport(host, id, state.imports, (next) =>
    saveRemovedImport(host, state, id, next, prepareUninstall),
  );
  state.imports = imports;
  const index = state.catalog.findIndex((entry) => entry.id === id);
  if (index !== -1) state.catalog.splice(index, 1);
  return imports;
}

export async function removeFailedImport(
  host: RemovalHost,
  state: RemovalState,
  id: string,
  prepareUninstall: PrepareUninstall,
) {
  const imports = state.imports.filter((entry) => entry.id !== id);
  await saveRemovedImport(host, state, id, imports, prepareUninstall);
  state.imports = imports;
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
