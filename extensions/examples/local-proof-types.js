/**
 * Type-only SDK references are erased; deployed ESM needs no runtime SDK URL.
 * @typedef {import("../../modules/sdk").ViewNode} ViewNode
 * @typedef {import("../../modules/sdk").ViewTreeScope} ViewScope
 * @typedef {import("../../modules/sdk").PageContribution} PageContribution
 * @typedef {import("../../modules/sdk").ExtensionDefinition} ExtensionDefinition
 * @typedef {Pick<import("../../modules/sdk").PageRouter, "register">} PageService
 * @typedef {Pick<import("../../modules/sdk").ExtensionContext, "id" | "signal" | "onDispose" | "use" | "provide">} AuthorContext
 * @typedef {Parameters<AuthorContext["onDispose"]>[0]} Dispose
 * @typedef {{createNode: (mode: "editor" | "checklist") => ViewNode, diagnostics: () => {mounts: number, disposals: number, activeNodes: number, subscriptions: number}}} TextNodeService
 */
export {};
