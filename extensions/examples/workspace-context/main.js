/** Context owner is separate from the workspace owner. */
/** @type {import("../../../modules/sdk").ExtensionMain} */
export default {
  activate(ctx) {
    ctx.view({
      id: "example.workspace-context.sidebar",
      label: "实体侧栏",
      presentation: "sidebar",
      mount(root) {
        root.textContent = "实体拥有的上下文";
        return () => root.replaceChildren();
      },
    });
  },
};
