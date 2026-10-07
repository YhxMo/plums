import { useAction } from "../hooks/useAction.js";
import { newerVersion } from "../shared/version.js";
import type { AgentRecord } from "@plums/host";
import type { CatalogItem } from "../shared/types.js";
import { EmptyState } from "./EmptyState.js";
import { KindIcon } from "./KindIcon.js";
import { UsageBadge } from "./UsageBadge.js";
import { Popover } from "./Popover.js";
import { Icon } from "./Icon.js";
export function LibraryView({
  items,
  search,
  scope,
  canUse,
  agents,
  developer,
  onInspect,
  onOpen,
  onRemove,
  onExport,
  onUse,
}: {
  items: CatalogItem[];
  search: string;
  scope: string;
  canUse: boolean;
  agents: AgentRecord[];
  developer: boolean;
  onInspect: (item: CatalogItem) => void;
  onOpen: (id: string) => void;
  onRemove: (hash: string) => Promise<unknown>;
  onExport: (hash: string) => Promise<unknown>;
  onUse: (item: CatalogItem) => Promise<unknown>;
}) {
  const visible = items.filter((p) =>
    `${p.manifest.name} ${p.manifest.description ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      {!visible.length && (
        <EmptyState
          illustration={items.length ? "search" : "components"}
          description={
            items.length
              ? "没有匹配的组件。"
              : "这里还没有组件。导入角色卡或扩展后，就可以用它们组装 Agent。"
          }
        />
      )}
      <div className="library-grid">
        {visible.map((p) => (
          <LibraryCard
            key={p.digest}
            item={p}
            items={items}
            scope={scope}
            canUse={canUse}
            agents={agents}
            developer={developer}
            onInspect={onInspect}
            onOpen={onOpen}
            onRemove={onRemove}
            onExport={onExport}
            onUse={onUse}
          />
        ))}
      </div>
    </>
  );
}

function LibraryCard({
  item: p,
  items,
  scope,
  canUse,
  agents,
  developer,
  onInspect,
  onOpen,
  onRemove,
  onExport,
  onUse,
}: {
  item: CatalogItem;
  items: CatalogItem[];
  scope: string;
  canUse: boolean;
  agents: AgentRecord[];
  developer: boolean;
  onInspect: (item: CatalogItem) => void;
  onOpen: (id: string) => void;
  onRemove: (digest: string) => Promise<unknown>;
  onExport: (digest: string) => Promise<unknown>;
  onUse: (item: CatalogItem) => Promise<unknown>;
}) {
  const action = useAction(scope);
  const busy = action.pending;
  return (
    <article className="library-card" data-kind={p.manifest.kind}>
      <div className="card-heading">
        <KindIcon kind={p.manifest.kind} size={40} />
        <span className="version-label">
          v{p.manifest.version}
          {items.some(
            (candidate) =>
              candidate.manifest.id === p.manifest.id &&
              newerVersion(candidate.manifest.version, p.manifest.version),
          ) && <span className="new-version">有新版本</span>}
        </span>
      </div>
      <h3>{p.manifest.name}</h3>
      {p.manifest.kind === "connector" && (
        <span className="version-label">服务接入</span>
      )}
      <p className="library-description">
        {p.manifest.description || "可用于组装自己的 Agent。"}
      </p>
      {!!p.missingDependencies.length && (
        <p className="dependency-hint">
          还需要导入：
          {p.missingDependencies.map((d) => `${d.id}（${d.range}）`).join("、")}
        </p>
      )}
      <div className="library-card-footer">
        <UsageBadge
          agents={agents.filter((a) =>
            a.components?.some((c) => c.digest === p.digest),
          )}
          onOpen={onOpen}
        />
        <div className="inline-actions">
          <button
            className="sm"
            disabled={busy || !canUse}
            onClick={() => void action.run(() => onUse(p))}
          >
            加入…
          </button>
          <Popover
            label={`${p.manifest.name} 的更多操作`}
            trigger={<Icon name="more" size={16} />}
            disabled={busy}
          >
            <button
              onClick={() => void action.run(() => onExport(p.digest), false)}
            >
              导出组件
            </button>
            <button
              className="danger"
              disabled={p.usedBy.length > 0}
              title={
                p.usedBy.length ? "先从引用此组件的 Agent 中移出" : undefined
              }
              onClick={() => void action.run(() => onRemove(p.digest))}
            >
              删除组件
            </button>
          </Popover>
        </div>
      </div>
      {action.error && (
        <p role="alert" className="notice error">
          {action.error}
        </p>
      )}
      {developer && (
        <div className="technical-details">
          <button className="sm" onClick={() => onInspect(p)}>
            查看 / 编辑内容
          </button>
        </div>
      )}
    </article>
  );
}
