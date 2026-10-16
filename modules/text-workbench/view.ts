import type { ExtensionContext, PageRouter, ViewNode } from "../sdk";
import { TextWorkbenchStore, type TextResult } from "./store";
import "./style.css";

const status = {
  ready: "未执行",
  running: "执行中",
  saving: "等待保存",
  saved: "已保存",
  cancelled: "已取消，输入已保留",
  failed: "执行失败",
  uncertain: "结果未确认",
};
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(
  label: string,
  action: () => void | Promise<void>,
  primary = false,
) {
  const node = el("button", label, primary ? "" : "secondary");
  node.type = "button";
  node.addEventListener("click", () => {
    void Promise.resolve()
      .then(action)
      .catch((error) => {
        const message = el("p", String(error), "error");
        message.role = "alert";
        node
          .closest("[data-text-workbench]")
          ?.querySelector("[data-feedback]")
          ?.replaceChildren(message);
      });
  });
  return node;
}
function heading(text: string) {
  const title = el("h1", text);
  title.tabIndex = -1;
  return title;
}

export function workbenchPages(
  store: TextWorkbenchStore,
  router: PageRouter,
  ctx: ExtensionContext,
  provider: string,
): Record<string, ViewNode> {
  const selected = () =>
    store
      .snapshot()
      .items.find((item) => item.id === store.snapshot().selected);
  const errorBox = () => {
    const node = el("p", "", "error");
    node.role = "alert";
    return node;
  };
  const openEditor = async (changeItem: () => void) => {
    await store.quiesce();
    // Commit the route preference before changing the business selection.
    // A rejected navigation must leave the old page and its selected item aligned.
    await router.navigate("edit");
    changeItem();
    await router.reload();
  };
  const list: ViewNode = {
    id: "text-workbench.list",
    mount(root) {
      const page = el("div", undefined, "tw-page tw-overview");
      page.append(
        el("span", "本地文本工作台", "eyebrow"),
        heading("把文本变成可复用的结果"),
        el("p", "创建处理项、执行转换，再按结果继续编辑。", "tw-lead"),
      );
      const create = button(
        "新建处理项",
        () =>
          openEditor(() => {
            store.create();
          }),
        true,
      );
      create.dataset.pageFocus = "new-item";
      page.append(create);
      const count = el(
        "p",
        `${store.snapshot().items.length} 个处理项 · 结果保存在本地`,
        "muted",
      );
      page.append(count);
      root.append(page);
    },
  };
  const edit: ViewNode = {
    id: "text-workbench.edit",
    mount(root, scope) {
      const page = el("div", undefined, "tw-page");
      page.dataset.pageScroll = "editor";
      const item = selected();
      if (!item) {
        page.append(
          heading("选择或新建一个处理项"),
          button(
            "新建处理项",
            () =>
              openEditor(() => {
                store.create();
              }),
            true,
          ),
        );
        root.append(page);
        return;
      }
      const title = heading("编辑处理项");
      const nameLabel = el("label", "处理项名称", "field");
      const name = el("input");
      name.value = item.title;
      name.maxLength = 120;
      name.dataset.pageFocus = "item-title";
      nameLabel.append(name);
      const textLabel = el("label", "输入文本", "field");
      const input = el("textarea");
      input.value = item.input;
      input.placeholder = "输入要转换的文本，例如：Build something unexpected.";
      input.dataset.pageFocus = "item-input";
      textLabel.append(input);
      const saveFields = () => store.edit(name.value, input.value);
      name.addEventListener("input", saveFields);
      input.addEventListener("input", saveFields);
      const service = el("div", undefined, "tw-service");
      service.append(
        el("span", "转换服务", "muted"),
        el("strong", provider),
        button("更换服务", () => ctx.shell.open("extensions")),
      );
      const run = button("执行转换", () => store.run(), true);
      run.dataset.pageFocus = "execute";
      const cancel = button("取消执行", () => store.cancel());
      const save = button("保存草稿", () => store.saveDraft());
      const results = button("查看结果", () => router.navigate("results"));
      const removal = el("div", undefined, "tw-delete-confirm");
      removal.hidden = true;
      const remove = button("删除处理项", () => {
        removal.hidden = false;
      });
      removal.append(
        el("p", "删除这个处理项及其结果？"),
        button("取消删除", () => {
          removal.hidden = true;
          remove.focus();
        }),
        button("确认删除", async () => {
          await store.remove();
          try {
            await router.navigate("list");
          } catch (error) {
            // The data removal may have committed even when the route save failed.
            // Rebind the editor to the actual remaining selection before accepting input.
            await router.reload();
            throw error;
          }
        }),
      );
      const actions = el("div", undefined, "tw-actions");
      actions.append(run, cancel, save, results);
      remove.className = "text-button tw-remove";
      const phase = el("p", "", "tw-phase");
      phase.role = "status";
      const failure = errorBox();
      const update = () => {
        const state = store.snapshot();
        const busy = state.phase === "running" || state.phase === "saving";
        name.readOnly = input.readOnly = busy || state.phase === "uncertain";
        run.disabled =
          busy || state.phase === "uncertain" || !selected()?.input.trim();
        cancel.hidden = state.phase !== "running";
        run.hidden = state.phase === "running";
        save.disabled = busy || state.phase === "uncertain";
        remove.disabled = busy || state.phase === "uncertain";
        phase.textContent = status[state.phase];
        failure.textContent = state.error ?? "";
        results.disabled = !selected()?.results.length;
      };
      scope.onDispose(store.subscribe(update));
      page.append(
        title,
        nameLabel,
        textLabel,
        service,
        actions,
        removal,
        phase,
        failure,
        el(
          "p",
          "切换页面会取消未提交的执行，并等待已派发的保存回执。",
          "tw-footnote",
        ),
        remove,
      );
      update();
      root.append(page);
    },
  };
  let detail: TextResult | undefined;
  const results: ViewNode = {
    id: "text-workbench.results",
    mount(root, scope) {
      const page = el("div", undefined, "tw-page");
      page.dataset.pageScroll = "results";
      page.append(heading("结果记录"));
      const content = el("div", undefined, "tw-results");
      const update = () => {
        content.replaceChildren();
        const entries = selected()?.results ?? [];
        if (!entries.length)
          content.append(
            el(
              "p",
              "还没有已保存的结果。执行一次转换后，结果会出现在这里。",
              "tw-lead",
            ),
          );
        for (const result of [...entries].reverse()) {
          const open = button("", async () => {
            detail = result;
            await router.navigate("detail", result.id);
          });
          open.className = "tw-result";
          open.dataset.pageFocus = result.id;
          open.append(
            el(
              "span",
              `${result.provider} · ${new Date(result.created).toLocaleString()}`,
              "muted",
            ),
            el("strong", result.output.slice(0, 160) || "（空文本结果）"),
            el("span", "查看结果 →", "tw-result-link"),
          );
          content.append(open);
        }
      };
      scope.onDispose(store.subscribe(update));
      page.append(
        content,
        button("返回编辑", () => router.navigate("edit")),
      );
      update();
      root.append(page);
    },
  };
  const detailNode: ViewNode = {
    id: "text-workbench.detail",
    mount(root) {
      const page = el("div", undefined, "tw-page tw-detail");
      page.dataset.pageScroll = "detail";
      const owner = selected();
      const result =
        owner?.results.find((entry) => entry.id === detail?.id) ??
        owner?.results.at(-1);
      const panel = el("aside", undefined, "tw-detail-panel");
      panel.append(heading("结果详情"));
      if (!result) {
        panel.append(
          el("p", "这个结果暂不可用，已保存的数据仍然保留。"),
          button("返回结果", () => router.navigate("results")),
        );
      } else {
        const actions = el("div", undefined, "tw-actions");
        actions.append(
          button("关闭详情", () => router.back("results")),
          button(
            "再编辑",
            () =>
              openEditor(() => {
                if (!owner) throw Error("处理项暂不可用");
                store.select(owner.id);
                store.edit(owner.title, result.input);
              }),
            true,
          ),
        );
        panel.append(
          el(
            "p",
            `${result.provider} · ${new Date(result.created).toLocaleString()}`,
            "muted",
          ),
          actions,
          el("h2", "输入"),
          el("pre", result.input, "tw-text"),
          el("h2", "输出"),
          el("pre", result.output, "tw-text"),
        );
      }
      const index = el("section", undefined, "tw-detail-index");
      index.append(el("h2", "结果记录"));
      for (const entry of [...(selected()?.results ?? [])].reverse()) {
        const choose = button(
          entry.output.slice(0, 100) || "（空文本结果）",
          async () => {
            detail = entry;
            await router.reload();
          },
        );
        choose.setAttribute("aria-pressed", String(entry.id === result?.id));
        index.append(choose);
      }
      page.append(index, panel);
      root.append(page);
    },
  };
  return { list, edit, results, detail: detailNode };
}

