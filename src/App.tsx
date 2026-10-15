import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Host, loadExtension } from "../modules/extension-host/host";
import type { StoredState } from "../modules/sdk";
import { PlatformAdapter } from "./platform";
import styles from "./App.module.css";

type Runtime = {
  host: Host;
  adapter: PlatformAdapter;
  catalog: { id: string; url: string; label: string }[];
  layout: string;
  revision: number;
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
  for (const entry of catalog)
    host.install(
      await loadExtension(new URL(entry.url, location.href).href, entry.id),
    );
  await adapter.grant("host.shell", [
    "state.read",
    "state.write",
    "platform.info",
  ]);
  const saved = (await adapter.call(
    "host.shell",
    "state.read",
  )) as StoredState | null;
  const value = saved?.value as { layout?: unknown } | undefined;
  return {
    host,
    adapter,
    catalog,
    layout: typeof value?.layout === "string" ? value.layout : "default",
    revision: saved?.revision ?? 0,
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
        <span className={styles.logo}>P</span>
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
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showExtensions, setShowExtensions] = useState(false);
  const [fault, setFault] = useState(false);
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
    .filter((view) => failedViews[view.id] !== view.generation);
  const activeView =
    views.find((view) => view.id === selected)?.id ??
    views.find((view) => view.id === "default")?.id ??
    views[0]?.id;
  const generation = views.find((view) => view.id === activeView)?.generation;
  const states = host.ids().map((id) => host.inspect(id));
  const activeCount = states.filter(
    (state) => state.status === "active",
  ).length;
  const taskCount = states.reduce((total, state) => total + state.tasks, 0);

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
  }
  async function selectLayout(layout: string) {
    setSelected(layout);
    const saved = (await adapter.call("host.shell", "state.write", {
      revision: runtime.revision,
      value: { version: 1, layout },
    })) as StoredState;
    runtime.revision = saved.revision;
  }
  const writeDenied = host.inspect("workbench").status === "waiting" && started;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}>P</span>
          <strong>Plums</strong>
          <span className={styles.stage}>
            扩展实验室 <b>M1</b>
          </span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.platform}>
            {adapter.kind === "native" ? "Rust 原生" : "浏览器预览"}
          </span>
          <button
            ref={managerButton}
            className={showExtensions ? "selected secondary" : "secondary"}
            aria-expanded={showExtensions}
            aria-controls="extension-manager"
            onClick={() => toggleManager(!showExtensions)}
          >
            扩展管理
          </button>
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
          {(started || views.length > 0) && (
            <section className={styles.toolbar} aria-label="工作区控制">
              <div className={styles.layoutSwitch}>
                <label htmlFor="layout">工作区</label>
                <select
                  id="layout"
                  aria-label="界面布局"
                  value={activeView ?? ""}
                  disabled={busy || !views.length}
                  onChange={(event) =>
                    void operate(() => selectLayout(event.target.value))
                  }
                >
                  {!views.length && <option value="">尚未启用</option>}
                  {views.map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.label}
                    </option>
                  ))}
                </select>
              </div>
              <span className={styles.runtimeStatus} role="status">
                {activeCount} 个扩展运行中 · {taskCount} 个任务
              </span>
            </section>
          )}
          {!activeView && (
            <main className={styles.welcome}>
              <span className={styles.welcomeMark} aria-hidden="true">
                P<span>＋</span>
              </span>
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
            <button className="secondary" onClick={() => toggleManager(false)}>
              返回工作区
            </button>
          </div>
          <p className={styles.managerHint}>
            检查模块与所需能力；停用后保留已保存的数据。
          </p>
          <div className={styles.extensions}>
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
                              await host.start(id);
                            },
                            event.currentTarget,
                          );
                        else void operate(() => host.start(id));
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
          <details className={styles.diagnostics}>
            <summary>诊断与实验</summary>
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
      <footer className={styles.footer}>
        <span>本地 ESM · 实验契约 v1</span>
        <span>
          {adapter.kind === "browser"
            ? "浏览器预览 · 非原生验收"
            : "M1 调试原型"}
        </span>
      </footer>
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
