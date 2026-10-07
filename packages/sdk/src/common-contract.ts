import { Ajv, type ValidateFunction } from "ajv";
import { CAPABILITY_FAILED, PlumsError } from "@plums/core";
import {
  commonEnvelopeSchema,
  commonDeclarationSchema,
  commonPolicyDecisionSchema,
} from "./common-schema.js";
export {
  commonEnvelopeSchema,
  commonDeclarationSchema,
  commonPolicyDecisionSchema,
} from "./common-schema.js";

/** The transport version is independent of SDK, package and business protocol versions. */
export const COMMON_CONTRACT_VERSION = "1.0";
export type CommonVersion = `1.${number}`;
export type CommonJson =
  | null
  | boolean
  | number
  | string
  | CommonJson[]
  | { [key: string]: CommonJson };
export type CommonExecutionState = "not_started" | "unknown" | "completed";
export type CommonErrorCode =
  | "INVALID_REQUEST"
  | "INCOMPATIBLE"
  | "UNBOUND"
  | "STALE_BINDING"
  | "NOT_AUTHORIZED"
  | "POLICY_UNAVAILABLE"
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "RESOURCE_CONFLICT"
  | "RESOURCE_NOT_FOUND"
  | "REPLAY_GAP"
  | "LIMIT_EXCEEDED"
  | "PROVIDER_FAILED"
  | "RUNTIME_UNAVAILABLE";
export interface CommonFailure {
  code: CommonErrorCode;
  /** JSON Pointer only; never a rejected value or physical path. */
  path?: string;
}
interface CommonBase {
  commonVersion: CommonVersion;
  callId: string;
  [key: string]: unknown;
}
export type CommonEnvelope =
  | (CommonBase & {
      kind: "invoke";
      binding: string;
      operation: string;
      input: CommonJson;
      timeoutMs?: number;
    })
  | (CommonBase & {
      kind: "cancel";
      reason: "user" | "deadline" | "owner_closed";
    })
  | (CommonBase & { kind: "accepted"; sequence: number; taskId: string })
  | (CommonBase & {
      kind: "event";
      sequence: number;
      channel: string;
      data: CommonJson;
    })
  | (CommonBase & {
      kind: "result";
      sequence: number;
      executionState: "completed";
      outcome: { ok: true; value: CommonJson };
    })
  | (CommonBase & {
      kind: "result";
      sequence: number;
      executionState: CommonExecutionState;
      outcome: { ok: false; error: CommonFailure };
    });

/** Host issued. Neither a package declaration nor an incoming message can choose these fields. */
export interface CommonActor {
  agentId: string;
  componentId: string;
  installId: string;
  artifactDigest: string;
  instanceId: string;
  generation: number;
}
export interface CommonBinding {
  handle: string;
  revision: number;
  requirementId: string;
  protocol: string;
  protocolVersion: string;
  features: readonly string[];
  provider: CommonActor;
  evidence: "declared" | "internal-conformance" | "third-party-conformance";
}
export interface CommonDeclaration {
  commonVersion: CommonVersion;
  /** Host capabilities required in addition to business protocol requirements. */
  features: string[];
  runtime: "isolate" | "controlled-node";
  /** Opt-in only; Agent ownership also requires a trusted management choice. */
  background?: boolean;
  resources?: {
    id: string;
    permissionId: string;
    operations: ResourceOperation[];
    optional?: boolean;
  }[];
  /** A policy still needs a matching generic protocol provider declaration. */
  policy?: { provideId: string };
  [key: string]: unknown;
}
export type ResourceOperation = "read" | "write" | "delete";
export interface ResourceDescription {
  /** Local declared slot, available from the desktop resource bridge. */
  requirementId?: string;
  binding: string;
  resourceId: string;
  scope: "shared" | "agent";
  ownerAgentId?: string;
  operations: readonly ResourceOperation[];
  generation: number;
}
export type ResourceSnapshot =
  | { exists: false; revision: string }
  | { exists: true; revision: string; value: CommonJson };
