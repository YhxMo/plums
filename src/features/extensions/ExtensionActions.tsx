import type { ExtensionCardModel, ExtensionRowActions } from "./controllers";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/** Starts or stops an extension from its card or details; on only while it runs. */
export function ExtensionSwitch({
  extension,
  actions,
  busy,
}: {
  extension: Pick<ExtensionCardModel, "entry" | "manifest" | "state" | "users">;
  actions: Pick<ExtensionRowActions, "toggle">;
  busy: boolean;
}) {
  const { entry, state } = extension;
  return (
    <Switch
      checked={state.status === "active"}
      aria-label={`启用 ${entry.id}`}
      disabled={
        busy || state.status === "cleanup-failed" || state.status === "stopping"
      }
      onClick={(event) => {
        // Switching on a card does not open its details.
        event.stopPropagation();
        actions.toggle(extension, event.currentTarget);
      }}
    />
  );
}

/** What the selected extension offers besides its switch: its pages, settings and removal. */
export function ExtensionActions({
  extension,
  actions,
  busy,
}: {
  extension: Pick<
    ExtensionCardModel,
    "entry" | "manifest" | "state" | "imported" | "dialogs"
  >;
  actions: Pick<ExtensionRowActions, "configure" | "uninstall" | "openView">;
  busy: boolean;
}) {
  const { entry, manifest, state, imported, dialogs } = extension;
  const { id } = entry;
  const pages = state.status === "active" ? dialogs : [];
  if (!pages.length && !manifest.configuration && !imported) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {pages.map((view) => (
        <Button
          key={view.id}
          variant="outline"
          size="xs"
          aria-label={`打开 ${view.label}`}
          onClick={(event) => actions.openView(view, event.currentTarget)}
        >
          {pages.length > 1 ? view.label : "打开"}
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
    </div>
  );
}
