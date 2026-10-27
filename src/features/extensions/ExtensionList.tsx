import { TriangleAlertIcon } from "lucide-react";
import type { ExtensionListController } from "./controllers";
import { ExtensionCard } from "./ExtensionCard";
import { ExtensionSwitch } from "./ExtensionActions";
import { Button } from "@/components/ui/button";

/** Load failures first, then every installed extension as a card. */
export function ExtensionList({
  controller,
}: {
  controller: ExtensionListController;
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
              disabled={busy}
              aria-label={`重试加载 ${id}`}
              onClick={() => void actions.retry(id)}
            >
              重试加载
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              aria-label={`移除路径 ${id}`}
              onClick={() => void actions.removeFailure(id)}
            >
              移除失效路径
            </Button>
          </div>
        </article>
      ))}
      <ul
        aria-label="扩展"
        className="grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-2"
      >
        {controller.rows.map((row) => (
          <ExtensionCard
            key={row.entry.id}
            extension={row}
            onOpen={(source) => actions.select(row.entry.id, source)}
            toggle={
              <ExtensionSwitch extension={row} actions={actions} busy={busy} />
            }
          />
        ))}
      </ul>
    </div>
  );
}
