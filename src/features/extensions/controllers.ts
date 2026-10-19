import type { Host } from "../../../modules/extension-host/host";
import type { ImportedExtension } from "../../../modules/shell/uninstall";
import type { CredentialAccess } from "../../credentials";
import type { ShellOperations } from "../../shell/useOperations";
import type { Workspace } from "../../shell/useWorkspace";
import type { ShellNavigation } from "../../shell/useShellNavigation";
import type { Authorization } from "../../shell/AuthorizationDialog";
import type { CredentialOperations } from "../../shell/controllers";
import type { useExtensionManager } from "./useExtensionManager";

export type ManagementInputs = {
  operations: Pick<
    ShellOperations,
    "busy" | "error" | "operate" | "setError" | "setNotice"
  >;
  workspace: Pick<Workspace, "enableExtension">;
  navigation: Pick<ShellNavigation, "manager" | "closeManager">;
  authorization: Pick<Authorization, "requestAuthorization">;
};
export type ExtensionCardModel = {
  entry: ImportedExtension;
  manifest: ReturnType<Host["manifest"]>;
  state: ReturnType<Host["inspect"]>;
  users: ReturnType<Host["users"]>;
  selected: boolean;
  imported: boolean;
};
export type ExtensionDetailsProps = {
  host: Pick<Host, "inspect" | "manifest" | "users" | "toggleUser">;
  /** Shown inside the selected card on narrow screens. */
  inline?: boolean;
  access: CredentialAccess;
  entry: ImportedExtension;
  operations: CredentialOperations;
};
type Management = ReturnType<typeof useExtensionManager>;
export type ExtensionManagerController = Pick<
  Management,
  "visible" | "header" | "list" | "detail" | "dialogs"
>;
export type ManagerHeaderController = Pick<
  Management["header"],
  "heading" | "count" | "close" | "install"
>;
export type ExtensionListController = Pick<
  Management["list"],
  "rows" | "failures" | "busy" | "adapter" | "actions"
>;
export type ExtensionDialogController = Pick<
  Management["dialogs"],
  | "dialog"
  | "close"
  | "install"
  | "preview"
  | "importFile"
  | "uninstall"
  | "stop"
  | "label"
  | "configure"
>;
export type ExtensionRowActions = Pick<
  Management["list"]["actions"],
  "select" | "configure" | "uninstall" | "toggle"
>;
