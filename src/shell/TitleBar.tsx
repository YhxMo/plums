import type { Runtime } from "./runtime";
import type { Appearance } from "./useAppearance";
import type { ShellOperations } from "./useOperations";
import type { Workspace } from "./useWorkspace";
import type { WorkspaceChrome } from "./useWorkspaceChrome";
import type { ShellNavigation } from "./useShellNavigation";
import { SettingsMenu } from "../components/SettingsMenu";
import { Icon } from "../components/Icon";
import styles from "../App.module.css";

export function TitleBar({
  runtime,
  appearance,
  workspace,
  chrome,
  navigation,
  operations,
}: {
  runtime: Runtime;
  appearance: Appearance;
  workspace: Workspace;
  chrome: WorkspaceChrome;
  navigation: ShellNavigation;
  operations: ShellOperations;
}) {
  const managerOpen = navigation.manager.open;
  const title = managerOpen
    ? "扩展管理"
    : chrome.title ||
      (workspace.current?.chrome ? "" : workspace.current?.label || "工作空间");
  const isMacOverlay =
    runtime.adapter.kind === "native" && !/android/i.test(navigator.userAgent);
  return (
    <header
      className={`${styles.header} ${isMacOverlay ? styles.macOverlayHeader : ""}`}
      data-tauri-drag-region
    >
      <div className={styles.headerLeft} data-tauri-drag-region>
        <div className={styles.brand} data-tauri-drag-region>
          <img className={styles.logo} src="/brand/plums.png" alt="" />
          <strong>Plums</strong>
        </div>
        {title && (
          <>
            <span className={styles.topDivider} aria-hidden="true" />
            <span className={styles.topTitle} data-tauri-drag-region>
              {title}
            </span>
          </>
        )}
      </div>
      <div className={styles.headerRight}>
        <button
          className={`topbar-ghost ${styles.themeSwitch}`}
          aria-label={
            appearance.appearance === "light"
              ? "切换到深色模式"
              : "切换到浅色模式"
          }
          title={
            appearance.appearance === "light"
              ? "切换到深色模式"
              : "切换到浅色模式"
          }
          disabled={operations.busy}
          onClick={() =>
            void operations.operate(() =>
              appearance.toggleTheme(workspace.selected),
            )
          }
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {appearance.appearance === "light" ? (
              <path d="M20.6 13.1A8.6 8.6 0 0 1 10.9 3.4a8.7 8.7 0 1 0 9.7 9.7Z" />
            ) : (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </>
            )}
          </svg>
        </button>
        <SettingsMenu
          views={workspace.allViews.filter(
            (view) => view.presentation === "dialog",
          )}
          onView={navigation.setDialog}
          onChoose={(action) => {
            if (action === "extensions" || action === "diagnostics") {
              navigation.openManager(action === "diagnostics");
            } else navigation.setDialog(action);
          }}
        />
        <button
          className={`topbar-ghost ${styles.sidebarToggle}`}
          aria-label="展开或收起右侧栏"
          title={
            chrome.custom ? `切换 ${chrome.custom.label}` : "展开或收起右侧栏"
          }
          aria-pressed={chrome.open}
          onClick={(event) => chrome.toggle(event.currentTarget)}
        >
          <Icon name="sidebarList" size={18} />
        </button>
      </div>
    </header>
  );
}
