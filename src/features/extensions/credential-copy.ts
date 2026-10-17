import type { CredentialManagementResponse } from "../../credentials";

/** Shared management copy; keeps result-code mapping testable outside React. */
export function resultMessage(
  result: CredentialManagementResponse,
  success: string,
) {
  if (result.status === "saved") return success;
  if (result.status === "cancelled") return "已取消，保留原连接记录。";
  if (result.status === "unknown")
    return "操作结果待核对，请刷新记录后处理待核对项。";
  const reasons: Record<string, string> = {
    unavailable: "当前平台或凭据服务不可用，操作未执行；原记录已保留。",
    "invalid-key": "API Key 不能为空、包含空格或超过 4096 字节。",
    "invalid-policy":
      "目标、请求头或代理地址无效；代理地址仅支持无账号密码的 HTTP(S) 地址。",
    conflict: "连接记录已变化，请刷新后重试。",
    busy: "已有原生操作进行中，请先完成或取消。",
    "reconcile-required": "请先核对保存状态或完成凭据删除。",
    "cleanup-required": "请先撤销并删除旧凭据，再重新录入。",
  };
  return reasons[result.reason] ?? "操作未完成，请核对连接记录后重试。";
}
