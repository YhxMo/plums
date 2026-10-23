import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import config from "../src-tauri/tauri.conf.json";
import capability from "../src-tauri/capabilities/main.json";

it("keeps native control positioning under AppKit ownership", () => {
  const window = config.app.windows.find((window) => window.label === "main")!;
  expect(window).not.toHaveProperty("trafficLightPosition");
  expect(window.titleBarStyle).toBe("Overlay");
  expect(window.hiddenTitle).toBe(true);
  expect(window).not.toHaveProperty("decorations", false);
});

it("leaves native button visibility to AppKit without lifecycle overrides", () => {
  const source = readFileSync("src-tauri/src/lib.rs", "utf8");
  expect(source).not.toContain("window_chrome");
  expect(source).not.toContain("setHidden");
  expect(source).toContain("NSControlSize::Small");
});

it("does not add explicit permissions for custom window controls", () => {
  for (const command of [
    "close",
    "minimize",
    "set-fullscreen",
    "is-fullscreen",
  ])
    expect(capability.permissions).not.toContain(
      `core:window:allow-${command}`,
    );
  expect(capability.permissions).toContain("core:window:allow-start-dragging");
  expect(capability.permissions).toContain(
    "core:window:allow-internal-toggle-maximize",
  );
});
