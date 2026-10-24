import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import capability from "../src-tauri/capabilities/main.json";

const invoke = vi.hoisted(() => vi.fn());
const native = vi.hoisted(() => ({ value: true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => native.value,
}));
const { PlatformAdapter } = await import("../src/platform");
const { capabilityLabel } = await import("../modules/shell/capabilities");

const owner = "extension.ui.agents";
const url = "https://example.com/guide?q=1#install";
const calls = () =>
  invoke.mock.calls.filter(([command]) => command === "link_open");

beforeEach(() => {
  native.value = true;
  invoke.mockReset().mockResolvedValue(null);
});
async function ready() {
  const adapter = new PlatformAdapter();
  await adapter.grant(owner, ["link.open"]);
  return adapter;
}

it("tells the user links open in the browser", () => {
  expect(capabilityLabel("link.open")).toBe(
    "在浏览器中打开网页链接（仅 https）",
  );
});

it("opens an https link natively for a granted owner", async () => {
  const adapter = await ready();
  expect(adapter.available("link.open")).toBe(true);
  await expect(
    adapter.call(owner, "link.open", { version: 1, url }),
  ).resolves.toBeUndefined();
  expect(calls()).toEqual([["link_open", { owner, url }]]);
});

it("refuses other schemes and malformed requests before calling native", async () => {
  const adapter = await ready();
  for (const payload of [
    { version: 1, url: "http://example.com" },
    { version: 1, url: "javascript:alert(1)" },
    { version: 1, url: "file:///etc/hosts" },
    { version: 1, url: "https://user:pass@example.com/" },
    { version: 1, url: `https://example.com/${"a".repeat(2048)}` },
    { version: 2, url },
    { url },
    { version: 1, url, target: "_self" },
    null,
  ])
    await expect(adapter.call(owner, "link.open", payload)).rejects.toThrow(
      "只能打开 https 链接",
    );
  expect(calls()).toHaveLength(0);
});

it("needs the grant", async () => {
  const adapter = new PlatformAdapter();
  await expect(
    adapter.call(owner, "link.open", { version: 1, url }),
  ).rejects.toThrow("Permission denied: link.open");
  expect(calls()).toHaveLength(0);
});

it("opens a separate tab without an opener in the browser preview", async () => {
  native.value = false;
  const open = vi.fn(() => null);
  vi.stubGlobal("window", { open });
  try {
    const adapter = await ready();
    expect(adapter.available("link.open")).toBe(true);
    await adapter.call(owner, "link.open", { version: 1, url });
    expect(open.mock.calls).toEqual([[url, "_blank", "noopener,noreferrer"]]);
    expect(calls()).toHaveLength(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("reports a native failure without the native code", async () => {
  const adapter = await ready();
  invoke.mockRejectedValueOnce("unavailable");
  await expect(
    adapter.call(owner, "link.open", { version: 1, url }),
  ).rejects.toThrow("未能在浏览器中打开链接。");
});

it("keeps the opener out of the WebView", () => {
  const permissions = JSON.stringify(capability.permissions);
  expect(permissions).not.toContain("opener");
  expect(readFileSync("src-tauri/src/lib.rs", "utf8")).not.toContain(
    "tauri_plugin_opener::init",
  );
});
