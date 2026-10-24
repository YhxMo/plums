import { beforeEach, expect, it, vi } from "vitest";
import { validateDefinition } from "../modules/extension-host/definition";
import { networkOrigin } from "../modules/sdk/network";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
const { PlatformAdapter } = await import("../src/platform");
const { capabilityLabel } = await import("../modules/shell/capabilities");

const owner = "extension.connector.models";
const url = "https://models.dev/api.json";
const calls = (name: string) =>
  invoke.mock.calls.filter(([command]) => command === name);
const definition = (manifest: Record<string, unknown>) => ({
  manifest: { id: "reader", version: "1", apiVersion: 1, ...manifest },
  activate() {},
});

beforeEach(() =>
  invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "network_read") return { status: 200, body: "{}" };
    return null;
  }),
);
async function ready(sources: string[] = ["https://models.dev"]) {
  const adapter = new PlatformAdapter();
  adapter.network.describe = (id) => (id === owner ? sources : undefined);
  await adapter.grant(owner, ["network.read"]);
  return adapter;
}

it("accepts only bare public HTTPS origins, and only with network.read", () => {
  expect(() =>
    validateDefinition(
      definition({
        capabilities: ["network.read"],
        networkSources: ["https://models.dev"],
      }),
    ),
  ).not.toThrow();
  for (const sources of [
    ["https://models.dev/"],
    ["https://models.dev/api.json"],
    ["http://models.dev"],
    ["https://localhost"],
    ["https://127.0.0.1"],
    ["https://models.dev:8443"],
    ["https://Models.dev"],
    ["https://models.dev", "https://models.dev"],
    [],
    Array.from({ length: 9 }, (_, i) => `https://s${i}.example.com`),
  ])
    expect(() =>
      validateDefinition(
        definition({ capabilities: ["network.read"], networkSources: sources }),
      ),
    ).toThrow("Invalid network source declaration");
  // Each needs the other: a capability with nothing to reach, or sources without it.
  expect(() =>
    validateDefinition(definition({ capabilities: ["network.read"] })),
  ).toThrow("Invalid network source declaration");
  expect(() =>
    validateDefinition(definition({ networkSources: ["https://models.dev"] })),
  ).toThrow("Invalid network source declaration");
});

it("names the declared sites in the permission shown to the user", () => {
  expect(
    capabilityLabel("network.read", {
      networkSources: ["https://models.dev", "https://openrouter.ai"],
    }),
  ).toBe("读取公开网络资源（models.dev、openrouter.ai，不带密钥）");
});

it("reads a declared source natively with a fresh id and returns the body", async () => {
  const adapter = await ready();
  expect(adapter.available("network.read")).toBe(true);
  await expect(
    adapter.call(owner, "network.read", { version: 1, url }),
  ).resolves.toEqual({ status: 200, body: "{}" });
  const [[, args]] = calls("network_read");
  expect(args).toMatchObject({ owner, url });
  expect(args.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(Object.keys(args).sort()).toEqual(["id", "owner", "url"]);
});

it.each([
  { version: 1, url: "https://openrouter.ai/api/v1/models" },
  { version: 1, url: "http://models.dev/api.json" },
  { version: 1, url: "https://models.dev/api.json#x" },
  { version: 1, url: "https://user@models.dev/api.json" },
  { version: 1, url: `https://models.dev/${"a".repeat(2048)}` },
  { version: 2, url },
  { version: 1, url, method: "POST" },
  { version: 1 },
  null,
])("refuses %j without calling native code", async (payload) => {
  const adapter = await ready();
  await expect(
    adapter.call(owner, "network.read", payload),
  ).rejects.toMatchObject({
    code: "invalid-request",
    outcome: "not-dispatched",
  });
  expect(calls("network_read")).toHaveLength(0);
});

it("needs the grant", async () => {
  const adapter = new PlatformAdapter();
  adapter.network.describe = () => ["https://models.dev"];
  await expect(
    adapter.call(owner, "network.read", { version: 1, url }),
  ).rejects.toThrow("Permission denied: network.read");
  expect(calls("network_read")).toHaveLength(0);
});

it("forwards cancellation by id and keeps the native outcome", async () => {
  let finish!: (value: unknown) => void;
  invoke.mockImplementation(async (command: string) => {
    if (command === "network_read")
      return new Promise((_, reject) => {
        finish = reject;
      });
    return null;
  });
  const adapter = await ready();
  const controller = new AbortController();
  const read = adapter.call(
    owner,
    "network.read",
    { version: 1, url },
    controller.signal,
  );
  await vi.waitFor(() => expect(calls("network_read")).toHaveLength(1));
  controller.abort();
  const id = calls("network_read")[0][1].id;
  expect(calls("network_abort")[0][1]).toEqual({ owner, id });
  finish({ code: "cancelled", outcome: "unknown" });
  await expect(read).rejects.toMatchObject({
    code: "cancelled",
    outcome: "unknown",
  });
});

it("stopping the extension releases its read in flight", async () => {
  const adapter = await ready();
  await adapter.release(owner);
  expect(calls("network_release")[0][1]).toEqual({ owner });
});

it("derives the origin only for public HTTPS names on the default port", () => {
  expect(networkOrigin("https://models.dev:443/api.json")).toBe(
    "https://models.dev",
  );
  expect(networkOrigin("https://intranet/api.json")).toBeUndefined();
  expect(networkOrigin("https://[::1]/")).toBeUndefined();
});