export interface CommonResourcesSdk {
  list(): Promise<readonly ResourceDescription[]>;
  read(binding: string, key: string): Promise<ResourceSnapshot>;
  /** Both mutations require CAS, including creation and tombstone replacement. */
  write(
    binding: string,
    key: string,
    expectedRevision: string,
    value: CommonJson,
  ): Promise<{ revision: string }>;
  delete(
    binding: string,
    key: string,
    expectedRevision: string,
  ): Promise<{ revision: string }>;
}
export interface CommonCall {
  callId: string;
  taskId: string;
  events: AsyncIterable<Extract<CommonEnvelope, { kind: "event" }>>;
  result: Promise<Extract<CommonEnvelope, { kind: "result" }>>;
  cancel(): Promise<void>;
}
export interface CommonCallOptions {
  timeoutMs?: number;
  /** A caller-owned, unused task handle; every task has at most one root call. */
  taskId?: string;
}
export interface CommonTaskDescription {
  taskId: string;
  lifetime: "frontend" | "agent";
  owner: CommonActor;
}
export interface CommonTaskSnapshot {
  status: CommonTaskStatus;
  /** In-memory terminal reply, if still retained. Never replay execution. */
  result?: Extract<CommonEnvelope, { kind: "result" }>;
}
export interface CommonTasksSdk {
  /** Does not grant I/O or choose another Agent/component as owner. */
  create(options: {
    lifetime: "frontend" | "agent";
    timeoutMs?: number;
  }): Promise<CommonTaskDescription>;
  status(taskId: string): Promise<CommonTaskSnapshot>;
  /** Current component's tasks plus explicitly approved compatible takeovers. */
  list(): Promise<readonly CommonTaskDescription[]>;
  /** Ordered state changes; unsubscribe also suppresses a pending response. */
  subscribe(
    taskId: string,
    callback: (snapshot: CommonTaskSnapshot) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}
/** Interface specification. Stage 3 injects an instance; stage 1 does not fabricate a bridge. */
export interface CommonPlatformSdk {
  discover(requirementId: string): Promise<readonly CommonBinding[]>;
  binding(requirementId: string): Promise<CommonBinding | null>;
  invoke(
    binding: string,
    operation: string,
    input: CommonJson,
    options?: CommonCallOptions,
  ): Promise<CommonCall>;
  /** Reattaches to an existing task, never re-executes its invocation. */
  attach(taskId: string, afterSequence?: number): Promise<CommonCall>;
  resources: CommonResourcesSdk;
  /** Read-only trusted state; changing strategy or ranges is management-only. */
  policy: { status(): Promise<CommonPolicyStatus> };
  tasks: CommonTasksSdk;
}
export interface CommonPolicyStatus {
  selected: { mode: string; providerId: string } | null;
  active: {
    modeGeneration: number;
    expiresAt: number;
    selection: readonly {
      componentId: string;
      category: CommonOperationContext["category"];
      operation: string;
      target: string;
    }[];
  } | null;
}
export interface CommonOperationContext {
  /** Host deadline for this call, bounded by task and lease; epoch milliseconds. */
  deadline?: number;
  assessmentId: string;
  operationFingerprint: string;
  callId: string;
  taskId: string;
  actors: readonly CommonActor[];
  category: "resource" | "fs" | "https" | "exec" | "tool";
  operation: string;
  /** Trusted logical root, resource, program or contribution target. */
  target?: string;
  /** Present for actual manifest capabilities and resources. */
  permissionId?: string;
  /** Logical identifiers and credential-free intent, supplied by the trusted host. */
  intent: CommonJson;
  maximum: {
    operations: readonly string[];
    resourceIds: readonly string[];
    expiresAt: number;
    /** Exact logical maxima chosen in trusted management; no physical paths. */
    selection?: readonly {
      componentId: string;
      category: CommonOperationContext["category"];
      operation: string;
      target: string;
    }[];
  };
  modeGeneration: number;
}
export type CommonPolicyDecision = {
  assessmentId: string;
  operationFingerprint: string;
  decision: "allow" | "deny" | "confirm";
};
export interface CommonPolicyProvider {
  evaluate(context: CommonOperationContext): Promise<CommonPolicyDecision>;
}
export interface CommonTaskStatus {
  taskId: string;
  /** Absent before the single root invocation is accepted. */
  callId?: string;
  state:
    | "starting"
    | "running"
    | "cancelling"
    | "stopped"
    | "crashed"
    | "completed";
  executionState: CommonExecutionState;
  lastSequence: number;
}

// Branches refer to fields defined at the root (valid Draft-07); strictRequired
// cannot follow them through `not`. Keep all validation and other strict checks.
const ajv = new Ajv({
  strict: true,
  strictRequired: false,
  allErrors: false,
  validateFormats: false,
});
const envelopeSchema = structuredClone(commonEnvelopeSchema);
const declarationSchema = structuredClone(commonDeclarationSchema);
const policyDecisionSchema = structuredClone(commonPolicyDecisionSchema);
let envelope: ValidateFunction | undefined;
let declaration: ValidateFunction | undefined;
let policyDecision: ValidateFunction | undefined;
const maxBytes = 1024 * 1024;
function invalid(path: string): never {
  throw new PlumsError({
    code: CAPABILITY_FAILED,
    message: "共同契约数据无效。",
    ...(path ? { path } : {}),
    details: {
      reason: "COMMON_CONTRACT_INVALID",
      phase: "validation",
      executionState: "not_started",
    },
  });
}
/** Reject non-JSON values before serialization can silently drop or alter them. */
function jsonCopy(value: unknown): unknown {
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (depth > 32) invalid("");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") {
      if (v.length > maxBytes) invalid("");
      return;
    }
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (typeof v !== "object" || !v || seen.has(v)) invalid("");
    seen.add(v);
    if (Array.isArray(v)) {
      const descriptors = Object.getOwnPropertyDescriptors(v);
      if (
        Object.getOwnPropertySymbols(v).length ||
        Object.keys(descriptors).length !== v.length + 1
      )
        invalid("");
      for (let i = 0; i < v.length; i++) {
        const d = descriptors[String(i)];
        if (!d || !("value" in d) || !d.enumerable) invalid("");
        visit(d.value, depth + 1);
      }
    } else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) invalid("");
      for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) {
        if (!("value" in d) || !d.enumerable) invalid("");
        visit(d.value, depth + 1);
      }
      if (Object.getOwnPropertySymbols(v).length) invalid("");
    }
    seen.delete(v);
  };
  try {
    visit(value, 0);
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > maxBytes) invalid("");
    return JSON.parse(encoded);
  } catch {
    // Proxies and serialization hooks are not wire JSON; never expose their errors.
    invalid("");
  }
}
/** Copies the message, validates recognized fields, preserves same-major unknown fields. */
export function parseCommonEnvelope(value: unknown): CommonEnvelope {
  const copy = jsonCopy(value);
  envelope ??= ajv.getSchema(envelopeSchema.$id) ?? ajv.compile(envelopeSchema);
  if (!envelope(copy)) invalid(envelope.errors?.[0]?.instancePath ?? "");
  if (
    (copy as CommonEnvelope).kind === "event" &&
    Buffer.byteLength(JSON.stringify(copy)) > 256 * 1024
  )
    invalid("/data");
  return copy as CommonEnvelope;
}
export function parseCommonDeclaration(value: unknown): CommonDeclaration {
  const copy = jsonCopy(value);
  declaration ??=
    ajv.getSchema(declarationSchema.$id) ?? ajv.compile(declarationSchema);
  if (!declaration(copy)) invalid(declaration.errors?.[0]?.instancePath ?? "");
  const d = copy as CommonDeclaration;
  const ids = new Set<string>();
  for (const [i, r] of (d.resources ?? []).entries()) {
    if (ids.has(r.id)) invalid(`/resources/${i}/id`);
    ids.add(r.id);
  }
  return d;
}
/** Matching the returned fingerprint and live scope is the host's separate responsibility. */
export function parseCommonPolicyDecision(
  value: unknown,
): CommonPolicyDecision {
  const copy = jsonCopy(value);
  policyDecision ??=
    ajv.getSchema(policyDecisionSchema.$id) ??
    ajv.compile(policyDecisionSchema);
  if (!policyDecision(copy))
    invalid(policyDecision.errors?.[0]?.instancePath ?? "");
  return copy as CommonPolicyDecision;
}
/** Wire ordering check; replay attachment creates a tracker at the last acknowledged sequence. */
export class CommonReplyTracker {
  private last: number;
  private terminal = false;
  constructor(
    private readonly callId: string,
    afterSequence = -1,
  ) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < -1)
      invalid("/sequence");
    this.last = afterSequence;
  }
  receive(
    value: unknown,
  ): Extract<CommonEnvelope, { kind: "accepted" | "event" | "result" }> {
    const message = parseCommonEnvelope(value);
    if (message.callId !== this.callId) invalid("/callId");
    if (
      message.kind !== "accepted" &&
      message.kind !== "event" &&
      message.kind !== "result"
    )
      invalid("/kind");
    if (
      this.terminal ||
      message.sequence !== this.last + 1 ||
      (message.kind === "accepted" && message.sequence !== 0) ||
      (this.last === -1 && message.kind === "event")
    )
      invalid("/sequence");
    this.last = message.sequence;
    this.terminal = message.kind === "result";
    return message;
  }
}
/** Capability negotiation only. This does not authorize, bind or execute. */
export function negotiateCommonContract(
  request: CommonDeclaration,
  availableFeatures: readonly string[],
):
  | { compatible: true; features: string[] }
  | { compatible: false; missingFeatures: string[] } {
  const copied = parseCommonDeclaration(request);
  const available = new Set(availableFeatures);
  const missingFeatures = copied.features.filter((f) => !available.has(f));
  return missingFeatures.length
    ? { compatible: false, missingFeatures }
    : { compatible: true, features: copied.features };
}
