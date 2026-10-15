import type { Host } from "../extension-host/host";

export type Composition = {
  schema: 1;
  enabled: { id: string; version: string }[];
};
export function readComposition(value: unknown): Composition | undefined {
  if (value === undefined) return undefined;
  const candidate = value as Composition | null;
  const seen = new Set<string>();
  if (!candidate || candidate.schema !== 1 || !Array.isArray(candidate.enabled))
    throw Error("组合配置版本不支持或已损坏，原数据已保留。");
  for (const entry of candidate.enabled) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !/^[a-z][a-z0-9.-]{0,63}$/.test(entry.id) ||
      entry.id.includes("..") ||
      typeof entry.version !== "string" ||
      !entry.version ||
      seen.has(entry.id)
    )
      throw Error("组合配置无效，原数据已保留。");
    seen.add(entry.id);
  }
  return candidate;
}
function issues(host: Host, composition: Composition): string[] {
  const errors: string[] = [];
  const providers = new Map<string, string>();
  for (const entry of composition.enabled) {
    if (!host.ids().includes(entry.id)) {
      errors.push(`缺失扩展 ${entry.id}`);
      continue;
    }
    const manifest = host.manifest(entry.id);
    if (manifest.version !== entry.version)
      errors.push(
        `扩展版本不符 ${entry.id}：需要 ${entry.version}，实际 ${manifest.version}`,
      );
    for (const name of Object.keys(manifest.provides ?? {})) {
      const previous = providers.get(name);
      if (previous)
        errors.push(`服务 ${name} 的提供者冲突：${previous}、${entry.id}`);
      providers.set(name, entry.id);
    }
  }
  return errors;
}
export function captureComposition(host: Host): Composition {
  const composition: Composition = {
    schema: 1,
    enabled: host
      .ids()
      .filter((id) => host.inspect(id).desired)
      .map((id) => ({ id, version: host.manifest(id).version })),
  };
  const errors = issues(host, composition);
  for (const { id } of composition.enabled) {
    if (
      ["failed", "cleanup-failed", "stopping"].includes(host.inspect(id).status)
    )
      errors.push(`扩展 ${id} 尚未恢复，不能保存组合`);
  }
  if (errors.length) throw Error(errors.join("；"));
  return composition;
}
/** Boot-only restoration: grants stay session-scoped; missing permissions remain waiting. */
export async function restoreComposition(host: Host, composition: Composition) {
  const errors = issues(host, composition);
  if (errors.length) return errors;
  for (const { id } of composition.enabled) {
    try {
      await host.start(id);
    } catch (error) {
      errors.push(`组合恢复失败 ${id}：${String(error)}`);
    }
  }
  return errors;
}
