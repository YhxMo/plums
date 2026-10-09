import type {
  AgentTierCeiling,
  LocalExecutionTier,
  LocalToolchain,
  LocalCredentialKind,
} from "../package/types.js";

/** Host-selected identity; physical paths stay private and never enter exports or audits. */
export interface LocalDirectory {
  root: string;
  path: string;
  dev: string;
  ino: string;
}
export interface LocalComponentApproval {
  packageId: string;
  installedAt: string;
  permissions: string;
}
export interface AgentTierRecord {
  instanceId: string;
  ceiling: AgentTierCeiling;
  projects: LocalDirectory[];
  readOnly: LocalDirectory[];
  /** Separate from the ceiling: only explicitly listed components can cover fs/exec confirmation. */
  components: LocalComponentApproval[];
}
export interface AgentLocalGrant {
  instanceId: string;
  packageId: string;
  engineId: string;
  installedAt: string;
  permission: string;
  tier: LocalExecutionTier;
  hosts: string[];
  toolchains: { name: LocalToolchain; root: string; executable: string }[];
  configuration: { tool: string; field: string; value: string }[];
  credentials: {
    id: string;
    kind: LocalCredentialKind;
    host: string;
    secretRef: string;
  }[];
  grantedAt: string;
  /** New confirmations carry a nonce so revoke/reconfirm cannot revive an in-flight request. */
  authorizationId?: string;
  source: "engine-trust" | "confirmation";
}
export interface LocalAuthorizationMigration {
  instanceId: string;
  callId: string;
  timestamp: string;
  migrated: number;
  skipped: number;
  audited: boolean;
}
export interface LocalAuthorizationState {
  tier: AgentTierRecord;
  grants: AgentLocalGrant[];
  revision: number;
  migration?: LocalAuthorizationMigration;
}
/** Trusted-host commit. The complete assembly snapshot prevents grants from racing installs. */
export interface LocalAuthorizationCommit {
  tier: AgentTierRecord;
  grants: AgentLocalGrant[];
  revision: number;
  assembly: LocalComponentApproval[];
}
export function sandboxTier(instanceId: string): AgentTierRecord {
  return {
    instanceId,
    ceiling: "sandbox",
    projects: [],
    readOnly: [],
    components: [],
  };
}
