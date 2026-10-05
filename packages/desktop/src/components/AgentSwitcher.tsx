import type { AgentRecord } from "@plums/host";
export function AgentSwitcher({
  agents,
  selected,
  onChange,
}: {
  agents: AgentRecord[];
  selected: string;
  onChange: (id: string) => void;
}) {
  if (!agents.length) return null;
  return (
    <label className="agent-switcher">
      <span className="mini-avatar" aria-hidden="true">
        {agents.find((a) => a.instanceId === selected)?.name.slice(0, 1)}
      </span>
      <select
        data-testid="agent-switcher"
        aria-label="当前 Agent"
        value={selected}
        onChange={(event) => onChange(event.target.value)}
      >
        {agents.map((agent) => (
          <option key={agent.instanceId} value={agent.instanceId}>
            {agent.name}
          </option>
        ))}
      </select>
    </label>
  );
}
