import { ContractError } from "../sdk/errors";
import { array, identifier, object, string } from "../sdk/validation";
import type { Host } from "../extension-host/host";

type Entry = { id: string; version: string };
/** Capabilities the user granted; they apply only to the recorded version. */
export type Grant = Entry & { capabilities: string[] };
export type Composition = {
  schema: 1;
  enabled: Entry[];
  granted?: Grant[];
};
function entries<T extends Entry>(
  value: unknown,
  path: string,
  extra: (entry: Record<string, unknown>, path: string) => void = () => {},
): T[] {
  const seen = new Set<string>();
  return array(
    value,
    "state.composition",
    (value, path) => {
      const entry = object(value, "state.composition", { path });
      const id = identifier(entry.id, "state.composition", {
        path: `${path}.id`,
      });
      string(entry.version, "state.composition", {
        path: `${path}.version`,
        min: 1,
      });
      if (seen.has(id))
        throw new ContractError("state.composition", `${path}.id`);
      seen.add(id);
      extra(entry, path);
      return entry as T;
    },
    { path },
  );
}
export function readComposition(value: unknown): Composition | undefined {
  if (value === undefined) return undefined;
  const candidate = object(value, "state.composition", { path: "composition" });
  if (candidate.schema !== 1)
    throw new ContractError("state.composition", "composition");
  entries(candidate.enabled, "composition.enabled");
  if (candidate.granted !== undefined)
    entries(candidate.granted, "composition.granted", (entry, path) =>
      array(entry.capabilities, "state.composition", undefined, {
        path: `${path}.capabilities`,
      }).forEach((capability, index) =>
        string(capability, "state.composition", {
          path: `${path}.capabilities.${index}`,
          min: 1,
        }),
      ),
    );
  return candidate as Composition;
}
type CompositionHost = Pick<Host, "ids" | "manifest" | "inspect" | "granted">;
/**
 * What is enabled and granted now. Saved entries of `pending` extensions,
 * imports that did not load this time, keep their place until they do.
 */
export function captureComposition(
  host: CompositionHost,
  previous?: Composition,
  pending: string[] = [],
): Composition {
  const installed = host.ids();
  const kept = <T extends Entry>(list: T[] = []) =>
    list.filter(({ id }) => !installed.includes(id) && pending.includes(id));
  const version = (id: string) => host.manifest(id).version;
  const enabled = [
    ...kept(previous?.enabled),
    ...installed
      .filter((id) => host.inspect(id).desired)
      .map((id) => ({ id, version: version(id) })),
  ];
  const granted = [
    ...kept(previous?.granted),
    ...installed
      .map((id) => ({
        id,
        version: version(id),
        capabilities: host.granted(id),
      }))
      .filter(({ capabilities }) => capabilities.length),
  ];
  return { schema: 1, enabled, ...(granted.length ? { granted } : {}) };
}
/**
 * Boot-only restoration. Grants return only for the version they were given
 * to; an extension that is no longer installed is skipped.
 */
export async function restoreComposition(
  host: CompositionHost & Pick<Host, "start" | "grant">,
  composition: Composition,
) {
  const errors: string[] = [];
  const installed = host.ids();
  for (const { id, version, capabilities } of composition.granted ?? []) {
    if (!installed.includes(id) || host.manifest(id).version !== version)
      continue;
    try {
      await host.grant(id, capabilities);
    } catch (error) {
      errors.push(`权限恢复失败 ${id}：${String(error)}`);
    }
  }
  for (const { id } of composition.enabled) {
    if (!installed.includes(id)) continue;
    try {
      await host.start(id);
    } catch (error) {
      errors.push(`组合恢复失败 ${id}：${String(error)}`);
    }
  }
  return errors;
}
