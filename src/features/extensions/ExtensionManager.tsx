import type { ReactNode } from "react";
import { useMediaQuery } from "../../components/useMediaQuery";
import type { ExtensionManagerController } from "./controllers";
import { ManagerHeader } from "./ManagerHeader";
import { ExtensionList } from "./ExtensionList";
import { ExtensionDetails } from "./ExtensionDetails";
import { ExtensionDialogs } from "./ExtensionDialogs";
import { RetainedCredentialBindings } from "./CredentialBindings";

export function ExtensionManager({
  controller,
  diagnostics,
}: {
  controller: ExtensionManagerController;
  diagnostics: ReactNode;
}) {
  const { detail } = controller;
  // One column: details open inside the selected card instead of below the list.
  const narrow = useMediaQuery("(max-width: 1020px)");
  const details = detail.entry && (
    <ExtensionDetails
      host={detail.host}
      access={detail.access}
      entry={detail.entry}
      operations={detail.operations}
      inline={narrow}
    />
  );
  return (
    <>
      <aside
        id="extension-manager"
        hidden={!controller.visible}
        className="mx-2 mb-2 flex min-h-0 w-full flex-1 shrink-0 flex-col overflow-hidden rounded-xl bg-surface shadow-panel max-md:m-0 max-md:rounded-none max-md:shadow-none"
        aria-label="扩展管理"
      >
        <ManagerHeader controller={controller.header} />
        <div className="min-h-0 flex-1 overflow-auto px-6 pt-4 pb-5 max-[1020px]:px-4 max-md:px-4">
          <div className="mx-auto grid max-w-310 grid-cols-[minmax(320px,44%)_minmax(340px,56%)] items-start gap-5 max-[1020px]:grid-cols-1">
            <div className="min-w-0">
              <ExtensionList
                controller={controller.list}
                selectedDetail={narrow ? details : undefined}
              />
            </div>
            <div className="sticky top-0 flex min-w-0 flex-col gap-3.5 max-[1020px]:static">
              {!narrow && details}
              {diagnostics}
              <RetainedCredentialBindings
                access={detail.access}
                operations={detail.operations}
                installed={controller.list.installed}
              />
            </div>
          </div>
        </div>
      </aside>
      <ExtensionDialogs
        controller={controller.dialogs}
        host={detail.host}
        feedback={detail.operations}
      />
    </>
  );
}
