import type { Runtime } from "../../shell/runtime";
export async function saveRemovedImport(
  runtime: Runtime,
  id: string,
  imports: Runtime["imports"],
) {
  const composition = runtime.composition && {
    ...runtime.composition,
    enabled: runtime.composition.enabled.filter((entry) => entry.id !== id),
  };
  await runtime.save({ imports, ...(composition ? { composition } : {}) });
  runtime.composition = composition;
}
