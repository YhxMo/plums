import type { AgentRecord, LibraryItem } from "@plums/host";
import type {
  Manifest,
  InstalledPackage,
  SettingsDescription,
  McpTool,
} from "@plums/core";
import type { DesktopContribution } from "@plums/sdk";

export type Resource = InstalledPackage & {
  manifest: Manifest;
  serviceTargets?: Record<string, string[]>;
  needsApproval?: boolean;
  settings: SettingsDescription;
  desktop?: DesktopContribution;
  mcpTools?: { tool: McpTool; state: string }[];
};
export type CatalogItem = LibraryItem & {
  usedBy: string[];
  missingDependencies: { id: string; range: string }[];
};
export interface AssemblyDraft {
  name: string;
  digests: string[];
  characterId?: string;
  startup?: string;
}
export interface AgentDetail {
  record: AgentRecord;
  packages: Resource[];
}

export type AgentRuntimeState = {
  instanceId: string;
  name: string;
  visible: boolean;
} | null;
