/** Explain an enable attempt that did not reach the active state. */
export function waitingNotice(status: string, error?: string): string | null {
  if (status === "active") return null;
  const reason = error?.trim().replace(/。$/, "") || "等待条件";
  return `扩展尚未运行：${reason}。`;
}
