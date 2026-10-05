import type { FsOperation } from "../package/types.js";
import type { EgressRequest, EgressResult } from "../types.js";

export type FsRequest =
  | { kind: "fs"; operation: "read" | "list"; path: string }
  | { kind: "fs"; operation: "write"; path: string; data: Uint8Array };
export interface ExecRequest {
  kind: "exec";
  args: string[];
  cwd: { root: string; path: string };
}
export type CapabilityRequest = FsRequest | ExecRequest | (EgressRequest & { kind: "egress" });
export interface RunCapabilityInput {
  extensionId: string;
  permissionId: string;
  request: CapabilityRequest;
}
export interface CapabilityCaller { packageId: string; permissionId: string }
export interface RunDelegatedCapabilityInput {
  packageId: string;
  permissionId: string;
  callers: CapabilityCaller[];
  request: CapabilityRequest;
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
  | { callId: string; kind: "egress"; result: EgressResult };

export type ExecutionState = "not_started" | "completed" | "unknown";
export interface AuditEvent {
  callId: string;
  timestamp: string;
  extensionId?: string;
  callerIds?: string[];
  permissionId?: string;
  kind?: CapabilityRequest["kind"];
  operation?: FsOperation | "run" | "send";
  /** Logical directory/program name or declared egress target; no physical path or URL. */
  target?: string;
  phase: "confirmation" | "allow" | "result" | "denied";
  outcome: "requested" | "allowed" | "denied" | "timeout" | "error" | "missing" | "invalid" | "completed" | "failed";
  executionState: ExecutionState;
  code?: string;
  reason?: string;
}
export type AuditHandler = (event: Readonly<AuditEvent>) => void | Promise<void>;
export const DEFAULT_CONFIRM_TIMEOUT_MS = 120_000;
