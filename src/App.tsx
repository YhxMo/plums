import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { Host, loadExtension } from "../modules/extension-host/host";
import type { StoredState } from "../modules/sdk";
import { PlatformAdapter } from "./platform";
import styles from "./App.module.css";
import { agentExtension } from "../modules/agents/provider";
import { restoreAgents, type SaveOptions } from "../modules/agents/store";
import type { Agent } from "../modules/sdk/agents";
import { agentUI } from "./agent-ui";
import { SettingsMenu } from "./components/SettingsMenu";
import { ExtensionView } from "./components/ExtensionView";
import { Dialog } from "./components/Dialog";

type Runtime = {
  host: Host;
  adapter: PlatformAdapter;
  catalog: { id: string; url: string; label: string }[];
  layout: string;
  theme: "light" | "dark";
  imports: { id: string; url: string; label: string }[];
  events: EventTarget;
  failedImports: Record<string, string>;
  save: (
    patch: {
      layout?: string;
      theme?: "light" | "dark";
      agents?: Agent[];
      imports?: Runtime["imports"];
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

async function boot(): Promise<Runtime> {
  const adapter = new PlatformAdapter();
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
        agents?: unknown;
        imports?: unknown;
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
  const agents = restoreAgents(value?.agents);
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
    );
  const failedImports: Runtime["failedImports"] = {};
  for (const entry of imports) {
    try {
      host.install(
        await loadExtension(new URL(entry.url, location.href).href, entry.id),
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
    agents,
    imports,
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
  host.install(
    agentExtension(agents, (agents, options) => save({ agents }, options)),
  );
  host.install(agentUI(() => events.dispatchEvent(new Event("extensions"))));
  await host.start("transform.upper");
  await host.start("agents.local");
  await host.start("ui.agents");
  return {
    host,
    adapter,
    catalog: [
      ...catalog,
      { id: "agents.local", url: "内置公开服务", label: "本地 Agent 提供者" },
      { id: "ui.agents", url: "内置可替换界面", label: "默认 Agent 界面" },
    ],
    layout: preferences.layout,
    theme: preferences.theme,
    imports,
    failedImports,
    events,
    save,
  };
}

export function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void boot()
      .then((value) => {
        if (active) setRuntime(value);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
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
        {error && <button onClick={() => location.reload()}>重新加载</button>}
      </main>
    );
  return <Workbench runtime={runtime} />;
}

function Workbench({ runtime }: { runtime: Runtime }) {
  const { host, adapter, catalog } = runtime;
  useSyncExternalStore(host.subscribe, host.snapshot);
  const [selected, setSelected] = useState(runtime.layout);
  const [theme, setTheme] = useState(runtime.theme);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    Object.keys(runtime.failedImports).length
      ? "有扩展加载失败，请在扩展管理重试或移除失效路径。"
      : "",
  );
  const [failedImports, setFailedImports] = useState(runtime.failedImports);
  const [notice, setNotice] = useState("");
  const [showExtensions, setShowExtensions] = useState(false);
  const [fault, setFault] = useState(false);
  const [settings, setSettings] = useState<
    "settings" | "roles" | "about" | null
  >(null);
  const [diagnostics, setDiagnostics] = useState(false);
  const [install, setInstall] = useState(false);
  const installTrigger = useRef<HTMLElement | null>(null);
  const [moduleUrl, setModuleUrl] = useState("");
  const [moduleId, setModuleId] = useState("");
  useEffect(() => {
    const open = () => setShowExtensions(true);
    runtime.events.addEventListener("extensions", open);
    return () => runtime.events.removeEventListener("extensions", open);
  }, [runtime]);
  const [authorization, setAuthorization] = useState<Authorization | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const managerButton = useRef<HTMLButtonElement>(null);
  const managerHeading = useRef<HTMLHeadingElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [failedViews, setFailedViews] = useState<Record<string, number>>({});
  const recovering = useRef<string | null>(null);
  const views = host
    .views()
    .filter(
      (view) =>
        view.id !== "role-settings" && failedViews[view.id] !== view.generation,
    );
  const roleView = host.views().find((view) => view.id === "role-settings");
  const activeView =
    views.find((view) => view.id === selected)?.id ??
    views.find((view) => view.id === "agents")?.id ??
    views.find((view) => view.id === "default")?.id ??
    views[0]?.id;
  const generation = views.find((view) => view.id === activeView)?.generation;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (adapter.kind === "native")
      void invoke("shell_set_theme", { theme }).catch((reason) =>
        setError(`窗口外观更新失败：${errorMessage(reason)}`),
      );
  }, [adapter, theme]);

  useEffect(() => {
    if (showExtensions) managerHeading.current?.focus();
  }, [showExtensions]);

  useEffect(() => {
    if (authorization) dialog.current?.showModal();
  }, [authorization]);

  useEffect(() => {
    const root = slot.current;
    if (!root || !activeView) return;
    const container = document.createElement("div");
    root.replaceChildren(container);
    try {
      const close = host.mountView(activeView, container);
      if (recovering.current) {
        setError(
          `布局不可用，已恢复${activeView === "default" ? "默认界面" : "可用界面"}：${recovering.current}`,
        );
        recovering.current = null;
      }
      return () => {
        try {
          const pending = close();
          if (pending)
            void pending.catch((reason) => setError(errorMessage(reason)));
        } catch (reason) {
          setError(errorMessage(reason));
        }
      };
    } catch (reason) {
      root.replaceChildren();
      recovering.current = errorMessage(reason);
      setError(
        `布局不可用；将使用可用布局或宿主恢复入口：${errorMessage(reason)}`,
      );
      setFailedViews((previous) => ({
        ...previous,
        [activeView]: generation!,
      }));
      setSelected("default");
    }
  }, [host, activeView, generation]);

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
      .find((view) => view.owner === id && view.id !== "role-settings");
    if (contributed) {
      await runtime.save({ layout: contributed.id });
      setSelected(contributed.id);
    }
  }
  async function savePreferences(layout: string, appearance: Runtime["theme"]) {
    await runtime.save({ layout, theme: appearance });
  }
  async function selectLayout(layout: string) {
    await savePreferences(layout, theme);
    setSelected(layout);
    setSettings(null);
  }
  async function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    await savePreferences(selected, next);
    setTheme(next);
  }
  const writeDenied = host.inspect("workbench").status === "waiting" && started;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <img className={styles.logo} src="/brand/plums.png" alt="" />
          <strong>Plums</strong>
          <span className={styles.stage}>M1</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.platform}>
            {adapter.kind === "native" ? "Rust 原生" : "浏览器预览"}
          </span>
          <button
            className={`secondary ${styles.themeSwitch}`}
            aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
            title={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
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
              {theme === "light" ? (
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
            onChoose={(action) => {
              if (action === "extensions" || action === "diagnostics") {
                setShowExtensions(true);
                setDiagnostics(action === "diagnostics");
              } else setSettings(action);
            }}
          />
        </div>
      </header>
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
        <div className={styles.stageArea} data-workspace>
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
        <aside
          id="extension-manager"
          hidden={!showExtensions}
          className={styles.inspector}
          aria-label="扩展管理"
        >
          <div className={styles.inspectorHeading}>
            <div>
              <span className="eyebrow">本地扩展 · {catalog.length}</span>
              <h2 ref={managerHeading} tabIndex={-1}>
                扩展与状态
              </h2>
            </div>
            <button
              ref={managerButton}
              className="secondary"
              onClick={() => toggleManager(false)}
            >
              返回工作区
            </button>
          </div>
          <button
            className="secondary"
            onClick={(e) => {
              installTrigger.current = e.currentTarget;
              setInstall(true);
            }}
          >
            安装扩展
          </button>
          <p className={styles.managerHint}>
            检查模块与所需能力；停用后保留已保存的数据。
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
                      const entry = runtime.imports.find((e) => e.id === id)!;
                      const target = new URL(entry.url, location.href);
                      target.searchParams.set("_retry", String(Date.now()));
                      host.install(await loadExtension(target.href, id));
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
                      await runtime.save({ imports });
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
            {catalog.map((entry) => {
              const { id } = entry;
              const state = host.inspect(id);
              const manifest = host.manifest(id);
              const capabilities = manifest.capabilities ?? [];
              return (
                <article key={id}>
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
                  {state.error && <p className="error">{state.error}</p>}
                  <p className={styles.resourceCount}>
                    {state.resources} 项资源 · {state.tasks} 个在途任务
                  </p>
                  <div className={styles.extensionActions}>
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
                            .map(([name, version]) => `${name}@${version}`)
                            .join("、") || "无"}
                        </dd>
                        <dt>提供服务</dt>
                        <dd>
                          {Object.entries(manifest.provides ?? {})
                            .map(([name, version]) => `${name}@${version}`)
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
                  {state.status === "cleanup-failed" && (
                    <p className="error">请重新启动应用以恢复此扩展。</p>
                  )}
                </article>
              );
            })}
          </div>
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
                requestAuthorization(["workbench"], start, event.currentTarget)
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
        </aside>
      </div>
      {settings && (
        <Dialog
          title={
            settings === "about"
              ? "关于 Plums"
              : settings === "roles"
                ? "角色卡设置"
                : "应用设置"
          }
          onClose={() => setSettings(null)}
        >
          {settings === "roles" ? (
            roleView ? (
              <ExtensionView
                host={host}
                id={roleView.id}
                generation={roleView.generation}
              />
            ) : (
              <div className="dialog-content">
                <p>
                  角色卡设置暂不可用，请在扩展管理中启用 Agent 提供者与默认
                  Agent 界面。
                </p>
                <button
                  className="secondary"
                  onClick={() => {
                    setSettings(null);
                    setShowExtensions(true);
                  }}
                >
                  查看扩展
                </button>
              </div>
            )
          ) : (
            <div className="dialog-content">
              {settings === "about" ? (
                <>
                  <img src="/brand/plums.png" width="56" height="56" alt="" />
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
                        onClick={() =>
                          void operate(() => selectLayout(view.id))
                        }
                      >
                        使用 {view.label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="secondary"
                    onClick={() => void operate(toggleTheme)}
                  >
                    {theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
                  </button>
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
          )}
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
                host.install(definition);
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
