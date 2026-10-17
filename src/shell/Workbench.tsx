import { useState, useSyncExternalStore } from "react";
import type { Runtime } from "./runtime";
import { useOperations } from "./useOperations";
import { useAppearance } from "./useAppearance";
import { useWorkspace } from "./useWorkspace";
import { useWorkspaceChrome } from "./useWorkspaceChrome";
import { useShellNavigation } from "./useShellNavigation";
import { useExperiments } from "./useExperiments";
import { AuthorizationDialog, useAuthorization } from "./AuthorizationDialog";
import { TitleBar } from "./TitleBar";
import { ShellFeedback } from "./ShellFeedback";
import { WorkspaceArea } from "./WorkspaceArea";
import { ShellDialogs } from "./ShellDialogs";
import { ExtensionManager } from "../features/extensions/ExtensionManager";
import styles from "./layout.module.css";

/** Composes feature owners; it does not own extension form or workspace state. */
export function Workbench({ runtime }: { runtime: Runtime }) {
  useSyncExternalStore(runtime.host.subscribe, runtime.host.snapshot);
  const operations = useOperations(runtime);
  const appearance = useAppearance(runtime, operations);
  const workspace = useWorkspace(runtime, operations, appearance.theme);
  const chrome = useWorkspaceChrome(workspace);
  const navigation = useShellNavigation(runtime);
  const authorization = useAuthorization();
  const experiments = useExperiments(
    runtime,
    workspace,
    navigation.closeManager,
  );
  const [failedImports, setFailedImports] = useState(runtime.failedImports);
  function clearFailure(id: string) {
    setFailedImports((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }
  return (
    <div className={styles.app}>
      <TitleBar
        {...{ runtime, operations, appearance, workspace, chrome, navigation }}
      />
      <ShellFeedback
        {...{
          runtime,
          operations,
          appearance,
          workspace,
          navigation,
          failedImports,
        }}
      />
      <div className={styles.body} data-inspecting={navigation.manager.open}>
        <WorkspaceArea
          {...{
            runtime,
            operations,
            workspace,
            chrome,
            experiments,
            authorization,
          }}
          hidden={navigation.manager.open}
          onExtensions={() => navigation.openManager()}
        />
        <ExtensionManager
          {...{
            runtime,
            operations,
            workspace,
            appearance,
            authorization,
            navigation,
            experiments,
            failedImports,
            clearFailure,
          }}
          onReveal={
            chrome.navigation?.entityType === "agents.agent"
              ? (id) => chrome.navigation!.reveal(id)
              : undefined
          }
        />
      </div>
      <ShellDialogs
        {...{ runtime, operations, appearance, workspace, navigation }}
      />
      <AuthorizationDialog
        runtime={runtime}
        operations={operations}
        controller={authorization}
      />
    </div>
  );
}
