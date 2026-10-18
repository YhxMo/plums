import type { ExtensionCardModel, ExtensionRowActions } from "./controllers";
import { capabilityLabel } from "../../shell/messages";
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
  const capabilities = manifest.capabilities ?? [];
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
      <details>
        <summary>扩展详情</summary>
        <dl>
          <dt>模块位置</dt>
          <dd>{entry.url}</dd>
          <dt>能力</dt>
          <dd>
            {capabilities.length
              ? capabilities.map(capabilityLabel).join("、")
              : "无需原生能力"}
          </dd>
          <dt>依赖服务</dt>
          <dd>
            {Object.entries(manifest.requires ?? {})
              .map(([name, version]) => `${name}@${version}`)
              .join("、") || "无"}
          </dd>
          <dt>提供服务</dt>
          <dd>
            {Object.entries(manifest.provides ?? {})
              .map(([name, version]) => `${name}@${version}`)
              .join("、") || "无"}
          </dd>
        </dl>
      </details>
      <button
        className="secondary"
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
