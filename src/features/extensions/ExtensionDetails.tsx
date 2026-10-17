import type { Runtime } from "../../shell/runtime";
import type { Agent } from "../../../modules/sdk/agents";
import { capabilityLabel, translateStatus } from "../../shell/messages";
import styles from "../../shell/dialogs.module.css";
import managerStyles from "./ExtensionManager.module.css";
import { CredentialBindings } from "./CredentialBindings";
import type { ShellOperations } from "../../shell/useOperations";
export function ExtensionDetails({
  runtime,
  entry: activeSelectedExt,
  agents: extBoundAgents,
  onReveal,
  operations,
}: {
  runtime: Runtime;
  entry: Runtime["catalog"][number];
  agents: Agent[];
  onReveal?: (id: string) => void;
  operations: ShellOperations;
}) {
  const extId = activeSelectedExt.id;
  const extState = runtime.host.inspect(extId);
  const extManifest = runtime.host.manifest(extId);
  const extCaps = extManifest.capabilities ?? [];
  return (
    <div className={styles.detailCard}>
      <header className={styles.detailCardHeader}>
        <div>
          <div className={managerStyles.extensionTitle}>
            <h3>{activeSelectedExt.label}</h3>
            <span
              className={`${managerStyles.status} ${extState.status === "active" ? managerStyles.active : ""}`}
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
              <div key={agent.id} className={styles.boundAgentRow}>
                <div>
                  <strong>{agent.name}</strong>
                  <p className="muted">{agent.description}</p>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={!onReveal}
                  title={
                    onReveal
                      ? undefined
                      : "当前工作区不支持 Agent 导航，请先切换到 Agent 界面"
                  }
                  onClick={() => onReveal?.(agent.id)}
                >
                  跳转到 Agent →
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">当前没有启用中的 Agent 直接绑定此扩展。</p>
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
      <CredentialBindings
        key={extId}
        access={runtime.adapter.credentials}
        operations={operations}
        id={extId}
        source={activeSelectedExt.url}
        version={extManifest.version}
        declarations={extManifest.credentialBindings ?? {}}
      />
    </div>
  );
}
