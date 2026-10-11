import type { Resource } from "../shared/types.js";
import {
  executionGuidance,
  executionRecords,
} from "../shared/execution-state.js";
export function ExecutionRecordList({
  events,
  resources,
  limit = 5,
}: {
  events: unknown[] | null;
  resources: Resource[];
  limit?: number;
}) {
  if (!events) return <p role="status">正在读取执行记录…</p>;
  const records = executionRecords(events, limit);
  return records.length ? (
    <ol className="execution-records">
      {records.map((chain) => {
        const event = chain.at(-1)!;
        const guidance =
          event.executionState && executionGuidance[event.executionState];
        return (
          <li key={event.callId}>
            <time>
              {new Date(event.timestamp).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <div>
              <strong>
                {event.phase === "task"
                  ? "任务范围"
                  : (resources.find((r) => r.id === event.extensionId)?.name ??
                    "组件调用")}
              </strong>
              <span>
                {event.phase === "task"
                  ? event.reason === "TASK_REVOKED"
                    ? "停止并撤权"
                    : "授权"
                  : event.kind === "fs"
                    ? event.operation === "write"
                      ? "写入"
                      : "读取"
                    : event.kind === "egress"
                      ? "联网"
                      : "运行"}{" "}
                ·{" "}
                {event.phase === "task" && event.outcome === "allowed"
                  ? "已批准"
                  : event.phase === "task" && event.reason === "TASK_REVOKED"
                    ? "已撤销"
                    : event.outcome === "denied"
                      ? "已拒绝"
                      : [
                            "failed",
                            "error",
                            "timeout",
                            "missing",
                            "invalid",
                          ].includes(event.outcome)
                        ? "未完成"
                        : event.executionState === "completed"
                          ? "已执行"
                          : "已记录"}
              </span>
              {guidance && event.phase !== "task" && (
                <p>
                  {guidance.title}。{guidance.next}
                </p>
              )}
              <details>
                <summary>查看调用阶段与核实信息</summary>
                <p>
                  调用标识：<code>{event.callId}</code>
                </p>
                <ol className="execution-stages">
                  {chain.map((stage, index) => (
                    <li key={index}>
                      {stage.phase} · {stage.outcome}
                      {stage.executionState ? ` · ${stage.executionState}` : ""}
                    </li>
                  ))}
                </ol>
                <p>
                  如需向组件作者反馈，请提供调用标识和阶段；勿提供密钥或业务正文。
                </p>
              </details>
            </div>
          </li>
        );
      })}
    </ol>
  ) : (
    <p>暂无执行记录。</p>
  );
}
