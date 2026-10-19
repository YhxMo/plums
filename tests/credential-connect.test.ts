import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
const { PlatformAdapter } = await import("../src/platform");

const owner = "extension.connector.models";
const openai = {
  label: "OpenAI 兼容",
  contentType: "application/json",
  headers: {},
  authentication: { type: "bearer" as const },
};
const view = (alias: string, target: string, revision = 1) => ({
  owner,
  alias,
  source: "内置",
  version: "1",
  declaration: { ...openai, label: "我的连接", target },
  route: { type: "direct" },
  revision,
  status: "ready",
});
let saved: ReturnType<typeof view>[] = [];
const calls = (name: string) =>
  invoke.mock.calls.filter(([command]) => command === name);

beforeEach(() => {
  saved = [];
  invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "credential_supported") return true;
    if (command === "credential_inventory") return saved;
    if (command === "credential_list") return saved;
    if (command === "credential_configure" || command === "credential_delete")
      return { status: "saved" };
    return null;
  });
});
async function ready(protocols = { openai }) {
  const adapter = new PlatformAdapter();
  await adapter.credentials.initialize(true);
  adapter.credentials.describe = (id) =>
    id === owner ? { source: "内置", version: "1", protocols } : undefined;
  await adapter.grant(owner, ["credential.request", "credential.connect"]);
  return adapter;
}
const connect = (
  adapter: InstanceType<typeof PlatformAdapter>,
  payload: unknown,
) => adapter.call(owner, "credential.connect", payload);

it("builds a new connection from the template and the user's target", async () => {
  const adapter = await ready();
  const result = (await connect(adapter, {
    action: "save",
    protocol: "openai",
    label: "Kimi",
    target: "https://api.moonshot.cn/v1/chat/completions",
  })) as { alias: string; status: string };
  expect(result.status).toBe("saved");
  expect(result.alias).toMatch(/^c-[a-z0-9]{8}$/);
  const [[, args]] = calls("credential_configure");
  expect(args).toEqual({
    owner,
    alias: result.alias,
    source: "内置",
    version: "1",
    declaration: {
      ...openai,
      label: "Kimi",
      target: "https://api.moonshot.cn/v1/chat/completions",
    },
    revision: 0,
  });
});

it("lists only its own connections with the protocol they match", async () => {
  saved = [
    view("c-abcdefgh", "https://api.deepseek.com/chat/completions"),
    view("text", "https://static.example/"),
  ];
  const adapter = await ready();
  expect(await connect(adapter, { action: "list" })).toEqual([
    {
      alias: "c-abcdefgh",
      protocol: "openai",
      label: "我的连接",
      target: "https://api.deepseek.com/chat/completions",
      status: "ready",
    },
  ]);
});

it("re-enters an existing connection at its revision and removes it", async () => {
  saved = [view("c-abcdefgh", "https://api.deepseek.com/chat/completions", 3)];
  const adapter = await ready();
  await connect(adapter, {
    action: "save",
    alias: "c-abcdefgh",
    protocol: "openai",
    label: "DeepSeek",
    target: "https://api.deepseek.com/chat/completions",
  });
  expect(calls("credential_configure")[0][1].revision).toBe(3);
  expect(
    await connect(adapter, { action: "remove", alias: "c-abcdefgh" }),
  ).toEqual({ alias: "c-abcdefgh", status: "saved" });
  expect(calls("credential_delete")[0][1]).toEqual({
    owner,
    alias: "c-abcdefgh",
    revision: 3,
  });
});

it.each([
  {
    action: "save",
    protocol: "missing",
    label: "x",
    target: "https://a.example/",
  },
  {
    action: "save",
    protocol: "openai",
    label: "x",
    target: "http://a.example/",
  },
  {
    action: "save",
    protocol: "openai",
    label: "x",
    target: "https://a.example:8443/",
  },
  {
    action: "save",
    protocol: "openai",
    label: "x",
    target: "https://a.example/?k=1",
  },
  {
    action: "save",
    protocol: "openai",
    label: "",
    target: "https://a.example/",
  },
  {
    action: "save",
    protocol: "openai",
    label: "x",
    target: "https://a.example/",
    headers: {},
  },
  {
    action: "save",
    alias: "c-unknown1",
    protocol: "openai",
    label: "x",
    target: "https://a.example/",
  },
  { action: "remove", alias: "text" },
  { action: "list", extra: 1 },
  null,
])("rejects %j without opening a native panel", async (payload) => {
  const adapter = await ready();
  await expect(connect(adapter, payload)).rejects.toMatchObject({
    code: "invalid-request",
  });
  expect(calls("credential_configure")).toHaveLength(0);
  expect(calls("credential_delete")).toHaveLength(0);
});

it("refuses owners without protocols and ungranted callers", async () => {
  const adapter = await ready();
  adapter.credentials.describe = () => undefined;
  await expect(connect(adapter, { action: "list" })).rejects.toMatchObject({
    code: "invalid-request",
  });
  await expect(
    adapter.call("extension.other", "credential.connect", { action: "list" }),
  ).rejects.toThrow("Permission denied");
});
