import {
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cn } from "cn";
import type { Runtime } from "./runtime";
import { useOperations } from "./useOperations";
import { useAppearance } from "./useAppearance";
import { useWorkspace } from "./useWorkspace";
import { useWorkspaceChrome } from "./useWorkspaceChrome";
import { useShellNavigation } from "./useShellNavigation";
import { useSystemBack } from "./useSystemBack";
import { useAppCommands } from "./useAppCommands";
import { useExperiments } from "@/features/extensions/useExperiments";
import { AuthorizationDialog, useAuthorization } from "./AuthorizationDialog";
import { TitleBar } from "./TitleBar";
import { NavRail } from "./NavRail";
import { SidebarToggle } from "./SidebarToggle";
import { ShellFeedback } from "./ShellFeedback";
import { WorkspaceArea } from "./WorkspaceArea";
import { RecoveryWelcome } from "./RecoveryWelcome";
import { ShellDialogs } from "./ShellDialogs";
import { WindowDropHint } from "./WindowDrop";
import { useExtensionManager } from "@/features/extensions/useExtensionManager";
import { DiagnosticsPanel } from "@/features/extensions/DiagnosticsPanel";
import { DiagnosticActions } from "@/features/extensions/DiagnosticActions";

// Loaded the first time it is needed, then kept mounted like before.
const ExtensionManager = lazy(() =>
  import("@/features/extensions/ExtensionManager").then((module) => ({
    default: module.ExtensionManager,
  })),
);

/** Composes feature owners; it does not own extension form or workspace state. */
export function Workbench({ runtime }: { runtime: Runtime }) {
  // AppKit draws the window buttons over the content only in the Mac app.
  const macOverlay = runtime.os === "macos";
  useSyncExternalStore(runtime.host.subscribe, runtime.host.snapshot);
  const operations = useOperations(runtime);
  const appearance = useAppearance(runtime, operations);
  const navigation = useShellNavigation(runtime);
  const workspace = useWorkspace(runtime, operations, !navigation.manager.open);
  const chrome = useWorkspaceChrome(workspace);
  useSystemBack(navigation, chrome);
  useAppCommands(
    runtime,
    (command) => {
      // A dialog covers the workspace and the menu's commands alike.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (command === "settings") navigation.openDialog("settings");
      else if (!navigation.manager.open) chrome.commands[command]?.();
    },
    operations.setError,
  );
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
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!macOverlay) return;
    document.documentElement.dataset.glass = "";
    return () => {
      delete document.documentElement.dataset.glass;
    };
  }, [macOverlay]);
  const [managerLoaded, setManagerLoaded] = useState(false);
  // Its dialogs live with it, including packages a bundle offers.
  if (
    !managerLoaded &&
    (navigation.manager.open ||
      management.dialogs.dialog ||
      management.dialogs.offer)
  )
    setManagerLoaded(true);
  return (
    <div
      ref={root}
      className={cn(
        "flex h-dvh min-h-0 overflow-hidden max-md:flex-col",
        !macOverlay && "bg-chrome",
      )}
    >
      {/* AppKit owns the buttons in the rail's top strip; the Mac window is
          never narrower than the rail layout. A strip keeps the top edge
          dragging the window above the panes. */}
      {macOverlay && (
        <div
          className="fixed inset-x-0 top-0 z-40 h-3"
          data-tauri-drag-region
        />
      )}
      <NavRail
        macOverlay={macOverlay}
        operations={operations}
        workspace={workspace}
        navigation={navigation}
      />
      {/* The content is one card floating on the window colour beside the
          rail, unless the view says it draws its own (see `.pane`). */}
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-chrome"
        data-tauri-drag-region
      >
        <div
          className="pane relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-frame={navigation.manager.open ? undefined : chrome.frame}
        >
          {/* Desktop keeps the sidebar button in the pane's top-right corner; headers leave room for it. */}
          {!navigation.manager.open && (
            <div className="pane-toggle absolute z-3 max-md:hidden">
              <SidebarToggle chrome={chrome} side="bottom" />
            </div>
          )}
          <TitleBar
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
              {managerLoaded && (
                <Suspense fallback={null}>
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
                </Suspense>
              )}
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
      {/* The hidden workspace takes no files while management shows. */}
      <WindowDropHint
        root={root}
        drop={navigation.manager.open ? undefined : chrome.drop}
      />
    </div>
  );
}
