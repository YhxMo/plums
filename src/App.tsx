import { createViewSlot } from "../modules/shell/view-slot";
import { applyTheme } from "../modules/shell/theme";
import {
  diagnoseLayoutFallback,
  mapExtensionAgents,
  readActiveAgents,
} from "../modules/shell/diagnostics";
import { saveConfiguration } from "../modules/shell/configuration";
import type { ConfigurationValue } from "../modules/sdk/configuration";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { Host, loadExtension } from "../modules/extension-host/host";
import {
  readComposition,
  captureComposition,
  restoreComposition,
  type Composition,
} from "../modules/shell/composition";
import { recoverComposition } from "../modules/shell/composition-recovery";
import {
  uninstallImport,
  type ImportedExtension,
} from "../modules/shell/uninstall";
import { extensionOwner, type StoredState } from "../modules/sdk";
import { PlatformAdapter } from "./platform";
import styles from "./App.module.css";
import { agentExtension } from "../modules/agents/provider";
import { restoreAgents, type SaveOptions } from "../modules/agents/store";
import type { Agent } from "../modules/sdk/agents";
import { agentUI } from "./agent-ui";
import { textWorkbench } from "../modules/text-workbench/extension";
import { SettingsMenu } from "./components/SettingsMenu";
import { ExtensionView } from "./components/ExtensionView";
import { SelectedDocuments } from "./components/SelectedDocuments";
import { Dialog } from "./components/Dialog";
import { Icon } from "./components/Icon";

