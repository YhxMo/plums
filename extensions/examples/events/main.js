/** @type {import('../../../modules/sdk').ExtensionMain} */
export default {
  activate(ctx) {
    /** @type {{increment(): number}} */
    const counter = ctx.use("sample.counter");
    ctx.on("sample.increment", () => {
      ctx.emit("sample.changed", counter.increment());
    });
  },
};
