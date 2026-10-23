import { Host } from "@modules/extension-host/host";
import {
  restoreComposition,
  startNewDefaults,
} from "@modules/shell/composition";
import type { ImportedExtension } from "@modules/shell/uninstall";
import type { ExtensionDefinition, StoredState } from "@modules/sdk";
import { PlatformAdapter } from "@/platform";
import { errorMessage } from "./messages";
import {
  parsePersistedState,
  checkImportIds,
  type Preferences,
} from "./persisted-state";
import { createPersistence, createShellBridge } from "./persistence";
import { loadCatalog, installCatalog, installImports } from "./extensions";
import { sourceStore, type SourceStore } from "@modules/shell/file-import";

export type Runtime = Readonly<{
  host: Host;
  adapter: PlatformAdapter;
  catalog: ImportedExtension[];
  /** Sources of extensions imported from files, in the shell's own state. */
  sources: SourceStore;
  events: EventTarget;
  /** The native app's OS from `platform.info` (`std::env::consts::OS`); absent in the browser preview. */
  os?: string;
  initial: Readonly<
    Pick<
      Preferences,
      | "layout"
      | "theme"
      | "themeId"
      | "imports"
      | "configurations"
      | "composition"
    > & {
      failedImports: Record<string, string>;
      compositionErrors: string[];
      startErrors: string[];
      platformErrors: string[];
    }
  >;
  save: ReturnType<typeof createPersistence>["save"];
}>;
export class CompositionRecovery extends Error {
  constructor(
    message: string,
    readonly adapter: PlatformAdapter,
    readonly saved: StoredState,
  ) {
    super(message);
  }
}

function readPreferences(
  saved: StoredState | null,
  adapter: PlatformAdapter,
  catalog: ImportedExtension[],
) {
  try {
    const preferences = parsePersistedState(
      saved ? (saved.value ?? null) : undefined,
    );
    checkImportIds(preferences.imports, catalog);
    return preferences;
  } catch (error) {
    if ((error as { code?: string })?.code === "state.composition")
      throw new CompositionRecovery(errorMessage(error), adapter, saved!);
    throw error;
  }
}

export type ShellApplication = {
  catalog: ImportedExtension[];
  restore: (state: Preferences) => Preferences;
  extensions: (
    state: Preferences,
    save: Runtime["save"],
  ) => ExtensionDefinition[];
  /** Capabilities the application grants its own built-in extensions. */
  grants?: Record<string, string[]>;
  start: string[];
};

export async function bootShell(
  application: ShellApplication,
): Promise<Runtime> {
  const adapter = new PlatformAdapter();
  await Promise.all([
    adapter.initializeDocuments(),
    adapter.credentials.initialize(adapter.kind === "native"),
  ]);
  const host = new Host(adapter, undefined, errorMessage);
  const catalog = await loadCatalog();
  await adapter.grant("host.shell", [
    "state.read",
    "state.write",
    "platform.info",
  ]);
  const saved = (await adapter.call(
    "host.shell",
    "state.read",
  )) as StoredState | null;
  // Only the native app knows its OS; the browser preview reports none.
  const info =
    adapter.kind === "native"
      ? ((await adapter.call("host.shell", "platform.info")) as {
          os?: unknown;
        } | null)
      : null;
  const os = typeof info?.os === "string" ? info.os : undefined;
  const preferences = application.restore(
    readPreferences(saved, adapter, [...catalog, ...application.catalog]),
  );
  const { imports, configurations, composition } = preferences;
  await installCatalog(host, catalog, configurations);
  const sources = sourceStore((capability, payload) =>
    adapter.call("host.shell", capability, payload),
  );
  const { failedImports } = await installImports(
    host,
    imports,
    configurations,
    catalog,
    { sources },
  );
  const { save, current } = createPersistence(
    adapter,
    preferences,
    saved?.revision ?? 0,
  );
  const events = new EventTarget();
  const entries = [...catalog, ...application.catalog];
  host.connectShell(createShellBridge({ save, current }, events, entries));
  // Connections an extension makes itself are recorded under its current source.
  adapter.credentials.describe = (owner) => {
    const id = owner.replace(/^extension\./, "");
    const protocols = host.ids().includes(id)
      ? host.manifest(id).credentialProtocols
      : undefined;
    const entry = entries.find((item) => item.id === id);
    return protocols && entry
      ? { source: entry.url, version: host.manifest(id).version, protocols }
      : undefined;
  };
  adapter.network.describe = (owner) => {
    const id = owner.replace(/^extension\./, "");
    return host.ids().includes(id)
      ? host.manifest(id).networkSources
      : undefined;
  };
  for (const extension of application.extensions(preferences, save))
    host.install(extension, configurations[extension.manifest.id]);
  // Built-ins get only what this platform has (no keys in the browser preview).
  for (const [id, capabilities] of Object.entries(application.grants ?? {}))
    await host.grant(
      id,
      capabilities.filter((name) => adapter.available(name)),
    );
  const compositionErrors = composition
    ? await restoreComposition(host, composition)
    : [];
  // Defaults start on a first boot and when an update adds one; one the user
  // turned off stays off. One failed activation must not block the shell.
  const { composition: started, errors: startErrors } = await startNewDefaults(
    host,
    composition ?? { schema: 1, enabled: [] },
    application.start,
  );
  const platformErrors = [
    adapter.documentsInitializationError &&
      `文档服务初始化失败：${adapter.documentsInitializationError}`,
    adapter.credentialsInitializationError &&
      `凭据服务初始化失败：${adapter.credentialsInitializationError}`,
  ].filter((entry): entry is string => Boolean(entry));
  return {
    host,
    adapter,
    catalog: entries,
    sources,
    os,
    initial: {
      layout: preferences.layout,
      theme: preferences.theme,
      themeId: preferences.themeId,
      imports,
      failedImports,
      composition: started,
      compositionErrors,
      startErrors,
      platformErrors,
      configurations,
    },
    events,
    save,
  };
}
