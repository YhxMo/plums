import { Host } from "../../modules/extension-host/host";
import {
  restoreComposition,
  type Composition,
} from "../../modules/shell/composition";
import type { ImportedExtension } from "../../modules/shell/uninstall";
import type { StoredState } from "../../modules/sdk";
import { PlatformAdapter } from "../platform";
import { agentExtension } from "../../modules/agents/provider";
import type { SaveOptions } from "../../modules/agents/store";
import type { Agent } from "../../modules/sdk/agents";
import { agentUI } from "../agent-ui";
import { textWorkbench } from "../../modules/text-workbench/extension";
import { errorMessage } from "./messages";
import { parsePersistedState, checkImportIds } from "./persisted-state";
import { createPersistence, createShellBridge } from "./persistence";
import {
  loadCatalog,
  installCatalog,
  installImports,
  builtInCatalog,
} from "./extensions";

export type Runtime = {
  host: Host;
  adapter: PlatformAdapter;
  catalog: ImportedExtension[];
  layout: string;
  theme: "light" | "dark";
  themeId: string | null;
  imports: ImportedExtension[];
  events: EventTarget;
  failedImports: Record<string, string>;
  configurations: Record<string, unknown>;
  composition?: Composition;
  compositionErrors: string[];
  save: (
    patch: {
      layout?: string;
      theme?: "light" | "dark";
      themeId?: string | null;
      agents?: Agent[];
      imports?: Runtime["imports"];
      composition?: Composition;
      configurations?: Record<string, unknown>;
      pages?: Record<string, string>;
    },
    options?: SaveOptions,
  ) => Promise<void>;
};
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

export async function boot(): Promise<Runtime> {
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
  const preferences = readPreferences(saved, adapter, catalog);
  const { imports, configurations, agents, composition } = preferences;
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
  host.install(textWorkbench, configurations["ui.workbench-board"]);
  host.install(
    agentExtension(agents, (agents, options) => save({ agents }, options)),
    configurations["agents.local"],
  );
  host.install(agentUI(), configurations["ui.agents"]);
  const compositionErrors = composition
    ? await restoreComposition(host, composition)
    : [];
  if (!composition) {
    await host.start("transform.upper");
    await host.start("agents.local");
    await host.start("ui.agents");
  }
  return {
    host,
    adapter,
    catalog: [...catalog, ...builtInCatalog()],
    layout: preferences.layout,
    theme: preferences.theme,
    themeId: preferences.themeId,
    imports,
    failedImports,
    composition,
    compositionErrors,
    configurations,
    events,
    save,
  };
}
