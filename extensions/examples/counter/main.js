/** @type {import('../../../modules/sdk').ExtensionMain} */
export default {
  activate(ctx) {
    let count = 0;
    ctx.provide("sample.counter", 1, {
      read: () => count,
      increment: () => (count += Number(ctx.configuration.step)),
    });
  },
};
