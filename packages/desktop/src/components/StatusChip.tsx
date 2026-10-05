export type AgentStatus =
  | "ready"
  | "needs-config"
  | "disabled"
  | "running"
  | "unavailable";
const labels = {
  ready: "可用",
  "needs-config": "待配置",
  disabled: "未启用",
  running: "运行中",
  unavailable: "无法读取",
};
export function StatusChip({ status }: { status?: AgentStatus }) {
  return (
    <span
      data-testid="agent-status"
      className={`status-chip ${status ?? "loading"}`}
    >
      <i />
      {status ? labels[status] : "读取中"}
    </span>
  );
}
export function startLabel(status?: AgentStatus) {
  return status === "needs-config"
    ? "去配置"
    : status === "disabled"
      ? "启用"
      : status === "running"
        ? "继续"
        : "开始使用";
}
