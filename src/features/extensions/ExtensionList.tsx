import type { ReactNode } from "react";
import { TriangleAlertIcon } from "lucide-react";
import type { ExtensionListController } from "./controllers";
import { extensionOwner } from "@modules/sdk";
import { SelectedDocuments } from "./SelectedDocuments";
import { ExtensionCard } from "./ExtensionCard";
import { ExtensionActions } from "./ExtensionActions";
import { Button } from "@/components/ui/button";

export function ExtensionList({
  controller,
  selectedDetail,
}: {
  controller: ExtensionListController;
  selectedDetail?: ReactNode;
}) {
  const { actions, busy } = controller;
  return (
    <div>
      {Object.entries(controller.failures).map(([id, reason]) => (
        <article
          key={id}
          className="mb-2 rounded-xl border border-destructive/30 bg-destructive/6 p-3.5"
        >
          <strong className="flex items-center gap-1.5 text-sm">
            <TriangleAlertIcon className="size-4 text-destructive" />
            {id}
          </strong>
          <p className="mt-1 mb-2.5 text-xs text-destructive">
            加载失败：{reason}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={`重试加载 ${id}`}
              onClick={() => void actions.retry(id)}
            >
              重试加载
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`移除路径 ${id}`}
              onClick={() => void actions.removeFailure(id)}
            >
              移除失效路径
            </Button>
          </div>
        </article>
      ))}
      <ul aria-label="扩展" className="grid gap-0.5">
        {controller.rows.map((row) => (
          <ExtensionCard
            key={row.entry.id}
            extension={row}
            onSelect={() => actions.select(row.entry.id)}
            actions={
              <ExtensionActions extension={row} actions={actions} busy={busy} />
            }
          >
            {row.manifest.capabilities?.includes("document.read") && (
              <SelectedDocuments
                adapter={controller.adapter}
                owner={extensionOwner(row.entry.id)}
                enabled={row.state.status === "active"}
              />
            )}
            {row.selected && selectedDetail}
          </ExtensionCard>
        ))}
      </ul>
    </div>
  );
}
