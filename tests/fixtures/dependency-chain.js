import { state } from "./dependency-state.js";

export const catalog = [
  ["combo.provider", "组合提供者"],
  ["combo.middle", "组合中间层"],
  ["combo.leaf", "组合叶节点"],
  ["combo.controls", "组合检查界面"],
].map(([id, label]) => ({
  id,
  label,
  url: `/fixtures/dependency-chain.js?owner=${id}`,
}));

/** @type {Record<string, import('../../modules/sdk').ExtensionDefinition>} */
const definitions = {
  "combo.provider": {
    manifest: {
      id: "combo.provider",
      version: "1",
      apiVersion: 1,
      provides: { "combo.source": 1 },
      requires: { "combo.notifications": 1 },
    },
    activate(ctx) {
      const notify = ctx.use("combo.notifications");
      ctx.signal.addEventListener("abort", /** @type {()=>void} */ (notify), {
        once: true,
      });
      ctx.provide("combo.source", 1, () => {
        state.calls++;
      });
      ctx.view({
        id: "combo-owner",
        label: "组合所有者",
        mount(root) {
          root.textContent = "组合提供者视图：切换离开将注入释放失败";
          return async () => {
            throw new Error("组合提供者释放失败");
          };
        },
      });
    },
  },
  "combo.controls": {
    manifest: {
      id: "combo.controls",
      version: "1",
      apiVersion: 1,
      provides: { "combo.notifications": 1 },
    },
    activate(ctx) {
      ctx.provide("combo.notifications", 1, () => {
        state.notifications++;
        ctx.emit("combo.tick", null);
      });
      ctx.view({
        id: "combo-controls",
        label: "组合检查",
        mount(root) {
          const count = document.createElement("p");
          const render = () => {
            count.textContent = `旧服务调用 ${state.calls} · 已取消 ${state.aborted.size} · 清理回调 ${state.disposed.size} · 取消通知 ${state.notifications}`;
          };
          const emit = document.createElement("button");
          emit.textContent = "发送组合事件";
          emit.onclick = () => {
            ctx.emit("combo.tick", null);
            render();
          };
          const label = document.createElement("label");
          const fail = document.createElement("input");
          fail.type = "checkbox";
          fail.checked = state.failMiddle;
          fail.onchange = () => {
            state.failMiddle = fail.checked;
          };
          label.append(fail, "注入消费者清理失败");
          root.replaceChildren(count, emit, label);
          render();
          return () => {
            emit.onclick = null;
            fail.onchange = null;
            root.replaceChildren();
          };
        },
      });
    },
  },
};
for (const id of ["combo.middle", "combo.leaf"]) {
  const middle = id === "combo.middle";
  const dependency = middle ? "combo.source" : "combo.relay";
  definitions[id] = {
    manifest: {
      id,
      version: "1",
      apiVersion: 1,
      requires: { [dependency]: 1, "combo.notifications": 1 },
      ...(middle ? { provides: { "combo.relay": 1 } } : {}),
    },
    activate(ctx) {
      const notify = ctx.use("combo.notifications");
      ctx.signal.addEventListener("abort", /** @type {()=>void} */ (notify), {
        once: true,
      });
      const service = /** @type {()=>void} */ (ctx.use(dependency));
      if (middle) ctx.provide("combo.relay", 1, service);
      ctx.on("combo.tick", () => service());
      void ctx.task(
        (signal) =>
          new Promise((resolve) => {
            const abort = () => {
              state.aborted.add(id);
              resolve(undefined);
            };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          }),
      );
      ctx.onDispose(() => {
        state.disposed.add(id);
        if (middle && state.failMiddle) throw new Error("组合消费者清理失败");
      });
    },
  };
}
export default definitions[
  new URL(import.meta.url).searchParams.get("owner") ?? ""
];
