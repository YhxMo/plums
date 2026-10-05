import type { AgentRecord } from "@plums/host";
import { StatusChip, startLabel, type AgentStatus } from "./StatusChip.js";
import { Popover } from "./Popover.js";
import { Icon } from "./Icon.js";
import { kindLabel, type ComponentKind } from "./KindIcon.js";
export function AgentCard({
  agent,
  status,
  busy,
  primary,
  onOpen,
  onStart,
}: {
  agent: AgentRecord;
  status?: AgentStatus;
  busy: boolean;
  primary: boolean;
  onOpen: () => void;
  onStart: () => void;
}) {
  return (
    <article
      className="agent-card"
      data-testid="agent-card"
      tabIndex={0}
      aria-label={`查看 ${agent.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="card-heading">
        <span className="avatar">{agent.name.slice(0, 1)}</span>
        <StatusChip status={status} />
      </div>
      <h3 title={agent.name}>{agent.name}</h3>
      <div className="card-meta">
        <span>v{agent.agent.version}</span>
        {(["character", "extension"] as ComponentKind[]).map((kind) => (
          <span key={kind} data-kind={kind}>
            <i className="kind-dot" />
            {kindLabel[kind]}{" "}
            {agent.components?.filter(
              (p) =>
                p.kind === kind ||
                (kind === "extension" && p.kind === "connector"),
            ).length ?? 0}
          </span>
        ))}
      </div>
      {agent.recoveryError && (
        <p className="error-text" role="alert">
          {agent.recoveryError}
        </p>
      )}
      <div
        className="card-actions"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className={primary ? "cta" : ""}
          disabled={busy || status === "unavailable"}
          onClick={onStart}
        >
          {startLabel(status)}
        </button>
        <Popover
          label={`${agent.name} 的更多操作`}
          trigger={<Icon name="more" size={16} />}
        >
          <button onClick={onOpen}>查看详情</button>
        </Popover>
      </div>
    </article>
  );
}
