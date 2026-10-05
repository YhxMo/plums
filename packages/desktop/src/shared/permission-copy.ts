import type { Permission, PermissionV1, PermissionV2 } from "@plums/core";
const operationNames: Record<string, string> = {
  read: "读取",
  list: "查看列表",
  write: "写入",
};
export function permissionCopy(
  permission: Permission,
  formatVersion = "kind" in permission ? "2.0" : "1.0",
  serviceTargets?: string[],
): string {
  const target = permission.target.startsWith("*.")
    ? `${permission.target.slice(2)} 这个网站的所有子站`
    : permission.target;
  if (formatVersion.startsWith("2.")) {
    const typed = permission as PermissionV2;
    if (typed.kind === "fs")
      return `${typed.operations.map((op) => operationNames[op]).join("和")}目录 ${target} 内的文件`;
    if (typed.kind === "service")
      return target === "https"
        ? `连接当前 Agent 配置的 HTTPS 服务${serviceTargets?.length ? `：${serviceTargets.join("、")}` : ""}`
        : `使用 ${target} 服务：${typed.operations.join("、")}`;
    if (typed.kind === "engine") return `启动本机引擎 ${target}（读取和修改文件、运行程序及访问网络；首次启动需单独信任）`;
    if (typed.kind === "exec") return `运行程序 ${target}`;
    return `把数据发送到 ${target}`;
  }
  const legacy = permission as PermissionV1;
  return legacy.level === "egress"
    ? `把数据发送到 ${target}`
    : legacy.level === "write"
      ? `修改 ${target} 的数据`
      : `读取 ${target} 的数据`;
}
