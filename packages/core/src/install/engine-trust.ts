/** Schema-6 archive shape, retained for migration and internal machine-grant reads. */
export interface EngineTrust {
  instanceId: string;
  packageId: string;
  engineId: string;
  installedAt: string;
  permission: string;
  grantedAt: string;
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
