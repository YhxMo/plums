/** @type {import("../../modules/sdk").ExtensionDefinition} */
export default {
  manifest: {
    id: "chat.boundary",
    apiVersion: 1,
    version: "1",
    provides: { chat: 1 },
  },
  activate(ctx) {
    ctx.provide("chat", 1, {
      name: "边界模型",
      models: () => [{ id: "edge", label: "边界", description: "" }],
      subscribe: () => () => {},
      /** @param {{ input: string }} request */
      async reply({ input }) {
        return "x".repeat(input === "oversized" ? 1_000_001 : 1_000_000);
      },
    });
  },
};
