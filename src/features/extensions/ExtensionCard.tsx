import type { ReactNode } from "react";
import type { ExtensionCardModel } from "./controllers";
import { stateMessage, translateStatus } from "../../shell/messages";
import styles from "./ExtensionManager.module.css";

export function ExtensionCard({
  extension,
  onSelect,
  children,
}: {
  extension: Pick<
    ExtensionCardModel,
    "entry" | "manifest" | "state" | "selected" | "users"
  >;
  onSelect(): void;
  children: ReactNode;
}) {
  const { entry, manifest, state, users, selected: isSelected } = extension;
  const { id } = entry;
  return (
    <article
      key={id}
      data-extension-id={id}
      className={`${styles.extensionItem} ${isSelected ? styles.extensionItemSelected : ""}`}
      onClick={onSelect}
    >
      <div className={styles.extensionTitle}>
        <button
          type="button"
          className={styles.cardName}
          aria-pressed={isSelected}
          onClick={onSelect}
        >
          {entry.label}
        </button>
        <span
          className={`${styles.status} ${state.status === "active" ? styles.active : ""}`}
        >
          {translateStatus(state.status)}
        </span>
      </div>
      <p className={styles.cardMeta}>
        <code>
          {id} · {manifest.version}
        </code>
        {users.map((group) =>
          group.users.length ? (
            <span key={group.owner}>
              {group.users.length} 个 {group.kind} 在使用
            </span>
          ) : null,
        )}
      </p>
      {state.error && <p className="error">{stateMessage(state)}</p>}
      {children}
      {state.status === "cleanup-failed" && (
        <p className="error">请重新启动应用以恢复此扩展。</p>
      )}
    </article>
  );
}
