import { afterEach, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "../src/shell/SettingsPanel";

afterEach(() => vi.unstubAllEnvs());
const props: ComponentProps<typeof SettingsPanel> = {
  busy: false,
  operate: async (run) => {
    await run();
  },
  views: [],
  activeView: "",
  selectLayout: async () => {},
  appearance: {
    appearance: "dark",
    themes: [],
    themeId: null,
    selectTheme: async () => {},
    toggleTheme: async () => {},
  },
  openManager: () => {},
  openAbout: () => {},
};
it.each([false, true])(
  "only advertises diagnostics when available (DEV=%s)",
  (dev) => {
    vi.stubEnv("DEV", dev);
    const html = renderToStaticMarkup(createElement(SettingsPanel, props));
    expect(html.includes("打开诊断工具")).toBe(dev);
    expect(html.includes("数据与诊断")).toBe(dev);
    expect(html).toContain("管理扩展");
    // What the app menu used to hold now lives here.
    expect(html).toContain("切换到浅色模式");
    expect(html).toContain("关于 Plums");
  },
);
