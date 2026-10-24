import { invokeNative as invoke } from "../../src/native/invoke";
import { Host } from "../../modules/extension-host/host";
import { applyTheme } from "../../modules/shell/theme";
import { PlatformAdapter } from "../../src/platform";
import type { ExtensionContext, StoredState } from "../../modules/sdk";
import { loadExtension } from "../../modules/extension-host/definition";
import "../../src/styles.css";
import "./style.css";

// The two theme samples, loaded from their folders as the app loads them.
const ocean = await loadExtension(
  new URL("/samples/theme-ocean/", location.href).href,
);
const ink = await loadExtension(
  new URL("/samples/theme-ink/", location.href).href,
);

const adapter = new PlatformAdapter();
const host = new Host(adapter);
const root = document.documentElement;
const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = byId("status"),
  choices = byId("choices"),
  result = byId("result");
const owner = "host.theme-probe";
let selected: string | null = null,
  saved: StoredState | null = null;
let oldInk!: ExtensionContext;
const fallback = "light";
function render() {
  const themes = host.themes();
  const active = themes.find((t) => t.id === selected);
  applyTheme(root, fallback, active);
  status.textContent = active
    ? `当前外观：${active.label}`
    : selected
      ? "所选主题暂不可用，已恢复内置外观。"
      : "当前外观：内置浅色";
  choices.replaceChildren();
  for (const item of [{ id: null, label: "内置外观" }, ...themes]) {
    const button = document.createElement("button");
    button.className = "secondary";
    button.textContent = item.label;
    button.setAttribute(
      "aria-pressed",
      String(item.id === (active?.id ?? null)),
    );
    button.onclick = () => {
      selected = item.id;
      render();
    };
    choices.append(button);
  }
}
function pick(id: string | null) {
  selected = id;
  render();
}
function palette(id: string) {
  return host.themes().find((t) => t.id === id)!;
}
function rgb(color: string) {
  const n = parseInt(color.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}
async function savePreference() {
  saved = (await adapter.call(owner, "state.write", {
    revision: saved?.revision ?? 0,
    value: { themeId: "sample.ink" },
  })) as StoredState;
}
async function run() {
  const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, condition: boolean) => {
    checks.push({ name, passed: condition });
    if (!condition) throw Error(name);
  };
  await adapter.grant(owner, ["state.read", "state.write", "platform.info"]);
  saved = (await adapter.call(owner, "state.read")) as StoredState | null;
  const restored =
    (saved?.value as { themeId?: string } | undefined)?.themeId ===
    "sample.ink";
  host.install(ocean);
  host.install({
    ...ink,
    activate(ctx) {
      oldInk = ctx;
      ink.activate(ctx);
    },
  });
  host.install({
    manifest: { id: "theme.panel", version: "1", apiVersion: 1 },
    activate(ctx) {
      ctx.view({
        id: "theme.panel",
        label: "今日事项",
        mount(container) {
          const heading = document.createElement("h2");
          heading.textContent = "今天的一小步";
          const p = document.createElement("p");
          p.className = "muted";
          p.textContent = "独立于聊天界面的公开视图，沿用当前语义颜色。";
          const button = document.createElement("button");
          button.textContent = "完成一项";
          const count = document.createElement("p");
          let n = 0;
          count.textContent = "已完成 0 项";
          button.onclick = () => {
            count.textContent = `已完成 ${++n} 项`;
          };
          container.replaceChildren(heading, p, button, count);
          return () => {
            button.onclick = null;
            container.replaceChildren();
          };
        },
      });
    },
  });
  host.subscribe(render);
  await host.start(ocean.manifest.id);
  await host.start(ink.manifest.id);
  await host.start("theme.panel");
  host.mountView("theme.panel", byId("content"));
  if (restored) pick("sample.ink");
  const coldRestartRestored = restored && root.dataset.themeId === "sample.ink";
  check("cold-start-selection", !restored || coldRestartRestored);
  check("two-public-authors", host.themes().length === 2);
  pick("sample.ocean");
  const oceanColor = palette("sample.ocean").colors;
  check(
    "light-colors-on-public-view",
    getComputedStyle(byId("content").querySelector("button")!)
      .backgroundColor === rgb(oceanColor.accent) &&
      root.dataset.theme === "light",
  );
  pick("sample.ink");
  check(
    "dark-appearance-and-colors",
    root.dataset.theme === "dark" &&
      root.style.getPropertyValue("--text") ===
        palette("sample.ink").colors.text,
  );
  if (adapter.kind === "native") {
    await invoke("shell_set_theme", { theme: "dark" });
    // Only proves the adapter invoke resolved; window/system appearance is
    // checked manually, so this is not a receipt assertion.
    check("appearance-adapter-invoke-completed", true);
  }
  const detached = host.themes()[0];
  const before = palette(detached.id).colors.text;
  detached.colors.text = "#000000";
  check(
    "query-cannot-mutate-theme",
    palette(detached.id).colors.text === before,
  );
  host.install({
    manifest: { id: "theme.duplicate", version: "1", apiVersion: 1 },
    activate(ctx) {
      const {
        owner: _owner,
        generation: _generation,
        ...theme
      } = palette("sample.ink");
      ctx.theme(theme);
    },
  });
  let duplicate = false;
  try {
    await host.start("theme.duplicate");
  } catch (e) {
    duplicate = String(e).includes("Theme conflict");
  }
  check(
    "duplicate-id-preserves-owner",
    duplicate && palette("sample.ink").owner === ink.manifest.id,
  );
  host.install({
    manifest: { id: "theme.invalid", version: "1", apiVersion: 1 },
    activate(ctx) {
      const {
        owner: _owner,
        generation: _generation,
        ...theme
      } = palette("sample.ink");
      ctx.theme({
        ...theme,
        id: "theme.invalid",
        colors: { ...theme.colors, text: "red;display:none" },
      });
    },
  });
  let invalid = false;
  try {
    await host.start("theme.invalid");
  } catch {
    invalid = true;
  }
  check("invalid-css-rejected", invalid && host.themes().length === 2);
  const inkTheme = palette("sample.ink");
  host.install({
    manifest: { id: "theme.partial", version: "1", apiVersion: 1 },
    activate(ctx) {
      const { owner: _o, generation: _g, ...base } = inkTheme;
      ctx.theme({ ...base, id: "theme.partial" });
      throw Error("Synthetic activation failure");
    },
  });
  try {
    await host.start("theme.partial");
  } catch {
    /* expected */
  }
  check(
    "partial-activation-withdrawn",
    !host.themes().some((t) => t.id === "theme.partial"),
  );
  await host.stop(ink.manifest.id);
  check(
    "stop-restores-built-in",
    !root.hasAttribute("data-theme-id") &&
      root.dataset.theme === fallback &&
      root.style.getPropertyValue("--accent") === "",
  );
  let stale = false;
  try {
    oldInk.theme({
      id: "late",
      label: "late",
      appearance: "dark",
      colors: inkTheme.colors,
    });
  } catch (e) {
    stale = String(e).includes("Extension stopped");
  }
  check("old-context-rejected", stale);
  await host.start(ink.manifest.id);
  check("restart-restores-preference", root.dataset.themeId === "sample.ink");
  await host.stop(ink.manifest.id);
  await host.uninstall(ink.manifest.id);
  check(
    "uninstall-falls-back",
    !root.dataset.themeId && !host.ids().includes(ink.manifest.id),
  );
  host.install(ink);
  await host.start(ink.manifest.id);
  await savePreference();
  const receipt = (await adapter.call(owner, "state.read")) as StoredState;
  check(
    "native-preference-receipt",
    (receipt.value as { themeId: string }).themeId === "sample.ink",
  );
  check(
    "management-survives",
    !byId<HTMLButtonElement>("manage").disabled &&
      byId("content").querySelectorAll("button").length === 1,
  );
  const info = await adapter.call(owner, "platform.info");
  const report = {
    passed: true,
    platform: adapter.kind,
    info,
    coldRestartRestored,
    checks,
    selected: root.dataset.themeId,
  };
  result.textContent = JSON.stringify(report, null, 2);
  await adapter.grant("host.theme-report", ["state.read", "state.write"]);
  const previous = (await adapter.call(
    "host.theme-report",
    "state.read",
  )) as StoredState | null;
  await adapter.call("host.theme-report", "state.write", {
    revision: previous?.revision ?? 0,
    value: report,
  });
  return report;
}
byId("manage").onclick = () => {
  byId("management").textContent =
    `可管理 ${host.ids().length} 个隔离扩展；无真实文件、账户或凭据访问。`;
  byId("management").focus();
};
byId("stop").onclick = () => {
  const active = host.themes().find((t) => t.id === selected);
  if (active) void host.stop(active.owner);
};
byId("restore").onclick = () => {
  void host.start(ink.manifest.id);
};
byId("save").onclick = () => {
  void savePreference().then(() => {
    byId("management").textContent = "墨夜偏好已保存，冷启动可恢复。";
  });
};
Object.assign(window, {
  __themeProbe: {
    host,
    run,
    pick,
    snapshot: () => ({
      selected,
      active: root.dataset.themeId,
      appearance: root.dataset.theme,
      text: result.textContent,
    }),
  },
});
void run().catch((e) => {
  result.textContent = JSON.stringify({ passed: false, error: String(e) });
});
