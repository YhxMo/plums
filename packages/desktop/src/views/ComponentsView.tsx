import type { AgentRecord } from "@plums/host";
import type { CatalogItem } from "../shared/types.js";
import { kindLabel, type ComponentKind } from "../shared/terms.js";
import { LibraryView } from "../components/LibraryView.js";
import { SearchField } from "../components/SearchField.js";
import { RawJson } from "../components/RawJson.js";

export function ComponentsView({
  kind,
  search,
  onSearch,
  selected,
  record,
  library,
  agents,
  developer,
  loading,
  output,
  onOpen,
  onUse,
  onRemove,
  onExport,
}: {
  kind: ComponentKind;
  search: string;
  onSearch: (search: string) => void;
  selected: string;
  record?: AgentRecord;
  library: CatalogItem[];
  agents: AgentRecord[];
  developer: boolean;
  loading: boolean;
  output: unknown;
  onOpen: (id: string) => void;
  onUse: (item: CatalogItem) => Promise<unknown>;
  onRemove: (digest: string) => Promise<unknown>;
  onExport: (digest: string) => Promise<unknown>;
}) {
  return (
    <>
      <section className="page-header">
        <div>
          <h1>{kindLabel[kind]}</h1>
          <p>
            {kind === "character"
              ? "为 Agent 选择角色与设定。"
              : kind === "extension"
                ? "公共库中的工作界面、工具和服务接入扩展。当前 Agent 的配置在详情页管理。"
                : "连接模型和其他服务。"}
          </p>
        </div>
      </section>
      <div className="components-toolbar">
        {record && (
          <button onClick={() => onOpen(selected)}>
            管理当前 Agent · {record.name}
          </button>
        )}
        <SearchField label="搜索公共库" value={search} onChange={onSearch} />
      </div>
      <LibraryView
        items={library.filter(
          (p) =>
            p.manifest.kind === kind ||
            (kind === "extension" && p.manifest.kind === "connector"),
        )}
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
      {developer && output !== undefined && <RawJson value={output} />}
    </>
  );
}
