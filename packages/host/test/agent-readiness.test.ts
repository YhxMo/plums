import { expect, it } from "vitest";
import { readinessReasons } from "../src/agent-readiness.js";
import type { enablePlan } from "../src/agent-launch.js";
import type { TierPlan } from "../src/local-authorization.js";

it("keeps optional protocol slots out of blockers and exposes the actual required slot state", () => {
  const plan = {
    missing: [],
    entries: [],
    missingProtocols: [
      {
        consumerId: "consumer",
        requirement: { id: "model" },
        state: "choose",
      },
    ],
  } as unknown as Awaited<ReturnType<typeof enablePlan>>;
  const tier = { entries: [] } as unknown as TierPlan;
  expect(readinessReasons(plan, tier, true, true)).toEqual([
    {
      code: "PROTOCOL_REQUIRED",
      blocking: true,
      action: "connections",
      packageId: "consumer",
      requirementId: "model",
      protocolState: "choose",
    },
  ]);
});
it.each(["pending", "tier-required", "confirmed"] as const)(
  "project declaration stays unavailable even when its authorization state is %s",
  (state) => {
    const plan = {
      missing: [],
      missingProtocols: [],
      entries: [],
    } as unknown as Awaited<ReturnType<typeof enablePlan>>;
    const tier = {
      entries: [
        {
          packageId: "project-engine",
          engines: [{ engineId: "local", tier: "project", state }],
        },
      ],
    } as unknown as TierPlan;
    const reasons = readinessReasons(plan, tier, true, true);
    expect(reasons).toContainEqual({
      code: "PROJECT_UNAVAILABLE",
      blocking: true,
      action: "permissions",
      packageId: "project-engine",
      engineId: "local",
    });
    expect(reasons.some((r) => r.code === "LOCAL_TIER_REQUIRED")).toBe(
      state === "tier-required",
    );
    expect(reasons.some((r) => r.code === "LOCAL_AUTHORIZATION_REQUIRED")).toBe(
      state === "pending",
    );
  },
);
