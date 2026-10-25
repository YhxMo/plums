import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const native = vi.hoisted(() => ({ value: true }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => native.value,
}));
const { PlatformAdapter } = await import("../src/platform");
const { capabilityLabel } = await import("../modules/shell/capabilities");
const { MAX_SAVE_BYTES } = await import("../modules/sdk/files");

const owner = "extension.ui.agents";
const data = btoa("png bytes");
const calls = () =>
  invoke.mock.calls.filter(([command]) => command === "file_save");

beforeEach(() => {
  native.value = true;
  invoke.mockReset().mockResolvedValue("saved");
});
afterEach(() => vi.unstubAllGlobals());
async function ready() {
  const adapter = new PlatformAdapter();
  await adapter.grant(owner, ["file.save"]);
  return adapter;
}

it("tells the user files are saved where they choose", () => {
  expect(capabilityLabel("file.save")).toBe("把文件保存到你选择的位置");
});

it("asks the system where to save, then writes the bytes there", async () => {
  const adapter = await ready();
  expect(adapter.available("file.save")).toBe(true);
  await expect(
    adapter.call(owner, "file.save", {
      version: 1,
      name: "写作助手.png",
      data,
    }),
  ).resolves.toEqual({ saved: true });
  expect(calls()).toEqual([
    ["file_save", { owner, name: "写作助手.png", data }],
  ]);
  invoke.mockResolvedValueOnce("cancelled");
  await expect(
    adapter.call(owner, "file.save", { version: 1, name: "a.plums", data }),
  ).resolves.toEqual({ saved: false });
});

it("refuses other kinds of files, paths and malformed requests before calling native", async () => {
  const adapter = await ready();
  for (const payload of [
    { version: 1, name: "a.exe", data },
    { version: 1, name: "../a.png", data },
    { version: 1, name: "dir/a.png", data },
    { version: 1, name: ".png", data },
    { version: 1, name: `${"长".repeat(200)}.png`, data },
    { version: 1, name: "a.png", data: "not base64!" },
    { version: 1, name: "a.png", data: "A".repeat(MAX_SAVE_BYTES * 2) },
    { version: 2, name: "a.png", data },
    { version: 1, name: "a.png", data, path: "/tmp/a.png" },
    null,
  ])
    await expect(adapter.call(owner, "file.save", payload)).rejects.toThrow(
      "无法保存这个文件",
    );
  expect(calls()).toHaveLength(0);
});

it("needs the grant", async () => {
  const adapter = new PlatformAdapter();
  await expect(
    adapter.call(owner, "file.save", { version: 1, name: "a.png", data }),
  ).rejects.toThrow("Permission denied: file.save");
  expect(calls()).toHaveLength(0);
});

it("downloads the file in the browser preview", async () => {
  native.value = false;
  const click = vi.fn();
  const anchor = { click, href: "", download: "" };
  vi.stubGlobal("document", { createElement: () => anchor });
  const created: Blob[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: (blob: Blob) => {
      created.push(blob);
      return "blob:saved";
    },
    revokeObjectURL: vi.fn(),
  });
  const adapter = await ready();
  await expect(
    adapter.call(owner, "file.save", { version: 1, name: "卡.png", data }),
  ).resolves.toEqual({ saved: true });
  expect(anchor).toMatchObject({ href: "blob:saved", download: "卡.png" });
  expect(click).toHaveBeenCalledOnce();
  expect(await created[0].text()).toBe("png bytes");
  expect(created[0].type).toBe("image/png");
  expect(calls()).toHaveLength(0);
});

it("reports a native failure without the native code", async () => {
  const adapter = await ready();
  invoke.mockRejectedValueOnce("io");
  await expect(
    adapter.call(owner, "file.save", { version: 1, name: "a.png", data }),
  ).rejects.toThrow("文件没有保存。");
});
