import type { ReactNode } from "react";
import { useMediaQuery } from "@/components/useMediaQuery";
import { below } from "@/components/breakpoints";
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
  const narrow = useMediaQuery(below("manager"));
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
        className="flex min-h-0 w-full flex-1 shrink-0 flex-col overflow-hidden"
        aria-label="扩展管理"
      >
        <ManagerHeader controller={controller.header} />
        {/* The list and the selected extension side by side, each
            scrolling; narrow windows open the details inside the list. */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(296px,0.45fr)_minmax(0,0.55fr)] max-manager:grid-cols-1 max-manager:overflow-auto">
          <div className="min-w-0 overflow-auto border-r p-2 max-manager:overflow-visible max-manager:border-r-0">
            <ExtensionList
              controller={controller.list}
              selectedDetail={narrow ? details : undefined}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-3.5 overflow-auto px-6 py-6 max-manager:overflow-visible max-manager:px-4 max-manager:py-3 max-manager:empty:hidden">
            {!narrow && details}
            {diagnostics}
            <RetainedCredentialBindings
              access={detail.access}
              operations={detail.operations}
              installed={controller.list.installed}
            />
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
