import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
const { PlatformAdapter } = await import("../src/platform");

beforeEach(() => invoke.mockReset().mockResolvedValue(undefined));

async function write(failure: unknown) {
  const adapter = new PlatformAdapter();
  await adapter.grant("extension.sample", ["state.write"]);
  invoke.mockRejectedValueOnce(failure);
  return adapter
    .call("extension.sample", "state.write", { revision: 0, value: 1 })
    .catch((error: unknown) => error);
}

it("keeps a native rejection retryable", async () => {
  expect(
    await write({ code: "state-write", outcome: "not-committed" }),
  ).toMatchObject({ code: "state-write", outcome: "not-committed" });
});

it("reports a write that may be on disk as unknown with its reason", async () => {
  const error = await write({ code: "state-sync", outcome: "unknown" });
  expect(error).toMatchObject({ code: "state-sync", outcome: "unknown" });
  expect((error as Error).message).toContain("未确认落盘");
});
