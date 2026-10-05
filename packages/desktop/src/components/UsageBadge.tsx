import type { AgentRecord } from "@plums/host";
import { Popover } from "./Popover.js";
import { Icon } from "./Icon.js";
export function UsageBadge({
  agents,
  onOpen,
}: {
  agents: AgentRecord[];
  onOpen: (id: string) => void;
}) {
  return agents.length ? (
    <Popover
      className="usage"
      label={`被 ${agents.length} 个 Agent 使用`}
      trigger={
        <>
          被 {agents.length} 个 Agent 使用
          <Icon name="next" size={12} />
        </>
      }
    >
      <p className="popover-title">使用此组件的 Agent</p>
      {agents.map((agent) => (
        <button key={agent.instanceId} onClick={() => onOpen(agent.instanceId)}>
          <span className="mini-avatar">{agent.name.slice(0, 1)}</span>
          {agent.name}
          <Icon name="next" size={14} />
        </button>
      ))}
    </Popover>
  ) : (
    <span className="usage-badge unused">未被使用</span>
  );
}
