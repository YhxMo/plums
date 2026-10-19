import type { ExtensionDetailsProps } from "./controllers";
import { capabilityLabel, translateStatus } from "../../shell/messages";
import styles from "../../shell/dialogs.module.css";
import managerStyles from "./ExtensionManager.module.css";
import { CredentialBindings } from "./CredentialBindings";
import { sourceLabel } from "../../../modules/shell/file-import";
import { Icon } from "../../components/Icon";
import { serviceList } from "./services";
export function ExtensionDetails({
  host,
  access,
  entry: activeSelectedExt,
  operations,
  inline,
}: ExtensionDetailsProps) {
  const extId = activeSelectedExt.id;
  const extState = host.inspect(extId);
  const extManifest = host.manifest(extId);
  const extCaps = extManifest.capabilities ?? [];
  const users = host.users(extId);
  return (
    <section
      aria-label="所选扩展详情"
      className={inline ? managerStyles.inlineDetail : styles.detailCard}
    >
      <header className={styles.detailCardHeader} hidden={inline}>
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
      {extManifest.description && (
        // Author text from the manifest; React renders it as plain text.
        <p className={styles.detailDescription}>{extManifest.description}</p>
      )}
      {users.map((group) => (
        <section className={styles.detailSection} key={group.owner}>
          <h4>
            {group.toggle ? `为 ${group.kind} 开启` : `使用中的 ${group.kind}`}
          </h4>
          <ul className={managerStyles.userChips}>
            {group.toggle
              ? [
                  ...group.users.map((user) => ({ ...user, on: true })),
                  ...group.others.map((user) => ({ ...user, on: false })),
                ].map((user) => (
                  <li key={user.id} className={managerStyles.toggleChip}>
                    <button
                      aria-pressed={user.on}
                      aria-label={`在 ${user.label} 中使用 ${activeSelectedExt.label}`}
                      disabled={operations.busy}
                      onClick={() =>
                        void operations.operate(() =>
                          host.toggleUser(
                            group.owner,
                            user.id,
                            extId,
                            !user.on,
                          ),
                        )
                      }
                    >
                      <Icon name={user.on ? "check" : "plus"} size={13} />
                      {user.label}
                    </button>
                  </li>
                ))
              : group.users.map((user) => <li key={user.id}>{user.label}</li>)}
          </ul>
          {group.toggle && (
            <p className={managerStyles.assignHint}>
              点按为单个 {group.kind} 开启或关闭此扩展。
            </p>
          )}
        </section>
      ))}
      <section className={styles.detailSection}>
        <h4>服务与权限概览</h4>
        <dl className={styles.detailMetaGrid}>
          <dt>模块位置</dt>
          <dd>{sourceLabel(activeSelectedExt.url)}</dd>
          <dt>所需服务</dt>
          <dd>{serviceList(extManifest.requires, extManifest.optional)}</dd>
          <dt>提供服务</dt>
          <dd>{serviceList(extManifest.provides)}</dd>
          <dt>系统权限</dt>
          <dd>
            {extCaps.length
              ? extCaps.map(capabilityLabel).join("、")
              : "无需原生能力"}
          </dd>
          <dt>运行资源</dt>
          <dd>
            {extState.resources} 项资源 · {extState.tasks} 个在途任务
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
        managed={!!extManifest.credentialProtocols}
      />
    </section>
  );
}
