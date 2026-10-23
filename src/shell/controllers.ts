import type { ReactNode } from "react";
import type { Host } from "../../modules/extension-host/host";
import type { Runtime } from "./runtime";
import type { ShellOperations } from "./useOperations";
import type { Workspace } from "./useWorkspace";
import type { Appearance } from "./useAppearance";
import type { ShellNavigation } from "./useShellNavigation";
import type { WorkspaceChrome } from "./useWorkspaceChrome";
import type { Authorization } from "./AuthorizationDialog";
import type { Experiments } from "../features/extensions/useExperiments";

export type CredentialOperations = Pick<ShellOperations, "busy" | "operate">;
export type DialogFeedback = Pick<ShellOperations, "busy">;
export type TitleBarProps = {
  appearance: Pick<Appearance, "appearance" | "toggleTheme">;
  workspace: Pick<Workspace, "current" | "allViews">;
  chrome: Pick<WorkspaceChrome, "title" | "custom" | "open" | "toggle">;
  navigation: Pick<ShellNavigation, "manager" | "setDialog" | "openManager">;
  operations: Pick<ShellOperations, "busy" | "operate">;
};
export type NavRailProps = {
  macOverlay: boolean;
  appearance: Pick<Appearance, "appearance" | "toggleTheme">;
  workspace: Pick<
    Workspace,
    "views" | "allViews" | "activeView" | "selectLayout"
  >;
  navigation: Pick<
    ShellNavigation,
    "manager" | "setDialog" | "openManager" | "closeManager"
  >;
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
  operations: Pick<ShellOperations, "busy" | "operate">;
  workspace: Pick<
    Workspace,
    "views" | "activeView" | "allViews" | "selectLayout"
  >;
  appearance: Pick<
    Appearance,
    "appearance" | "themes" | "themeId" | "selectTheme" | "toggleTheme"
  >;
  navigation: Pick<
    ShellNavigation,
    "dialog" | "setDialog" | "back" | "openManager"
  >;
};
export type AuthorizationDialogProps = {
  runtime: Pick<Runtime, "host" | "catalog">;
  operations: Pick<ShellOperations, "operate">;
  controller: Pick<
    Authorization,
    "authorization" | "trigger" | "closeAuthorization"
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
  experiments: Pick<
    Experiments,
    "started" | "start" | "available" | "authorizationOwners"
  >;
  authorization: Pick<Authorization, "requestAuthorization">;
  onExtensions(): void;
};
export type DiagnosticActionsProps = {
  runtime: Pick<Runtime, "host" | "adapter">;
  operations: Pick<ShellOperations, "busy" | "operate" | "setNotice">;
  workspace: Pick<Workspace, "activeView" | "setSelected">;
  authorization: Pick<Authorization, "requestAuthorization">;
  experiments: Pick<
    Experiments,
    "started" | "start" | "writeDenied" | "available"
  >;
};
