import { afterEach, expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import {
  MODEL_PAGE,
  modelConnector,
  type ModelConnectionsApi,
} from "../modules/models/extension";
import type { ConnectionDraft } from "../modules/models/connections";
import type { ChatService } from "../extensions/contracts";
import type { Platform, StoredState } from "../modules/sdk";

const owner = "extension.connector.models";
const deepseek: ConnectionDraft = {
  name: "DeepSeek",
  preset: "deepseek",
  protocol: "openai-chat",
  target: "https://api.deepseek.com/chat/completions",
  model: "deepseek-flash",
  maxTokens: 1024,
  turns: 10,
};
const claude: ConnectionDraft = {
  name: "Claude",
  preset: "custom-anthropic",
  protocol: "anthropic-messages",
  target: "https://gateway.example/v1/messages",
  model: "claude-sonnet-5-5",
  maxTokens: 512,
  turns: 2,
};
const completion = (content: string) => ({
  status: 200,
  body: JSON.stringify({
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
  }),
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

/** Test-only platform: keyed state, native connection panel and transport. */
async function fixture({
  credentials = true,
  saved,
}: { credentials?: boolean; saved?: unknown } = {}) {
  const states = new Map<string, StoredState>();
  if (saved !== undefined) states.set(owner, { revision: 1, value: saved });
  const connections = new Map<
    string,
    { target: string; protocol: string; label: string }
  >();
  const panel = vi.fn(async (_request: Record<string, unknown>) => "saved");
  const send = vi.fn(async (_alias: string, _target: string, _body: string) =>
    completion("你是 nanan。"),
  );
  let next = 0;
  const platform: Platform = {
    kind: credentials ? "native" : "browser",
    available: (name) => credentials || name.startsWith("state."),
    async grant() {},
    async call(caller, name, payload) {
      expect(caller).toBe(owner);
      const request = (payload ?? {}) as Record<string, unknown>;
      if (name === "state.read") return states.get(owner) ?? null;
      if (name === "state.write") {
        const stored = {
          revision: (request.revision as number) + 1,
          value: request.value,
        };
        states.set(owner, stored);
        return stored;
      }
      if (name === "credential.connect") {
        if (request.action === "list")
          return [...connections].map(([alias, item]) => ({
            alias,
            ...item,
            status: "ready",
          }));
        const status = await panel(request);
        if (status !== "saved") return { alias: request.alias ?? "", status };
        if (request.action === "remove") {
          connections.delete(request.alias as string);
          return { alias: request.alias, status };
        }
        const alias = (request.alias as string) ?? `c-0000000${next++}`;
        connections.set(alias, {
          target: request.target as string,
          protocol: request.protocol as string,
          label: request.label as string,
        });
        return { alias, status };
      }
      if (name === "credential.request") {
        const item = connections.get(request.binding as string);
        if (!item)
          throw Object.assign(new Error("未就绪"), {
            outcome: "not-dispatched",
          });
        return send(
          request.binding as string,
          item.target,
          request.body as string,
        );
      }
      throw new Error("Permission denied");
    },
  };
  const host = new Host(platform);
  let api!: ModelConnectionsApi;
  let chat!: ChatService;
  host.install(
    modelConnector({
      mountPage(_container, value) {
        api = value;
        return () => {};
      },
    }),
  );
  host.install({
    manifest: {
      id: "consumer.chat",
      version: "1",
      apiVersion: 1,
      requires: { chat: 1 },
    },
    activate(ctx) {
      chat = ctx.use<ChatService>("chat");
    },
  });
  const capabilities = [
    "state.read",
    "state.write",
    "credential.request",
    "credential.connect",
  ];
  await host.grant("connector.models", capabilities.filter(platform.available));
  await host.start("connector.models").catch(() => {});
  cleanups.push(() => host.stop("connector.models"));
  if (host.inspect("connector.models").status === "active") {
    await host.start("consumer.chat");
    host.mountView(MODEL_PAGE, {} as HTMLElement);
  }
  return { host, api, chat: () => chat, panel, send, states, connections };
}
const signal = () => new AbortController().signal;
const body = (send: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(send.mock.calls[call][2] as string) as Record<string, unknown>;

it("adds a connection through the native panel and offers it as a chat model", async () => {
  const { api, chat, panel, send, states } = await fixture();
  expect(await api.save(deepseek)).toBe(true);
  expect(panel).toHaveBeenCalledWith({
    action: "save",
    protocol: "openai-chat",
    label: "DeepSeek",
    target: deepseek.target,
  });
  const [connection] = api.list();
  expect(connection).toMatchObject({
    ...deepseek,
    alias: "c-00000000",
    status: "ready",
  });
  expect(states.get(owner)?.value).toEqual({
    version: 1,
    connections: [{ ...deepseek, id: connection.id, alias: "c-00000000" }],
  });
  expect(chat().models()).toEqual([
    {
      id: connection.id,
      label: "DeepSeek",
      description: "DeepSeek · deepseek-flash",
    },
  ]);
  await expect(
    chat().reply(
      {
        model: connection.id,
        instructions: "简洁回答。",
        history: [
          { role: "user", text: "我是 nanan" },
          { role: "agent", text: "你好 nanan" },
        ],
        input: "我是谁？",
      },
      signal(),
    ),
  ).resolves.toBe("你是 nanan。");
  expect(send.mock.calls[0].slice(0, 2)).toEqual([
    "c-00000000",
    deepseek.target,
  ]);
  expect(body(send)).toMatchObject({
    model: "deepseek-flash",
    thinking: { type: "disabled" },
    messages: [
      { role: "system", content: "简洁回答。" },
      { role: "user", content: "我是 nanan" },
      { role: "assistant", content: "你好 nanan" },
      { role: "user", content: "我是谁？" },
    ],
  });
});

it("keeps connections apart and uses each one's protocol", async () => {
  const { api, chat, send } = await fixture();
  await api.save(deepseek);
  await api.save(claude);
  const [, second] = api.list();
  send.mockResolvedValueOnce({
    status: 200,
    body: JSON.stringify({
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "好" }],
    }),
  });
  await chat().reply({ model: second.id, history: [], input: "hi" }, signal());
  expect(send.mock.calls[0].slice(0, 2)).toEqual(["c-00000001", claude.target]);
  expect(body(send)).toEqual({
    model: "claude-sonnet-5-5",
    max_tokens: 512,
    messages: [{ role: "user", content: "hi" }],
  });
});

it("asks for the key only when the address changes or the user asks", async () => {
  const { api, panel } = await fixture();
  await api.save(deepseek);
  const { id } = api.list()[0];
  await api.save(
    { ...deepseek, name: "主力", model: "deepseek-pro", turns: 4 },
    id,
  );
  expect(panel).toHaveBeenCalledTimes(1);
  expect(api.list()[0]).toMatchObject({
    name: "主力",
    model: "deepseek-pro",
    turns: 4,
  });
  await api.save(
    { ...api.list()[0], target: "https://proxy.example/v1/chat/completions" },
    id,
  );
  expect(panel).toHaveBeenLastCalledWith(
    expect.objectContaining({
      alias: "c-00000000",
      target: "https://proxy.example/v1/chat/completions",
    }),
  );
  await api.save(api.list()[0], id, true);
  expect(panel).toHaveBeenCalledTimes(3);
});

it("saves nothing when the user cancels the panel", async () => {
  const { api, panel, states } = await fixture();
  panel.mockResolvedValueOnce("cancelled");
  expect(await api.save(deepseek)).toBe(false);
  expect(api.list()).toEqual([]);
  expect(states.has(owner)).toBe(false);
});

it("deletes the key before the record, and keeps both when cancelled", async () => {
  const { api, panel, connections } = await fixture();
  await api.save(deepseek);
  const { id } = api.list()[0];
  panel.mockResolvedValueOnce("cancelled");
  expect(await api.remove(id)).toBe(false);
  expect(api.list()).toHaveLength(1);
  expect(await api.remove(id)).toBe(true);
  expect(api.list()).toEqual([]);
  expect(connections.size).toBe(0);
});

it.each([
  [{ name: "" }, "名称"],
  [{ target: "http://api.example/v1" }, "https://"],
  [{ target: "https://api.example:8443/v1" }, "https://"],
  [{ model: "" }, "模型名"],
  [{ maxTokens: 0 }, "最大输出"],
  [{ turns: 51 }, "上下文轮数"],
])("rejects %j before opening the panel", async (patch, message) => {
  const { api, panel } = await fixture();
  await expect(api.save({ ...deepseek, ...patch })).rejects.toThrow(message);
  expect(panel).not.toHaveBeenCalled();
});

it("refuses unknown models and malformed requests without sending", async () => {
  const { api, chat, send } = await fixture();
  await api.save(deepseek);
  const { id } = api.list()[0];
  for (const request of [
    { model: "m-missing0", history: [], input: "hi" },
    { model: id, history: [{ role: "system", text: "x" }], input: "hi" },
    { model: id, history: [], input: " " },
  ])
    await expect(
      chat().reply(request as Parameters<ChatService["reply"]>[0], signal()),
    ).rejects.toMatchObject({ outcome: "not-dispatched" });
  expect(send).not.toHaveBeenCalled();
});

it("reports an unconfirmed transport failure as possibly sent", async () => {
  const { api, chat, send } = await fixture();
  await api.save(deepseek);
  send.mockRejectedValueOnce(
    Object.assign(new Error("x"), { outcome: "unknown" }),
  );
  await expect(
    chat().reply(
      { model: api.list()[0].id, history: [], input: "hi" },
      signal(),
    ),
  ).rejects.toMatchObject({
    outcome: "unknown",
    message: expect.stringContaining("重复调用"),
  });
});

it("waits where keys cannot be stored, such as the browser preview", async () => {
  const { host } = await fixture({ credentials: false });
  expect(host.inspect("connector.models").wait).toMatchObject({
    kind: "capability-unavailable",
  });
});

it("fails on corrupt records and leaves them as they were", async () => {
  const saved = { version: 1, connections: [{ id: "bad" }] };
  const { host, states } = await fixture({ saved });
  expect(host.inspect("connector.models").status).not.toBe("active");
  expect(states.get(owner)?.value).toBe(saved);
});
