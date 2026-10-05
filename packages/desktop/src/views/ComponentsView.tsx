import type { AgentRecord } from "@plums/host";
import type { CatalogItem, Resource } from "../shared/types.js";
import { kindLabel, type ComponentKind } from "../shared/terms.js";
import { latestUpdate } from "../shared/version.js";
import { LibraryView } from "../components/LibraryView.js";
import { ComponentRow } from "../components/ComponentRow.js";
import { SearchField } from "../components/SearchField.js";
import { SegmentedControl } from "../components/SegmentedControl.js";
import { EmptyState } from "../components/EmptyState.js";
import { Skeleton } from "../components/Skeleton.js";
import { RawJson } from "../components/RawJson.js";

export function ComponentsView({
  kind,
  scope,
  onScope,
  search,
  onSearch,
  selected,
  record,
  resources,
  library,
  agents,
  developer,
  loading,
  output,
  onOpen,
  onUse,
  onRemove,
  onExport,
  onConfig,
  onAction,
  onInvoke,
}: {
  kind: ComponentKind;
  scope: "agent" | "library";
  onScope: (scope: "agent" | "library") => void;
  search: string;
  onSearch: (search: string) => void;
  selected: string;
  record?: AgentRecord;
  resources: Resource[];
  library: CatalogItem[];
  agents: AgentRecord[];
  developer: boolean;
  loading: boolean;
  output: unknown;
  onOpen: (id: string) => void;
  onUse: (item: CatalogItem) => Promise<unknown>;
  onRemove: (digest: string) => Promise<unknown>;
  onExport: (digest: string) => Promise<unknown>;
  onConfig: (resource: Resource) => void;
  onAction: (
    method: string,
    resource: Resource,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
  onInvoke: (
    resource: Resource,
    kind: string,
    item: { name: string; title: string; inputSchema?: unknown },
  ) => Promise<unknown> | void;
}) {
  const visible = resources.filter(
    (p) =>
      p.kind === kind &&
      `${p.name} ${p.manifest.description ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <section className="page-header">
        <div>
          <h1>{kindLabel[kind]}</h1>
          <p>
            {kind === "character"
              ? "为 Agent 选择角色与设定。"
              : kind === "extension"
                ? "添加工作界面、工具和功能。"
                : "连接模型和其他服务。"}
          </p>
        </div>
      </section>
      <div className="components-toolbar">
        <SegmentedControl
          label="组件范围"
          value={scope}
          onChange={(value) => onScope(value as "agent" | "library")}
          options={[
            { value: "library", label: "公共库" },
            { value: "agent", label: "当前 Agent", disabled: !selected },
          ]}
        />
        <SearchField
          label={scope === "library" ? "搜索公共库" : "搜索当前 Agent"}
          value={search}
          onChange={onSearch}
        />
      </div>
      {scope === "library" ? (
        <LibraryView
          items={library.filter((p) => p.manifest.kind === kind)}
          search={search}
          scope={selected}
          canUse={!loading || !selected}
          agents={agents}
          developer={developer}
          onOpen={onOpen}
          onUse={onUse}
          onRemove={onRemove}
          onExport={onExport}
        />
      ) : loading && !record ? (
        <Skeleton />
      ) : (
        <>
          <h2 className="current-agent-heading">当前 Agent · {record?.name}</h2>
          {visible.map((p) => (
            <ComponentRow
              key={`${selected}:${p.id}`}
              resource={p}
              update={latestUpdate(library, p.id, p.version)}
              developer={developer}
              onConfig={() => onConfig(p)}
              onAction={(method, extra) => onAction(method, p, extra)}
              onInvoke={(type, item) => onInvoke(p, type, item)}
            />
          ))}
          {!visible.length && (
            <EmptyState
              illustration={search ? "search" : "components"}
              description={
                search ? "没有匹配的组件。" : "当前 Agent 没有此类组件。"
              }
            />
          )}
        </>
      )}
      {developer && output !== undefined && <RawJson value={output} />}
    </>
  );
}
