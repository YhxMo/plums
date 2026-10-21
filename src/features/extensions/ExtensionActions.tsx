import {
  PowerIcon,
  PowerOffIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import type { ExtensionCardModel, ExtensionRowActions } from "./controllers";
import { Button } from "../../components/ui/button";

export function ExtensionActions({
  extension,
  actions,
  busy,
}: {
  extension: Pick<
    ExtensionCardModel,
    "entry" | "manifest" | "state" | "imported" | "users"
  >;
  actions: Pick<ExtensionRowActions, "configure" | "uninstall" | "toggle">;
  busy: boolean;
}) {
  const { entry, manifest, state, imported } = extension;
  const { id } = entry;
  const active = state.status === "active";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {manifest.configuration && (
        <Button
          variant="outline"
          size="sm"
          aria-label={`配置 ${id}`}
          disabled={busy}
          onClick={(event) => actions.configure(id, event.currentTarget)}
        >
          <Settings2Icon data-icon="inline-start" />
          配置
        </Button>
      )}
      {imported && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`卸载 ${id}`}
          onClick={(event) => actions.uninstall(id, event.currentTarget)}
        >
          <Trash2Icon data-icon="inline-start" />
          卸载（保留数据）
        </Button>
      )}
      <Button
        variant={active ? "outline" : "secondary"}
        size="sm"
        aria-label={`${active ? "停用" : "启用"} ${id}`}
        disabled={
          busy ||
          state.status === "cleanup-failed" ||
          state.status === "stopping"
        }
        onClick={(event) => actions.toggle(extension, event.currentTarget)}
      >
        {active ? (
          <PowerOffIcon data-icon="inline-start" />
        ) : (
          <PowerIcon data-icon="inline-start" />
        )}
        {active ? "停用" : state.status === "waiting" ? "恢复" : "启用"}
      </Button>
    </div>
  );
}
