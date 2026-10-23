import { Host } from "@modules/extension-host/host";
import { loadExtension } from "@modules/extension-host/definition";
import type { ImportedExtension } from "@modules/shell/uninstall";
import {
  isFileImport,
  loadExtensionSource,
  type LoadSource,
  type SourceStore,
} from "@modules/shell/file-import";
import { errorMessage } from "./messages";

const readCatalog = async (path: string): Promise<ImportedExtension[]> => {
  const response = await fetch(path);
  if (!response.ok) throw new Error("扩展目录读取失败");
  return response.json();
};
/** Development builds add fault and sample extensions; releases never ship them. */
export async function loadCatalog(): Promise<ImportedExtension[]> {
  const catalog = await readCatalog("/catalog.json");
  if (!import.meta.env.DEV) return catalog;
  return [...catalog, ...(await readCatalog("/catalog.dev.json"))];
}
export async function installCatalog(
  host: Host,
  catalog: ImportedExtension[],
  configurations: Record<string, unknown>,
): Promise<void> {
  for (const entry of catalog)
    host.install(
      await loadExtension(new URL(entry.url, location.href).href, entry.id),
      configurations[entry.id],
    );
}
export async function installImports(
  host: Host,
  imports: ImportedExtension[],
  configurations: Record<string, unknown>,
  catalog: ImportedExtension[],
  {
    sources,
    loadSource = loadExtensionSource,
  }: { sources: SourceStore; loadSource?: LoadSource },
): Promise<{
  catalog: ImportedExtension[];
  failedImports: Record<string, string>;
}> {
  const failedImports: Record<string, string> = {};
  for (const entry of imports) {
    try {
      host.install(
        isFileImport(entry.url)
          ? await loadSource(await sources.read(entry.url), entry.id)
          : await loadExtension(
              new URL(entry.url, location.href).href,
              entry.id,
            ),
        configurations[entry.id],
      );
      catalog.push(entry);
    } catch (error) {
      failedImports[entry.id] = errorMessage(error);
    }
  }
  return { catalog, failedImports };
}
