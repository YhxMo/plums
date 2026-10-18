import type { ExtensionListController } from "./controllers";
import { extensionOwner } from "../../../modules/sdk";
import { SelectedDocuments } from "./SelectedDocuments";
import { ExtensionCard } from "./ExtensionCard";
import { ExtensionActions } from "./ExtensionActions";
import styles from "./ExtensionManager.module.css";

export function ExtensionList({
  controller,
}: {
  controller: ExtensionListController;
}) {
  const { actions, busy } = controller;
  return (
    <div className={styles.extensions}>
      {Object.entries(controller.failures).map(([id, reason]) => (
        <article key={id}>
          <strong>{id}</strong>
          <p className="error">加载失败：{reason}</p>
          <button
            className="secondary"
            disabled={busy}
            aria-label={`重试加载 ${id}`}
            onClick={() => void actions.retry(id)}
          >
            重试加载
          </button>{" "}
          <button
            className="secondary"
            disabled={busy}
            aria-label={`移除路径 ${id}`}
            onClick={() => void actions.removeFailure(id)}
          >
            移除失效路径
          </button>
        </article>
      ))}
      {controller.rows.map((row) => (
        <ExtensionCard
          key={row.entry.id}
          extension={row}
          onSelect={() => actions.select(row.entry.id)}
        >
          <ExtensionActions extension={row} actions={actions} busy={busy} />
          {row.manifest.capabilities?.includes("document.read") && (
            <SelectedDocuments
              adapter={controller.adapter}
              owner={extensionOwner(row.entry.id)}
              enabled={row.state.status === "active"}
            />
          )}
        </ExtensionCard>
      ))}
    </div>
  );
}