type Runtime = {
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
type Authorization = { ids: string[]; run: () => Promise<void> };
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const capabilityLabel = (capability: string) =>
  ({
    "state.read": "读取隔离状态",
    "state.write": "写入隔离状态",
    "platform.info": "查看平台信息",
    "document.read": "只读访问本次选择的文档（最多64 KiB）",
  })[capability] ?? capability;
const translateStatus = (status: string) =>
  ({
    disabled: "已停用",
    active: "运行中",
    stopping: "停用中",
    waiting: "等待条件",
    failed: "激活失败",
    "cleanup-failed": "清理未完成",
  })[status] ?? status;

class CompositionRecovery extends Error {
  constructor(
    message: string,
    readonly adapter: PlatformAdapter,
    readonly saved: StoredState,
  ) {
    super(message);
  }
}

async function boot(): Promise<Runtime> {
  const adapter = new PlatformAdapter();
  await adapter.initializeDocuments();
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
    layout: typeof value?.layout === "string" ? value.layout : "agents",
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
      const next = { ...preferences, ...patch };
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

export function App() {
  const [recovery, setRecovery] = useState<CompositionRecovery | null>(null);
  const [confirmRecovery, setConfirmRecovery] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryLocked, setRecoveryLocked] = useState(false);
  const recoveryTrigger = useRef<HTMLElement | null>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const recoveryFinished = useRef(false);
  useEffect(() => {
    if (!confirmRecovery && recoveryFinished.current) {
      recoveryFinished.current = false;
      reloadButton.current?.focus();
    }
  }, [confirmRecovery]);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void boot()
      .then((value) => {
        if (active) setRuntime(value);
      })
      .catch((reason) => {
        if (active) {
          setError(errorMessage(reason));
          if (reason instanceof CompositionRecovery) setRecovery(reason);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  if (!runtime)
    return (
      <main className={styles.loading}>
        <img className={styles.logo} src="/brand/plums.png" alt="" />
        <h1>Plums</h1>
        <p role={error ? "alert" : "status"}>{error || "正在读取本地扩展…"}</p>
        {error && (
          <button
            ref={reloadButton}
            disabled={recovering}
            onClick={() => location.reload()}
          >
            重新加载
          </button>
        )}
        {recovery && !recoveryLocked && (
          <button
            className="secondary"
            onClick={(event) => {
              recoveryTrigger.current = event.currentTarget;
              setConfirmRecovery(true);
            }}
          >
            恢复默认组合
          </button>
        )}
        {confirmRecovery && recovery && (
          <Dialog
            title="恢复默认组合"
            returnFocusTo={recoveryTrigger.current}
            onClose={() => {
              if (!recovering) setConfirmRecovery(false);
            }}
          >
            <div className="dialog-content">
              <p>
                先独立备份原应用配置，再重置损坏的组合。角色、会话、外观、安装路径及扩展数据保留；重新加载后启动默认组合。
              </p>
              <p>
                备份保留在本地应用状态目录，不自动清理。此操作不能修复其他配置损坏。
              </p>
            </div>
            <footer className="dialog-actions">
              <button
                className="secondary"
                disabled={recovering}
                onClick={() => setConfirmRecovery(false)}
              >
                取消
              </button>
              <button
                disabled={recovering}
                onClick={() => {
                  setRecovering(true);
                  const backupOwner = `host.recovery.${crypto.randomUUID()}`;
                  void recoverComposition(
                    recovery.adapter,
                    recovery.saved,
                    backupOwner,
                  )
                    .then(() => {
                      setRecovery(null);
                      setError(
                        `原配置已备份至 ${backupOwner}，组合已重置，请重新加载。`,
                      );
                    })
                    .catch((reason) => {
                      setRecoveryLocked(true);
                      setError(
                        `恢复未确认完成：${errorMessage(reason)}。请重新加载确认实际结果；本次备份标识：${backupOwner}，是否已写入须核对。`,
                      );
                    })
                    .finally(() => {
                      recoveryFinished.current = true;
                      setRecovering(false);
                      setConfirmRecovery(false);
                    });
                }}
              >
                备份并重置组合
              </button>
            </footer>
          </Dialog>
        )}
      </main>
    );
  return <Workbench runtime={runtime} />;
}

function Workbench({ runtime }: { runtime: Runtime }) {
  const { host, adapter, catalog } = runtime;
  useSyncExternalStore(host.subscribe, host.snapshot);
  const [selected, setSelected] = useState(runtime.layout);
  const [theme, setTheme] = useState(runtime.theme);
  const [themeId, setThemeId] = useState(runtime.themeId);
  const themes = host.themes();
  const currentTheme = themes.find((entry) => entry.id === themeId);
  const appearance = currentTheme?.appearance ?? theme;
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    runtime.compositionErrors.length
      ? `组合未完整恢复：${runtime.compositionErrors.join("；")}。原配置已保留。`
      : Object.keys(runtime.failedImports).length
        ? "有扩展加载失败，请在扩展管理重试或移除失效路径。"
        : "",
  );
  const [failedImports, setFailedImports] = useState(runtime.failedImports);
  const [notice, setNotice] = useState("");
  const [showExtensions, setShowExtensions] = useState(false);
  const [selectedExtId, setSelectedExtId] = useState<string>(
    () =>
      catalog.find((entry) => host.ids().includes(entry.id))?.id ??
      "agents.local",
  );
  const [dismissedFallback, setDismissedFallback] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const [agentDetailOpen, setAgentDetailOpen] = useState(false);
  const isMacOverlay =
    adapter.kind === "native" && !/android/i.test(navigator.userAgent);
  const [fault, setFault] = useState(false);
  const [settings, setSettings] = useState<"settings" | "about" | null>(null);
  const [dialogView, setDialogView] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [diagnostics, setDiagnostics] = useState(false);
  const [install, setInstall] = useState(false);
  const installTrigger = useRef<HTMLElement | null>(null);
  const [removal, setRemoval] = useState<string | null>(null);
  const removalTrigger = useRef<HTMLElement | null>(null);
  const removed = useRef(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<
    Record<string, ConfigurationValue>
  >({});
  const configTrigger = useRef<HTMLElement | null>(null);
  const [moduleUrl, setModuleUrl] = useState("");
  const [moduleId, setModuleId] = useState("");
  useEffect(() => {
    const updateTitle = (event: Event) =>
      setWorkspaceTitle((event as CustomEvent<string>).detail ?? "");
    window.addEventListener("plums:workspace-title", updateTitle);
    const updateDetail = (event: Event) =>
      setAgentDetailOpen(!!(event as CustomEvent<boolean>).detail);
    window.addEventListener("plums:agent-detail-state", updateDetail);
    return () => {
      window.removeEventListener("plums:workspace-title", updateTitle);
      window.removeEventListener("plums:agent-detail-state", updateDetail);
    };
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "settings") setSettings("settings");
      else {
        setShowExtensions(true);
        setDiagnostics(action === "diagnostics");
      }
    };
    runtime.events.addEventListener("shell", open);
    return () => runtime.events.removeEventListener("shell", open);
  }, [runtime]);
  const [authorization, setAuthorization] = useState<Authorization | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const managerButton = useRef<HTMLButtonElement>(null);
  const managerHeading = useRef<HTMLHeadingElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [viewOutlet] = useState(() => createViewSlot(host));
  useEffect(() => {
    if (!removal && removed.current) {
      removed.current = false;
      managerHeading.current?.focus();
    }
  }, [removal]);
  const [failedViews, setFailedViews] = useState<Record<string, number>>({});
  const recovering = useRef<string | null>(null);
  const lastWorkingView = useRef<string | undefined>(undefined);
  const views = host
    .views()
    .filter(
      (view) =>
        view.presentation === "workspace" &&
        failedViews[view.id] !== view.generation,
    );
  const modalViews = host
    .views()
    .filter((view) => view.presentation === "dialog");
  const sidebarViews = host
    .views()
    .filter((view) => view.presentation === "sidebar");
  const customSidebarView = sidebarViews[0];
  const modalView = modalViews.find((view) => view.id === dialogView?.id);
  const activeView =
    views.find((view) => view.id === selected)?.id ??
    [...views].sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
    )[0]?.id;
  const activeViewLabel = views.find((view) => view.id === activeView)?.label;
  const generation = views.find((view) => view.id === activeView)?.generation;
  const fallbackDiagnosis = diagnoseLayoutFallback(
    host,
    catalog,
    selected,
    activeView,
    failedViews,
    failedImports,
  );
  const activeAgents = readActiveAgents(host);
  const extensionAgents = mapExtensionAgents(host, activeAgents);
  const installedCatalog = catalog.filter((entry) =>
    host.ids().includes(entry.id),
  );
  const activeSelectedExt =
    installedCatalog.find((entry) => entry.id === selectedExtId) ??
    installedCatalog[0];

  useLayoutEffect(() => {
    applyTheme(document.documentElement, theme, currentTheme);
    return () => applyTheme(document.documentElement, theme);
  }, [theme, currentTheme]);

  useEffect(() => {
    if (adapter.kind === "native")
      void invoke("shell_set_theme", { theme: appearance }).catch((reason) =>
        setError(`窗口外观更新失败：${errorMessage(reason)}`),
      );
  }, [adapter, appearance]);

  useEffect(() => {
    if (showExtensions) managerHeading.current?.focus();
  }, [showExtensions]);

  useEffect(() => {
    if (authorization) dialog.current?.showModal();
  }, [authorization]);

  useEffect(() => {
    const root = slot.current;
    if (!root || !activeView) return;
    let active = true;
    const container = document.createElement("div");
    root.replaceChildren(container);
    void viewOutlet
      .show(activeView, container)
      .then(() => {
        if (active) lastWorkingView.current = activeView;
        if (active && recovering.current) {
          setError(`布局不可用，已恢复可用界面：${recovering.current}`);
          recovering.current = null;
        }
      })
      .catch((reason) => {
        if (!active) return;
        container.remove();
        recovering.current = errorMessage(reason);
        setError(
          `布局不可用；将使用可用布局或宿主恢复入口：${errorMessage(reason)}`,
        );
        setFailedViews((previous) => ({
          ...previous,
          [activeView]: generation!,
        }));
        setSelected(lastWorkingView.current ?? "");
      });
    return () => {
      active = false;
      void viewOutlet.clear().catch((reason) => setError(errorMessage(reason)));
    };
  }, [host, activeView, generation, viewOutlet]);

  async function operate(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  function requestAuthorization(
    ids: string[],
    run: () => Promise<void>,
    source: HTMLElement,
  ) {
    trigger.current = source;
    setAuthorization({ ids, run });
  }
  function closeAuthorization() {
    dialog.current?.close();
  }
  function toggleManager(open: boolean) {
    setShowExtensions(open);
    if (!open) managerButton.current?.focus();
  }
  function toggleRightSidebar(source: HTMLElement) {
    if (customSidebarView) {
      setSidebarOpen((prev) => !prev);
      return;
    }
    if (activeView === "agents") {
      window.dispatchEvent(
        new CustomEvent("plums:toggle-agent-detail", { detail: source }),
      );
      return;
    }
    setSidebarOpen((prev) => !prev);
  }
  async function start() {
    await host.grant("workbench", ["state.read", "state.write"]);
    await host.start("workbench");
    const defaultView = host.views().find((view) => view.id === "default");
    if (defaultView && failedViews.default === defaultView.generation)
      await host.stop("ui.default");
    await host.start("ui.default");
    await host.start("ui.board");
    if (host.inspect("transform.reverse").status !== "active")
      await host.start("transform.upper");
    setStarted(true);
    setSelected(runtime.layout === "agents" ? "default" : runtime.layout);
    setShowExtensions(false);
  }
  async function enableExtension(id: string) {
    await host.start(id);
    const contributed = host
      .views()
      .find((view) => view.owner === id && view.presentation === "workspace");
    if (contributed) {
      await runtime.save({ layout: contributed.id });
      setSelected(contributed.id);
    }
  }
  async function saveRemovedImport(id: string, imports: Runtime["imports"]) {
    const composition = runtime.composition && {
      ...runtime.composition,
      enabled: runtime.composition.enabled.filter((entry) => entry.id !== id),
    };
    await runtime.save({ imports, ...(composition ? { composition } : {}) });
    runtime.composition = composition;
  }
  async function selectLayout(layout: string) {
    if (activeView) await host.leaveView(activeView);
    await runtime.save({ layout, theme });
    setSelected(layout);
    setSettings(null);
  }
  async function toggleTheme() {
    const next = appearance === "light" ? "dark" : "light";
    await runtime.save({ layout: selected, theme: next, themeId: null });
    setTheme(next);
    setThemeId(null);
  }
  async function selectTheme(id: string | null) {
    await runtime.save({ themeId: id });
    setThemeId(id);
  }
  const writeDenied = host.inspect("workbench").status === "waiting" && started;

  return (
    <div className={styles.app}>
      <header
        className={`${styles.header} ${isMacOverlay ? styles.macOverlayHeader : ""}`}
        data-tauri-drag-region
      >
        <div className={styles.headerLeft} data-tauri-drag-region>
          <div className={styles.brand} data-tauri-drag-region>
            <img className={styles.logo} src="/brand/plums.png" alt="" />
            <strong>Plums</strong>
          </div>
          {(showExtensions || workspaceTitle || activeView !== "agents") && (
            <>
              <span className={styles.topDivider} aria-hidden="true" />
              <span className={styles.topTitle} data-tauri-drag-region>
                {showExtensions
                  ? "扩展管理"
                  : workspaceTitle || activeViewLabel || "工作空间"}
              </span>
            </>
          )}
        </div>
        <div className={styles.headerRight}>
          <button
            className={`topbar-ghost ${styles.themeSwitch}`}
            aria-label={
              appearance === "light" ? "切换到深色模式" : "切换到浅色模式"
            }
            title={appearance === "light" ? "切换到深色模式" : "切换到浅色模式"}
            disabled={busy}
            onClick={() => void operate(toggleTheme)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {appearance === "light" ? (
                <path d="M20.6 13.1A8.6 8.6 0 0 1 10.9 3.4a8.7 8.7 0 1 0 9.7 9.7Z" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </>
              )}
            </svg>
          </button>
          <SettingsMenu
            views={modalViews}
            onView={setDialogView}
            onChoose={(action) => {
              if (action === "extensions" || action === "diagnostics") {
                setShowExtensions(true);
                setDiagnostics(action === "diagnostics");
              } else setSettings(action);
            }}
          />
          <button
            className={`topbar-ghost ${styles.sidebarToggle}`}
            aria-label="展开或收起右侧栏"
            title={
              customSidebarView
                ? `切换 ${customSidebarView.label}`
                : "展开或收起右侧栏"
            }
            aria-pressed={customSidebarView ? sidebarOpen : agentDetailOpen}
            onClick={(event) => toggleRightSidebar(event.currentTarget)}
          >
            <Icon name="sidebarList" size={18} />
          </button>
        </div>
      </header>
      {fallbackDiagnosis &&
        dismissedFallback !== fallbackDiagnosis.signature && (
          <div
            role="status"
            className={`theme-fallback ${styles.fallbackBanner}`}
          >
            <span>{fallbackDiagnosis.message}</span>
            <div className={styles.fallbackActions}>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  if (fallbackDiagnosis.targetExtensionId)
                    setSelectedExtId(fallbackDiagnosis.targetExtensionId);
                  setShowExtensions(true);
                }}
              >
                查看原因
              </button>
              <button
                type="button"
                className="topbar-ghost"
                aria-label="关闭所选界面提示"
                onClick={() =>
                  setDismissedFallback(fallbackDiagnosis.signature)
                }
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </div>
        )}
      {themeId && !currentTheme && (
        <p role="status" className="theme-fallback">
          所选主题 {themeId} 暂不可用，已使用内置外观；再次启用该主题后恢复。
        </p>
      )}
      {(error || notice) && (
        <div
          className={`${styles.feedback} ${error ? styles.error : styles.notice}`}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          <button
            className="secondary"
            aria-label="关闭提示"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}
      <div className={styles.body} data-inspecting={showExtensions}>
        <div
          className={styles.stageArea}
          data-workspace
          hidden={showExtensions}
          inert={showExtensions || undefined}
        >
          {!activeView && (
            <main className={styles.welcome}>
              <img
                className={styles.welcomeMark}
                src="/brand/plums.png"
                alt=""
              />
              <span className="eyebrow">你的本地工作空间</span>
              <h1>
                {started ? "扩展正在等待条件。" : "从一个可替换的界面开始。"}
              </h1>
              <p>
                {started
                  ? "查看扩展状态以恢复依赖，或重新启用默认组合。已保存的数据会在恢复时读取。"
                  : "服务处理输入，布局呈现结果。先查看扩展，再授权启动你的第一个组合。"}
              </p>
              <ol className={styles.steps}>
                <li>
                  <b>1</b>查看扩展
                </li>
                <li>
                  <b>2</b>确认授权
                </li>
                <li>
                  <b>3</b>运行与保存
                </li>
              </ol>
              <div className={styles.welcomeActions}>
                <button
                  disabled={busy}
                  onClick={(event) =>
                    requestAuthorization(
                      ["workbench"],
                      start,
                      event.currentTarget,
                    )
                  }
                >
                  {started ? "恢复权限与默认界面" : "授予实验能力并启动"}
                </button>
                <button
                  className="secondary"
                  onClick={() => toggleManager(true)}
                >
                  查看本地扩展
                </button>
              </div>
              <p className={styles.welcomeHint}>
                默认组合：文本工作台、大写服务、工作台与画布布局。只处理本地示例文本。
              </p>
            </main>
          )}
          <div ref={slot} hidden={!activeView} className={styles.viewSlot} />
        </div>
        {!showExtensions && customSidebarView && sidebarOpen && (
          <aside
            className={styles.extensionSidebar}
            aria-label={customSidebarView.label}
          >
            <header className={styles.extensionSidebarHeader}>
              <h2>{customSidebarView.label}</h2>
              <button
                className="topbar-ghost"
                aria-label="收起扩展侧栏"
                onClick={() => setSidebarOpen(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className={styles.extensionSidebarBody}>
              <ExtensionView
                host={host}
                id={customSidebarView.id}
                generation={customSidebarView.generation}
              />
            </div>
          </aside>
        )}
        <aside
          id="extension-manager"
          hidden={!showExtensions}
          className={styles.inspector}
          aria-label="扩展管理"
        >
          <div className={styles.managerPage}>
            <div className={styles.managerMaster}>
              <div className={styles.inspectorHeading}>
                <div className={styles.inspectorHeadingLeft}>
                  <button
                    ref={managerButton}
                    className={`topbar-ghost ${styles.backArrow}`}
                    aria-label="返回工作区"
                    title="返回工作区"
                    onClick={() => toggleManager(false)}
                  >
                    <Icon name="arrowLeft" size={18} />
                  </button>
                  <div>
                    <span className="eyebrow">本地扩展 · {catalog.length}</span>
                    <h2 ref={managerHeading} tabIndex={-1}>
                      扩展与状态
                    </h2>
                  </div>
                </div>
                <div className={styles.managerGlobalActions}>
                  <button
                    className="secondary"
                    onClick={(e) => {
                      installTrigger.current = e.currentTarget;
                      setInstall(true);
                    }}
                  >
                    安装扩展
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void operate(async () => {
                        const composition = captureComposition(host);
                        await runtime.save({
                          composition,
                          layout: selected,
                          theme,
                        });
                        runtime.composition = composition;
                        setNotice(
                          "当前组合已保存，下次启动自动恢复；所需权限须重新确认。",
                        );
                      })
                    }
                  >
                    保存当前组合
                  </button>
                </div>
              </div>
              <p className={styles.managerHint}>
                检查模块与所需能力；停用后保留已保存的数据。保存当前组合会记录启用集合、扩展版本与当前外观，权限和扩展业务数据分别管理。
              </p>
              <div className={styles.extensions}>
                {Object.entries(failedImports).map(([id, reason]) => (
                  <article key={id}>
                    <strong>{id}</strong>
                    <p className="error">加载失败：{reason}</p>
                    <button
                      className="secondary"
                      disabled={busy}
                      aria-label={`重试加载 ${id}`}
                      onClick={() =>
                        void operate(async () => {
                          const entry = runtime.imports.find(
                            (e) => e.id === id,
                          )!;
                          const target = new URL(entry.url, location.href);
                          target.searchParams.set("_retry", String(Date.now()));
                          host.install(
                            await loadExtension(target.href, id),
                            runtime.configurations[id],
                          );
                          catalog.push(entry);
                          setFailedImports((previous) => {
                            const next = { ...previous };
                            delete next[id];
                            return next;
                          });
                        })
                      }
                    >
                      重试加载
                    </button>{" "}
                    <button
                      className="secondary"
                      disabled={busy}
                      aria-label={`移除路径 ${id}`}
                      onClick={() =>
                        void operate(async () => {
                          const imports = runtime.imports.filter(
                            (e) => e.id !== id,
                          );
                          await saveRemovedImport(id, imports);
                          runtime.imports = imports;
                          setFailedImports((previous) => {
                            const next = { ...previous };
                            delete next[id];
                            return next;
                          });
                        })
                      }
                    >
                      移除失效路径
                    </button>
                  </article>
                ))}
                {catalog
                  .filter((entry) => host.ids().includes(entry.id))
                  .map((entry) => {
                    const { id } = entry;
                    const state = host.inspect(id);
                    const manifest = host.manifest(id);
                    const capabilities = manifest.capabilities ?? [];
                    const boundAgents = extensionAgents[id] ?? [];
                    const isSelected = activeSelectedExt?.id === id;
                    return (
                      <article
                        key={id}
                        className={`${styles.extensionItem} ${isSelected ? styles.extensionItemSelected : ""}`}
                        onClick={() => setSelectedExtId(id)}
                      >
                        <div className={styles.extensionTitle}>
                          <strong>{entry.label}</strong>
                          <span
                            className={`${styles.status} ${state.status === "active" ? styles.active : ""}`}
                          >
                            {translateStatus(state.status)}
                          </span>
                        </div>
                        <code>
                          {id} · {manifest.version}
                        </code>
                        {boundAgents.length > 0 && (
                          <div className={styles.boundAgentPills}>
                            <span className="muted">关联 Agent：</span>
                            {boundAgents.map((agent) => (
                              <span key={agent.id} className={styles.agentPill}>
                                {agent.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {state.error && <p className="error">{state.error}</p>}
                        <p className={styles.resourceCount}>
                          {state.resources} 项资源 · {state.tasks} 个在途任务
                        </p>
                        <div className={styles.extensionActions}>
                          {manifest.configuration && (
                            <button
                              className="secondary"
                              aria-label={`配置 ${id}`}
                              disabled={busy}
                              onClick={(event) => {
                                configTrigger.current = event.currentTarget;
                                setConfigDraft({
                                  ...host.configuration(id).value.values,
                                });
                                setError("");
                                setConfiguring(id);
                              }}
                            >
                              配置
                            </button>
                          )}
                          {runtime.imports.some((item) => item.id === id) && (
                            <button
                              className="secondary"
                              disabled={busy}
                              aria-label={`卸载 ${id}`}
                              onClick={(event) => {
                                removalTrigger.current = event.currentTarget;
                                setError("");
                                setRemoval(id);
                              }}
                            >
                              卸载（保留数据）
                            </button>
                          )}
                          <details>
                            <summary>扩展详情</summary>
                            <dl>
                              <dt>模块位置</dt>
                              <dd>{entry.url}</dd>
                              <dt>能力</dt>
                              <dd>
                                {capabilities.length
                                  ? capabilities.map(capabilityLabel).join("、")
                                  : "无需原生能力"}
                              </dd>
                              <dt>依赖服务</dt>
                              <dd>
                                {Object.entries(manifest.requires ?? {})
                                  .map(
                                    ([name, version]) => `${name}@${version}`,
                                  )
                                  .join("、") || "无"}
                              </dd>
                              <dt>提供服务</dt>
                              <dd>
                                {Object.entries(manifest.provides ?? {})
                                  .map(
                                    ([name, version]) => `${name}@${version}`,
                                  )
                                  .join("、") || "无"}
                              </dd>
                            </dl>
                          </details>
                          <button
                            className="secondary"
                            aria-label={`${state.status === "active" ? "停用" : "启用"} ${id}`}
                            disabled={
                              busy ||
                              state.status === "cleanup-failed" ||
                              state.status === "stopping"
                            }
                            onClick={(event) => {
                              if (state.status === "active")
                                void operate(() => host.stop(id));
                              else if (capabilities.length)
                                requestAuthorization(
                                  [id],
                                  async () => {
                                    await host.grant(id, capabilities);
                                    await enableExtension(id);
                                  },
                                  event.currentTarget,
                                );
                              else
                                void operate(async () => {
                                  await enableExtension(id);
                                });
                            }}
                          >
                            {state.status === "active"
                              ? "停用"
                              : state.status === "waiting"
                                ? "恢复"
                                : "启用"}
                          </button>
                        </div>
                        {capabilities.includes("document.read") && (
                          <SelectedDocuments
                            adapter={runtime.adapter}
                            owner={extensionOwner(id)}
                            enabled={state.status === "active"}
                          />
                        )}
                        {state.status === "cleanup-failed" && (
                          <p className="error">请重新启动应用以恢复此扩展。</p>
                        )}
                      </article>
                    );
                  })}
              </div>
            </div>
            <section
              className={styles.managerDetailPane}
              aria-label="所选扩展与关联 Agent 详情"
            >
              {activeSelectedExt &&
                (() => {
                  const extId = activeSelectedExt.id;
                  const extState = host.inspect(extId);
                  const extManifest = host.manifest(extId);
                  const extCaps = extManifest.capabilities ?? [];
                  const extBoundAgents = extensionAgents[extId] ?? [];
                  return (
                    <div className={styles.detailCard}>
                      <header className={styles.detailCardHeader}>
                        <div>
                          <div className={styles.extensionTitle}>
                            <h3>{activeSelectedExt.label}</h3>
                            <span
                              className={`${styles.status} ${extState.status === "active" ? styles.active : ""}`}
                            >
                              {translateStatus(extState.status)}
                            </span>
                          </div>
                          <code>
                            {extId} · {extManifest.version}
                          </code>
                        </div>
                      </header>
                      <section className={styles.detailSection}>
                        <h4>已绑定的启用中 Agent（{extBoundAgents.length}）</h4>
                        {extBoundAgents.length ? (
                          <div className={styles.boundAgentList}>
                            {extBoundAgents.map((agent) => (
                              <div
                                key={agent.id}
                                className={styles.boundAgentRow}
                              >
                                <div>
                                  <strong>{agent.name}</strong>
                                  <p className="muted">{agent.description}</p>
                                </div>
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => {
                                    toggleManager(false);
                                    window.dispatchEvent(
                                      new CustomEvent("plums:select-agent", {
                                        detail: agent.id,
                                      }),
                                    );
                                  }}
                                >
                                  跳转到 Agent →
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="muted">
                            当前没有启用中的 Agent 直接绑定此扩展。
                          </p>
                        )}
                      </section>
                      <section className={styles.detailSection}>
                        <h4>服务与权限概览</h4>
                        <dl className={styles.detailMetaGrid}>
                          <dt>模块位置</dt>
                          <dd>{activeSelectedExt.url}</dd>
                          <dt>所需服务</dt>
                          <dd>
                            {Object.entries(extManifest.requires ?? {})
                              .map(([name, version]) => `${name}@${version}`)
                              .join("、") || "无"}
                          </dd>
                          <dt>提供服务</dt>
                          <dd>
                            {Object.entries(extManifest.provides ?? {})
                              .map(([name, version]) => `${name}@${version}`)
                              .join("、") || "无"}
                          </dd>
                          <dt>系统权限</dt>
                          <dd>
                            {extCaps.length
                              ? extCaps.map(capabilityLabel).join("、")
                              : "无需原生能力"}
                          </dd>
                        </dl>
                      </section>
                    </div>
                  );
                })()}
              <details
                className={styles.diagnostics}
                open={diagnostics}
                onToggle={(e) => setDiagnostics(e.currentTarget.open)}
              >
                <summary>诊断与实验</summary>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={(event) =>
                    requestAuthorization(
                      ["workbench"],
                      start,
                      event.currentTarget,
                    )
                  }
                >
                  授予实验能力并启动
                </button>
                <div className={styles.diagnosticActions}>
                  <button
                    className="secondary"
                    disabled={!started || busy}
                    onClick={() =>
                      void operate(async () => {
                        const upper =
                          host.inspect("transform.upper").status === "active";
                        await host.stop(
                          upper ? "transform.upper" : "transform.reverse",
                        );
                        await host.start(
                          upper ? "transform.reverse" : "transform.upper",
                        );
                        setNotice("服务已替换，工作台已重新连接。");
                      })
                    }
                  >
                    替换服务
                  </button>
                  <button
                    className="secondary"
                    disabled={!activeView || busy}
                    onClick={() =>
                      void operate(async () => {
                        const owner = host
                          .views()
                          .find((view) => view.id === activeView)!.owner;
                        await host.stop(owner);
                        setSelected("default");
                        setNotice("布局已停用，已选择可用界面。");
                      })
                    }
                  >
                    停用当前布局
                  </button>
                  <button
                    className="secondary"
                    disabled={!started || busy}
                    onClick={() =>
                      void operate(async () => {
                        await host.start("ui.broken");
                        setSelected("broken");
                      })
                    }
                  >
                    测试故障布局
                  </button>
                  <button
                    className="secondary"
                    disabled={!started || busy}
                    onClick={(event) => {
                      if (writeDenied)
                        requestAuthorization(
                          ["workbench"],
                          async () => {
                            await host.grant("workbench", [
                              "state.read",
                              "state.write",
                            ]);
                          },
                          event.currentTarget,
                        );
                      else
                        void operate(async () => {
                          await host.grant("workbench", ["state.read"]);
                          setNotice("写入能力已撤销，工作台等待重新授权。");
                        });
                    }}
                  >
                    {writeDenied ? "恢复状态写入" : "撤销状态写入"}
                  </button>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={fault}
                      onChange={(event) => {
                        adapter.failWrites = event.target.checked;
                        setFault(event.target.checked);
                      }}
                    />
                    注入存储写入失败
                  </label>
                  <p>故障注入只用于本应用实验，不代表操作系统授权。</p>
                </div>
              </details>
            </section>
          </div>
        </aside>
      </div>
      {dialogView && (
        <Dialog title={dialogView.label} onClose={() => setDialogView(null)}>
          {modalView ? (
            <ExtensionView
              host={host}
              id={modalView.id}
              generation={modalView.generation}
            />
          ) : (
            <div className="dialog-content">
              <p>界面提供者暂不可用，原数据已保留。</p>
              <button
                onClick={() => {
                  setDialogView(null);
                  setShowExtensions(true);
                }}
              >
                查看扩展
              </button>
            </div>
          )}
        </Dialog>
      )}
      {settings && (
        <Dialog
          title={settings === "about" ? "关于 Plums" : "应用设置"}
          onClose={() => setSettings(null)}
        >
          <div className="dialog-content">
            {settings === "about" ? (
              <>
                <img
                  className={styles.aboutLogo}
                  src="/brand/plums.png"
                  width="56"
                  height="56"
                  alt=""
                />
                <h3>Plums M1 · 0.0.4</h3>
                <p>通过扩展组合角色、能力和界面。</p>
                <p className="muted">
                  本地调试原型。当前 Agent 使用本地文本服务，模型与 MCP
                  连接器尚未内置。
                </p>
              </>
            ) : (
              <>
                <h3>界面与外观</h3>
                <p className="muted">
                  扩展界面优先于默认界面，可在此切换已启用的界面。
                </p>
                <div
                  role="group"
                  aria-label="界面布局"
                  className="layout-options"
                >
                  {views.map((view) => (
                    <button
                      className="secondary"
                      key={view.id}
                      aria-pressed={view.id === activeView}
                      onClick={() => void operate(() => selectLayout(view.id))}
                    >
                      使用 {view.label}
                    </button>
                  ))}
                </div>
                <button
                  className="secondary"
                  onClick={() => void operate(toggleTheme)}
                >
                  {appearance === "light" ? "切换到深色模式" : "切换到浅色模式"}
                </button>
                <div
                  role="group"
                  aria-label="扩展主题"
                  className="layout-options"
                >
                  <button
                    className="secondary"
                    disabled={busy}
                    aria-pressed={!themeId}
                    onClick={() => void operate(() => selectTheme(null))}
                  >
                    使用内置外观
                  </button>
                  {themes.map((entry) => (
                    <button
                      className="secondary"
                      disabled={busy}
                      key={entry.id}
                      aria-pressed={entry.id === themeId}
                      onClick={() => void operate(() => selectTheme(entry.id))}
                    >
                      使用 {entry.label}
                      <small className="muted theme-identity">
                        {entry.id} · {entry.owner}
                      </small>
                    </button>
                  ))}
                </div>
                <p className="muted">
                  主题来自已启用的扩展；停用后使用内置外观。重启启用集合需在扩展管理中保存当前组合。
                </p>
                <h3>扩展与连接</h3>
                <p className="muted">
                  模型连接器、MCP 服务和其他能力统一在扩展中配置、启用或停用。
                </p>
                <button
                  className="secondary"
                  onClick={() => {
                    setSettings(null);
                    setShowExtensions(true);
                  }}
                >
                  管理扩展
                </button>
                <h3>数据与诊断</h3>
                <p className="muted">
                  配置与会话保存在本地隔离数据中。实验工具可检查任务、权限与恢复状态。
                </p>
                <button
                  className="secondary"
                  onClick={() => {
                    setSettings(null);
                    setShowExtensions(true);
                    setDiagnostics(true);
                  }}
                >
                  打开诊断工具
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
      {configuring && (
        <Dialog
          title="扩展配置"
          returnFocusTo={configTrigger.current}
          onClose={() => {
            if (!busy) setConfiguring(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void operate(async () => {
                const id = configuring;
                await saveConfiguration(
                  host,
                  id,
                  {
                    version: host.manifest(id).configuration!.version,
                    values: configDraft,
                  },
                  async (value) => {
                    const configurations = Object.assign(
                      Object.create(null),
                      runtime.configurations,
                      { [id]: value },
                    );
                    await runtime.save({ configurations });
                    runtime.configurations = configurations;
                  },
                );
                setConfiguring(null);
                setNotice("配置已保存并应用；未启用的扩展保持停用。");
              });
            }}
          >
            <div className="dialog-content">
              <p>
                {configuring} ·
                仅填写普通配置，勿输入密钥或令牌。保存会先停用扩展；已启用的扩展随后重新启动。
              </p>
              {host.configuration(configuring).error && (
                <p className="error">
                  原配置无效：{host.configuration(configuring).error}
                  。下方展示默认值，确认保存会替换原配置；取消保留原值。
                </p>
              )}
              {Object.entries(
                host.manifest(configuring).configuration!.fields,
              ).map(([key, field]) => (
                <label
                  className={field.type === "boolean" ? "check-field" : "field"}
                  key={key}
                >
                  {field.label}
                  {field.type === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={configDraft[key] === true}
                      onChange={(event) =>
                        setConfigDraft({
                          ...configDraft,
                          [key]: event.target.checked,
                        })
                      }
                    />
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      required={field.type === "number"}
                      step={field.type === "number" ? "any" : undefined}
                      min={field.type === "number" ? field.min : undefined}
                      max={field.type === "number" ? field.max : undefined}
                      maxLength={
                        field.type === "string" ? field.maxLength : undefined
                      }
                      value={String(configDraft[key] ?? "")}
                      onChange={(event) =>
                        setConfigDraft({
                          ...configDraft,
                          [key]:
                            field.type === "number" && event.target.value !== ""
                              ? Number(event.target.value)
                              : event.target.value,
                        })
                      }
                    />
                  )}
                </label>
              ))}
              {error && (
                <p className="error" role="alert">
                  配置操作未完成：{error}
                  。扩展可能已停用，配置可能已保存；重载确认或修复后重新启用。
                </p>
              )}
            </div>
            <footer className="dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setConfiguring(null)}
              >
                取消
              </button>
              <button disabled={busy}>保存并应用</button>
            </footer>
          </form>
        </Dialog>
      )}
      {removal && (
        <Dialog
          title="卸载扩展"
          returnFocusTo={removalTrigger.current}
          onClose={() => {
            if (!busy) setRemoval(null);
          }}
        >
          <div className="dialog-content">
            <p>卸载 {removal}？扩展会先停用，依赖它的扩展将等待服务恢复。</p>
            <p>
              保留已保存的数据和模块文件，仅移除安装路径与授权；下次启动不会自动加载。同
              ID 重装后需重新授权。
            </p>
            {error && (
              <p className="error" role="alert">
                卸载未完成：{error}
                。扩展可能已停用；可重试，保存回执不明时请重新加载确认。
              </p>
            )}
          </div>
          <footer className="dialog-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setRemoval(null)}
            >
              取消
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  const id = removal;
                  const imports = await uninstallImport(
                    host,
                    id,
                    runtime.imports,
                    (imports) => saveRemovedImport(id, imports),
                  );
                  runtime.imports = imports;
                  const index = catalog.findIndex((entry) => entry.id === id);
                  if (index !== -1) catalog.splice(index, 1);
                  removed.current = true;
                  setRemoval(null);
                  setNotice("扩展已卸载，已保存的数据和模块文件已保留。");
                })
              }
            >
              保留数据并卸载
            </button>
          </footer>
        </Dialog>
      )}
      {install && (
        <Dialog
          title="安装扩展"
          returnFocusTo={installTrigger.current}
          onClose={() => {
            if (!busy) setInstall(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void operate(async () => {
                const target = new URL(moduleUrl, location.href);
                if (target.origin !== location.origin)
                  throw Error(
                    "当前 M1 仅加载本地可信 ESM 模块。请将扩展放入应用目录后填写模块路径。",
                  );
                const definition = await loadExtension(target.href, moduleId);
                if (host.ids().includes(moduleId))
                  throw Error("此扩展 ID 已存在。");
                const entry = {
                  id: moduleId,
                  url: target.pathname + target.search,
                  label: moduleId,
                };
                const imports = [
                  ...runtime.imports.filter((saved) => saved.id !== moduleId),
                  entry,
                ];
                await runtime.save({ imports });
                runtime.imports = imports;
                host.install(definition, runtime.configurations[moduleId]);
                catalog.push(entry);
                setFailedImports((previous) => {
                  const next = { ...previous };
                  delete next[moduleId];
                  return next;
                });
                setInstall(false);
                setNotice(
                  "模块路径已保存。请检查来源与能力，再启用扩展；下次启动会重新加载模块。",
                );
              });
            }}
          >
            <div className="dialog-content">
              <p>加载本地可信 ESM 扩展，再查看能力并确认启用。</p>
              <label className="field">
                扩展 ID
                <input
                  value={moduleId}
                  onChange={(e) => setModuleId(e.target.value)}
                  required
                  placeholder="example.extension"
                />
              </label>
              <label className="field">
                模块路径
                <input
                  value={moduleUrl}
                  onChange={(e) => setModuleUrl(e.target.value)}
                  required
                  placeholder="/extensions/example.js"
                />
              </label>
              <p className="muted">
                模型连接器和 MCP
                服务也通过扩展接入。模块路径保存在本地；扩展与宿主共享环境，加载的代码会执行。
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setInstall(false)}
              >
                取消
              </button>
              <button disabled={busy}>加载模块</button>
            </footer>
          </form>
        </Dialog>
      )}
      <dialog
        ref={dialog}
        className={styles.authorization}
        aria-labelledby="authorization-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = event.currentTarget.querySelectorAll("button");
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClose={() => {
          setAuthorization(null);
          trigger.current?.focus();
        }}
      >
        {authorization && (
          <>
            <span className="eyebrow">应用内能力授权</span>
            <h2 id="authorization-title">授权并启动扩展</h2>
            <p>以下扩展请求使用列出的应用能力。</p>
            <div className={styles.permissionList}>
              {authorization.ids.map((id) => (
                <section key={id}>
                  <strong>
                    {catalog.find((entry) => entry.id === id)?.label ?? id}
                  </strong>
                  <code>
                    {id} · {host.manifest(id).version}
                  </code>
                  <ul>
                    {host.manifest(id).capabilities?.map((capability) => (
                      <li key={capability}>{capabilityLabel(capability)}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <p className={styles.trustNote}>
              可信扩展共享运行环境。授权约束公开契约调用，不构成恶意代码安全沙箱。
            </p>
            <div className={styles.dialogActions}>
              <button
                className="secondary"
                autoFocus
                onClick={closeAuthorization}
              >
                暂不授权
              </button>
              <button
                onClick={() => {
                  const action = authorization.run;
                  closeAuthorization();
                  void operate(action);
                }}
              >
                授权并启动
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
