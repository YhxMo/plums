import type { ReactNode } from "react";
import { extensionOwner } from "@modules/sdk";
import { Dialog, DialogBody, DialogDone } from "@/components/Dialog";
import type { ExtensionManagerController } from "./controllers";
import { ManagerHeader } from "./ManagerHeader";
import { ExtensionList } from "./ExtensionList";
import { ExtensionDetails } from "./ExtensionDetails";
import { ExtensionActions, ExtensionSwitch } from "./ExtensionActions";
import { SelectedDocuments } from "./SelectedDocuments";
import { ExtensionDialogs } from "./ExtensionDialogs";
import { RetainedCredentialBindings } from "./CredentialBindings";

export function ExtensionManager({
  controller,
  diagnostics,
}: {
  controller: ExtensionManagerController;
  diagnostics: ReactNode;
}) {
  const { detail, list } = controller;
  const row =
    detail.entry &&
    list.rows.find((candidate) => candidate.entry.id === detail.entry!.id);
  return (
    <>
      <aside
        id="extension-manager"
        hidden={!controller.visible}
        className="flex min-h-0 w-full flex-1 shrink-0 flex-col overflow-hidden"
        aria-label="扩展管理"
      >
        <ManagerHeader controller={controller.header} />
        {/* Every extension as a card; its details open over the page. */}
        <div className="grid min-h-0 flex-1 content-start gap-6 overflow-auto p-4">
          <ExtensionList controller={list} />
          {diagnostics}
          <RetainedCredentialBindings
            access={detail.access}
            operations={detail.operations}
            installed={list.installed}
          />
        </div>
      </aside>
      {controller.visible && detail.entry && row && (
        <Dialog
          key={detail.entry.id}
          title={detail.entry.label}
          returnFocusTo={detail.trigger}
          fallbackFocus={() => controller.header.heading.current}
          onClose={detail.close}
        >
          <DialogBody>
            <ExtensionDetails
              host={detail.host}
              access={detail.access}
              entry={detail.entry}
              operations={detail.operations}
              toggle={
                <ExtensionSwitch
                  extension={row}
                  actions={list.actions}
                  busy={list.busy}
                />
              }
              actions={
                <ExtensionActions
                  extension={row}
                  actions={list.actions}
                  busy={list.busy}
                />
              }
            >
              {row.manifest.capabilities?.includes("document.read") && (
                <SelectedDocuments
                  adapter={list.adapter}
                  owner={extensionOwner(row.entry.id)}
                  enabled={row.state.status === "active"}
                />
              )}
            </ExtensionDetails>
          </DialogBody>
          {/* Switches here apply at once, so it only needs a way out. */}
          <DialogDone onDone={detail.close} />
        </Dialog>
      )}
      <ExtensionDialogs
        controller={controller.dialogs}
        host={detail.host}
        feedback={detail.operations}
      />
    </>
  );
}
