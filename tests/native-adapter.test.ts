import { beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: bridge.invoke,
}));
import { PlatformAdapter } from "../src/platform";

beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.invoke.mockResolvedValue(undefined);
});

it("does not dispatch a native write that was cancelled before the commit segment", async () => {
  const adapter = new PlatformAdapter();
  await adapter.grant("sample", ["state.write"]);
  bridge.invoke.mockClear();
  const controller = new AbortController();
  controller.abort();
  await expect(
    adapter.call(
      "sample",
      "state.write",
      { revision: 0, value: 1 },
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(bridge.invoke).not.toHaveBeenCalled();
});

it("keeps a confirmed native commit receipt after cancellation was requested", async () => {
  const adapter = new PlatformAdapter();
  await adapter.grant("sample", ["state.write"]);
  let release!: (value: unknown) => void;
  bridge.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController();
  const operation = adapter.call(
    "sample",
    "state.write",
    { revision: 0, value: 1 },
    controller.signal,
  );
  controller.abort();
  release({ schema: 1, revision: 1, value: 1 });
  await expect(operation).resolves.toMatchObject({ revision: 1, value: 1 });
});

it("preserves the explicit native rejection outcome", async () => {
  const adapter = new PlatformAdapter();
  await adapter.grant("sample", ["state.write"]);
  bridge.invoke.mockRejectedValueOnce({
    message: "State is corrupt; original preserved",
    outcome: "not-committed",
  });
  await expect(
    adapter.call("sample", "state.write", { revision: 0, value: 1 }),
  ).rejects.toMatchObject({
    message: "State is corrupt; original preserved",
    outcome: "not-committed",
  });
});

it("reports a lost native receipt as unknown rather than cancelled or uncommitted", async () => {
  const adapter = new PlatformAdapter();
  await adapter.grant("sample", ["state.write"]);
  bridge.invoke.mockRejectedValueOnce(new Error("transport closed"));
  await expect(
    adapter.call("sample", "state.write", { revision: 0, value: 1 }),
  ).rejects.toMatchObject({ outcome: "unknown" });
});

it("keeps the proposed document capability unavailable in production", async () => {
  const adapter = new PlatformAdapter();
  expect(adapter.available("document.read")).toBe(false);
  await expect(adapter.grant("sample", ["document.read"])).rejects.toThrow(
    "Unknown capability",
  );
  await expect(
    adapter.call("sample", "document.read", {
      handle: "synthetic",
      maxBytes: 4,
    }),
  ).rejects.toThrow("Permission denied");
  expect(bridge.invoke).not.toHaveBeenCalled();
});
