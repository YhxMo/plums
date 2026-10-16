import { element, listen, panel, action } from "./local-proof-ui.js";

/** @typedef {"main" | "z" | "a" | "priority"} PageKey */
/** @typedef {{key: PageKey, id: string, route: string, label: string, priority: number}} PageSpec */
/** @type {readonly PageSpec[]} */
export const pageSpecs = [
  {
    key: "main",
    id: "example.local-proof.main",
    route: "local-proof",
    label: "交稿检查",
    priority: 0,
  },
  {
    key: "z",
    id: "example.local-proof.z",
    route: "local-proof-review",
    label: "交稿清单 · Z",
    priority: 0,
  },
  {
    key: "a",
    id: "example.local-proof.a",
    route: "local-proof-review",
    label: "交稿清单 · A",
    priority: 0,
  },
  {
    key: "priority",
    id: "example.local-proof.priority",
    route: "local-proof-review",
    label: "交稿清单 · 高优先级",
    priority: 10,
  },
];

/**
 * Owns async registration and removal, including registration racing disposal.
 * @param {import("./local-proof-types.js").AuthorContext} ctx
 * @param {import("./local-proof-types.js").PageService} pages
 * @param {(spec: PageSpec) => import("./local-proof-types.js").ViewNode} makeNode
 */
export function createPageManager(ctx, pages, makeNode) {
  /** @type {Map<PageKey, () => Promise<void>>} */
  const handles = new Map();
  /** @type {Set<PageKey>} */
  const failedRemovals = new Set();
  /** @type {unknown[]} */
  const removalErrors = [];
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  /** @type {Promise<void> | undefined} */
  let closed;
  let closing = false;
  let pending = 0;
  let error = "";
  const notify = () => {
    for (const listener of listeners) listener();
  };
  /** @param {() => Promise<void>} operation */
  const enqueue = (operation) => {
    if (closing || ctx.signal.aborted)
      return Promise.reject(Error("页面扩展已停止"));
    if (removalErrors.length) return Promise.reject(removalErrors[0]);
    pending++;
    notify();
    const result = queue
      .then(async () => {
        if (closing || ctx.signal.aborted) throw Error("页面扩展已停止");
        if (removalErrors.length) throw removalErrors[0];
        error = "";
        await operation();
      })
      .catch((cause) => {
        error = String(cause);
        throw cause;
      })
      .finally(() => {
        pending--;
        notify();
      });
    queue = result.catch(() => {});
    return result;
  };
  function close() {
    if (closed) return closed;
    closing = true;
    notify();
    closed = (async () => {
      // A register already dispatched must finish before its handle can be released.
      await queue;
      const results = await Promise.allSettled(
        [...handles.entries()]
          .reverse()
          .filter(([key]) => !failedRemovals.has(key))
          .map(([, remove]) => remove()),
      );
      listeners.clear();
      const failures = results.filter((result) => result.status === "rejected");
      const errors = [
        ...removalErrors,
        ...failures.map((result) => result.reason),
      ];
      if (errors.length) throw new AggregateError(errors, "页面贡献清理失败");
      handles.clear();
    })();
    return closed;
  }
  ctx.onDispose(close);
  return {
    snapshot: () => ({
      keys: [...handles.keys()],
      busy: pending > 0 || closing,
      blocked: removalErrors.length > 0,
      error,
    }),
    /** @param {() => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** @param {PageKey} key */
    add(key) {
      return enqueue(async () => {
        if (handles.has(key)) return;
        const spec = pageSpecs.find((candidate) => candidate.key === key);
        if (!spec) throw Error(`未知页面：${key}`);
        const remove = await pages.register({ ...spec, node: makeNode(spec) });
        handles.set(key, remove);
      });
    },
    /** @param {PageKey} key */
    remove(key) {
      return enqueue(async () => {
        const remove = handles.get(key);
        if (!remove) return;
        try {
          await remove();
        } catch (cause) {
          // A rejected disposer is not known safe to retry, even at shutdown.
          failedRemovals.add(key);
          removalErrors.push(cause);
          throw cause;
        }
        handles.delete(key);
      });
    },
    close,
  };
}

