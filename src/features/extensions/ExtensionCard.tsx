import type { ReactNode } from "react";
import type { ExtensionCardModel } from "./controllers";
import { errorMessage, translateStatus } from "../../shell/messages";
import styles from "./ExtensionManager.module.css";

export function ExtensionCard({
  extension,
  onSelect,
  children,
}: {
  extension: Pick<
    ExtensionCardModel,
    "entry" | "manifest" | "state" | "agents" | "selected"
  >;
  onSelect(): void;
  children: ReactNode;
}) {
  const {
    entry,
    manifest,
    state,
    agents: boundAgents,
    selected: isSelected,
  } = extension;
  const { id } = entry;
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
      {state.error && <p className="error">{errorMessage(state.error)}</p>}
      <p className={styles.resourceCount}>
        {state.resources} 项资源 · {state.tasks} 个在途任务
      </p>
      {children}
      {state.status === "cleanup-failed" && (
        <p className="error">请重新启动应用以恢复此扩展。</p>
      )}
    </article>
  );
}
