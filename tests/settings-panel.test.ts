import { afterEach, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { SettingsPanel } from "../src/shell/SettingsPanel";
import { VERSION } from "../src/shell/version";

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
    selected: "dark",
    themes: [],
    themeId: null,
    selectTheme: async () => {},
    selectAppearance: async () => {},
  },
  openManager: () => {},
  openAbout: () => {},
};
it.each([false, true])(
  "groups how the app looks, then diagnostics (DEV=%s) and about",
  (dev) => {
    vi.stubEnv("DEV", dev);
    const html = renderToStaticMarkup(createElement(SettingsPanel, props));
    expect(html.includes("诊断工具")).toBe(dev);
    expect(html).toContain('aria-label="外观"');
    expect(html).toContain('aria-label="颜色"');
    for (const label of ["跟随系统", "浅色", "深色"])
      expect(html).toContain(label);
    expect(html).toContain("关于 Plums");
    expect(html).toContain(VERSION);
    // Extensions have their own place on the rail; no detour from here.
    expect(html).not.toContain("管理扩展");
  },
);

it("shows the version package.json has", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(VERSION).toBe(manifest.version);
});
