import type { Host } from "../extension-host/host";
export type ImportedExtension = { id: string; url: string; label: string };

/** Persist removal only after cleanup and revocation. Never remove extension data or code. */
export async function uninstallImport(
  host: Host,
  id: string,
  imports: ImportedExtension[],
  save: (next: ImportedExtension[]) => Promise<void>,
) {
  if (!imports.some((entry) => entry.id === id))
    throw new Error("仅支持卸载手动安装的扩展。");
  await host.stop(id);
  await host.grant(id, []);
  const next = imports.filter((entry) => entry.id !== id);
  await save(next);
  await host.uninstall(id);
  return next;
}
