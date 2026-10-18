import type { ExtensionDefinition, ViewNode } from "../../modules/sdk/index";

export function createPanel(): ExtensionDefinition {
  return {
    manifest: {
      id: "ui.panel.author",
      version: "1.0.0",
      apiVersion: 1,
      provides: { "ui.panel": 1 },
    },
    activate(ctx) {
      let clicks = 0;
      let live = 0;
      let closed = 0;
      const node: ViewNode = {
        id: "panel.counter",
        mount(root, scope) {
          const value = document.createElement("p");
          const button = document.createElement("button");
          const onClick = () => {
            clicks += 1;
            value.textContent = `已完成 ${clicks} 项`;
          };
          scope.onDispose(() => {
            button.removeEventListener("click", onClick);
            root.replaceChildren();
            live -= 1;
            closed += 1;
          });
          live += 1;
          const section = document.createElement("section");
          section.dataset.testid = "counter";
          const heading = document.createElement("h2");
          heading.textContent = "今日进度";
          value.dataset.testid = "counter-value";
          value.textContent = `已完成 ${clicks} 项`;
          button.type = "button";
          button.textContent = "完成一项";
          button.addEventListener("click", onClick);
          section.append(heading, value, button);
          root.append(section);
        },
      };
      ctx.provide("ui.panel", 1, {
        node,
        inspect: () => ({ clicks, live, closed }),
      });
    },
  };
}
