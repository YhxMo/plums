/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: {
    id: "sample.events",
    version: "1.0.0",
    apiVersion: 1,
    requires: { "sample.counter": 1 },
  },
  activate(ctx) {
    /** @type {{increment(): number}} */
    const counter = ctx.use("sample.counter");
    ctx.on("sample.increment", () => {
      ctx.emit("sample.changed", counter.increment());
    });
  },
};
