import { Icon } from "./Icon.js";
import type { AgentRuntimeState } from "../shared/types.js";
export function RunningBar({
  runtime,
  busy,
  onReturn,
  onStop,
}: {
  runtime: NonNullable<AgentRuntimeState>;
  busy: boolean;
  onReturn: () => void;
  onStop: () => void;
}) {
  return (
    <div className="running-bar" data-testid="running-bar">
      <button className="ghost sm" disabled={busy} onClick={onReturn}>
        <Icon name="back" size={16} />
        返回
      </button>
      <span>
        <span className="mini-avatar">{runtime.name.slice(0, 1)}</span>
        <span
          className="running-name"
          role={runtime.diagnostics?.length ? "status" : undefined}
          title={
            runtime.diagnostics?.length
              ? "部分界面未恢复。返回管理页重新选择组件。"
              : undefined
          }
        >
          {runtime.diagnostics?.length ? "部分界面未恢复" : runtime.name}
        </span>
        <i className="running-dot" />
      </span>
      <button className="ghost sm danger" disabled={busy} onClick={onStop}>
        停止
      </button>
    </div>
  );
}
