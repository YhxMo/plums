import type { ExtensionDetailsProps } from "./controllers";
import { capabilityLabel, translateStatus } from "../../shell/messages";
import styles from "../../shell/dialogs.module.css";
import managerStyles from "./ExtensionManager.module.css";
import { CredentialBindings } from "./CredentialBindings";
import { sourceLabel } from "../../../modules/shell/file-import";
export function ExtensionDetails({
  host,
  access,
  entry: activeSelectedExt,
  operations,
}: ExtensionDetailsProps) {
  const extId = activeSelectedExt.id;
  const extState = host.inspect(extId);
  const extManifest = host.manifest(extId);
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
        <h4>服务与权限概览</h4>
        <dl className={styles.detailMetaGrid}>
          <dt>模块位置</dt>
          <dd>{sourceLabel(activeSelectedExt.url)}</dd>
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
        access={access}
        operations={operations}
        id={extId}
        source={activeSelectedExt.url}
        version={extManifest.version}
        declarations={extManifest.credentialBindings ?? {}}
      />
    </div>
  );
}
