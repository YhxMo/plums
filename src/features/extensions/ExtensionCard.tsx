import type { Runtime } from "../../shell/runtime";
import type { ShellOperations } from "../../shell/useOperations";
import type { Workspace } from "../../shell/useWorkspace";
import type { Authorization } from "../../shell/AuthorizationDialog";
import type { Agent } from "../../../modules/sdk/agents";
import { extensionOwner } from "../../../modules/sdk";
import { SelectedDocuments } from "../../components/SelectedDocuments";
import { capabilityLabel, translateStatus } from "../../shell/messages";
import styles from "../../App.module.css";
export function ExtensionCard({
  runtime,
  entry,
  operations,
  workspace,
  authorization,
  boundAgents,
  selected: isSelected,
  onSelect,
  onConfigure,
  onUninstall,
}: {
  runtime: Runtime;
  entry: Runtime["catalog"][number];
  operations: ShellOperations;
  workspace: Workspace;
  authorization: Authorization;
  boundAgents: Agent[];
  selected: boolean;
  onSelect: () => void;
  onConfigure: (source: HTMLElement) => void;
  onUninstall: (source: HTMLElement) => void;
}) {
  const { host } = runtime;
  const { id } = entry;
  const state = host.inspect(id);
  const manifest = host.manifest(id);
  const capabilities = manifest.capabilities ?? [];
  const { busy, operate } = operations;
  const { requestAuthorization } = authorization;
  return (
    <article
      key={id}
      className={`${styles.extensionItem} ${isSelected ? styles.extensionItemSelected : ""}`}
      onClick={onSelect}
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
              onConfigure(event.currentTarget);
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
              onUninstall(event.currentTarget);
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
            if (state.status === "active") void operate(() => host.stop(id));
            else if (capabilities.length)
              requestAuthorization(
                [id],
                async () => {
                  await host.grant(id, capabilities);
                  await workspace.enableExtension(id);
                },
                event.currentTarget,
              );
            else
              void operate(async () => {
                await workspace.enableExtension(id);
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
}
