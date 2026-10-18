import type { ExtensionCardModel, ExtensionRowActions } from "./controllers";
import styles from "./ExtensionManager.module.css";

export function ExtensionActions({
  extension,
  actions,
  busy,
}: {
  extension: Pick<
    ExtensionCardModel,
    "entry" | "manifest" | "state" | "imported"
  >;
  actions: Pick<ExtensionRowActions, "configure" | "uninstall" | "toggle">;
  busy: boolean;
}) {
  const { entry, manifest, state, imported } = extension;
  const { id } = entry;
  return (
    <div className={styles.extensionActions}>
      {manifest.configuration && (
        <button
          className="secondary"
          aria-label={`配置 ${id}`}
          disabled={busy}
          onClick={(event) => actions.configure(id, event.currentTarget)}
        >
          配置
        </button>
      )}
      {imported && (
        <button
          className="secondary"
          disabled={busy}
          aria-label={`卸载 ${id}`}
          onClick={(event) => actions.uninstall(id, event.currentTarget)}
        >
          卸载（保留数据）
        </button>
      )}
      <button
        className={`secondary ${styles.toggle}`}
        aria-label={`${state.status === "active" ? "停用" : "启用"} ${id}`}
        disabled={
          busy ||
          state.status === "cleanup-failed" ||
          state.status === "stopping"
        }
        onClick={(event) => actions.toggle(extension, event.currentTarget)}
      >
        {state.status === "active"
          ? "停用"
          : state.status === "waiting"
            ? "恢复"
            : "启用"}
      </button>
    </div>
  );
}
