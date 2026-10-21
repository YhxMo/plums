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
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-rail">
      <TitleBar
        platformKind={runtime.adapter.kind}
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
        <NavRail
          operations={operations}
          appearance={appearance}
          workspace={workspace}
          navigation={navigation}
        />
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
