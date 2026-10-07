import type { AgentRecord } from "@plums/host";
import { SelectMenu } from "./SelectMenu.js";
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
    <SelectMenu
      className="agent-switcher"
      testId="agent-switcher"
      label="当前 Agent"
      value={selected}
      onChange={onChange}
      options={agents.map((agent) => ({
        value: agent.instanceId,
        label: agent.name,
        leading: (
          <span className="mini-avatar" aria-hidden="true">
            {agent.name.slice(0, 1)}
          </span>
        ),
      }))}
    />
  );
}
