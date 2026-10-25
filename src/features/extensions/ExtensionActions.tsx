import type { ExtensionCardModel, ExtensionRowActions } from "./controllers";
import { Button } from "@/components/ui/button";

export function ExtensionActions({
  extension,
  actions,
  busy,
}: {
  extension: Pick<
    ExtensionCardModel,
    "entry" | "manifest" | "state" | "imported" | "users" | "dialogs"
  >;
  actions: Pick<
    ExtensionRowActions,
    "configure" | "uninstall" | "toggle" | "openView"
  >;
  busy: boolean;
}) {
  const { entry, manifest, state, imported, dialogs } = extension;
  const { id } = entry;
  const active = state.status === "active";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {active &&
        dialogs.map((view) => (
          <Button
            key={view.id}
            variant="outline"
            size="xs"
            aria-label={`打开 ${view.label}`}
            onClick={(event) => actions.openView(view, event.currentTarget)}
          >
            {dialogs.length > 1 ? view.label : "打开"}
          </Button>
        ))}
      {manifest.configuration && (
        <Button
          variant="outline"
          size="xs"
          aria-label={`配置 ${id}`}
          disabled={busy}
          onClick={(event) => actions.configure(id, event.currentTarget)}
        >
          配置
        </Button>
      )}
      {imported && (
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          aria-label={`卸载 ${id}`}
          onClick={(event) => actions.uninstall(id, event.currentTarget)}
        >
          卸载
        </Button>
      )}
      <Button
        variant="outline"
        size="xs"
        aria-label={`${active ? "停用" : "启用"} ${id}`}
        disabled={
          busy ||
          state.status === "cleanup-failed" ||
          state.status === "stopping"
        }
        onClick={(event) => actions.toggle(extension, event.currentTarget)}
      >
        {active ? "停用" : state.status === "waiting" ? "恢复" : "启用"}
      </Button>
    </div>
  );
}
