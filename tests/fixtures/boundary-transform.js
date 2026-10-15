/** @type {import("../../modules/sdk").ExtensionDefinition} */
export default {
  manifest: {
    id: "transform.boundary",
    apiVersion: 1,
    version: "1",
    provides: { "text.transform": 1 },
  },
  activate(ctx) {
    ctx.provide("text.transform", 1, {
      name: "boundary fixture",
      /** @param {string} input */
      async transform(input) {
        return "x".repeat(input === "oversized" ? 32001 : 32000);
      },
    });
  },
};