export function mountWorkbench(
  root: HTMLElement,
  store: TextWorkbenchStore,
  router: PageRouter,
  ctx: ExtensionContext,
) {
  const frame = el("div", undefined, "tw-workspace");
  frame.dataset.textWorkbench = "";
  const sidebar = el("aside", undefined, "tw-sidebar");
  sidebar.ariaLabel = "处理项列表";
  const brand = el("header", undefined, "tw-brand");
  brand.append(
    el("span", "▤", "tw-mark"),
    el("strong", "文本处理"),
    el("small", "本地工作台"),
  );
  const create = button(
    "＋ 新建处理项",
    async () => {
      await store.quiesce();
      await router.navigate("edit");
      store.create();
      await router.reload();
    },
    true,
  );
  create.dataset.pageFocus = "new-item";
  const filters = el("nav", undefined, "tw-filters");
  filters.ariaLabel = "处理项筛选";
  let filter = "全部";
  for (const label of ["全部", "已保存", "失败"])
    filters.append(
      button(label, () => {
        filter = label;
        drawItems();
      }),
    );
  const items = el("div", undefined, "tw-items");
  const management = button("管理扩展", () => ctx.shell.open("extensions"));
  sidebar.append(brand, create, filters, items, management);
  const main = el("main", undefined, "tw-main");
  const top = el("header", undefined, "tw-top");
  const nav = el("nav", undefined, "tw-nav");
  nav.ariaLabel = "工作台页面";
  const listPage = button("返回列表", () => router.navigate("list"));
  listPage.className = "secondary tw-mobile-back";
  top.append(listPage, nav);
  const feedback = el("div");
  feedback.dataset.feedback = "";
  const outlet = el("div", undefined, "tw-outlet");
  const mobile = matchMedia("(max-width: 767px)");
  main.append(top, feedback, outlet);
  frame.append(sidebar, main);
  root.append(frame);
  function drawItems() {
    const state = store.snapshot();
    const active = document.activeElement as HTMLElement | null;
    const focusId =
      active && items.contains(active) ? active.dataset.item : undefined;
    items.replaceChildren();
    for (const entry of state.items) {
      const failed = entry.id === state.selected && state.phase === "failed";
      if (
        (filter === "已保存" && !entry.results.length) ||
        (filter === "失败" && !failed)
      )
        continue;
      const row = button("", async () => {
        await store.quiesce();
        await router.navigate("edit");
        store.select(entry.id);
        await router.reload();
      });
      row.className = "tw-item";
      row.dataset.item = entry.id;
      row.setAttribute("aria-pressed", String(entry.id === state.selected));
      row.append(
        el("strong", entry.title),
        el(
          "span",
          failed
            ? "执行失败"
            : entry.results.length
              ? `${entry.results.length} 次已保存结果`
              : "草稿 · 尚未执行",
        ),
      );
      items.append(row);
    }
    if (!items.childElementCount)
      items.append(
        el(
          "p",
          state.items.length ? "没有符合筛选的处理项。" : "还没有处理项。",
          "muted",
        ),
      );
    if (focusId)
      [...items.querySelectorAll<HTMLButtonElement>("button")]
        .find((node) => node.dataset.item === focusId)
        ?.focus();
    for (const node of filters.querySelectorAll("button"))
      node.setAttribute("aria-pressed", String(node.textContent === filter));
  }
  const drawNavigation = () => {
    const state = router.snapshot();
    nav.replaceChildren();
    const order = ["list", "edit", "results"];
    for (const entry of state.entries
      .filter((entry) => entry.route !== "detail")
      .sort(
        (a, b) =>
          (order.includes(a.route) ? order.indexOf(a.route) : 3) -
          (order.includes(b.route) ? order.indexOf(b.route) : 3),
      )) {
      const tab = button(
        (
          { list: "处理项", edit: "编辑", results: "结果" } as Record<
            string,
            string
          >
        )[entry.route] ?? entry.label,
        () => router.navigate(entry.route),
      );
      tab.setAttribute(
        "aria-current",
        state.route === entry.route ? "page" : "false",
      );
      tab.disabled = state.busy;
      nav.append(tab);
    }
    frame.dataset.page = state.route ?? "list";
    // On mobile, the route itself is the detail layer with a modal interaction boundary.
    if (state.route === "detail" && mobile.matches) {
      top.inert = true;
      outlet.setAttribute("role", "dialog");
      outlet.setAttribute("aria-modal", "true");
      outlet.setAttribute("aria-label", "结果详情");
    } else {
      top.inert = false;
      outlet.removeAttribute("role");
      outlet.removeAttribute("aria-modal");
      outlet.removeAttribute("aria-label");
    }
    const messages = [
      state.missing ? `页面 ${state.missing} 暂不可用，原偏好已保留。` : "",
      state.conflicts.length
        ? `存在 ${state.conflicts.length} 处导航冲突，已按优先级选择；同级按贡献 ID 排序。`
        : "",
      state.error ?? "",
    ].filter(Boolean);
    feedback.replaceChildren(
      ...messages.map((text) => el("p", text, "tw-route-notice")),
    );
  };
  const offStore = store.subscribe(drawItems);
  const offRouter = router.subscribe(drawNavigation);
  mobile.addEventListener("change", drawNavigation);
  drawItems();
  drawNavigation();
  const keys = (event: KeyboardEvent) => {
    if (router.snapshot().route !== "detail") return;
    if (event.key === "Escape") {
      event.preventDefault();
      void router.back("results").catch((error) => {
        feedback.textContent = String(error);
      });
    }
    if (event.key === "Tab" && outlet.getAttribute("aria-modal") === "true") {
      const controls = [
        ...outlet.querySelectorAll<HTMLElement>(
          "button, [href], input, textarea",
        ),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !controls.includes(document.activeElement as HTMLElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  frame.addEventListener("keydown", keys);
  let alive = true;
  void router.mount(outlet).catch((error) => {
    if (alive) feedback.textContent = String(error);
  });
  return async () => {
    alive = false;
    offStore();
    offRouter();
    mobile.removeEventListener("change", drawNavigation);
    frame.removeEventListener("keydown", keys);
    await router.detach();
    frame.remove();
  };
}
