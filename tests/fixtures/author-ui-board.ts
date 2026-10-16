import {
  mountViewTree,
  type ExtensionDefinition,
  type ViewNode,
} from "../../modules/sdk/index";

type Mode = "normal" | "cycle" | "conflict" | "throw" | "cleanup-fail";

export function createBoard(): ExtensionDefinition {
  return {
    manifest: {
      id: "ui.board.author",
      version: "1",
      apiVersion: 1,
      requires: { "ui.panel": 1 },
      provides: { "ui.board.control": 1 },
    },
    activate(ctx) {
      const panel = ctx.use<{ node: ViewNode }>("ui.panel");
      let mode: Mode = "normal";
      const counts = { ready: 0, failed: 0, closed: 0 };
      ctx.provide("ui.board.control", 1, {
        setMode(next: Mode) {
          mode = next;
        },
        inspect() {
          return { ...counts };
        },
      });
      ctx.view({
        id: "composition.board",
        label: "组合任务板",
        mount(root) {
          let alive = true;
          const currentMode = mode;
          const tree = mountViewTree(root, {
            id: "board.root",
            async mount(target, scope) {
              scope.onDispose(() => target.replaceChildren());
              const board = document.createElement("section");
              const heading = document.createElement("h1");
              heading.textContent = "今日工作台";
              const description = document.createElement("p");
              description.textContent = "两个扩展，共同完成一张任务板";
              const section = document.createElement("section");
              board.append(heading, description, section);
              target.append(board);
              if (currentMode === "cleanup-fail") {
                scope.onDispose(() => {
                  throw new Error("Synthetic board cleanup failure");
                });
              }
              await scope.mount(
                {
                  id: currentMode === "cycle" ? "board.root" : "board.section",
                  async mount(container, childScope) {
                    childScope.onDispose(() => container.replaceChildren());
                    const slot = document.createElement("div");
                    slot.dataset.testid = "panel-slot";
                    container.append(slot);
                    await childScope.mount(panel.node, slot);
                    if (currentMode === "conflict") {
                      await childScope.mount(panel.node, slot);
                    }
                    if (currentMode === "throw") {
                      throw new Error("Synthetic board mount failure");
                    }
                  },
                },
                section,
              );
            },
          });
          void tree.ready.then(
            () => {
              counts.ready += 1;
            },
            () => {
              counts.failed += 1;
              if (!alive) return;
              const alert = document.createElement("p");
              alert.setAttribute("role", "alert");
              alert.textContent = "组合未能打开，请返回扩展管理。";
              root.replaceChildren(alert);
            },
          );
          return () => {
            alive = false;
            counts.closed += 1;
            // Remove fallback DOM too; tree.close still reports any cleanup failure.
            root.replaceChildren();
            return tree.close();
          };
        },
      });
    },
  };
}
