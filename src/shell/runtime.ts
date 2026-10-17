import { Host, loadExtension } from "../../modules/extension-host/host";
import {
  readComposition,
  restoreComposition,
  type Composition,
} from "../../modules/shell/composition";
import type { ImportedExtension } from "../../modules/shell/uninstall";
import type { StoredState } from "../../modules/sdk";
import { PlatformAdapter } from "../platform";
import { agentExtension } from "../../modules/agents/provider";
import { restoreAgents, type SaveOptions } from "../../modules/agents/store";
import type { Agent } from "../../modules/sdk/agents";
import { agentUI } from "../agent-ui";
import { textWorkbench } from "../../modules/text-workbench/extension";
import { errorMessage } from "./messages";

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

export async function boot(): Promise<Runtime> {
  const adapter = new PlatformAdapter();
  await Promise.all([
    adapter.initializeDocuments(),
    adapter.credentials.initialize(adapter.kind === "native"),
  ]);
  const host = new Host(adapter);
  const response = await fetch("/catalog.json");
  if (!response.ok) throw new Error("扩展目录读取失败");
  const catalog: Runtime["catalog"] = await response.json();
  await adapter.grant("host.shell", [
    "state.read",
    "state.write",
    "platform.info",
  ]);
  const saved = (await adapter.call(
    "host.shell",
    "state.read",
  )) as StoredState | null;
  const value = saved?.value as
    | {
        version?: unknown;
        layout?: unknown;
        layoutIntent?: unknown;
        theme?: unknown;
        themeId?: unknown;
        agents?: unknown;
        imports?: unknown;
        composition?: unknown;
        configurations?: unknown;
        pages?: unknown;
      }
    | undefined;
  if (
    saved &&
    (!value ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      value.version !== 1)
  )
    throw Error("应用配置版本不支持，原数据已保留。");
  let composition: Composition | undefined;
  try {
    composition = readComposition(value?.composition);
  } catch (error) {
    throw new CompositionRecovery(errorMessage(error), adapter, saved!);
  }
  const agents = restoreAgents(value?.agents);
  if (
    value?.pages !== undefined &&
    (!value.pages ||
      typeof value.pages !== "object" ||
      Array.isArray(value.pages) ||
      Object.values(value.pages).some((route) => typeof route !== "string"))
  )
    throw Error("页面偏好损坏，原数据已保留。");
  let pages: Record<string, string> = Object.assign(
    Object.create(null),
    value?.pages ?? {},
  );
  if (
    value?.configurations !== undefined &&
    (!value.configurations ||
      typeof value.configurations !== "object" ||
      Array.isArray(value.configurations))
  )
    throw Error("Extension configuration map is invalid; original preserved");
  const configurations: Record<string, unknown> = Object.assign(
    Object.create(null),
    value?.configurations ?? {},
  );
  const imports: Runtime["imports"] = [];
  if (value?.imports !== undefined) {
    if (!Array.isArray(value.imports))
      throw Error("扩展路径配置损坏，原数据已保留。");
    for (const entry of value.imports) {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        typeof entry.url !== "string" ||
        typeof entry.label !== "string" ||
        new URL(entry.url, location.href).origin !== location.origin ||
        ["agents.local", "ui.agents"].includes(entry.id) ||
        [...catalog, ...imports].some((e) => e.id === entry.id)
      )
        throw Error("扩展路径配置无效，原数据已保留。");
      imports.push(entry);
    }
  }
  for (const entry of catalog)
    host.install(
      await loadExtension(new URL(entry.url, location.href).href, entry.id),
      configurations[entry.id],
    );
  const failedImports: Runtime["failedImports"] = {};
  for (const entry of imports) {
    try {
      host.install(
        await loadExtension(new URL(entry.url, location.href).href, entry.id),
        configurations[entry.id],
      );
      catalog.push(entry);
    } catch (error) {
      failedImports[entry.id] = errorMessage(error);
    }
  }
  let preferences = {
    ...value,
    version: 1,
    // Early previews saved the workbench's initial value without an enabled
    // composition. Only that unmarked legacy default adopts the Agent start.
    layout:
      value?.layout === "default" &&
      value.layoutIntent !== "explicit" &&
      !composition
        ? "agents"
        : typeof value?.layout === "string"
          ? value.layout
          : "agents",
    theme:
      value?.theme === "light" || value?.theme === "dark"
        ? value.theme
        : matchMedia("(prefers-color-scheme: dark)").matches
          ? ("dark" as const)
          : ("light" as const),
    themeId: typeof value?.themeId === "string" ? value.themeId : null,
    agents,
    imports,
    configurations,
  };
  let revision = saved?.revision ?? 0;
  let queue: Promise<unknown> = Promise.resolve();
  let uncertain = false;
  const save: Runtime["save"] = (patch, options) => {
    const pending = queue.then(async () => {
      options?.signal?.throwIfAborted();
      if (uncertain)
        throw Error("保存回执未确认，请重新加载应用后再修改配置。");
      const next = {
        ...preferences,
        ...patch,
        ...(patch.layout === undefined ? {} : { layoutIntent: "explicit" }),
      };
      try {
        options?.onCommit?.();
        const receipt = (await adapter.call(
          "host.shell",
          "state.write",
          {
            revision,
            value: next,
          },
          options?.signal,
        )) as StoredState;
        revision = receipt.revision;
        preferences = next;
      } catch (error) {
        if (
          !(error instanceof Error && error.name === "AbortError") &&
          (error as { outcome?: string }).outcome !== "not-committed"
        )
          uncertain = true;
        throw error;
      }
    });
    queue = pending.catch(() => {});
    return pending;
  };
  const events = new EventTarget();
  let pageQueue: Promise<void> = Promise.resolve();
  host.connectShell({
    open: async (action) => {
      events.dispatchEvent(new CustomEvent("shell", { detail: action }));
    },
    readPage: (key) => pages[key],
    savePage: (key, route) => {
      const work = pageQueue.then(async () => {
        const next = Object.assign(Object.create(null), pages, {
          [key]: route,
        });
        await save({ pages: next });
        pages = next;
      });
      pageQueue = work.catch(() => {});
      return work;
    },
  });
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
    catalog: [
      ...catalog,
      { id: "agents.local", url: "内置公开服务", label: "本地 Agent 提供者" },
      { id: "ui.agents", url: "内置可替换界面", label: "默认 Agent 界面" },
      {
        id: "ui.workbench-board",
        url: "内置公开契约样板",
        label: "文本处理工作台",
      },
    ],
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
