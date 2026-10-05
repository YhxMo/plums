import { useAction } from "../hooks/useAction.js";
import type { CatalogItem, Resource } from "../shared/types.js";
import { KindIcon } from "./KindIcon.js";
import { Icon } from "./Icon.js";
import { Popover } from "./Popover.js";
import { PermissionList } from "./PermissionList.js";
export function ComponentRow({
  resource: p,
  update,
  developer,
  onConfig,
  onAction,
  onInvoke,
}: {
  resource: Resource;
  update?: CatalogItem;
  developer: boolean;
  onConfig: () => void;
  onAction: (
    method: string,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
  onInvoke: (
    kind: string,
    item: { name: string; title: string; inputSchema?: unknown },
  ) => Promise<unknown> | void;
}) {
  const action = useAction();
  const busy = action.pending;
  const run = (method: string, extra?: Record<string, unknown>) =>
    void action.run(() => onAction(method, extra));
  return (
    <article
      className="component-row"
      data-testid="component-row"
      data-kind={p.kind}
    >
      <div className="component-row-main">
        <KindIcon kind={p.kind} />
        <div className="component-copy">
          <h3>
            {p.name} <small>v{p.version}</small>
            {update && <span className="new-version">有新版本</span>}
          </h3>
          <p>
            {p.manifest.description || "此组件的配置与授权属于当前 Agent。"}
          </p>
        </div>
        <span className={`component-enabled ${p.enabled ? "enabled" : ""}`}>
          {p.enabled ? "已启用 ✓" : "未启用"}
        </span>
        <div className="row-actions">
          <button
            className="sm"
            disabled={busy}
            onClick={p.enabled ? onConfig : () => run("enable")}
          >
            {p.enabled ? "配置" : "启用"}
          </button>
          <Popover
            label={`${p.name} 的更多操作`}
            disabled={busy}
            trigger={<Icon name="more" size={16} />}
          >
            <button onClick={onConfig}>配置</button>
            {p.desktop?.frontend && (
              <button onClick={() => run("setStartup")}>设为工作界面</button>
            )}
            {update && (
              <button
                onClick={() =>
                  run("updateFromLibrary", { digest: update.digest })
                }
              >
                有新版本 · 更新到 v{update.manifest.version}
              </button>
            )}
            {p.enabled && <button onClick={() => run("disable")}>停用</button>}
            <button className="danger" onClick={() => run("uninstall")}>
              从 Agent 移出
            </button>
          </Popover>
        </div>
      </div>
      {action.error && (
        <p className="notice error" role="alert">
          {action.error}
        </p>
      )}
      <details className="component-permissions">
        <summary>需要 {p.manifest.permissions.length} 项权限</summary>
        <PermissionList
          permissions={p.manifest.permissions}
          formatVersion={p.manifest.formatVersion}
        />
      </details>
      {p.mcpTools?.map(({ tool, state }) => (
        <div className="mcp-tool" key={tool.name}>
          <div>
            <strong>{tool.name}</strong>
            <p>{tool.description}</p>
            <span>
              {state === "APPROVED"
                ? "已批准"
                : state === "CHANGED"
                  ? "已变化需重新批准"
                  : "待批准"}
            </span>
            {developer && <code>{state}</code>}
          </div>
          {state !== "APPROVED" && (
            <button
              className="sm"
              disabled={busy}
              onClick={() =>
                run("approveMcp", {
                  permissionId: p.manifest.permissions.find(
                    (x) => "kind" in x && x.kind === "egress",
                  )?.id,
                  tools: [tool],
                })
              }
            >
              批准工具
            </button>
          )}
        </div>
      ))}
      {developer && (
        <details className="technical-details">
          <summary>开发者信息与调用</summary>
          <small>标识：{p.id}</small>
          <div className="inline-actions">
            {Object.entries(p.desktop?.contributes ?? {}).flatMap(
              ([kind, items]) =>
                items!.map((item) => (
                  <button
                    className="sm"
                    disabled={busy}
                    key={kind + item.name}
                    onClick={() =>
                      void action.run(async () => onInvoke(kind, item))
                    }
                  >
                    {item.title}
                    <Icon name="external" size={16} />
                  </button>
                )),
            )}
          </div>
        </details>
      )}
    </article>
  );
}
