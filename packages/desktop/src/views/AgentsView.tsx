import type { AgentRecord } from "@plums/host";
import { AgentCard } from "../components/AgentCard.js";
import type { AgentStatus } from "../components/StatusChip.js";
import { EmptyState } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
export function AgentsView({
  agents,
  statuses,
  selected,
  busy,
  importing,
  onImport,
  onCreate,
  onOpen,
  onStart,
}: {
  agents: AgentRecord[];
  statuses: Record<string, AgentStatus>;
  selected: string;
  busy: boolean;
  importing: boolean;
  onImport: () => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onStart: (id: string) => void;
}) {
  return (
    <>
      <section className="page-header">
        <div>
          <h1>
            我的 Agent <span className="count-badge">{agents.length}</span>
          </h1>
          <p>你选择的角色与功能，组成自己的助手。</p>
        </div>
        {!!agents.length && (
          <button disabled={busy} onClick={onCreate}>
            <Icon name="plus" size={16} />
            创建 Agent
          </button>
        )}
      </section>
      {agents.length ? (
        <div className="agent-grid">
          {agents.map((agent) => (
            <AgentCard
              key={agent.instanceId}
              agent={agent}
              status={statuses[agent.instanceId]}
              busy={busy}
              primary={agent.instanceId === selected}
              onOpen={() => onOpen(agent.instanceId)}
              onStart={() => onStart(agent.instanceId)}
            />
          ))}
          <button
            className="import-agent-card"
            disabled={importing}
            onClick={onImport}
          >
            <Icon name="plus" size={24} />
            导入新的 Agent
          </button>
        </div>
      ) : (
        <EmptyState
          title="把第一个 Agent 拖进来"
          description="导入第三方 Agent，完成配置就能开始。"
          action={
            <>
              <button
                className="cta lg"
                disabled={importing}
                onClick={onImport}
              >
                选择文件
              </button>
              <button className="ghost" disabled={busy} onClick={onCreate}>
                从组件库组装
              </button>
            </>
          }
        />
      )}
    </>
  );
}
