import type { AuditEvent } from "@plumsjs/core";

export const executionGuidance = {
  not_started: {
    title: "记录生成时操作尚未开始执行",
    next: "先刷新状态并确认调用已结束；修复配置或权限后，由你明确发起重试。",
  },
  unknown: {
    title: "操作可能已经执行，结果未知",
    next: "先核实文件、资源或外部服务结果，再决定下一步。停止不会回滚副作用。",
  },
  completed: {
    title: "操作已执行，后续处理可能失败",
    next: "先核实已产生的结果；查看调用阶段定位后续失败，请勿自动重试。",
  },
} satisfies Record<
  NonNullable<AuditEvent["executionState"]>,
  { title: string; next: string }
>;

export function executionRecords(events: unknown[], limit: number) {
  const grouped = new Map<string, AuditEvent[]>();
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    const value = event as AuditEvent;
    if (typeof value.callId !== "string" || typeof value.timestamp !== "string")
      continue;
    const chain = grouped.get(value.callId) ?? [];
    chain.push(value);
    // Move the call to the end when another stage arrives.
    grouped.delete(value.callId);
    grouped.set(value.callId, chain);
  }
  return Array.from(grouped.values()).slice(-limit).reverse();
}
