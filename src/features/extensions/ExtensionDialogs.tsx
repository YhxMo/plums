import type { Host } from "../../../modules/extension-host/host";
import type { DialogFeedback } from "../../shell/controllers";
import type { ExtensionDialogController } from "./controllers";
import { InstallDialog } from "./InstallDialog";
import { UninstallDialog } from "./UninstallDialog";
import { ConfigurationDialog } from "./ConfigurationDialog";

export function ExtensionDialogs({
  controller,
  host,
  feedback,
}: {
  controller: ExtensionDialogController;
  host: Pick<Host, "manifest" | "configuration">;
  feedback: DialogFeedback;
}) {
  const { dialog, close } = controller;
  return (
    <>
      <InstallDialog
        feedback={feedback}
        open={dialog?.kind === "install"}
        source={dialog?.source ?? null}
        onClose={close}
        onInstall={controller.install}
        onPreview={controller.preview}
        onImport={controller.importFile}
      />
      {dialog?.kind === "configure" && (
        <ConfigurationDialog
          host={host}
          feedback={feedback}
          id={dialog.id}
          source={dialog.source}
          onClose={close}
          onSave={(values) => controller.configure(dialog.id, values)}
        />
      )}
      {dialog?.kind === "uninstall" && (
        <UninstallDialog
          feedback={feedback}
          id={dialog.id}
          source={dialog.source}
          onClose={close}
          onUninstall={() => controller.uninstall(dialog.id)}
        />
      )}
    </>
  );
}
