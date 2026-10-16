import { Host } from "../../modules/extension-host/host";
import type { ExtensionDefinition, Platform } from "../../modules/sdk";
import {
  resolveNavigation,
  type NavigationEntry,
} from "../../modules/sdk/navigation";
import "./style.css";

const platform: Platform = {
  kind: "browser",
  available: () => false,
  grant: async () => {},
  call: async () => {
    throw Error("No platform capability in synthetic fixture");
  },
};
const host = new Host(platform);
const entries = new Map<string, NavigationEntry>();
const content = document.querySelector<HTMLElement>("#content")!;
const management =
  document.querySelector<HTMLButtonElement>("#management-entry")!;
const status = document.querySelector<HTMLElement>("#status")!;
const nav = document.querySelector<HTMLElement>("#routes")!;
const result = document.querySelector<HTMLElement>("#result")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
let route = "home";
let mounted:
  | { id: string; generation: number; close: () => void | Promise<void> }
  | undefined;
let locked = false;
let failClose = false;
let running = false;
let queue: Promise<void> = Promise.resolve();
const counts = new Map<
  string,
  { clicks: number; mounts: number; closes: number }
>();
const ids = ["nav.base", "nav.alt", "nav.notes"];
const registry: ExtensionDefinition = {
  manifest: {
    id: "nav.registry",
    version: "1.0.0",
    apiVersion: 1,
    provides: { "nav.registry": 1 },
  },
  activate(ctx) {
    ctx.provide("nav.registry", 1, {
      add(entry: NavigationEntry) {
        if (entries.has(entry.id)) throw Error("Duplicate metadata");
        const copy = { ...entry };
        entries.set(copy.id, copy);
        return () => {
          if (entries.get(copy.id) === copy) entries.delete(copy.id);
        };
      },
    });
  },
};
function contribution(
  id: string,
  target: string,
  priority: number,
  label: string,
): ExtensionDefinition {
  const count = { clicks: 0, mounts: 0, closes: 0 };
  counts.set(id, count);
  return {
    manifest: {
      id,
      version: "1.0.0",
      apiVersion: 1,
      requires: { "nav.registry": 1 },
    },
    activate(ctx) {
      const registry = ctx.use<{ add(meta: NavigationEntry): () => void }>(
        "nav.registry",
      );
      ctx.onDispose(
        registry.add({
          id,
          route: target,
          priority,
          label,
          viewId: id + ".view",
        }),
      );
      ctx.view({
        id: id + ".view",
        label,
        mount(root) {
          count.mounts++;
          const heading = document.createElement("h2");
          heading.tabIndex = -1;
          heading.textContent = label;
          const note = document.createElement("p");
          note.textContent =
            target === "home"
              ? "整理今天的事项，专注下一步。"
              : "记录工作线索，返回工作台继续处理。";
          const value = document.createElement("p");
          value.dataset.testid = "count";
          const update = () => {
            value.textContent = `本贡献已完成 ${count.clicks} 项`;
          };
          update();
          const button = document.createElement("button");
          button.textContent = "完成一项";
          button.dataset.testid = "increment";
          const click = () => {
            count.clicks++;
            update();
          };
          button.addEventListener("click", click);
          root.replaceChildren(heading, note, value, button);
          root.dataset.owner = id;
          return () => {
            if (failClose) throw Error("Synthetic cleanup failure");
            button.removeEventListener("click", click);
            root.replaceChildren();
            delete root.dataset.owner;
            count.closes++;
          };
        },
      });
    },
  };
}
function selection() {
  const available = new Set(host.views().map((view) => view.id));
  return resolveNavigation(
    [...entries.values()].filter((entry) => available.has(entry.viewId)),
    route,
  );
}
function latch(error: unknown) {
  locked = true;
  content.inert = true;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "#routes button, #stop-priority, #restore, #run",
  ))
    button.disabled = true;
  status.textContent =
    "视图释放失败，需要重启。已禁止继续替换，管理入口仍可访问。";
  status.setAttribute("role", "alert");
  management.focus();
  return error;
}
async function closeCurrent() {
  if (!mounted) return;
  try {
    await mounted.close();
    mounted = undefined;
  } catch (error) {
    throw latch(error);
  }
}
async function render() {
  if (locked) {
    management.focus();
    return;
  }
  const resolved = selection();
  nav.replaceChildren();
  for (const entry of resolved.winners) {
    const button = document.createElement("button");
    button.textContent = entry.route === "home" ? "工作台" : "笔记";
    button.dataset.route = entry.route;
    button.setAttribute(
      "aria-current",
      entry.id === resolved.selected?.id ? "page" : "false",
    );
    nav.append(button);
  }
  const selected = resolved.selected;
  const view =
    selected && host.views().find((view) => view.id === selected.viewId);
  if (selected)
    status.textContent = `${selected.label} · ${resolved.conflicts.length ? `同路由优先贡献 ${selected.id}（优先级 ${selected.priority}）` : "当前可用视图"}`;
  if (
    mounted &&
    view &&
    mounted.id === view.id &&
    mounted.generation === view.generation
  )
    return;
  await closeCurrent();
  if (!view) {
    content.textContent = "当前没有启用的工作视图，请在管理区恢复。";
    status.textContent = "所有贡献均已停用";
    management.focus();
    return;
  }
  try {
    mounted = {
      id: view.id,
      generation: view.generation,
      close: host.mountView(view.id, content),
    };
    content.querySelector<HTMLElement>("h2")!.focus();
  } catch (error) {
    status.textContent = "视图挂载失败，请通过管理区停用或恢复。";
    status.setAttribute("role", "alert");
    management.focus();
    throw error;
  }
}
function enqueue(operation: () => Promise<void>) {
  const pending = queue.then(operation);
  queue = pending.catch(() => {});
  return pending;
}
async function navigate(next: string) {
  if (locked) throw Error("Restart required");
  route = next;
  await render();
}
async function stop(id: string) {
  if (locked) throw Error("Restart required");
  if (mounted?.id === id + ".view") await closeCurrent();
  await host.stop(id);
  await render();
}
async function restore() {
  if (locked) throw Error("Restart required");
  for (const id of ids) await host.start(id);
  route = "home";
  await render();
}
function reportError(error: unknown) {
  if (!locked) {
    status.textContent = String(error);
    status.setAttribute("role", "alert");
  }
}
nav.addEventListener("click", (event) => {
  if (running) return;
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "button[data-route]",
  );
  if (button)
    void enqueue(() => navigate(button.dataset.route!)).catch(reportError);
});
management.addEventListener("click", () => {
  document.querySelector<HTMLElement>("#management-title")!.focus();
});
document.querySelector("#stop-priority")!.addEventListener("click", () => {
  if (!running) void enqueue(() => stop("nav.alt")).catch(reportError);
});
document.querySelector("#restore")!.addEventListener("click", () => {
  if (!running) void enqueue(restore).catch(reportError);
});
async function acceptance() {
  const checks: { name: string; passed: boolean; error?: string }[] = [];
  const limitations = [
    "仅隔离合成数据与同进程路由；不是默认生产界面",
    "不验证 history、持久化、主题或快捷键冲突",
    "清理失败仅验证锁存与管理入口；不声称可原地修复",
    "浏览器执行不替代原生与真机证据",
  ];
  const check = (name: string, assertion: () => void) => {
    try {
      assertion();
      checks.push({ name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, error: String(error) });
      throw error;
    }
  };
  const assert = (value: unknown, message: string) => {
    if (!value) throw Error(message);
  };
  try {
    await restore();
    check("priority-and-conflict", () => {
      const state = selection();
      assert(
        state.selected?.id === "nav.alt" &&
          state.conflicts[0]?.winner === "nav.alt" &&
          state.conflicts[0]?.others.includes("nav.base"),
        "priority diagnostics",
      );
    });
    await navigate("notes");
    check("notes-focus", () => {
      assert(
        content.dataset.owner === "nav.notes" &&
          document.activeElement === content.querySelector("h2"),
        "notes and focus",
      );
    });
    await navigate("home");
    check("home-return", () => {
      assert(
        content.dataset.owner === "nav.alt" &&
          document.activeElement === content.querySelector("h2"),
        "home and focus",
      );
    });
    await stop("nav.alt");
    check("stop-priority-falls-back", () => {
      assert(
        content.dataset.owner === "nav.base" && !entries.has("nav.alt"),
        "base fallback and metadata disposal",
      );
    });
    await stop("nav.base");
    check("missing-route-falls-back", () => {
      assert(content.dataset.owner === "nav.notes", "notes fallback");
    });
    await stop("nav.notes");
    check("all-stopped-management", () => {
      assert(
        !mounted &&
          host.views().length === 0 &&
          entries.size === 0 &&
          document.activeElement === management,
        "empty and management focus",
      );
    });
    await restore();
    const old = content.querySelector<HTMLButtonElement>(
      "[data-testid=increment]",
    )!;
    await navigate("notes");
    await navigate("home");
    const before = counts.get("nav.alt")!.clicks;
    old.click();
    content
      .querySelector<HTMLButtonElement>("[data-testid=increment]")!
      .click();
    check("restore-single-listener", () => {
      assert(
        counts.get("nav.alt")!.clicks === before + 1,
        "old detached listener removed and current single listener",
      );
    });
    const beforeMounts = [...counts.values()].reduce(
      (sum, c) => sum + c.mounts,
      0,
    );
    failClose = true;
    let rejected = false;
    try {
      await navigate("notes");
    } catch {
      rejected = true;
    }
    let retryRejected = false;
    try {
      await restore();
    } catch {
      retryRejected = true;
    }
    check("cleanup-failure-latched-management", () => {
      assert(
        rejected &&
          retryRejected &&
          locked &&
          content.inert &&
          document.querySelector<HTMLButtonElement>("#restore")!.disabled &&
          !management.disabled &&
          document.activeElement === management &&
          [...counts.values()].reduce((sum, c) => sum + c.mounts, 0) ===
            beforeMounts,
        "no replacement after cleanup failure",
      );
      management.click();
      assert(
        document.activeElement === document.querySelector("#management-title"),
        "management remains operable",
      );
    });
  } catch (error) {
    if (checks.every((check) => check.passed))
      checks.push({ name: "operation", passed: false, error: String(error) });
  }
  result.textContent = JSON.stringify(
    {
      passed: checks.length === 8 && checks.every((check) => check.passed),
      checks,
      limitations,
    },
    null,
    2,
  );
}
runButton.addEventListener("click", () => {
  if (running || locked) return;
  running = true;
  runButton.disabled = true;
  void enqueue(acceptance)
    .catch((error) => {
      result.textContent = JSON.stringify({
        passed: false,
        checks: [],
        limitations: [String(error)],
      });
    })
    .finally(() => {
      running = false;
      runButton.textContent = "验收结束（重载可重跑）";
    });
});
async function boot() {
  host.install(registry);
  host.install(contribution("nav.base", "home", 0, "基础工作台"));
  host.install(contribution("nav.alt", "home", 10, "专注工作台"));
  host.install(contribution("nav.notes", "notes", 0, "工作笔记"));
  await host.start("nav.registry");
  await restore();
}
runButton.disabled = true;
void enqueue(boot)
  .then(() => {
    runButton.disabled = false;
  })
  .catch((error) => {
    reportError(error);
    result.textContent = JSON.stringify({
      passed: false,
      checks: [],
      limitations: [String(error)],
    });
  });
