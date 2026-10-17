import { beforeEach, expect, test, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { ExtensionContext } from "../modules/sdk";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: bridge.invoke,
}));
import { PlatformAdapter } from "../src/platform";
beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) =>
    command === "document_supported" ? true : undefined,
  );
});
async function setup() {
  const a = new PlatformAdapter();
  await a.initializeDocuments();
  await a.grant("extension.reader", ["document.read"]);
  return a;
}
test("native capability is opt-in after successful support probe and denied without grant", async () => {
  const a = new PlatformAdapter();
  expect(a.available("document.read")).toBe(false);
  await a.initializeDocuments();
  expect(a.available("document.read")).toBe(true);
  await expect(a.selectDocuments("extension.reader")).rejects.toThrow(
    "Permission denied",
  );
});
test("keeps a failed native probe distinct from an unsupported platform", async () => {
  bridge.invoke.mockRejectedValueOnce(new Error("ipc unavailable"));
  const a = new PlatformAdapter();
  await a.initializeDocuments();
  expect(a.available("document.read")).toBe(false);
  expect(a.documentsInitializationError).toBe("ipc unavailable");
});
test("keeps an empty probe failure observable", async () => {
  bridge.invoke.mockRejectedValueOnce(new Error(""));
  const adapter = new PlatformAdapter();
  await adapter.initializeDocuments();
  expect(adapter.documentsInitializationError).toBe("初始化探测失败");
  expect(adapter.available("document.read")).toBe(false);
});
test("cancelled native selection discards and revokes a late handle", async () => {
  const a = await setup();
  let finish!: (v: unknown) => void;
  bridge.invoke.mockImplementation((command: string) =>
    command === "document_select"
      ? new Promise((r) => {
          finish = r;
        })
      : Promise.resolve(),
  );
  const c = new AbortController();
  const selection = a.selectDocuments("extension.reader", false, c.signal);
  c.abort();
  expect(await selection).toEqual({ status: "cancelled" });
  finish({
    status: "selected",
    documents: [{ handle: "late", name: "test.txt" }],
  });
  await vi.waitFor(() =>
    expect(bridge.invoke).toHaveBeenCalledWith("document_revoke", {
      owner: "extension.reader",
      handle: "late",
    }),
  );
});
test("revocation prevents late native read delivery", async () => {
  const a = await setup();
  let finish!: (v: unknown) => void;
  bridge.invoke.mockImplementation((command: string) =>
    command === "document_read"
      ? new Promise((r) => {
          finish = r;
        })
      : Promise.resolve(),
  );
  const read = a.call("extension.reader", "document.read", {
    handle: "test",
    maxBytes: 4,
  });
  await a.revokeDocument("extension.reader", "test");
  finish({ status: "read", text: "plum", bytes: 4 });
  expect(await read).toEqual({ status: "cancelled" });
});
test("lost native document receipt is unknown and does not retry", async () => {
  const a = await setup();
  bridge.invoke.mockRejectedValue(Error("private native path"));
  expect(
    await a.call("extension.reader", "document.read", {
      handle: "test",
      maxBytes: 4,
    }),
  ).toEqual({ status: "unknown" });
  expect(
    bridge.invoke.mock.calls.filter((c) => c[0] === "document_read"),
  ).toHaveLength(1);
});
test("Host stop releases documents, retains state grants and rejects old context", async () => {
  const a = await setup();
  const host = new Host(a);
  let ctx!: ExtensionContext;
  host.install({
    manifest: {
      id: "reader",
      version: "1",
      apiVersion: 1,
      capabilities: ["document.read", "state.read"],
    },
    activate(c) {
      ctx = c;
    },
  });
  await host.grant("reader", ["document.read", "state.read"]);
  await host.start("reader");
  bridge.invoke.mockClear();
  await host.stop("reader");
  expect(bridge.invoke).toHaveBeenCalledWith("document_revoke", {
    owner: "extension.reader",
  });
  await expect(
    ctx.platform("document.read", { handle: "old", maxBytes: 4 }),
  ).rejects.toThrow("Extension stopped");
  expect(bridge.invoke.mock.calls.some((c) => c[0] === "platform_grant")).toBe(
    false,
  );
});
test("unknown revocation locks document access and is not reported as successful cleanup", async () => {
  const a = await setup();
  bridge.invoke.mockRejectedValueOnce(Error("closed"));
  await expect(a.release("extension.reader")).rejects.toThrow("撤销结果待确认");
  await expect(a.selectDocuments("extension.reader")).rejects.toThrow(
    "Permission denied",
  );
});

test("regrant cannot clear unknown cleanup; confirmed owner-wide revoke recovers", async () => {
  const a = await setup();
  bridge.invoke.mockRejectedValueOnce(Error("closed"));
  await expect(a.release("extension.reader")).rejects.toThrow("撤销结果待确认");
  await a.grant("extension.reader", ["document.read"]);
  await expect(a.selectDocuments("extension.reader")).rejects.toThrow(
    "Permission denied",
  );
  await a.revokeDocument("extension.reader");
  bridge.invoke.mockResolvedValueOnce({ status: "cancelled" });
  expect(await a.selectDocuments("extension.reader")).toEqual({
    status: "cancelled",
  });
});

test("overlapping revokes are serialized and any unknown failure stays latched", async () => {
  const a = await setup();
  let first!: () => void, second!: (e: Error) => void;
  let n = 0;
  bridge.invoke.mockImplementation((command: string) =>
    command === "document_revoke"
      ? new Promise<void>((ok, no) => {
          if (n++ === 0) first = ok;
          else second = no;
        })
      : Promise.resolve(),
  );
  const early = a.revokeDocument("extension.reader");
  const late = a.revokeDocument("extension.reader", "one");
  await vi.waitFor(() => expect(n).toBe(1));
  await expect(a.selectDocuments("extension.reader")).rejects.toThrow(
    "Permission denied",
  );
  first();
  await early;
  await vi.waitFor(() => expect(n).toBe(2));
  await expect(a.selectDocuments("extension.reader")).rejects.toThrow(
    "Permission denied",
  );
  second(Error("closed"));
  await expect(late).rejects.toThrow("撤销结果待确认");
  await expect(a.selectDocuments("extension.reader")).rejects.toThrow(
    "Permission denied",
  );
});
test("a successful different-handle revoke cannot clear an earlier unknown failure", async () => {
  const a = await setup();
  bridge.invoke.mockRejectedValueOnce(Error("closed"));
  const first = a.revokeDocument("extension.reader", "one");
  const second = a.revokeDocument("extension.reader", "two");
  await expect(first).rejects.toThrow("撤销结果待确认");
  await second;
  await expect(a.selectDocuments("extension.reader")).rejects.toThrow(
    "Permission denied",
  );
  await a.revokeDocument("extension.reader");
  bridge.invoke.mockResolvedValueOnce({ status: "cancelled" });
  expect(await a.selectDocuments("extension.reader")).toEqual({
    status: "cancelled",
  });
});
