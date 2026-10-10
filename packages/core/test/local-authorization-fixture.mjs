import { randomUUID } from "node:crypto";
import { enginePermissionKey } from "../dist/index.js";

// Trusted test setup uses the same atomic assembly commit as current management.
export async function localEntryPlan(core, packageId, engineId) {
  const state = await core.localAuthorizationState();
  const packages = await Promise.all(
    (await core.listInstalled()).map((p) => core.getPackage(p.id)),
  );
  const assembly = packages.map(({ installed, manifest }) => ({
    packageId: installed.id,
    installedAt: installed.installedAt,
    permissions: enginePermissionKey(manifest.permissions),
  }));
  const component = packages.find(
    ({ installed }) => installed.id === packageId,
  );
  const declaration = component.manifest.permissions.find(
    (p) => p.kind === "engine" && p.target === engineId,
  );
  const installedAt = component.installed.installedAt;
  const prior = state.grants.find(
    (g) => g.packageId === packageId && g.engineId === engineId,
  );
  return {
    revision: state.revision,
    assembly,
    tier: { ...state.tier, ceiling: "machine" },
    grants: [
      ...state.grants.filter(
        (g) => g.packageId !== packageId || g.engineId !== engineId,
      ),
      {
        instanceId: state.tier.instanceId,
        packageId,
        engineId,
        installedAt,
        permission: enginePermissionKey(declaration),
        tier: declaration?.tier ?? "machine",
        hosts: [],
        toolchains: [],
        configuration: [],
        credentials: [],
        grantedAt: new Date().toISOString(),
        authorizationId: randomUUID(),
        source: "confirmation",
      },
    ],
    installedAt,
    trusted:
      !!prior && state.tier.ceiling === "machine" && prior.tier === "machine",
  };
}
export async function revokeLocalEntry(core, packageId, engineId) {
  const plan = await localEntryPlan(core, packageId, engineId ?? "");
  const state = await core.localAuthorizationState();
  plan.tier = state.tier;
  plan.grants = state.grants.filter(
    (g) =>
      g.packageId !== packageId ||
      (engineId !== undefined && g.engineId !== engineId),
  );
  if (!(await core.commitLocalAuthorization(plan)))
    throw Error("Synthetic revocation commit failed");
}
