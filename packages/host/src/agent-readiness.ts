import type { ProtocolRequirementState } from "./protocol-bindings.js";
import type { TierPlan } from "./local-authorization.js";
import type { enablePlan } from "./agent-launch.js";

export interface ReadinessReason {
  code:
    | "SETTINGS_REQUIRED"
    | "PROTOCOL_REQUIRED"
    | "ENABLE_REQUIRED"
    | "LOCAL_AUTHORIZATION_REQUIRED"
    | "LOCAL_TIER_REQUIRED"
    | "PROJECT_UNAVAILABLE"
    | "FOUNDATION_UNAVAILABLE"
    | "STATE_UNAVAILABLE"
    | "RESOURCE_PAGE";
  blocking: boolean;
  action:
    | "settings"
    | "connections"
    | "enable"
    | "permissions"
    | "foundation"
    | "resources"
    | "refresh";
  packageId?: string;
  field?: string;
  requirementId?: string;
  engineId?: string;
  protocolState?: ProtocolRequirementState["state"];
}

/** Preparation evidence only; execution always rechecks its own authorization. */
export function readinessReasons(
  enable: Awaited<ReturnType<typeof enablePlan>>,
  tier: TierPlan,
  foundationAvailable: boolean,
  hasFrontend: boolean,
): ReadinessReason[] {
  const reasons: ReadinessReason[] = [];
  if (!foundationAvailable)
    reasons.push({
      code: "FOUNDATION_UNAVAILABLE",
      blocking: true,
      action: "foundation",
    });
  for (const missing of enable.missing)
    for (const field of missing.fields)
      reasons.push({
        code: "SETTINGS_REQUIRED",
        blocking: true,
        action: "settings",
        packageId: missing.packageId,
        field,
      });
  for (const slot of enable.missingProtocols)
    reasons.push({
      code: "PROTOCOL_REQUIRED",
      blocking: true,
      action: "connections",
      packageId: slot.consumerId,
      requirementId: slot.requirement.id,
      protocolState: slot.state,
    });
  for (const entry of enable.entries)
    if (entry.needsApproval)
      reasons.push({
        code: "ENABLE_REQUIRED",
        blocking: true,
        action: "enable",
        packageId: entry.packageId,
      });
  for (const entry of tier.entries)
    for (const engine of entry.engines) {
      if (engine.tier === "project")
        reasons.push({
          code: "PROJECT_UNAVAILABLE",
          blocking: true,
          action: "permissions",
          packageId: entry.packageId,
          engineId: engine.engineId,
        });
      if (engine.state !== "confirmed")
        reasons.push({
          code:
            engine.state === "tier-required"
              ? "LOCAL_TIER_REQUIRED"
              : "LOCAL_AUTHORIZATION_REQUIRED",
          blocking: true,
          action: "permissions",
          packageId: entry.packageId,
          engineId: engine.engineId,
        });
    }
  if (!hasFrontend)
    reasons.push({
      code: "RESOURCE_PAGE",
      blocking: false,
      action: "resources",
    });
  return reasons;
}
