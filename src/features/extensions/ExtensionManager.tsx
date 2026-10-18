import type { ReactNode } from "react";
import { useMediaQuery } from "../../components/useMediaQuery";
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
  // One column: details open inside the selected card instead of below the list.
  const narrow = useMediaQuery("(max-width: 1020px)");
  const details = detail.entry && (
    <ExtensionDetails
      host={detail.host}
      access={detail.access}
      entry={detail.entry}
      operations={detail.operations}
      inline={narrow}
    />
  );
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
              <ExtensionList
                controller={controller.list}
                selectedDetail={narrow ? details : undefined}
              />
            </div>
            <div className={styles.managerDetailPane}>
              {!narrow && details}
              {diagnostics}
              <RetainedCredentialBindings
                access={detail.access}
                operations={detail.operations}
                installed={controller.list.installed}
              />
            </div>
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
