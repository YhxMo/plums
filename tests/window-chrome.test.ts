import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import config from "../src-tauri/tauri.conf.json";
import capability from "../src-tauri/capabilities/main.json";
import { breakpoints } from "../src/components/breakpoints";

const window = config.app.windows.find((window) => window.label === "main")!;

it("places the native regular traffic lights in the rail's top", () => {
  expect(window.titleBarStyle).toBe("Overlay");
  expect(window.hiddenTitle).toBe(true);
  expect(window).not.toHaveProperty("decorations", false);
  expect(window.trafficLightPosition).toEqual({ x: 7, y: 20 });
  const source = readFileSync("src-tauri/src/lib.rs", "utf8");
  // Regular size, not shrunk; AppKit's reset of the 20 pt pitch is undone.
  expect(source).not.toContain("NSControlSize");
  expect(source).toContain("window_frame::");
  expect(source).not.toContain("setHidden");
});

it("lets the rail show the native sidebar material", () => {
  expect(window.transparent).toBe(true);
  expect(window.windowEffects).toEqual({ effects: ["sidebar"] });
});

it("opens at 940 × 640 and never narrower than the three-column layout", () => {
  expect([window.width, window.height]).toEqual([940, 640]);
  expect(window.minWidth).toBe(parseFloat(breakpoints.md) * 16);
});

it("drives no window commands from the WebView beyond dragging", () => {
  for (const command of [
    "close",
    "minimize",
    "set-fullscreen",
    "is-fullscreen",
    "set-size",
  ])
    expect(capability.permissions).not.toContain(
      `core:window:allow-${command}`,
    );
  expect(
    capability.permissions.filter((p) => p.startsWith("window-state")),
  ).toEqual([]);
  expect(capability.permissions).toContain("core:window:allow-start-dragging");
  expect(capability.permissions).toContain(
    "core:window:allow-internal-toggle-maximize",
  );
});
