import type { EgressRequest, EgressResult } from "../types.js";

export type FsRequest =
  | { kind: "fs"; operation: "read" | "list"; path: string }
  | { kind: "fs"; operation: "write"; path: string; data: Uint8Array };
export interface ExecRequest {
  kind: "exec";
  args: string[];
  cwd: { root: string; path: string };
}
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export interface ServiceRequest {
  kind: "service";
  operation: string;
  binding: string;
  sources: string[];
  input: JsonValue;
}
export type ServiceEffect =
  | "read"
  | "instance-write"
  | "egress"
  | "model-egress"
  | "external-write";
export interface ServiceBinding {
  fingerprint: string;
  sources: string[];
  host?: string;
}
export interface ServiceInvocation {
  instanceId: string;
  packageId: string;
  binding: string;
  operation: string;
  sources: readonly string[];
  input: JsonValue;
  signal?: AbortSignal;
  assertActive(): Promise<void>;
}
/** Registered only by the trusted host. No extension-supplied code or risk classification. */
export interface HostService {
  ownerId?: string;
  operations: Readonly<Record<string, ServiceEffect>>;
  getBinding(
    instanceId: string,
    binding: string,
  ): ServiceBinding | undefined | Promise<ServiceBinding | undefined>;
  invoke(request: ServiceInvocation): Promise<JsonValue>;
}
export interface BackgroundConsentInput {
  extensionId: string;
  permissionId: string;
  operation: string;
  binding: string;
  sources: string[];
}
export interface BackgroundConsent extends BackgroundConsentInput {
  instanceId: string;
  fingerprint: string;
  revision: string;
  grantedAt: string;
}
export type CapabilityRequest =
  | FsRequest
  | ExecRequest
  | ServiceRequest
  | (EgressRequest & { kind: "egress" });
export interface RunCapabilityInput {
  extensionId: string;
  permissionId: string;
  request: CapabilityRequest;
  grantId?: string;
  grantScope?: import("./grants.js").GrantUse;
  signal?: AbortSignal;
}
export interface CapabilityCaller {
  packageId: string;
  permissionId: string;
}
export interface RunDelegatedCapabilityInput {
  packageId: string;
  permissionId: string;
  callers: CapabilityCaller[];
  request: CapabilityRequest;
  grantId?: string;
  grantScope?: import("./grants.js").GrantUse;
  signal?: AbortSignal;
  /** Required for a call of an approved remote MCP tool. */
  mcpTool?: { name: string; description: string; inputSchema?: unknown };
}

/** Canonical absolute paths, checked against the logical root by the core. */
export interface FsLocation {
  rootPath: string;
  path: string;
}
export interface FsEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
}
/**
 * A real implementation must enforce rootPath at execution, including symlink races.
 * The core's metadata checks alone cannot prevent a filesystem change before I/O.
 */
export interface FsSink {
  read(req: FsLocation): Promise<Uint8Array>;
  write(req: FsLocation & { data: Uint8Array }): Promise<void>;
  list(req: FsLocation): Promise<FsEntry[]>;
}
export interface ExecInvocation {
  /** Fixed host binding, never supplied by the capability caller. */
  program: string;
  args: string[];
  cwd: string;
  rootPath: string;
}
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
/** The host passes args separately, without a shell, and supplies process isolation. */
export interface ExecSink {
  run(req: ExecInvocation): Promise<ExecResult>;
}

export type CapabilityResult =
  | { callId: string; kind: "fs"; operation: "read"; data: Uint8Array }
  | { callId: string; kind: "fs"; operation: "write"; completed: true }
  | { callId: string; kind: "fs"; operation: "list"; entries: FsEntry[] }
  | { callId: string; kind: "exec"; result: ExecResult }
  | { callId: string; kind: "egress"; result: EgressResult }
  | { callId: string; kind: "service"; operation: string; result: JsonValue };

export type ExecutionState = "not_started" | "completed" | "unknown";
export interface AuditEvent {
  callId: string;
  agentId?: string;
  migration?: { migrated: number; skipped: number };
  tier?: import("../package/types.js").AgentTierCeiling;
  localScope?: {
    roots: string[];
    readOnlyRoots: string[];
    componentIds: string[];
    hostCount: number;
  };
  taskId?: string;
  grantId?: string;
  taskScope?: import("./task-scope.js").TaskScopeSelection[];
  durationMs?: number;
  resourceMode?: "task" | "full-access";
  resourceScope?: {
    componentId: string;
    resourceId: string;
    operations: import("../package/types.js").ResourceOperation[];
  }[];
  assessmentId?: string;
  modeGeneration?: number;
  timestamp: string;
  extensionId?: string;
  callerIds?: string[];
  providerId?: string;
  requirementId?: string;
  permissionId?: string;
  kind?: CapabilityRequest["kind"] | "engine" | "resource";
  operation?: string;
  /** Logical directory/program name or declared egress target; no physical path or URL. */
  target?: string;
  phase:
    | "policy"
    | "grant"
    | "revoke"
    | "task"
    | "confirmation"
    | "allow"
    | "result"
    | "denied";
  outcome:
    | "requested"
    | "allowed"
    | "denied"
    | "timeout"
    | "error"
    | "missing"
    | "invalid"
    | "completed"
    | "failed";
  executionState: ExecutionState;
  code?: string;
  reason?: string;
}
export type AuditHandler = (
  event: Readonly<AuditEvent>,
) => void | Promise<void>;
export const DEFAULT_CONFIRM_TIMEOUT_MS = 120_000;

/** Trusted host gate, after core authorization. An accepted gate replaces the single-use question. */
export type CapabilityGate = (input: {
  callId: string;
  packageId: string;
  permissionId: string;
  target: string;
  callers: readonly CapabilityCaller[];
  request: CapabilityRequest;
}) => Promise<{ assertCurrent(): void | Promise<void> } | undefined>;
