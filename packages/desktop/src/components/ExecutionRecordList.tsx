import type { AuditEvent } from "@plums/core";
import type { Resource } from "../shared/types.js";
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
  const grouped = new Map<string, AuditEvent>();
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    const value = event as AuditEvent;
    if (typeof value.callId === "string" && typeof value.timestamp === "string")
      grouped.set(value.callId, value);
  }
  return grouped.size ? (
    <ol className="execution-records">
      {Array.from(grouped.values())
        .slice(-limit)
        .reverse()
        .map((event) => (
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
                    : event.executionState === "completed"
                      ? "已完成"
                      : event.outcome === "denied"
                        ? "已拒绝"
                        : event.outcome === "failed"
                          ? "未完成"
                          : "已记录"}
              </span>
            </div>
          </li>
        ))}
    </ol>
  ) : (
    <p>暂无执行记录。</p>
  );
}
