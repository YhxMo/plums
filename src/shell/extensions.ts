import { Host, loadExtension } from "../../modules/extension-host/host";
import type { ImportedExtension } from "../../modules/shell/uninstall";
import { errorMessage } from "./messages";

export async function loadCatalog(): Promise<ImportedExtension[]> {
  const response = await fetch("/catalog.json");
  if (!response.ok) throw new Error("扩展目录读取失败");
  return response.json();
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
): Promise<{
  catalog: ImportedExtension[];
  failedImports: Record<string, string>;
}> {
  const failedImports: Record<string, string> = {};
  for (const entry of imports) {
    try {
      host.install(
        await loadExtension(new URL(entry.url, location.href).href, entry.id),
        configurations[entry.id],
      );
      catalog.push(entry);
    } catch (error) {
      failedImports[entry.id] = errorMessage(error);
    }
  }
  return { catalog, failedImports };
}

export const builtInCatalog = (): ImportedExtension[] => [
  { id: "agents.local", url: "内置公开服务", label: "本地 Agent 提供者" },
  { id: "ui.agents", url: "内置可替换界面", label: "默认 Agent 界面" },
  {
    id: "ui.workbench-board",
    url: "内置公开契约样板",
    label: "文本处理工作台",
  },
];
