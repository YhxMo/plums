import { LocalPermissions } from "../components/LocalPermissions.js";
import { WorkspaceComposition } from "../components/WorkspaceComposition.js";
import { PolicyModes } from "../components/PolicyModes.js";
import { ControlledTasks } from "../components/ControlledTasks.js";
import { BusinessResources } from "../components/BusinessResources.js";
import { ProtocolBindings } from "../components/ProtocolBindings.js";
import { useAction } from "../hooks/useAction.js";
import { latestUpdate } from "../shared/version.js";
import type { PermissionV2 } from "@plumsjs/core";
import type { AgentRecord } from "@plumsjs/host";
import type { CatalogItem, Resource } from "../shared/types.js";
import {
  StatusChip,
  startLabel,
  type AgentStatus,
} from "../components/StatusChip.js";
import { ComponentRow } from "../components/ComponentRow.js";
import { PermissionSummary } from "../components/PermissionList.js";
import { ExecutionRecordList } from "../components/ExecutionRecordList.js";
import { kindLabel, type ComponentKind } from "../components/KindIcon.js";
import { Popover } from "../components/Popover.js";
import { Icon } from "../components/Icon.js";
import { EmptyState } from "../components/EmptyState.js";
import { RawJson } from "../components/RawJson.js";
export function AgentDetailView({
  record,
  resources,
  library,
  status,
  busy,
  developer,
  audit,
  auditError,
  output,
  onBack,
  onStart,
  onEdit,
  onInspect,
  onConfig,
  onAction,
  onInvoke,
  onAudit,
  onBind,
  onUnbind,
}: {
  record?: AgentRecord;
  resources: Resource[];
  library: CatalogItem[];
  status?: AgentStatus;
  busy: boolean;
  developer: boolean;
  audit: unknown[] | null;
  auditError: string;
  output: unknown;
  onBack: () => void;
  onStart: () => void;
  onEdit: () => void;
  onInspect: (p: Resource) => void;
  onConfig: (p: Resource) => void;
  onAction: (
    method: string,
    p?: Resource,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
  onInvoke: (
    p: Resource,
    kind: string,
    item: { name: string; title: string; inputSchema?: unknown },
  ) => Promise<unknown> | void;
  onAudit: () => void;
  onBind: (name: string) => Promise<unknown>;
  onUnbind: (name: string) => Promise<unknown>;
}) {
  const exportAction = useAction(record?.instanceId);
  const revokeAction = useAction(record?.instanceId);
  if (!record) return <EmptyState description="选择一个 Agent 查看详情。" />;
  const roots = Array.from(
    new Set(
      resources.flatMap((r) =>
        r.manifest.formatVersion?.startsWith("2.")
          ? (r.manifest.permissions as PermissionV2[]).flatMap((p) =>
              p.kind === "fs"
                ? [p.target]
                : p.kind === "exec"
                  ? p.cwdRoots
                  : [],
            )
          : [],
      ),
    ),
  ).filter((r) => r !== "agent-data");
  return (
    <section data-testid="agent-detail">
      <div className="breadcrumb">
        <button
          type="button"
          className="ghost sm icon-button agent-back"
          aria-label="返回我的 Agent"
          onClick={onBack}
        >
          <Icon name="back" size={18} />
        </button>
        <button className="ghost sm" onClick={onBack}>
          我的 Agent
        </button>
        <span>/</span>
        {record.name}
      </div>
      <div className="page-header detail-header">
        <div className="detail-identity">
          <span className="avatar large">{record.name.slice(0, 1)}</span>
          <div>
            <h1>{record.name}</h1>
            <StatusChip status={status} />
            <small>
              v{record.agent.version} · {resources.length} 个组件
            </small>
          </div>
        </div>
        <div className="inline-actions">
          <button className="cta lg" disabled={busy} onClick={onStart}>
            {startLabel(status)}
          </button>
          <button
            disabled={busy || revokeAction.pending}
            onClick={() =>
              void revokeAction.run(() => onAction("revokeTaskScope"))
            }
          >
            停止并撤权
          </button>
          <button disabled={busy} onClick={onEdit}>
            编辑组合
          </button>
          <Popover label="Agent 更多操作" trigger={<Icon name="more" />}>
            <button
              disabled={exportAction.pending}
              onClick={() =>
                void exportAction.run(() => onAction("export"), false)
              }
            >
              导出组合包
            </button>
            <button className="danger" onClick={() => void onAction("remove")}>
              删除 Agent
            </button>
          </Popover>
        </div>
      </div>
      {revokeAction.error && (
        <p role="alert" className="notice error">
          {revokeAction.error}
        </p>
      )}
      {exportAction.error && (
        <p role="alert" className="notice error">
          {exportAction.error}
        </p>
      )}
      {record.recoveryError && (
        <p role="alert" className="notice error">
          {record.recoveryError}
        </p>
      )}
      {resources
        .filter((p) => p.compatibility)
        .map((p) => (
          <p key={p.id} className="notice" role="status">
            {p.name}{" "}
            需要升级到外装连接器版本。请先升级聊天扩展，再升级模型连接器；配置、密钥与历史会保留。
          </p>
        ))}
      <WorkspaceComposition record={record} resources={resources} />
      <ControlledTasks record={record} resources={resources} />
      <BusinessResources instanceId={record.instanceId} revision={resources} />
      <PolicyModes instanceId={record.instanceId} revision={resources} />
      <LocalPermissions
        key={`permissions:${record.instanceId}`}
        record={record}
        resources={resources}
      />
      {resources.some((p) => p.desktop?.protocols?.requires?.length) && (
        <ProtocolBindings
          key={record.instanceId}
          instanceId={record.instanceId}
          revision={resources}
        />
      )}
      <div className="detail-layout">
        <div>
          <h2>组件管理</h2>
          {resources.length ? (
            (["character", "extension"] as ComponentKind[]).map((kind) => {
              const entries = resources.filter(
                (p) =>
                  p.kind === kind ||
                  (kind === "extension" && p.kind === "connector"),
              );
              return entries.length ? (
                <section
                  className="component-group"
                  data-kind={kind}
                  key={kind}
                >
                  <h3>
                    <i className="kind-dot" />
                    {kindLabel[kind]} · {entries.length}
                  </h3>
                  {entries.map((p) => (
                    <ComponentRow
                      key={`${record.instanceId}:${p.id}`}
                      resource={p}
                      update={latestUpdate(library, p.id, p.version)}
                      developer={developer}
                      onInspect={() => onInspect(p)}
                      onConfig={() => onConfig(p)}
                      onAction={(method, extra) => onAction(method, p, extra)}
                      onInvoke={(type, item) => onInvoke(p, type, item)}
                    />
                  ))}
                </section>
              ) : null;
            })
          ) : (
            <EmptyState
              illustration="components"
              description="这个 Agent 还没有组件，可以通过编辑组合添加。"
            />
          )}
        </div>
        <aside className="detail-sidebar">
          <section className="panel">
            <h2>权限摘要</h2>
            <p>开始使用时确认本次范围；有效期最长 1 小时，停止即撤销。</p>
            <PermissionSummary
              permissions={resources
                .filter((p) => p.enabled)
                .flatMap((p) =>
                  p.manifest.permissions.map((permission) => ({
                    permission,
                    formatVersion: p.manifest.formatVersion,
                    serviceTargets: p.serviceTargets?.[permission.id],
                  })),
                )}
            />
          </section>
          <section className="panel">
            <h2>工作目录</h2>
            <p>
              普通扩展按声明访问已绑定目录。本地执行还须符合组件档位与已确认范围，整机档位具有更广访问能力。
            </p>
            {roots.length ? (
              roots.map((name) => (
                <RootRow
                  key={`${record.instanceId}:${name}`}
                  name={name}
                  path={record.roots?.[name]}
                  onBind={onBind}
                  onUnbind={onUnbind}
                />
              ))
            ) : (
              <p>组件尚未声明外部工作目录。</p>
            )}
          </section>
          <section className="panel">
            <h2>最近执行记录</h2>
            {auditError ? (
              <p role="alert">{auditError}</p>
            ) : (
              <ExecutionRecordList events={audit} resources={resources} />
            )}
            <button className="ghost sm" disabled={busy} onClick={onAudit}>
              {auditError ? "重试" : "查看全部"}
            </button>
            {developer && audit && (
              <details>
                <summary>原始审计</summary>
                <pre>
                  {audit.map((event) => JSON.stringify(event)).join("\n")}
                </pre>
              </details>
            )}
          </section>
        </aside>
      </div>
      {developer && output !== undefined && <RawJson value={output} />}
    </section>
  );
}

function RootRow({
  name,
  path,
  onBind,
  onUnbind,
}: {
  name: string;
  path?: string;
  onBind: (name: string) => Promise<unknown>;
  onUnbind: (name: string) => Promise<unknown>;
}) {
  const action = useAction();
  return (
    <div className="root-row">
      <div>
        <strong>{name}</strong>
        <code>{path ?? "未绑定"}</code>
        {action.error && (
          <p role="alert" className="error-text">
            {action.error}
          </p>
        )}
      </div>
      <div className="inline-actions">
        <button
          className="ghost sm"
          disabled={action.pending}
          onClick={() => void action.run(() => onBind(name))}
        >
          {path ? "更换" : "绑定"}
        </button>
        {path && (
          <button
            className="ghost sm"
            disabled={action.pending}
            onClick={() => void action.run(() => onUnbind(name))}
          >
            解除绑定
          </button>
        )}
      </div>
    </div>
  );
}
