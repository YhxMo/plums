import type { Host } from "../extension-host/host";
import type { Agent, AgentProvider } from "../sdk/agents";
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

const viewOwnerMap: Record<
  string,
  { owner: string; label: string } | undefined
> = {
  agents: { owner: "ui.agents", label: "Agent 界面" },
  default: { owner: "ui.default", label: "工作台" },
  board: { owner: "ui.board", label: "画布" },
  "text-workbench": { owner: "ui.workbench-board", label: "文本处理工作台" },
  broken: { owner: "ui.broken", label: "故障布局实验" },
};

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
  const raw = info.error ?? "";
  if (raw.startsWith("Permission required:")) {
    const cap = raw.slice("Permission required:".length).trim();
    return {
      reason: `扩展 ${name}（${extensionId}）等待「${capabilityText(cap)}」授权`,
      targetId: extensionId,
    };
  }
  if (raw.startsWith("Capability unavailable:")) {
    const cap = raw.slice("Capability unavailable:".length).trim();
    return {
      reason: `当前平台不支持能力 ${capabilityText(cap)}`,
      targetId: extensionId,
    };
  }
  if (raw.startsWith("Configuration invalid:")) {
    return {
      reason: `扩展 ${name}（${extensionId}）配置无效`,
      targetId: extensionId,
    };
  }
  if (raw.startsWith("Dependency unavailable:")) {
    const dep = raw.slice("Dependency unavailable:".length).trim();
    const serviceName = dep.split("@")[0];
    const candidate = host
      .ids()
      .find((id) => host.manifest(id).provides?.[serviceName] !== undefined);
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
    reason: raw || `扩展 ${name}（${extensionId}）暂未就绪`,
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
    (activeView ? (viewOwnerMap[activeView]?.label ?? activeView) : undefined);
  const registered = host.views().find((view) => view.id === selected);
  const known = viewOwnerMap[selected];
  const ownerId =
    registered?.owner ??
    known?.owner ??
    (host.ids().includes(selected) ? selected : undefined);
  const label =
    registered?.label ??
    known?.label ??
    catalog.find((entry) => entry.id === selected)?.label ??
    selected;
  let reason = "对应界面扩展尚未启用";
  let targetExtensionId = ownerId;
  if (registered && failedViews[selected] === registered.generation) {
    reason = "界面挂载失败，已隔离故障视图";
    targetExtensionId = registered.owner;
  } else if (ownerId && failedImports[ownerId]) {
    reason = `模块加载失败：${failedImports[ownerId]}`;
    targetExtensionId = ownerId;
  } else if (failedImports[selected]) {
    reason = `模块加载失败：${failedImports[selected]}`;
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

export function readActiveAgents(host: Host): Agent[] {
  try {
    const provider = host.peekService<AgentProvider>("agents", 1);
    return provider ? provider.list() : [];
  } catch {
    return [];
  }
}

export function mapExtensionAgents(
  host: Host,
  agents: Agent[],
): Record<string, Agent[]> {
  const result: Record<string, Agent[]> = Object.create(null);
  if (!agents.length) return result;
  const activeIds = host
    .ids()
    .filter((id) => host.inspect(id).status === "active");
  const activeProviders = new Map<string, string>();
  for (const id of activeIds) {
    for (const service of Object.keys(host.manifest(id).provides ?? {})) {
      activeProviders.set(service, id);
    }
  }
  const addAgent = (extensionId: string, agent: Agent) => {
    const list = (result[extensionId] ??= []);
    if (!list.some((item) => item.id === agent.id)) list.push(agent);
  };
  for (const agent of agents) {
    if (!host.ids().includes(agent.extensionId)) continue;
    if (host.inspect(agent.extensionId).status !== "active") continue;
    const queue = [agent.extensionId];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current) || !host.ids().includes(current)) continue;
      visited.add(current);
      if (host.inspect(current).status !== "active") continue;
      addAgent(current, agent);
      const manifest = host.manifest(current);
      for (const req of Object.keys(manifest.requires ?? {})) {
        const depOwner = activeProviders.get(req);
        if (depOwner && !visited.has(depOwner)) queue.push(depOwner);
      }
    }
    for (const id of activeIds) {
      const manifest = host.manifest(id);
      if (
        manifest.requires?.agents === 1 &&
        host.views().some((v) => v.owner === id)
      ) {
        addAgent(id, agent);
      }
    }
  }
  return result;
}
