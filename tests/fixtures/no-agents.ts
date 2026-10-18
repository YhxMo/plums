import { bootShell } from "../../src/shell/runtime";

/** Browser-only integration fixture: no default business provider is installed. */
export const boot = () =>
  bootShell({
    catalog: [
      {
        id: "notes",
        url: "test fixture",
        label: "独立笔记",
        views: { notes: "笔记" },
      },
    ],
    restore: (state) => ({ ...state, layout: state.layout || "notes" }),
    extensions: () => [
      {
        manifest: { id: "notes", apiVersion: 1, version: "1.0.0" },
        activate(ctx) {
          ctx.view({
            id: "notes",
            label: "笔记",
            mount(container) {
              const label = document.createElement("label");
              label.textContent = "笔记草稿";
              const input = document.createElement("textarea");
              input.value = ctx.shell.readPage("notes") ?? "";
              label.append(input);
              const save = document.createElement("button");
              save.textContent = "保存笔记";
              save.onclick = async () => {
                await ctx.shell.savePage("notes", input.value);
                save.textContent = "笔记已保存";
              };
              container.append(label, save);
              return () => container.replaceChildren();
            },
          });
        },
      },
    ],
    start: ["notes"],
  });
