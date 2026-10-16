import { useEffect, useRef, useState } from "react";
import { loadExtension } from "../../../modules/extension-host/host";
import { captureComposition } from "../../../modules/shell/composition";
import {
  mapExtensionAgents,
  readActiveAgents,
} from "../../../modules/shell/diagnostics";
import type { Runtime } from "../../shell/runtime";
import type { ShellOperations } from "../../shell/useOperations";
import type { Workspace } from "../../shell/useWorkspace";
import type { Appearance } from "../../shell/useAppearance";
import type { Authorization } from "../../shell/AuthorizationDialog";
import type { ShellNavigation } from "../../shell/useShellNavigation";
import type { Experiments } from "../../shell/useExperiments";
import { Icon } from "../../components/Icon";
import { ConfigurationDialog } from "./ConfigurationDialog";
import { InstallDialog } from "./InstallDialog";
import { UninstallDialog } from "./UninstallDialog";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ExtensionCard } from "./ExtensionCard";
import { ExtensionDetails } from "./ExtensionDetails";
import { saveRemovedImport } from "./operations";
import styles from "../../App.module.css";

type ManagementDialog =
  | { kind: "install"; source: HTMLElement }
  | { kind: "configure" | "uninstall"; id: string; source: HTMLElement }
  | null;

export function ExtensionManager({
  runtime,
  operations,
  workspace,
  appearance,
  authorization,
  navigation,
  experiments,
  onReveal,
  failedImports,
  clearFailure,
}: {
  runtime: Runtime;
  operations: ShellOperations;
  workspace: Workspace;
  appearance: Appearance;
  authorization: Authorization;
  navigation: ShellNavigation;
  experiments: Experiments;
  onReveal?: (id: string) => void;
  failedImports: Record<string, string>;
  clearFailure: (id: string) => void;
}) {
  const { host, catalog } = runtime;
  const { manager, closeManager } = navigation;
  const { busy, operate, setError, setNotice } = operations;
  const [selectedId, setSelectedId] = useState(
    () =>
      catalog.find((entry) => host.ids().includes(entry.id))?.id ??
      "agents.local",
  );
  const [dialog, setDialog] = useState<ManagementDialog>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const removed = useRef(false);
  useEffect(() => {
    if (manager.open) {
      if (manager.targetId) setSelectedId(manager.targetId);
      heading.current?.focus();
    }
  }, [manager.open, manager.targetId]);
  useEffect(() => {
    if (!dialog && removed.current) {
      removed.current = false;
      heading.current?.focus();
    }
  }, [dialog]);
  const installed = catalog.filter((entry) => host.ids().includes(entry.id));
  const selected =
    installed.find((entry) => entry.id === selectedId) ?? installed[0];
  const extensionAgents = mapExtensionAgents(host, readActiveAgents(host));
  function openDialog(
    kind: "configure" | "uninstall",
    id: string,
    source: HTMLElement,
  ) {
    setError("");
    setDialog({ kind, id, source });
  }
  return (
    <>
      <aside
        id="extension-manager"
        hidden={!manager.open}
        className={styles.inspector}
        aria-label="扩展管理"
      >
        <div className={styles.managerPage}>
          <div className={styles.managerMaster}>
            <div className={styles.inspectorHeading}>
              <div className={styles.inspectorHeadingLeft}>
                <button
                  className={`topbar-ghost ${styles.backArrow}`}
                  aria-label="返回工作区"
                  title="返回工作区"
                  onClick={closeManager}
                >
                  <Icon name="arrowLeft" size={18} />
                </button>
                <div>
                  <span className="eyebrow">本地扩展 · {catalog.length}</span>
                  <h2 ref={heading} tabIndex={-1}>
                    扩展与状态
                  </h2>
                </div>
              </div>
              <div className={styles.managerGlobalActions}>
                <button
                  className="secondary"
                  onClick={(event) =>
                    setDialog({ kind: "install", source: event.currentTarget })
                  }
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
                        layout: workspace.selected,
                        theme: appearance.theme,
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
                          (item) => item.id === id,
                        )!;
                        const target = new URL(entry.url, location.href);
                        target.searchParams.set("_retry", String(Date.now()));
                        host.install(
                          await loadExtension(target.href, id),
                          runtime.configurations[id],
                        );
                        catalog.push(entry);
                        clearFailure(id);
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
                          (entry) => entry.id !== id,
                        );
                        await saveRemovedImport(runtime, id, imports);
                        runtime.imports = imports;
                        clearFailure(id);
                      })
                    }
                  >
                    移除失效路径
                  </button>
                </article>
              ))}
              {installed.map((entry) => (
                <ExtensionCard
                  key={entry.id}
                  {...{ runtime, operations, workspace, authorization, entry }}
                  boundAgents={extensionAgents[entry.id] ?? []}
                  selected={selected?.id === entry.id}
                  onSelect={() => setSelectedId(entry.id)}
                  onConfigure={(source) =>
                    openDialog("configure", entry.id, source)
                  }
                  onUninstall={(source) =>
                    openDialog("uninstall", entry.id, source)
                  }
                />
              ))}
            </div>
          </div>
          <section
            className={styles.managerDetailPane}
            aria-label="所选扩展与关联 Agent 详情"
          >
            {selected && (
              <ExtensionDetails
                runtime={runtime}
                entry={selected}
                agents={extensionAgents[selected.id] ?? []}
                onReveal={
                  onReveal
                    ? (id) => {
                        onReveal(id);
                        closeManager();
                      }
                    : undefined
                }
              />
            )}
            <DiagnosticsPanel
              {...{
                runtime,
                operations,
                workspace,
                authorization,
                experiments,
              }}
              open={manager.diagnostics}
              onToggle={navigation.setDiagnostics}
            />
          </section>
        </div>
      </aside>
      <InstallDialog
        {...{ runtime, operations }}
        open={dialog?.kind === "install"}
        source={dialog?.source ?? null}
        onClose={() => setDialog(null)}
        onInstalled={clearFailure}
      />
      {dialog?.kind === "configure" && (
        <ConfigurationDialog
          {...{ runtime, operations }}
          id={dialog.id}
          source={dialog.source}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "uninstall" && (
        <UninstallDialog
          {...{ runtime, operations }}
          id={dialog.id}
          source={dialog.source}
          onClose={() => setDialog(null)}
          onRemoved={() => {
            removed.current = true;
            setDialog(null);
          }}
        />
      )}
    </>
  );
}
