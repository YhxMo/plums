import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
const { PlatformAdapter } = await import("../src/platform");

const owner = "extension.connector.deepseek";
const request = { version: 1, binding: "text", body: "{}" };
const calls = (name: string) =>
  invoke.mock.calls.filter(([command]) => command === name);

beforeEach(() =>
  invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "credential_supported") return true;
    if (command === "credential_inventory") return [];
    if (command === "credential_request") return { status: 200, body: "ok" };
    return null;
  }),
);
async function ready() {
  const adapter = new PlatformAdapter();
  await adapter.credentials.initialize(true);
  await adapter.grant(owner, ["credential.request"]);
  return adapter;
}

it("is available only when the native credential store is", async () => {
  const adapter = new PlatformAdapter();
  expect(adapter.available("credential.request")).toBe(false);
  await adapter.credentials.initialize(true);
  expect(adapter.available("credential.request")).toBe(true);
});

it("sends the alias and body with a fresh request id and returns the reply", async () => {
  const adapter = await ready();
  await expect(
    adapter.call(owner, "credential.request", request),
  ).resolves.toEqual({ status: 200, body: "ok" });
  const [[, args]] = calls("credential_request");
  expect(args).toMatchObject({ owner, binding: "text", body: "{}" });
  expect(args.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(Object.keys(args).sort()).toEqual(["binding", "body", "id", "owner"]);
});

it("rejects malformed or oversized payloads before reaching native code", async () => {
  const adapter = await ready();
  for (const payload of [
    null,
    { ...request, version: 2 },
    { ...request, binding: 1 },
    { ...request, target: "https://elsewhere.invalid" },
    { ...request, body: "字".repeat(21846) },
  ])
    await expect(
      adapter.call(owner, "credential.request", payload),
    ).rejects.toMatchObject({ outcome: "not-dispatched" });
  expect(calls("credential_request")).toHaveLength(0);
});

it("keeps the native outcome and explains it", async () => {
  const adapter = await ready();
  invoke.mockRejectedValueOnce({
    code: "not-ready",
    outcome: "not-dispatched",
  });
  const refused = await adapter
    .call(owner, "credential.request", request)
    .catch((error: unknown) => error);
  expect(refused).toMatchObject({
    code: "not-ready",
    outcome: "not-dispatched",
  });
  expect((refused as Error).message).toContain("API Key");
  invoke.mockRejectedValueOnce({ code: "timeout", outcome: "unknown" });
  await expect(
    adapter.call(owner, "credential.request", request),
  ).rejects.toMatchObject({ code: "timeout", outcome: "unknown" });
  invoke.mockRejectedValueOnce("bridge lost");
  await expect(
    adapter.call(owner, "credential.request", request),
  ).rejects.toMatchObject({ outcome: "unknown" });
});

it("forwards cancellation to the same native request", async () => {
  const adapter = await ready();
  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const controller = new AbortController();
  const pending = adapter.call(
    owner,
    "credential.request",
    request,
    controller.signal,
  );
  controller.abort();
  finish(Promise.reject({ code: "cancelled", outcome: "unknown" }));
  await expect(pending).rejects.toMatchObject({ outcome: "unknown" });
  const [[, sent]] = calls("credential_request");
  expect(calls("credential_abort")).toEqual([
    ["credential_abort", { owner, id: sent.id }],
  ]);
});

it("releases confirmations when the extension stops", async () => {
  const adapter = await ready();
  await adapter.release(owner);
  expect(calls("credential_release")).toEqual([
    ["credential_release", { owner }],
  ]);
});
