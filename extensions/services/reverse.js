/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: {
    id: "transform.reverse",
    version: "1.0.0",
    apiVersion: 1,
    provides: { "text.transform": 1 },
  },
  activate(ctx) {
    /** @type {import('../contracts').Transformer} */
    const service = {
      name: "Reverse",
      async transform(input, signal) {
        signal.throwIfAborted();
        return [...input].reverse().join("");
      },
    };
    ctx.provide("text.transform", 1, service);
  },
};
