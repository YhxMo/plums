import {
  redact,
  type AuditEvent,
  type ConfirmRequest,
  type LocalAuthorizationState,
} from "@plums/core";
import type { FoundationSelection } from "@plums/sdk";
import type { AgentFoundationBinding } from "./foundation-state.js";
import type { TierPlan } from "./local-authorization.js";

type Projection =
  | boolean
  | { fields: Readonly<Record<string, Projection>> }
  | { elements: Projection };

// Only validated identity fields and host-produced control metadata are copied.
// Text from declarations and unknown fields still uses the full secret set.
const selection: Projection = {
  fields: {
    selectionVersion: true,
    source: true,
    id: true,
    version: true,
    digest: true,
  },
};
const binding: Projection = {
  fields: {
    bindingVersion: true,
    selection,
    installationId: true,
    enabled: true,
    dataFormat: true,
  },
};
const reports: Projection = {
  elements: {
    fields: {
      componentId: true,
      compatible: true,
      diagnostics: {
        elements: { fields: { reason: true, missing: false } },
      },
      missingOptionalFeatures: false,
      evidence: true,
      foundationVersion: true,
    },
  },
};
const plan: Projection = {
  fields: {
    current: binding,
    candidate: selection,
    compatible: true,
    reports,
    failure: {
      fields: { reason: true, executionState: true, reports },
    },
    fingerprint: true,
    evidence: true,
  },
};

const localDirectory: Projection = {
  fields: { root: true, path: false, dev: true, ino: true },
};
const localState: Projection = {
  fields: {
    tier: {
      fields: {
        instanceId: true,
        ceiling: true,
        projects: { elements: localDirectory },
        readOnly: { elements: localDirectory },
        components: {
          elements: {
            fields: { packageId: true, installedAt: true, permissions: false },
          },
        },
      },
    },
    grants: {
      elements: {
        fields: {
          instanceId: true,
          packageId: true,
          engineId: true,
          installedAt: true,
          permission: false,
          tier: true,
          hosts: false,
          toolchains: {
            elements: {
              fields: { name: true, root: false, executable: false },
            },
          },
          configuration: {
            elements: { fields: { tool: false, field: false, value: false } },
          },
          credentials: {
            elements: {
              fields: {
                id: true,
                kind: true,
                host: false,
                secretRef: false,
                valueRef: false,
                usernameRef: false,
                encodedValueRef: false,
                encodedUsernameRef: false,
              },
            },
          },
          grantedAt: true,
          authorizationId: true,
          source: true,
        },
      },
    },
    revision: true,
    migration: {
      fields: {
        instanceId: true,
        callId: true,
        timestamp: true,
        migrated: true,
        skipped: true,
        audited: true,
      },
    },
  },
};

/** Only current validated authority records, never arbitrary caller-supplied objects. */
export function presentLocalAuthorizationState(
  value: LocalAuthorizationState,
  secrets: readonly string[],
): LocalAuthorizationState {
  return project(value, secrets, localState) as LocalAuthorizationState;
}

/** The local authorization service owns the schema and generated lifecycle values. */
export function presentLocalAuthorizationEvent(
  value: AuditEvent,
  secrets: readonly string[],
): AuditEvent {
  return project(value, secrets, {
    fields: {
      callId: true,
      timestamp: true,
      agentId: true,
      kind: true,
      phase: true,
      outcome: true,
      executionState: true,
      reason: true,
      tier: true,
      localCredential: {
        fields: { packageId: false, engineId: false, id: false, host: false },
      },
      localScope: {
        fields: {
          roots: false,
          readOnlyRoots: false,
          componentIds: false,
          hostCount: true,
        },
      },
    },
  }) as AuditEvent;
}

/** Field names are host-generated; every confirmation string still redacts. */
export function presentLocalAuthorizationConfirmation(
  value: ConfirmRequest,
  secrets: readonly string[],
): ConfirmRequest {
  return project(value, secrets, {
    fields: {
      subject: false,
      action: false,
      message: false,
      presentation: true,
    },
  }) as ConfirmRequest;
}

function project(
  value: unknown,
  secrets: readonly string[],
  projection: Projection,
): unknown {
  if (projection === true) return structuredClone(value);
  if (projection === false) return redact(value, secrets);
  if ("elements" in projection)
    return Array.isArray(value)
      ? value.map((item) => project(item, secrets, projection.elements))
      : redact(value, secrets);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return redact(value, secrets);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const fixed = Object.hasOwn(projection.fields, key);
    Object.defineProperty(result, fixed ? key : redact(key, secrets), {
      value: project(child, secrets, fixed ? projection.fields[key]! : false),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

/** Trusted management projections; never use these on business or SDK replies. */
export function presentFoundationBinding(
  value: AgentFoundationBinding,
  secrets: readonly string[],
): AgentFoundationBinding {
  return project(value, secrets, binding) as AgentFoundationBinding;
}

export function presentFoundationPlan<
  T extends { current: AgentFoundationBinding; candidate: FoundationSelection },
>(value: T, secrets: readonly string[]): T {
  return project(value, secrets, plan) as T;
}

/** Installed identity is validated by Core; declaration text and payload stay redacted. */
const resourcePackage: Projection = {
  fields: {
    id: true,
    kind: true,
    version: true,
    installedAt: true,
    enabledAt: true,
    enabled: true,
    consented: true,
    name: false,
    manifest: {
      fields: {
        id: true,
        kind: true,
        version: true,
        formatVersion: true,
        name: false,
        description: false,
        dependencies: false,
        permissions: false,
        settingsSchema: false,
        payload: false,
      },
    },
    settings: false,
    desktop: false,
    mcpTools: false,
    engines: false,
    compatibility: false,
  },
};

/** Only fixed management paths have projections; arbitrary nested keys never inherit them. */
export function presentResources<
  T extends { record: object; packages: unknown[] },
>(value: T, secrets: readonly string[]): T {
  return project(value, secrets, {
    fields: {
      record: { fields: { foundation: binding } },
      packages: { elements: resourcePackage },
    },
  }) as T;
}

/** A confirmation fingerprint and validated selection are control data, not business text. */
export function presentTierPlan(
  value: TierPlan,
  secrets: readonly string[],
): TierPlan {
  const hosts: Projection = {
    fields: Object.fromEntries(
      value.entries.map((entry) => [
        entry.packageId,
        {
          fields: Object.fromEntries(
            entry.engines.map((engine) => [engine.engineId, true]),
          ),
        },
      ]),
    ),
  };
  return project(value, secrets, {
    fields: {
      fingerprint: true,
      selection: {
        fields: {
          ceiling: true,
          projects: true,
          readOnly: true,
          components: true,
          hosts,
        },
      },
      current: localState,
      entries: {
        elements: {
          fields: {
            packageId: true,
            name: false,
            formatVersion: true,
            confirmed: true,
            permissions: false,
            engines: {
              elements: {
                fields: {
                  engineId: true,
                  tier: true,
                  hosts: false,
                  state: true,
                  toolchains: {
                    elements: {
                      fields: {
                        name: true,
                        root: false,
                        executable: false,
                        found: true,
                        reason: true,
                      },
                    },
                  },
                  credentials: {
                    elements: {
                      fields: {
                        id: true,
                        kind: true,
                        host: false,
                        reason: false,
                        approved: true,
                      },
                    },
                  },
                  configuration: {
                    elements: {
                      fields: { tool: true, field: false, value: false },
                    },
                  },
                },
              },
            },
          },
        },
      },
      projects: { elements: localDirectory },
      readOnly: { elements: localDirectory },
      assembly: false,
      roots: false,
    },
  }) as TierPlan;
}
