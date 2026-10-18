import type { Host } from "../extension-host/host";
import type { ImportedExtension } from "./uninstall";

export type FallbackDiagnosis = {
  selected: string;
  label: string;
  activeView?: string;
  activeLabel?: string;
  targetExtensionId?: string;
  reason: string;
  signature: string;
  message: string;
};

const capabilityText = (capability: string) =>
  ({
    "state.read": "读取隔离状态",
    "state.write": "写入隔离状态",
    "platform.info": "查看平台信息",
    "document.read": "只读访问所选文档",
  })[capability] ?? capability;

function ownString(record: Record<string, string> | undefined, key: string) {
  if (!record || !Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function viewHint(catalog: ImportedExtension[], viewId: string) {
  for (const entry of catalog) {
    const label = ownString(entry.views, viewId);
    if (label !== undefined) return { owner: entry.id, label };
  }
  return undefined;
}

function explainWaitReason(
  host: Host,
  catalog: ImportedExtension[],
  extensionId: string,
  visited = new Set<string>(),
): { reason: string; targetId: string } {
  if (visited.has(extensionId) || !host.ids().includes(extensionId)) {
    return { reason: "扩展未安装或尚未加载", targetId: extensionId };
  }
  visited.add(extensionId);
  const info = host.inspect(extensionId);
  const manifest = host.manifest(extensionId);
  const name =
    catalog.find((entry) => entry.id === extensionId)?.label ?? extensionId;
  if (info.status === "disabled" && !info.desired) {
    return {
      reason: `扩展 ${name}（${extensionId}）尚未启用`,
      targetId: extensionId,
    };
  }
  if (info.status === "failed" || info.status === "cleanup-failed") {
    return {
      reason: `扩展 ${name}（${extensionId}）运行异常：${info.error ?? info.status}`,
      targetId: extensionId,
    };
  }
  const wait = info.wait;
  if (wait?.kind === "permission")
    return {
      reason: `扩展 ${name}（${extensionId}）等待「${capabilityText(wait.capability)}」授权`,
      targetId: extensionId,
    };
  if (wait?.kind === "capability-unavailable")
    return {
      reason: `当前平台不支持能力 ${capabilityText(wait.capability)}`,
      targetId: extensionId,
    };
  if (wait?.kind === "configuration")
    return {
      reason: `扩展 ${name}（${extensionId}）配置无效`,
      targetId: extensionId,
    };
  if (wait?.kind === "dependency") {
    const dep = `${wait.service}@${wait.version}`;
    const candidate = host
      .ids()
      .find((id) => host.manifest(id).provides?.[wait.service] !== undefined);
    if (candidate) {
      const nested = explainWaitReason(host, catalog, candidate, visited);
      return {
        reason: `依赖服务 ${dep} 未就绪（${nested.reason}）`,
        targetId: nested.targetId,
      };
    }
    return {
      reason: `依赖服务 ${dep} 未启用`,
      targetId: extensionId,
    };
  }
  for (const [serviceName, version] of Object.entries(
    manifest.requires ?? {},
  )) {
    const provider = host
      .ids()
      .find(
        (id) =>
          host.manifest(id).provides?.[serviceName] === version &&
          host.inspect(id).status === "active",
      );
    if (!provider) {
      const candidate = host
        .ids()
        .find((id) => host.manifest(id).provides?.[serviceName] === version);
      if (candidate) {
        const nested = explainWaitReason(host, catalog, candidate, visited);
        return {
          reason: `依赖服务 ${serviceName}@${version} 未就绪（${nested.reason}）`,
          targetId: nested.targetId,
        };
      }
    }
  }
  return {
    reason:
      wait?.kind === "cycle"
        ? `扩展 ${name}（${extensionId}）存在循环依赖`
        : info.error || `扩展 ${name}（${extensionId}）暂未就绪`,
    targetId: extensionId,
  };
}

export function diagnoseLayoutFallback(
  host: Host,
  catalog: ImportedExtension[],
  selected: string,
  activeView: string | undefined,
  failedViews: Record<string, number>,
  failedImports: Record<string, string>,
): FallbackDiagnosis | null {
  if (!selected || selected === activeView) return null;
  const activeEntry = host.views().find((view) => view.id === activeView);
  const activeLabel =
    activeEntry?.label ??
    (activeView
      ? (viewHint(catalog, activeView)?.label ?? activeView)
      : undefined);
  const registered = host.views().find((view) => view.id === selected);
  const known = viewHint(catalog, selected);
  const ownerId =
    registered?.owner ??
    known?.owner ??
    (host.ids().includes(selected) ? selected : undefined);
  const label =
    registered?.label ??
    known?.label ??
    catalog.find((entry) => entry.id === selected)?.label ??
    selected;
  const ownerFailure = ownerId ? ownString(failedImports, ownerId) : undefined;
  const viewFailure = ownString(failedImports, selected);
  let reason = "对应界面扩展尚未启用";
  let targetExtensionId = ownerId;
  if (registered && failedViews[selected] === registered.generation) {
    reason = "界面挂载失败，已隔离故障视图";
    targetExtensionId = registered.owner;
  } else if (ownerFailure) {
    reason = `模块加载失败：${ownerFailure}`;
    targetExtensionId = ownerId;
  } else if (viewFailure) {
    reason = `模块加载失败：${viewFailure}`;
    targetExtensionId = selected;
  } else if (ownerId && host.ids().includes(ownerId)) {
    const explained = explainWaitReason(host, catalog, ownerId);
    reason = explained.reason;
    targetExtensionId = explained.targetId;
  }
  const titleText = label === selected ? selected : `${label} (${selected})`;
  const fallbackText = activeLabel
    ? `已切换至 ${activeLabel}`
    : "当前暂无可用界面，请使用下方恢复入口或前往扩展管理";
  const signature = `${selected}|${activeView ?? "none"}|${targetExtensionId ?? "unknown"}|${reason}`;
  return {
    selected,
    label,
    activeView,
    activeLabel,
    targetExtensionId,
    reason,
    signature,
    message: `所选界面 ${titleText} 暂不可用（原因：${reason}），${fallbackText}；原偏好和数据已保留。`,
  };
}
