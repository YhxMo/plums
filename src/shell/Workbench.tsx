import { useSyncExternalStore } from "react";
import type { Runtime } from "./runtime";
import { useOperations } from "./useOperations";
import { useAppearance } from "./useAppearance";
import { useWorkspace } from "./useWorkspace";
import { useWorkspaceChrome } from "./useWorkspaceChrome";
import { useShellNavigation } from "./useShellNavigation";
import { useSystemBack } from "./useSystemBack";
import { useExperiments } from "../features/extensions/useExperiments";
import { AuthorizationDialog, useAuthorization } from "./AuthorizationDialog";
import { TitleBar } from "./TitleBar";
import { NavRail } from "./NavRail";
import { SidebarToggle } from "./ShellActions";
import { ShellFeedback } from "./ShellFeedback";
import { WorkspaceArea } from "./WorkspaceArea";
import { RecoveryWelcome } from "./RecoveryWelcome";
import { ShellDialogs } from "./ShellDialogs";
import { ExtensionManager } from "../features/extensions/ExtensionManager";
import { useExtensionManager } from "../features/extensions/useExtensionManager";
import { DiagnosticsPanel } from "../features/extensions/DiagnosticsPanel";
import { DiagnosticActions } from "../features/extensions/DiagnosticActions";

/** Composes feature owners; it does not own extension form or workspace state. */
export function Workbench({ runtime }: { runtime: Runtime }) {
  const macOverlay =
    runtime.adapter.kind === "native" && /Macintosh/.test(navigator.userAgent);
  useSyncExternalStore(runtime.host.subscribe, runtime.host.snapshot);
  const operations = useOperations(runtime);
  const appearance = useAppearance(runtime, operations);
  const workspace = useWorkspace(runtime, operations);
  const chrome = useWorkspaceChrome(workspace);
  const navigation = useShellNavigation(runtime);
  useSystemBack(navigation, chrome);
  const authorization = useAuthorization();
  const experiments = useExperiments(
    runtime,
    workspace,
    navigation.closeManager,
  );
  const management = useExtensionManager(runtime, {
    operations,
    workspace,
    navigation,
    authorization,
  });
  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-chrome max-md:flex-col">
      {macOverlay && (
        <>
          {/* AppKit owns the buttons. Reserve a row without HTML controls when
              the rail is absent, and keep a drag strip above wide panes. */}
          <div
            className="h-9 shrink-0 bg-chrome md:hidden"
            data-tauri-drag-region
          />
          <div
            className="fixed inset-x-0 top-0 z-40 h-3 max-md:hidden"
            data-tauri-drag-region
          />
        </>
      )}
      <NavRail
        macOverlay={macOverlay}
        operations={operations}
        appearance={appearance}
        workspace={workspace}
        navigation={navigation}
      />
      {/* The content is one rounded, raised pane on the chrome beside the rail,
          unless the view draws its own panels there (see `.pane`). */}
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col md:p-2 md:pl-0"
        data-tauri-drag-region
      >
        <div
          className="pane relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-manager={navigation.manager.open}
        >
          {/* Desktop keeps the sidebar button in the pane's top-right corner; headers leave room for it. */}
          {!navigation.manager.open && (
            <div className="pane-toggle absolute right-2 z-3 max-md:hidden">
              <SidebarToggle chrome={chrome} side="bottom" />
            </div>
          )}
          <TitleBar
            operations={operations}
            appearance={appearance}
            workspace={workspace}
            chrome={chrome}
            navigation={navigation}
          />
          <ShellFeedback
            runtime={runtime}
            operations={operations}
            appearance={appearance}
            workspace={workspace}
            navigation={navigation}
            failedImports={management.failedImports}
          />
          <div
            className="isolate flex min-h-0 flex-1 items-stretch"
            data-inspecting={navigation.manager.open}
          >
            <div className="flex min-w-0 flex-1 overflow-hidden">
              <WorkspaceArea
                host={runtime.host}
                workspace={workspace}
                chrome={chrome}
                hidden={navigation.manager.open}
              >
                <RecoveryWelcome
                  operations={operations}
                  experiments={experiments}
                  authorization={authorization}
                  onExtensions={() => navigation.openManager()}
                />
              </WorkspaceArea>
              <ExtensionManager
                controller={management}
                diagnostics={
                  import.meta.env.DEV && (
                    <DiagnosticsPanel
                      open={navigation.manager.diagnostics}
                      onToggle={navigation.setDiagnostics}
                    >
                      <DiagnosticActions
                        runtime={runtime}
                        operations={operations}
                        workspace={workspace}
                        authorization={authorization}
                        experiments={experiments}
                      />
                    </DiagnosticsPanel>
                  )
                }
              />
            </div>
          </div>
        </div>
      </div>
      <ShellDialogs
        host={runtime.host}
        operations={operations}
        appearance={appearance}
        workspace={workspace}
        navigation={navigation}
      />
      <AuthorizationDialog
        runtime={runtime}
        operations={operations}
        controller={authorization}
      />
    </div>
  );
}
