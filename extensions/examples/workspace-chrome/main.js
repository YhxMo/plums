/** Public-contract workspace sample; install manually, never enabled by default. */
/** @type {import("../../../modules/sdk").ExtensionMain} */
export default {
  activate(ctx) {
    let broken = false;
    let revision = 1;
    /** @type {import("../../../modules/sdk").WorkspaceChromeState} */
    let state = {
      title: "外部任务 · 1",
      contextOwner: "example.workspace-context",
    };
    /** @type {Set<() => void>} */
    const listeners = new Set();
    const publish = () => listeners.forEach((notify) => notify());
    ctx.view({
      id: "example.workspace-chrome.sidebar",
      label: "工作区侧栏",
      presentation: "sidebar",
      mount(root) {
        root.textContent = "工作区拥有的上下文";
        return () => root.replaceChildren();
      },
    });
    ctx.view({
      id: "example.workspace-chrome",
      label: "外部任务样板",
      chrome: {
        getSnapshot() {
          if (broken) throw Error("workspace chrome sample failure");
          return state;
        },
        subscribe(notify) {
          listeners.add(notify);
          return () => listeners.delete(notify);
        },
        navigation: { entityType: "example.task", reveal() {} },
      },
      mount(root) {
        const section = document.createElement("section");
        section.className = "dialog-content";
        const heading = document.createElement("h1");
        heading.textContent = "外部任务样板";
        const label = document.createElement("label");
        label.className = "field";
        label.textContent = "任务草稿";
        label.append(document.createElement("textarea"));
        const actions = document.createElement("div");
        actions.className = "actions";
        /** @param {string} text @param {() => void} action */
        const button = (text, action) => {
          const element = document.createElement("button");
          element.type = "button";
          element.textContent = text;
          element.onclick = action;
          actions.append(element);
        };
        button("更新任务标题", () => {
          state = { ...state, title: `外部任务 · ${++revision}` };
          publish();
        });
        button("切换上下文归属", () => {
          state = {
            ...state,
            contextOwner: state.contextOwner
              ? undefined
              : "example.workspace-context",
          };
          publish();
        });
        button("打开扩展管理", () => void ctx.shell.open("extensions"));
        button("模拟标题回调失败", () => {
          broken = true;
          publish();
        });
        section.append(heading, label, actions);
        root.append(section);
        return () => section.remove();
      },
    });
  },
};
