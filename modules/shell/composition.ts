import { ContractError } from "../sdk/errors";
import { array, object, string } from "../sdk/validation";
import type { Host } from "../extension-host/host";

export type Composition = {
  schema: 1;
  enabled: { id: string; version: string }[];
};
export function readComposition(value: unknown): Composition | undefined {
  if (value === undefined) return undefined;
  const candidate = object(value, "state.composition", { path: "composition" });
  if (candidate.schema !== 1)
    throw new ContractError("state.composition", "composition");
  const seen = new Set<string>();
  array(
    candidate.enabled,
    "state.composition",
    (value, path) => {
      const entry = object(value, "state.composition", { path });
      const id = string(entry.id, "state.composition", {
        path: `${path}.id`,
        pattern: /^[a-z][a-z0-9.-]{0,63}$/,
      });
      string(entry.version, "state.composition", {
        path: `${path}.version`,
        min: 1,
      });
      if (id.includes("..") || seen.has(id))
        throw new ContractError("state.composition", `${path}.id`);
      seen.add(id);
      return entry;
    },
    { path: "composition.enabled" },
  );
  return candidate as Composition;
}
type CompositionHost = Pick<Host, "ids" | "manifest" | "inspect">;
function issues(host: CompositionHost, composition: Composition): string[] {
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
export function captureComposition(host: CompositionHost): Composition {
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
export async function restoreComposition(
  host: CompositionHost & Pick<Host, "start">,
  composition: Composition,
) {
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
