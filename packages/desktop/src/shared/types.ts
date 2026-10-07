import type { AgentRecord, LibraryItem } from "@plums/host";
import type {
  Manifest,
  InstalledPackage,
  SettingsDescription,
  McpTool,
} from "@plums/core";
import type { DesktopContribution, EngineStatus } from "@plums/sdk";

export type Resource = InstalledPackage & {
  manifest: Manifest;
  serviceTargets?: Record<string, string[]>;
  needsApproval?: boolean;
  settings: SettingsDescription;
  engines?: EngineStatus[];
  compatibility?: string;
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
  protocolBindings?: import("@plums/sdk").ProtocolBindingIntent[];
}
export interface AgentDetail {
  record: AgentRecord;
  packages: Resource[];
}

export type AgentRuntimeState = {
  instanceId: string;
  name: string;
  visible: boolean;
  diagnostics?: { viewId: string; reason: string }[];
} | null;
