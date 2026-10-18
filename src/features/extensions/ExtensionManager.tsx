import type { ReactNode } from "react";
import type { ExtensionManagerController } from "./controllers";
import { ManagerHeader } from "./ManagerHeader";
import { ExtensionList } from "./ExtensionList";
import { ExtensionDetails } from "./ExtensionDetails";
import { ExtensionDialogs } from "./ExtensionDialogs";
import { RetainedCredentialBindings } from "./CredentialBindings";
import styles from "./ExtensionManager.module.css";

export function ExtensionManager({
  controller,
  diagnostics,
}: {
  controller: ExtensionManagerController;
  diagnostics: ReactNode;
}) {
  const { detail } = controller;
  return (
    <>
      <aside
        id="extension-manager"
        hidden={!controller.visible}
        className={styles.inspector}
        aria-label="扩展管理"
      >
        <ManagerHeader controller={controller.header} />
        <div className={styles.managerScroll}>
          <div className={styles.managerPage}>
            <div className={styles.managerMaster}>
              <p className={styles.managerHint}>
                检查模块与所需能力；停用后保留已保存的数据。保存当前组合会记录启用集合、扩展版本与当前外观，权限和扩展业务数据分别管理。
              </p>
              <ExtensionList controller={controller.list} />
            </div>
            <section
              className={styles.managerDetailPane}
              aria-label="所选扩展与关联 Agent 详情"
            >
              {detail.entry && (
                <ExtensionDetails
                  host={detail.host}
                  access={detail.access}
                  entry={detail.entry}
                  agents={detail.agents}
                  operations={detail.operations}
                  onReveal={detail.onReveal}
                />
              )}
              {diagnostics}
              <RetainedCredentialBindings
                access={detail.access}
                operations={detail.operations}
                installed={controller.list.installed}
              />
            </section>
          </div>
        </div>
      </aside>
      <ExtensionDialogs
        controller={controller.dialogs}
        host={detail.host}
        feedback={detail.operations}
      />
    </>
  );
}
