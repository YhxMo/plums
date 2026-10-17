import { ContractError, type ErrorCode } from "../../modules/sdk/errors";

export const preservedMessage = (
  reason: string,
  separator = "，",
  end = "。",
) => `${reason}${separator}原数据已保留${end}`;
const defaults: Record<ErrorCode, string> = {
  "state.version": "应用配置版本不支持",
  "state.corrupt": "应用配置损坏",
  "state.imports": "扩展路径配置无效",
  "state.pages": "页面偏好损坏",
  "state.composition": "组合配置版本不支持或已损坏",
  "host.invalid": "宿主操作无效。",
  "extension.invalid": "扩展声明无效。",
};
function hostMessage(message: string) {
  const exact: Record<string, string> = {
    "Extension stopped": "扩展已停用。",
    "cleanup timeout; restart required": "清理超时，请重新启动应用。",
    "activation timeout; retry allowed": "激活超时；可以重试。",
    "Cleanup incomplete; restart required": "清理未完成，请重新启动应用。",
    "Stop extension before configuring": "请先停用扩展，再修改配置。",
    "Stop extension successfully before uninstall":
      "请先成功停用扩展，再卸载。",
    "Capability not declared": "扩展未声明所需能力。",
    "Shell bridge already connected": "宿主入口已连接。",
    "Unknown shell action": "宿主操作不支持。",
    "Shell controls unavailable": "宿主入口暂不可用。",
    "Dependency cycle": "扩展存在循环依赖。",
  };
  if (Object.hasOwn(exact, message)) return exact[message];
  const prefixes: Record<string, string> = {
    "Unknown extension: ": "扩展不存在：",
    "Extension already installed: ": "扩展已安装：",
    "View unavailable: ": "界面暂不可用：",
    "Service not declared or unavailable: ": "服务未声明或暂不可用：",
    "Service not declared: ": "服务未声明：",
    "Service already provided: ": "服务提供者冲突：",
    "Theme conflict: ": "主题标识冲突：",
    "View conflict: ": "界面标识冲突：",
    "Configuration invalid: ": "扩展配置无效：",
    "Capability unavailable: ": "能力暂不可用：",
    "Permission required: ": "需要授权：",
    "Dependency unavailable: ": "依赖暂不可用：",
  };
  for (const [prefix, translated] of Object.entries(prefixes))
    if (message.startsWith(prefix))
      return translated + message.slice(prefix.length);
  return undefined;
}
export function errorMessage(error: unknown): string {
  if (!(error instanceof ContractError)) {
    const message = error instanceof Error ? error.message : String(error);
    return hostMessage(message) ?? message;
  }
  const { code, detail } = error;
  if (!Object.hasOwn(defaults, code)) return error.message;
  let reason = defaults[code];
  if (code === "host.invalid")
    return hostMessage(error.message) ?? defaults["host.invalid"];
  if (code === "extension.invalid") {
    if (detail.startsWith("configuration")) return "扩展配置无效。";
    if (detail.startsWith("credentialBindings")) return "凭据绑定声明无效。";
    if (detail.startsWith("theme")) return "主题声明无效。";
    return reason;
  }
  if (code === "state.corrupt") {
    if (detail.startsWith("pages")) reason = defaults["state.pages"];
    else if (detail.startsWith("configurations")) reason = "扩展配置损坏";
    else if (detail.startsWith("agents.sessions")) reason = "会话配置损坏";
    else if (detail.startsWith("agents.currentSessionId"))
      reason = "当前会话不存在";
    else if (detail.startsWith("agents")) reason = "Agent 配置损坏";
    else if (detail.startsWith("workbench"))
      return preservedMessage("工作台状态版本或内容无效", "；", "");
    else if (detail.startsWith("migration")) reason = "状态迁移数据无效";
  }
  if (code === "state.imports" && detail === "imports")
    reason = "扩展路径配置损坏";
  if (code === "state.composition" && detail.startsWith("composition.enabled."))
    reason = "组合配置无效";
  return preservedMessage(reason);
}
export const capabilityLabel = (capability: string) =>
  ({
    "state.read": "读取隔离状态",
    "state.write": "写入隔离状态",
    "platform.info": "查看平台信息",
    "document.read": "只读访问本次选择的文档（最多64 KiB）",
    "credential.request": "通过已授权连接发送请求",
  })[capability] ?? capability;
export const translateStatus = (status: string) =>
  ({
    disabled: "已停用",
    active: "运行中",
    stopping: "停用中",
    waiting: "等待条件",
    failed: "激活失败",
    "cleanup-failed": "清理未完成",
  })[status] ?? status;
