/** @deprecated Schema-6 archive shape and machine-only compatibility view. */
export interface EngineTrust {
  instanceId: string;
  packageId: string;
  engineId: string;
  installedAt: string;
  permission: string;
  grantedAt: string;
}
/** @deprecated Use the Agent's local authorization state for new management flows. */
export interface EngineTrustSnapshot {
  instanceId: string;
  packageId: string;
  engineId: string;
  installedAt: string;
  version: string;
  permission: string;
  revision: number;
  trusted: boolean;
}

/** Property order is not a permission change; unknown fields remain part of the declaration. */
export function enginePermissionKey(permission: unknown): string {
  return JSON.stringify(permission, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value))
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    return value;
  });
}
