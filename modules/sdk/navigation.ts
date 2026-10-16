export interface NavigationEntry {
  id: string;
  route: string;
  label: string;
  priority: number;
  viewId: string;
}
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Pure, deterministic choice among currently available view contributions. */
export function resolveNavigation(
  entries: readonly NavigationEntry[],
  preferredRoute?: string,
) {
  const ids = new Set<string>(),
    views = new Set<string>();
  const groups = new Map<string, NavigationEntry[]>();
  for (const entry of entries) {
    if (
      ![entry.id, entry.route, entry.label, entry.viewId].every(
        (v) => typeof v === "string" && v.trim(),
      ) ||
      !Number.isSafeInteger(entry.priority) ||
      ids.has(entry.id) ||
      views.has(entry.viewId)
    )
      throw Error("Invalid or duplicate navigation contribution");
    ids.add(entry.id);
    views.add(entry.viewId);
    const group = groups.get(entry.route) ?? [];
    group.push({ ...entry });
    groups.set(entry.route, group);
  }
  const winners: NavigationEntry[] = [];
  const conflicts: { route: string; winner: string; others: string[] }[] = [];
  for (const route of [...groups.keys()].sort(order)) {
    const group = groups.get(route)!;
    group.sort((a, b) => b.priority - a.priority || order(a.id, b.id));
    winners.push(group[0]);
    if (group.length > 1)
      conflicts.push({
        route,
        winner: group[0].id,
        others: group.slice(1).map((e) => e.id),
      });
  }
  return {
    winners,
    conflicts,
    selected: winners.find((e) => e.route === preferredRoute) ?? winners[0],
  };
}
