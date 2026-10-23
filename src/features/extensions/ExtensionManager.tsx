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
  // 280px list + 320px detail, gap, gutters and rail fit from 48rem.
  const narrow = useMediaQuery("(width < 48rem)");
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
        <div className="min-h-0 flex-1 overflow-auto px-6 pt-4 pb-5 max-[48rem]:px-4">
          <div className="mx-auto grid max-w-310 grid-cols-[minmax(280px,0.42fr)_minmax(320px,0.58fr)] items-start gap-5 max-[48rem]:grid-cols-1">
            <div className="min-w-0">
              <ExtensionList
                controller={controller.list}
                selectedDetail={narrow ? details : undefined}
              />
            </div>
            <div className="sticky top-0 flex min-w-0 flex-col gap-3.5 max-[48rem]:static">
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
