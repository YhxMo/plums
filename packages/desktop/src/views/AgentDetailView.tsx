import { useAction } from "../hooks/useAction.js";
import { latestUpdate } from "../shared/version.js";
import type { PermissionV2 } from "@plums/core";
import type { AgentRecord } from "@plums/host";
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
      {resources.some((p) => p.engines?.length) && (
        <section className="panel" aria-label="本机引擎管理">
          <h2>本机引擎</h2>
          <p>
            引擎以普通本机程序权限运行。关闭业务界面后仍可在这里停止或撤销信任。
          </p>
          {resources.flatMap((p) =>
            (p.engines ?? []).map((engine) => (
              <EngineRow
                key={`${p.id}:${engine.engineId}`}
                resource={p}
                engine={engine}
                onAction={(method) =>
                  onAction(method, p, { engineId: engine.engineId })
                }
              />
            )),
          )}
        </section>
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
              普通扩展只能访问已绑定并同意的目录。本机引擎的文件访问由引擎自行管理。
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

function EngineRow({
  resource,
  engine,
  onAction,
}: {
  resource: Resource;
  engine: NonNullable<Resource["engines"]>[number];
  onAction: (method: string) => Promise<unknown>;
}) {
  const action = useAction(`${resource.id}:${engine.engineId}`);
  const states = {
    stopped: "已停止",
    starting: "启动中",
    running: "运行中",
    stopping: "停止中",
    crashed: "已崩溃",
  };
  return (
    <div className="panel">
      <strong>
        {resource.desktop?.engines?.find((d) => d.id === engine.engineId)
          ?.title ?? engine.engineId}
      </strong>
      <p role="status">
        {states[engine.state]} · {engine.trusted ? "已信任" : "尚未信任"}
      </p>
      <div className="inline-actions">
        <button
          disabled={
            action.pending ||
            !resource.enabled ||
            ["running", "starting", "stopping"].includes(engine.state)
          }
          onClick={() => void action.run(() => onAction("startEngine"))}
        >
          启动引擎
        </button>
        <button
          disabled={action.pending || engine.state === "stopped"}
          onClick={() => void action.run(() => onAction("stopEngine"))}
        >
          停止引擎
        </button>
        <button
          disabled={action.pending || !engine.trusted}
          onClick={() => void action.run(() => onAction("revokeEngine"))}
        >
          撤销信任
        </button>
      </div>
      {action.error && (
        <p role="alert" className="notice error">
          {action.error}
        </p>
      )}
    </div>
  );
}
