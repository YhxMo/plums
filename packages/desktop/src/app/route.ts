export const tabs = [
  ["home", "Agent"],
  ["character", "角色卡"],
  ["extension", "扩展"],
  ["settings", "设置"],
] as const;
export type NavTab = (typeof tabs)[number][0];
export type Tab = NavTab | "status";
export interface Route {
  tab: Tab;
  agentId?: string;
}
export function componentTab(kind: string): NavTab {
  if (kind === "connector") return "extension";
  if (kind === "character" || kind === "extension") return kind;
  return "home";
}
