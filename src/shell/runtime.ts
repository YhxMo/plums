import { Host } from "../../modules/extension-host/host";
import { restoreComposition } from "../../modules/shell/composition";
import type { ImportedExtension } from "../../modules/shell/uninstall";
import type { ExtensionDefinition, StoredState } from "../../modules/sdk";
import { PlatformAdapter } from "../platform";
import { errorMessage } from "./messages";
import {
  parsePersistedState,
  checkImportIds,
  type Preferences,
} from "./persisted-state";
import { createPersistence, createShellBridge } from "./persistence";
import { loadCatalog, installCatalog, installImports } from "./extensions";

export type Runtime = Readonly<{
  host: Host;
  adapter: PlatformAdapter;
  catalog: ImportedExtension[];
  events: EventTarget;
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
  const preferences = application.restore(
    readPreferences(saved, adapter, [...catalog, ...application.catalog]),
  );
  const { imports, configurations, composition } = preferences;
  await installCatalog(host, catalog, configurations);
  const { failedImports } = await installImports(
    host,
    imports,
    configurations,
    catalog,
  );
  const { save, current } = createPersistence(
    adapter,
    preferences,
    saved?.revision ?? 0,
  );
  const events = new EventTarget();
  host.connectShell(createShellBridge({ save, current }, events));
  for (const extension of application.extensions(preferences, save))
    host.install(extension, configurations[extension.manifest.id]);
  const compositionErrors = composition
    ? await restoreComposition(host, composition)
    : [];
  if (!composition) for (const id of application.start) await host.start(id);
  const platformErrors = [
    adapter.documentsInitializationError &&
      `文档服务初始化失败：${adapter.documentsInitializationError}`,
    adapter.credentialsInitializationError &&
      `凭据服务初始化失败：${adapter.credentialsInitializationError}`,
  ].filter((entry): entry is string => Boolean(entry));
  return {
    host,
    adapter,
    catalog: [...catalog, ...application.catalog],
    initial: {
      layout: preferences.layout,
      theme: preferences.theme,
      themeId: preferences.themeId,
      imports,
      failedImports,
      composition,
      compositionErrors,
      platformErrors,
      configurations,
    },
    events,
    save,
  };
}
