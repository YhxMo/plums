import type { Host } from "@modules/extension-host/host";
import type { DialogFeedback } from "@/shell/controllers";
import type { ExtensionDialogController } from "./controllers";
import { InstallDialog, OfferDialog } from "./InstallDialog";
import { UninstallDialog } from "./UninstallDialog";
import { StopDialog } from "./StopDialog";
import { ConfigurationDialog } from "./ConfigurationDialog";

export function ExtensionDialogs({
  controller,
  host,
  feedback,
}: {
  controller: ExtensionDialogController;
  host: Pick<Host, "manifest" | "configuration" | "users">;
  feedback: DialogFeedback;
}) {
  const { dialog, close, offer } = controller;
  return (
    <>
      {offer && (
        <OfferDialog
          feedback={feedback}
          preview={offer.preview}
          position={offer.position}
          onAnswer={offer.answer}
          onClose={offer.close}
        />
      )}
      <InstallDialog
        feedback={feedback}
        open={dialog?.kind === "install"}
        source={dialog?.source ?? null}
        onClose={close}
        onInstall={controller.install}
        onPreview={controller.preview}
        onImport={controller.importPackage}
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
      {dialog?.kind === "stop" && (
        <StopDialog
          host={host}
          name={controller.label}
          feedback={feedback}
          id={dialog.id}
          source={dialog.source}
          onClose={close}
          onStop={() => controller.stop(dialog.id)}
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
