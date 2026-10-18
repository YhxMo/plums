import type { Host } from "../extension-host/host";
import type { Agent, AgentProvider } from "../sdk/agents";

export function readActiveAgents(host: Host): {
  agents: Agent[];
  error?: string;
} {
  try {
    const provider = host.peekService<AgentProvider>("agents", 1);
    return { agents: provider ? provider.list() : [] };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    return {
      agents: [],
      error: message.trim() || "提供者返回空错误",
    };
  }
}

export function mapExtensionAgents(
  host: Host,
  agents: Agent[],
): Record<string, Agent[]> {
  const result: Record<string, Agent[]> = Object.create(null);
  if (!agents.length) return result;
  const active = new Map(
    host
      .ids()
      .filter((id) => host.inspect(id).status === "active")
      .map((id) => [id, host.manifest(id)]),
  );
  const activeProviders = new Map<string, string>();
  for (const [id, manifest] of active) {
    for (const service of Object.keys(manifest.provides ?? {})) {
      activeProviders.set(service, id);
    }
  }
  const viewOwners = new Set(host.views().map((view) => view.owner));
  const agentViews = [...active]
    .filter(
      ([id, manifest]) => manifest.requires?.agents === 1 && viewOwners.has(id),
    )
    .map(([id]) => id);
  const addAgent = (extensionId: string, agent: Agent) => {
    const list = (result[extensionId] ??= []);
    if (!list.some((item) => item.id === agent.id)) list.push(agent);
  };
  for (const agent of agents) {
    if (!active.has(agent.extensionId)) continue;
    const queue = [agent.extensionId];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      const manifest = active.get(current);
      if (visited.has(current) || !manifest) continue;
      visited.add(current);
      addAgent(current, agent);
      for (const req of Object.keys(manifest.requires ?? {})) {
        const depOwner = activeProviders.get(req);
        if (depOwner && !visited.has(depOwner)) queue.push(depOwner);
      }
    }
    for (const id of agentViews) addAgent(id, agent);
  }
  return result;
}
