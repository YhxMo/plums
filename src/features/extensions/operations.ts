import type { Runtime } from "../../shell/runtime";
import { extensionOwner } from "../../../modules/sdk";
export async function saveRemovedImport(
  runtime: Runtime,
  id: string,
  imports: Runtime["imports"],
) {
  await runtime.adapter.credentials.prepareUninstall(
    extensionOwner(id),
    runtime.host.ids().includes(id) &&
      !!runtime.host.manifest(id).credentialBindings,
  );
  const composition = runtime.composition && {
    ...runtime.composition,
    enabled: runtime.composition.enabled.filter((entry) => entry.id !== id),
  };
  await runtime.save({ imports, ...(composition ? { composition } : {}) });
  runtime.composition = composition;
}
