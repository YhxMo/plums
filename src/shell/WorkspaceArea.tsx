import type { WorkspaceAreaProps } from "./controllers";
import { ExtensionView } from "../components/ExtensionView";
import { Icon } from "../components/Icon";
import styles from "./layout.module.css";
export function WorkspaceArea({
  host,
  workspace,
  chrome,
  hidden,
  children,
}: WorkspaceAreaProps) {
  return (
    <>
      <div
        className={styles.stageArea}
        data-workspace
        hidden={hidden}
        inert={hidden || undefined}
      >
        {!workspace.activeView && children}
        <div
          ref={workspace.slot}
          hidden={!workspace.activeView}
          className={styles.viewSlot}
        />
      </div>
      {!hidden && chrome.custom && chrome.open && (
        <aside
          className={styles.extensionSidebar}
          aria-label={chrome.custom.label}
        >
          <header className={styles.extensionSidebarHeader}>
            <h2>{chrome.custom.label}</h2>
            <button
              className="topbar-ghost"
              aria-label="收起扩展侧栏"
              onClick={chrome.closeCustom}
            >
              <Icon name="close" size={16} />
            </button>
          </header>
          <div className={styles.extensionSidebarBody}>
            <ExtensionView
              host={host}
              id={chrome.custom.id}
              generation={chrome.custom.generation}
            />
          </div>
        </aside>
      )}
    </>
  );
}
