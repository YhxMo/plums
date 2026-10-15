/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: {
    id: "sample.counter",
    version: "1.0.0",
    apiVersion: 1,
    provides: { "sample.counter": 1 },
  },
  activate(ctx) {
    let count = 0;
    ctx.provide("sample.counter", 1, {
      read: () => count,
      increment: () => ++count,
    });
  },
};
