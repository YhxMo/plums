import type { ReactNode } from "react";
import type { Host } from "../../modules/extension-host/host";
import type { Agent } from "../../modules/sdk/agents";
import type { ImportedExtension } from "../../modules/shell/uninstall";
import type { CredentialAccess } from "../credentials";
import type { Runtime } from "./runtime";
import type { ShellOperations } from "./useOperations";
import type { Workspace } from "./useWorkspace";
import type { Appearance } from "./useAppearance";
import type { ShellNavigation } from "./useShellNavigation";
import type { WorkspaceChrome } from "./useWorkspaceChrome";
import type { Authorization } from "./AuthorizationDialog";
import type { Experiments } from "./useExperiments";
import type { useExtensionManager } from "../features/extensions/useExtensionManager";

export type CredentialOperations = Pick<ShellOperations, "busy" | "operate">;
export type DialogFeedback = Pick<ShellOperations, "busy" | "error">;
export type TitleBarProps = {
  platformKind: Runtime["adapter"]["kind"];
  appearance: Pick<Appearance, "appearance" | "toggleTheme">;
  workspace: Pick<Workspace, "current" | "allViews">;
  chrome: Pick<WorkspaceChrome, "title" | "custom" | "open" | "toggle">;
  navigation: Pick<ShellNavigation, "manager" | "setDialog" | "openManager">;
  operations: Pick<ShellOperations, "busy" | "operate">;
};
export type ShellFeedbackProps = {
  runtime: Pick<Runtime, "host" | "catalog">;
  operations: Pick<
    ShellOperations,
    "error" | "notice" | "setError" | "setNotice"
  >;
  workspace: Pick<Workspace, "selected" | "activeView" | "failedViews">;
  appearance: Pick<Appearance, "themeId" | "currentTheme">;
  navigation: Pick<ShellNavigation, "openManager">;
  failedImports: Record<string, string>;
};
export type ShellDialogsProps = {
  host: Host;
  operations: Pick<ShellOperations, "busy" | "error" | "operate">;
  workspace: Pick<
    Workspace,
    "views" | "activeView" | "allViews" | "selectLayout"
  >;
  appearance: Pick<
    Appearance,
    "appearance" | "themes" | "themeId" | "selectTheme" | "toggleTheme"
  >;
  navigation: Pick<ShellNavigation, "dialog" | "setDialog" | "openManager">;
};
export type AuthorizationDialogProps = {
  runtime: Pick<Runtime, "host" | "catalog">;
  operations: Pick<ShellOperations, "operate">;
  controller: Pick<
    Authorization,
    | "authorization"
    | "dialog"
    | "trigger"
    | "setAuthorization"
    | "closeAuthorization"
  >;
};
export type WorkspaceAreaProps = {
  host: Host;
  workspace: Pick<Workspace, "slot" | "activeView">;
  chrome: Pick<WorkspaceChrome, "custom" | "open" | "closeCustom">;
  hidden: boolean;
  children: ReactNode;
};
export type RecoveryWelcomeProps = {
  operations: Pick<ShellOperations, "busy">;
  experiments: Pick<Experiments, "started" | "start">;
  authorization: Pick<Authorization, "requestAuthorization">;
  onExtensions(): void;
};
export type DiagnosticActionsProps = {
  runtime: Pick<Runtime, "host" | "adapter">;
  operations: Pick<ShellOperations, "busy" | "operate" | "setNotice">;
  workspace: Pick<Workspace, "activeView" | "setSelected">;
  authorization: Pick<Authorization, "requestAuthorization">;
  experiments: Pick<Experiments, "started" | "start" | "writeDenied">;
};
export type ManagementInputs = {
  operations: Pick<
    ShellOperations,
    "busy" | "error" | "operate" | "setError" | "setNotice"
  >;
  workspace: Pick<Workspace, "selected" | "enableExtension">;
  navigation: Pick<ShellNavigation, "manager" | "closeManager">;
  authorization: Pick<Authorization, "requestAuthorization">;
  onReveal?: (id: string) => void;
};
export type ExtensionCardModel = {
  entry: ImportedExtension;
  manifest: ReturnType<Host["manifest"]>;
  state: ReturnType<Host["inspect"]>;
  agents: Agent[];
  selected: boolean;
  imported: boolean;
};
export type ExtensionDetailsProps = {
  host: Pick<Host, "inspect" | "manifest">;
  access: CredentialAccess;
  entry: ImportedExtension;
  agents: Agent[];
  operations: CredentialOperations;
  onReveal?: (id: string) => void;
};
type Management = ReturnType<typeof useExtensionManager>;
export type ExtensionManagerController = Pick<
  Management,
  "visible" | "header" | "list" | "detail" | "dialogs"
>;
export type ManagerHeaderController = Pick<
  Management["header"],
  "heading" | "count" | "busy" | "close" | "install" | "save"
>;
export type ExtensionListController = Pick<
  Management["list"],
  "rows" | "failures" | "busy" | "adapter" | "actions"
>;
export type ExtensionDialogController = Pick<
  Management["dialogs"],
  "dialog" | "close" | "install" | "uninstall" | "configure"
>;
export type ExtensionRowActions = Pick<
  Management["list"]["actions"],
  "select" | "configure" | "uninstall" | "toggle"
>;
