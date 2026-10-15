import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Host, loadExtension } from "../modules/extension-host/host";
import type { StoredState } from "../modules/sdk";
import { PlatformAdapter } from "./platform";
import styles from "./App.module.css";

type Runtime = {
  host: Host;
  adapter: PlatformAdapter;
  labels: Record<string, string>;
  layout: string;
  revision: number;
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
async function boot(): Promise<Runtime> {
  const adapter = new PlatformAdapter();
  const host = new Host(adapter);
  const response = await fetch("/catalog.json");
  if (!response.ok) throw new Error("扩展目录读取失败");
  const catalog: { id: string; url: string; label: string }[] =
    await response.json();
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
    labels: Object.fromEntries(catalog.map((entry) => [entry.id, entry.label])),
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
        <h1>Plums 扩展实验室</h1>
        <p role={error ? "alert" : "status"}>{error || "正在读取本地扩展…"}</p>
        {error && <button onClick={() => location.reload()}>重新加载</button>}
      </main>
    );
  return <Workbench runtime={runtime} />;
}

function Workbench({ runtime }: { runtime: Runtime }) {
  const { host, adapter } = runtime;
  useSyncExternalStore(host.subscribe, host.snapshot);
  const [selected, setSelected] = useState(runtime.layout);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showExtensions, setShowExtensions] = useState(true);
  const [fault, setFault] = useState(false);
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
  }, [host, activeView, generation, started]);

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
    setNotice("实验组合已启用；权限仅用于本应用隔离实验状态。");
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
  const translateStatus = (status: string) =>
    ({
      disabled: "已停用",
      active: "运行中",
      stopping: "停用中",
      waiting: "等待条件",
      failed: "激活失败",
      "cleanup-failed": "清理未完成",
    })[status] ?? status;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <a className={styles.brand} href="#">
          <span className={styles.logo}>P</span>
          <strong>Plums</strong>
          <span className={styles.stage}>M1 / 扩展实验室</span>
        </a>
        <div className={styles.headerRight}>
          <span className={styles.platform}>
            {adapter.kind === "native"
              ? "● Rust 原生已连接"
              : "○ 浏览器预览 · 非原生验收"}
          </span>
          <button
            className="secondary"
            aria-expanded={showExtensions}
            onClick={() => setShowExtensions(!showExtensions)}
          >
            扩展管理
          </button>
        </div>
      </header>
      <section className={styles.toolbar} aria-label="实验控制">
        <div className={styles.layoutSwitch}>
          <label htmlFor="layout">界面布局</label>
          <select
            id="layout"
            value={activeView ?? ""}
            disabled={!started || busy || !views.length}
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
        <div className={styles.controls}>
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
                setNotice("已通过相同服务契约替换提供者。");
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
                setNotice("当前布局已停用；使用可用布局回退。");
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
        </div>
      </section>
      {(error || notice) && (
        <div
          className={error ? styles.error : styles.notice}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.stageArea}>
          {!activeView && (
            <main className={styles.welcome}>
              <span className="eyebrow">COMPOSE YOUR POSSIBILITIES</span>
              <h1>
                {started ? "扩展正在等待条件。" : "从一个可替换的界面开始。"}
              </h1>
              <p>
                服务、业务与布局分别由独立模块提供。这个实验只处理本地示例文本，不连接模型或外部账户。
              </p>
              <div className={styles.permission}>
                <strong>本次需要的能力</strong>
                <p>
                  文本工作台：读取、写入本应用的隔离实验状态。可信扩展共享运行环境，不具备恶意代码安全隔离。
                </p>
              </div>
              <button disabled={busy} onClick={() => void operate(start)}>
                {started ? "恢复权限与默认界面" : "授予实验能力并启动"}
              </button>
            </main>
          )}
          <div ref={slot} hidden={!activeView} />
        </div>
        {showExtensions && (
          <aside className={styles.inspector} aria-label="扩展管理">
            <div className={styles.inspectorHeading}>
              <span className="eyebrow">EXTENSIONS</span>
              <h2>组合与状态</h2>
            </div>
            <div className={styles.extensions}>
              {host.ids().map((id) => {
                const state = host.inspect(id);
                return (
                  <article key={id}>
                    <div>
                      <strong>{runtime.labels[id]}</strong>
                      <span
                        className={`${styles.status} ${state.status === "active" ? styles.active : ""}`}
                      >
                        {translateStatus(state.status)}
                      </span>
                    </div>
                    <code>
                      {id} · {host.manifest(id).version}
                    </code>
                    {state.error && <p>{state.error}</p>}
                    <small>
                      {state.resources} 项资源 · {state.tasks} 个在途任务
                    </small>
                    <small>
                      能力：
                      {host.manifest(id).capabilities?.join(", ") ||
                        "无原生能力"}
                    </small>
                    <button
                      className="secondary"
                      aria-label={`${state.status === "active" ? "停用" : "启用"} ${id}`}
                      disabled={
                        busy ||
                        state.status === "cleanup-failed" ||
                        state.status === "stopping"
                      }
                      onClick={() =>
                        void operate(async () => {
                          if (state.status === "active") await host.stop(id);
                          else {
                            await host.grant(
                              id,
                              host.manifest(id).capabilities ?? [],
                            );
                            await host.start(id);
                          }
                        })
                      }
                    >
                      {state.status === "active" ? "停用" : "启用"}
                    </button>
                  </article>
                );
              })}
            </div>
            <div className={styles.faultControls}>
              <h3>失败路径实验</h3>
              <button
                className="secondary"
                disabled={!started || busy}
                onClick={() =>
                  void operate(async () => {
                    await host.grant(
                      "workbench",
                      writeDenied
                        ? ["state.read", "state.write"]
                        : ["state.read"],
                    );
                    setNotice(
                      writeDenied
                        ? "已恢复状态写入能力。"
                        : "已撤销写入能力，依赖方进入等待。",
                    );
                  })
                }
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
              <p>
                故障注入用于检查错误反馈与数据保留，不代表已验证操作系统权限。
              </p>
            </div>
          </aside>
        )}
      </div>
      <footer className={styles.footer}>
        <span>本地 ESM 扩展 · 实验契约 v1</span>
        <span>移动端与其他桌面平台尚未验证</span>
      </footer>
    </div>
  );
}
