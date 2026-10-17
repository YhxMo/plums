/**
 * Selection after a workspace view fails to mount.
 *
 * A failed view must not become an empty layout preference. When a previously
 * working view exists, recover to it; otherwise keep the failed identifier so
 * the fallback diagnosis can explain what happened.
 */
export function selectionAfterFailure(
  selected: string,
  failedId: string,
  lastWorking: string | undefined,
): string {
  return selected === failedId ? (lastWorking ?? selected) : selected;
}
