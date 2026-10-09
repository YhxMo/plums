import { redact, type AuditEvent } from "@plums/core";

type Projection =
  | boolean
  | { fields: Readonly<Record<string, Projection>> }
  | { elements: Projection };
const generated = {
  callId: true,
  timestamp: true,
  kind: true,
  phase: true,
  outcome: true,
  executionState: true,
} as const;
function project(
  value: unknown,
  secrets: readonly string[],
  shape: Projection,
): unknown {
  if (shape === true) return structuredClone(value);
  if (shape === false) return redact(value, secrets);
  if ("elements" in shape)
    return Array.isArray(value)
      ? value.map((v) => project(v, secrets, shape.elements))
      : redact(value, secrets);
  if (!value || typeof value !== "object" || Array.isArray(value))
    return redact(value, secrets);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const fixed = Object.hasOwn(shape.fields, key);
    Object.defineProperty(out, fixed ? key : redact(key, secrets), {
      value: project(child, secrets, fixed ? shape.fields[key]! : false),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
function event(
  value: AuditEvent,
  secrets: readonly string[],
  fields: Record<string, Projection>,
): AuditEvent {
  const safe = project(value, secrets, { fields }) as AuditEvent;
  freeze(safe);
  return safe;
}
// These projections are only called at the corresponding internal constructors.
// They are never selected by an error code, event name, or extension-supplied key.
export function resourceAuditEvent(
  value: AuditEvent,
  secrets: readonly string[],
): AuditEvent {
  return event(value, secrets, {
    ...generated,
    taskId: true,
    durationMs: true,
    resourceMode: true,
    extensionId: false,
    callerIds: false,
    operation: true,
    reason: true,
    resourceScope: {
      elements: {
        fields: {
          componentId: false,
          resourceId: false,
          operations: { elements: true },
        },
      },
    },
  });
}
export function policyAuditEvent(
  value: AuditEvent,
  secrets: readonly string[],
): AuditEvent {
  return event(value, secrets, {
    ...generated,
    taskId: true,
    assessmentId: true,
    artifactDigest: true,
    mode: true,
    operationFingerprint: true,
    providerId: false,
    modeGeneration: true,
    durationMs: true,
    reason: true,
    tier: true,
    extensionId: false,
    callerIds: false,
    target: false,
    operation: false,
  });
}
export function engineAuditEvent(
  value: AuditEvent,
  secrets: readonly string[],
): AuditEvent {
  return event(value, secrets, {
    ...generated,
    tier: true,
    reason: true,
    agentId: true,
    extensionId: false,
    callerIds: false,
    target: false,
    operation: false,
  });
}
// host.grant(action:audit) reports an entry's own observation. Its correlation,
// phase and execution state are supplied by that entry, not minted by the host.
export function reportedEngineAuditEvent(
  value: AuditEvent,
  secrets: readonly string[],
): AuditEvent {
  return event(value, secrets, {
    ...generated,
    callId: false,
    grantId: false,
    phase: false,
    executionState: false,
    extensionId: false,
    callerIds: false,
    target: false,
    operation: false,
  });
}
export function protocolBindingAuditEvent(
  value: AuditEvent,
  secrets: readonly string[],
): AuditEvent {
  return event(value, secrets, {
    ...generated,
    operation: true,
    extensionId: false,
    providerId: false,
    requirementId: false,
  });
}
export function responseAuditEvent(
  value: AuditEvent,
  secrets: readonly string[],
): AuditEvent {
  return event(value, secrets, {
    ...generated,
    extensionId: false,
    operation: true,
    reason: false,
  });
}
export function managementAuditEvent(
  value: AuditEvent,
  secrets: readonly string[],
): AuditEvent {
  return event(value, secrets, { ...generated, taskId: true, reason: true });
}
