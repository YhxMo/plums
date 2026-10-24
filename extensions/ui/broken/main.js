/** @type {import('../../../modules/sdk').ExtensionMain} */
export default {
  activate(ctx) {
    ctx.view({
      id: "broken",
      label: "故障布局",
      mount() {
        throw new Error("注入的布局挂载故障");
      },
    });
  },
};
