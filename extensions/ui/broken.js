/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: { id: "ui.broken", version: "1.0.0", apiVersion: 1 },
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
