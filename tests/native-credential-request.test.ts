import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
const { PlatformAdapter } = await import("../src/platform");

const owner = "extension.connector.models";
const request = { version: 1, binding: "text", body: "{}" };
/** A 1M-token conversation is a few MB; the cap leaves room for it. */
const MiB8 = 8 * 1024 * 1024;
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

it("passes a body of exactly 8 MiB to native code", async () => {
  const adapter = await ready();
  const body = "x".repeat(MiB8);
  await adapter.call(owner, "credential.request", { ...request, body });
  expect(calls("credential_request")[0][1].body).toBe(body);
});

it("reads a plain path on the bound site with GET and no body", async () => {
  const adapter = await ready();
  await adapter.call(owner, "credential.request", {
    version: 1,
    binding: "text",
    method: "GET",
    path: "/v1/models",
  });
  const [[, args]] = calls("credential_request");
  expect(args).toMatchObject({
    owner,
    binding: "text",
    body: "",
    path: "/v1/models",
  });
  for (const path of [
    "v1/models",
    "//elsewhere.invalid/models",
    "/v1/../models",
    "/v1//models",
    "/v1/models?x=1",
    "/v1/%2e%2e",
    `/${"a".repeat(256)}`,
  ])
    await expect(
      adapter.call(owner, "credential.request", {
        version: 1,
        binding: "text",
        method: "GET",
        path,
      }),
    ).rejects.toMatchObject({ outcome: "not-dispatched" });
  for (const payload of [
    { ...request, method: "GET", path: "/v1/models" },
    { ...request, method: "PUT" },
    { ...request, method: "POST" },
    { version: 1, binding: "text", path: "/v1/models" },
  ])
    await expect(
      adapter.call(owner, "credential.request", payload),
    ).rejects.toMatchObject({ outcome: "not-dispatched" });
  expect(calls("credential_request")).toHaveLength(1);
});

it("rejects malformed or oversized payloads before reaching native code", async () => {
  const adapter = await ready();
  for (const payload of [
    null,
    { ...request, version: 2 },
    { ...request, binding: 1 },
    { ...request, target: "https://elsewhere.invalid" },
    { ...request, body: "字".repeat(MiB8 / 3 + 1) },
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
