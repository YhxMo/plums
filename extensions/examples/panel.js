/** @type {import('../../modules/sdk').ExtensionDefinition} */
export default {
  manifest: {
    id: "sample.panel",
    version: "1.0.0",
    apiVersion: 1,
    requires: { "sample.counter": 1 },
  },
  activate(ctx) {
    /** @type {{read(): number}} */
    const counter = ctx.use("sample.counter");
    ctx.view({
      id: "sample.panel",
      label: "计数样板",
      mount(root) {
        const section = document.createElement("section");
        const heading = document.createElement("h1");
        heading.textContent = "事件计数器";
        const output = document.createElement("p");
        output.setAttribute("role", "status");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "增加计数";
        const refresh = () => {
          output.textContent = `计数：${counter.read()}`;
        };
        const increment = () => {
          ctx.emit("sample.increment", null);
          refresh();
        };
        button.addEventListener("click", increment);
        refresh();
        section.append(heading, output, button);
        root.append(section);
        return () => {
          button.removeEventListener("click", increment);
          section.remove();
        };
      },
    });
  },
};