/** @type {import("./local-proof-types.js").ExtensionDefinition} */
const definition = {
  manifest: {
    id: "example.local-proof-pages",
    version: "0.1.0",
    apiVersion: 1,
    requires: { "text-workbench.pages": 1, "example.local-text.node": 1 },
  },
  async activate(ctx) {
    /** @type {import("./local-proof-types.js").PageService} */
    const pages = ctx.use("text-workbench.pages");
    /** @type {import("./local-proof-types.js").TextNodeService} */
    const textNode = ctx.use("example.local-text.node");
    const manager = createPageManager(ctx, pages, makeNode);
    /** @param {PageSpec} spec
     * @returns {import("./local-proof-types.js").ViewNode}
     */
    function makeNode(spec) {
      return {
        id: `${spec.id}.container`,
        async mount(root, scope) {
          const body = panel(
            root,
            scope,
            spec.label,
            spec.key === "main"
              ? "粘贴文本，检查格式与待补内容，再用清单核对交稿。"
              : `当前贡献：${spec.id}；优先级 ${spec.priority}。`,
          );
          body.dataset.pageScroll = "local-proof-body";
          Object.assign(body.style, { overflowY: "auto", maxHeight: "100%" });
          const child = element("div");
          body.append(child);
          const controls = element("fieldset");
          Object.assign(controls.style, {
            minWidth: "0",
            borderColor: "var(--control-border, currentColor)",
          });
          controls.append(element("legend", "额外页面登记与冲突实验"));
          controls.append(
            element(
              "p",
              "在工作台导航打开交稿清单：Z 与 A 同为 0 时 A 胜出；优先级 10 胜出后，移除它将回退 A。",
            ),
          );
          const rows = element("div");
          Object.assign(rows.style, {
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          });
          /** @type {{spec: PageSpec, add: HTMLButtonElement, remove: HTMLButtonElement}[]} */
          const pairs = [];
          // The same controls live on every contribution, so removing the visible
          // winner can be exercised without navigating away first.
          for (const candidate of pageSpecs.filter(
            (item) => item.key !== "main",
          )) {
            const row = element("div");
            Object.assign(row.style, {
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              alignItems: "center",
            });
            const label =
              candidate.key === "priority"
                ? "高优先级（10）"
                : `${candidate.key.toUpperCase()}（0）`;
            const add = action(`添加 ${label}`);
            const remove = action(`移除 ${label}`);
            add.dataset.pageFocus = `add-${candidate.key}`;
            remove.dataset.pageFocus = `remove-${candidate.key}`;
            listen(scope, add, "click", () => {
              void manager.add(candidate.key).catch(() => {});
            });
            listen(scope, remove, "click", () => {
              void manager.remove(candidate.key).catch(() => {});
            });
            row.append(add, remove);
            rows.append(row);
            pairs.push({ spec: candidate, add, remove });
          }
          const status = element("p");
          status.setAttribute("role", "status");
          const error = element("p");
          error.setAttribute("role", "alert");
          controls.append(rows, status, error);
          /** @type {HTMLButtonElement | undefined} */
          let removeCurrent;
          if (spec.key !== "main") {
            removeCurrent = action("移除当前贡献（观察同路由回退）");
            listen(scope, removeCurrent, "click", () => {
              void manager.remove(spec.key).catch(() => {});
            });
            controls.append(removeCurrent);
          }
          body.append(controls);
          const counters = element("p");
          const refresh = action("刷新节点清理计数");
          listen(scope, refresh, "click", () => {
            const value = textNode.diagnostics();
            counters.textContent = `节点累计挂载 ${value.mounts} · 已清理 ${value.disposals} · 活跃 ${value.activeNodes} · 订阅 ${value.subscriptions}`;
          });
          body.append(refresh, counters);
          const render = () => {
            const value = manager.snapshot();
            for (const pair of pairs) {
              pair.add.disabled =
                value.busy ||
                value.blocked ||
                value.keys.includes(pair.spec.key);
              pair.remove.disabled =
                value.busy ||
                value.blocked ||
                !value.keys.includes(pair.spec.key);
            }
            if (removeCurrent)
              removeCurrent.disabled = value.busy || value.blocked;
            status.textContent = `已登记额外贡献 ${value.keys.filter((key) => key !== "main").length} / 3${value.blocked ? " · 移除失败，操作已锁定" : value.busy ? " · 操作处理中" : ""}`;
            error.textContent = value.error;
          };
          let unsubscribe = () => {};
          scope.onDispose(() => unsubscribe());
          unsubscribe = manager.subscribe(render);
          render();
          // Workbench page tree -> this container -> another extension's node.
          // Child mounting completes here; UI callbacks only register whole pages.
          await scope.mount(
            textNode.createNode(spec.key === "main" ? "editor" : "checklist"),
            child,
          );
        },
      };
    }
    await manager.add("main");
  },
};
export default definition;
