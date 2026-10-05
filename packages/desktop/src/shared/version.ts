import type { CatalogItem } from "./types.js";

/** Library manifests already contain validated SemVer strings. */
export function newerVersion(candidate: string, current: string): boolean {
  const parse = (value: string) => {
    const core = value.split("+")[0]!;
    const separator = core.indexOf("-");
    const version = separator < 0 ? core : core.slice(0, separator);
    return {
      numbers: version.split(".").map(Number),
      prerelease:
        separator < 0 ? undefined : core.slice(separator + 1).split("."),
    };
  };
  const a = parse(candidate),
    b = parse(current);
  for (let i = 0; i < 3; i++)
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i]! > b.numbers[i]!;
  if (!a.prerelease || !b.prerelease) return !a.prerelease && !!b.prerelease;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i],
      right = b.prerelease[i];
    if (left === right) continue;
    if (left === undefined) return false;
    if (right === undefined) return true;
    const numericLeft = /^\d+$/.test(left),
      numericRight = /^\d+$/.test(right);
    return numericLeft && numericRight
      ? BigInt(left) > BigInt(right)
      : numericLeft !== numericRight
        ? !numericLeft
        : left > right;
  }
  return false;
}

export function latestUpdate(
  items: CatalogItem[],
  id: string,
  version: string,
) {
  return items
    .filter(
      (p) => p.manifest.id === id && newerVersion(p.manifest.version, version),
    )
    .sort((a, b) =>
      newerVersion(a.manifest.version, b.manifest.version)
        ? -1
        : newerVersion(b.manifest.version, a.manifest.version)
          ? 1
          : 0,
    )[0];
}
