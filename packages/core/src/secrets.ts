import type { Manifest } from "./package/types.js";

/**
 * The only reference a package may hold for a field: `secret:<packageId>/<settingKey>`.
 * Package ids contain no `/`, so a package can never name another package's secret.
 */
export function secretRef(packageId: string, key: string): string {
  return `secret:${packageId}/${key}`;
}

/** Setting keys marked `"x-secret": true` in the manifest's settingsSchema. */
export function secretKeys(manifest: Manifest): string[] {
  return Object.entries(manifest.settingsSchema?.properties ?? {})
    .filter(([, spec]) => spec["x-secret"] === true)
    .map(([key]) => key);
}
