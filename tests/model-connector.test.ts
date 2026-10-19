import { afterEach, expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import {
  MODEL_PAGE,
  modelConnector,
  type ModelConnectionsApi,
} from "../modules/models/extension";
import type { ProviderDraft } from "../modules/models/providers";
import type { ChatService } from "../extensions/contracts";
import type { Platform, StoredState } from "../modules/sdk";

const owner = "extension.connector.models";
const deepseek: ProviderDraft = {
  name: "DeepSeek",
  notes: "",
  website: "https://www.deepseek.com",
  preset: "deepseek",
  protocol: "openai-chat",
  base: "https://api.deepseek.com",
  models: ["user-model-a", "user-model-b"],
  maxTokens: 1024,
  context: 128_000,
};
const deepseekTarget = "https://api.deepseek.com/chat/completions";
const claude: ProviderDraft = {
  name: "Claude",
  notes: "公司网关",
  website: "",
  preset: "custom",
  protocol: "anthropic-messages",
  base: "https://gateway.example",
  models: ["user-claude"],
  maxTokens: 512,
  context: 1_000_000,
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
  const read = vi.fn(
    async (_alias: string, _target: string, _path: string) =>
      ({ status: 404, body: "" }) as { status: number; body: string },
  );
  let next = 0;
  let writeFailure: Error | undefined;
  let listFailures = 0;
  const platform: Platform = {
    kind: credentials ? "native" : "browser",
    available: (name) => credentials || name.startsWith("state."),
    async grant() {},
    async call(caller, name, payload) {
      expect(caller).toBe(owner);
      const request = (payload ?? {}) as Record<string, unknown>;
      if (name === "state.read") return states.get(owner) ?? null;
      if (name === "state.write") {
        const failure = writeFailure;
        writeFailure = undefined;
        if (failure) throw failure;
        const stored = {
          revision: (request.revision as number) + 1,
          value: request.value,
        };
        states.set(owner, stored);
        return stored;
      }
      if (name === "credential.connect") {
        if (request.action === "list" && listFailures-- > 0)
          throw new Error("连接记录不可用");
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
        if (request.method === "GET")
          return read(
            request.binding as string,
            item.target,
            request.path as string,
          );
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
  return {
    host,
    api,
    chat: () => chat,
    panel,
    send,
    read,
    states,
    connections,
    failNextWrite: () => void (writeFailure = new Error("磁盘已满")),
    failLists: (count: number) => void (listFailures = count),
  };
}
const signal = () => new AbortController().signal;
const body = (send: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(send.mock.calls[call][2] as string) as Record<string, unknown>;

it("adds a provider through the native panel and offers each of its models", async () => {
  const { api, chat, panel, send, states } = await fixture();
  const id = await api.save(deepseek);
  expect(panel).toHaveBeenCalledWith({
    action: "save",
    protocol: "openai-chat",
    label: "DeepSeek",
    target: deepseekTarget,
  });
  const [provider] = api.list();
  expect(provider.id).toBe(id);
  expect(provider).toMatchObject({
    ...deepseek,
    alias: "c-00000000",
    status: "ready",
  });
  expect(provider.id).toMatch(/^p-[a-z0-9]{8}$/);
  expect(states.get(owner)?.value).toEqual({
    version: 4,
    providers: [{ ...deepseek, id: provider.id, alias: "c-00000000" }],
  });
  expect(chat().models()).toEqual(
    deepseek.models.map((model) => ({
      id: `${provider.id}/${model}`,
      label: model,
      group: "DeepSeek",
      description: "DeepSeek",
    })),
  );
  await expect(
    chat().reply(
      {
        model: `${provider.id}/user-model-b`,
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
    deepseekTarget,
  ]);
  expect(body(send)).toMatchObject({
    model: "user-model-b",
    thinking: { type: "disabled" },
    messages: [
      { role: "system", content: "简洁回答。" },
      { role: "user", content: "我是 nanan" },
      { role: "assistant", content: "你好 nanan" },
      { role: "user", content: "我是谁？" },
    ],
  });
});

it("keeps providers apart and uses each one's protocol", async () => {
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
  await chat().reply(
    { model: `${second.id}/user-claude`, history: [], input: "hi" },
    signal(),
  );
  expect(send.mock.calls[0].slice(0, 2)).toEqual([
    "c-00000001",
    "https://gateway.example/v1/messages",
  ]);
  expect(body(send)).toEqual({
    model: "user-claude",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "hi", cache_control: { type: "ephemeral" } },
        ],
      },
    ],
  });
});

it("asks for the key only when the address changes or the user asks", async () => {
  const { api, panel } = await fixture();
  await api.save(deepseek);
  const { id } = api.list()[0];
  await api.save(
    { ...deepseek, name: "主力", models: ["user-model-c"], maxTokens: 4000 },
    id,
  );
  expect(panel).toHaveBeenCalledTimes(1);
  expect(api.list()[0]).toMatchObject({
    name: "主力",
    models: ["user-model-c"],
    maxTokens: 4000,
  });
  await api.save(
    { ...api.list()[0], base: "https://proxy.example/v1/chat/completions/" },
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

it("never sends to an address whose record failed to save", async () => {
  const { api, chat, panel, send, failNextWrite } = await fixture();
  await api.save(deepseek);
  const { id, alias } = api.list()[0];
  failNextWrite();
  // The panel confirms the new address natively, then the record write fails.
  await expect(
    api.save({ ...deepseek, base: "https://proxy.example/v1" }, id),
  ).rejects.toThrow("磁盘已满");
  expect(api.list()[0]).toMatchObject({
    base: "https://api.deepseek.com",
    status: "changed",
  });
  await expect(
    chat().reply(
      { model: `${id}/user-model-a`, history: [], input: "hi" },
      signal(),
    ),
  ).rejects.toMatchObject({ outcome: "not-dispatched" });
  await expect(api.fetchModels(id, signal())).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  // Saving again confirms the shown address under the same connection.
  await api.save(api.list()[0], id);
  expect(panel).toHaveBeenLastCalledWith(
    expect.objectContaining({ alias, target: deepseekTarget }),
  );
  expect(api.list()[0].status).toBe("ready");
});

it("does not keep showing or using a stale ready state when re-reading keys fails", async () => {
  const { api, chat, send, failLists } = await fixture();
  await api.save(deepseek);
  const { id } = api.list()[0];
  failLists(1);
  await expect(api.refresh()).rejects.toThrow("连接记录不可用");
  expect(api.list()[0].status).toBe("pending");
  // Each send re-reads the connection first and refuses when it cannot.
  failLists(1);
  await expect(
    chat().reply(
      { model: `${id}/user-model-a`, history: [], input: "hi" },
      signal(),
    ),
  ).rejects.toMatchObject({ outcome: "not-dispatched" });
  expect(send).not.toHaveBeenCalled();
  await chat().reply(
    { model: `${id}/user-model-a`, history: [], input: "hi" },
    signal(),
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(api.list()[0].status).toBe("ready");
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
  [{ base: "http://api.example/v1" }, "https://"],
  [{ base: "https://api.example:8443/v1" }, "https://"],
  [{ base: "https://api.example/v1?key=1" }, "https://"],
  [{ protocol: "anthropic-messages" as const }, "API 格式"],
  [{ notes: "x".repeat(81) }, "备注"],
  [{ website: "javascript:alert(1)" }, "官网"],
  [{ models: [""] }, "模型名"],
  [{ models: [" a"] }, "模型名"],
  [{ models: ["a", "a"] }, "重复"],
  [{ models: Array.from({ length: 33 }, (_, i) => `m${i}`) }, "最多"],
  [{ maxTokens: 0 }, "最大输出"],
  [{ context: 8000 }, "上下文窗口"],
  [{ context: 3_000_000 }, "上下文窗口"],
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
    { model: "p-missing0/user-model-a", history: [], input: "hi" },
    { model: `${id}/removed-model`, history: [], input: "hi" },
    { model: id, history: [], input: "hi" },
    {
      model: `${id}/user-model-a`,
      history: [{ role: "system", text: "x" }],
      input: "hi",
    },
    { model: `${id}/user-model-a`, history: [], input: " " },
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
      { model: `${api.list()[0].id}/user-model-a`, history: [], input: "hi" },
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
  const saved = { version: 3, providers: [{ id: "bad" }] };
  const { host, states } = await fixture({ saved });
  expect(host.inspect("connector.models").status).not.toBe("active");
  expect(states.get(owner)?.value).toBe(saved);
});

it("keeps a provider without models and offers nothing until one is added", async () => {
  const { api, chat, panel } = await fixture();
  expect(await api.save({ ...deepseek, models: [] })).toMatch(/^p-/);
  expect(chat().models()).toEqual([]);
  const { id } = api.list()[0];
  await api.save({ ...deepseek, models: ["added-later"] }, id);
  expect(panel).toHaveBeenCalledTimes(1);
  expect(
    chat()
      .models()
      .map((model) => model.id),
  ).toEqual([`${id}/added-later`]);
});

it("tests one model of a provider", async () => {
  const { api, send } = await fixture();
  await api.save(deepseek);
  const { id } = api.list()[0];
  await expect(api.test(id, "user-model-b", signal())).resolves.toBe(
    "你是 nanan。",
  );
  expect(body(send)).toMatchObject({ model: "user-model-b" });
});

it("upgrades version 2 records, which kept the full address", async () => {
  const old = {
    alias: "c-00000000",
    models: ["m"],
    maxTokens: 1024,
    turns: 10,
  };
  const saved = {
    version: 2,
    providers: [
      {
        ...old,
        id: "p-aaaaaaaa",
        name: "DeepSeek",
        preset: "deepseek",
        protocol: "openai-chat",
        target: "https://api.deepseek.com/chat/completions",
      },
      {
        ...old,
        id: "p-bbbbbbbb",
        name: "网关",
        preset: "custom-anthropic",
        protocol: "anthropic-messages",
        target: "https://gateway.example/v1/messages",
      },
    ],
  };
  const { api, states } = await fixture({ saved });
  expect(api.list().map(({ preset, base }) => ({ preset, base }))).toEqual([
    { preset: "deepseek", base: "https://api.deepseek.com" },
    { preset: "custom", base: "https://gateway.example" },
  ]);
  expect(api.list()[0]).not.toHaveProperty("target");
  // Earlier versions limited turns; the whole conversation is sent now.
  expect(api.list()[0]).not.toHaveProperty("turns");
  expect(api.list().map(({ context }) => context)).toEqual([128_000, 128_000]);
  expect(states.get(owner)?.value).toBe(saved);
});

it("gives version 3 records their preset's context window", async () => {
  const entry = {
    alias: "c-00000000",
    notes: "",
    website: "",
    models: ["m"],
    maxTokens: 1024,
    turns: 10,
  };
  const saved = {
    version: 3,
    providers: [
      {
        ...entry,
        id: "p-aaaaaaaa",
        name: "Claude",
        preset: "anthropic",
        protocol: "anthropic-messages",
        base: "https://api.anthropic.com",
      },
      {
        ...entry,
        id: "p-bbbbbbbb",
        name: "网关",
        preset: "custom",
        protocol: "openai-chat",
        base: "https://gateway.example/v1",
      },
    ],
  };
  const { api, states } = await fixture({ saved });
  expect(api.list().map(({ context }) => context)).toEqual([
    1_000_000, 128_000,
  ]);
  expect(states.get(owner)?.value).toBe(saved);
});

it("sends a whole long conversation to a 1M-context provider, and less to a 128K one", async () => {
  const { api, chat, send } = await fixture();
  const big = (await api.save({
    ...deepseek,
    context: 1_000_000,
  })) as string;
  const small = (await api.save({ ...deepseek, name: "小" })) as string;
  const history = Array.from({ length: 100 }, (_, i) => [
    { role: "user" as const, text: `${i}` + "问".repeat(4000) },
    { role: "agent" as const, text: `${i}` + "答".repeat(4000) },
  ]).flat();
  for (const id of [big, small])
    await chat().reply(
      { model: `${id}/user-model-a`, history, input: "总结" },
      signal(),
    );
  const [whole, trimmed] = [0, 1].map(
    (call) => (body(send, call).messages as unknown[]).length,
  );
  expect(whole).toBe(201);
  expect(trimmed).toBeLessThan(40);
});

it("fetches a provider's model list from the first path that has one", async () => {
  const { api, read } = await fixture();
  const id = (await api.save({ ...deepseek, models: [] })) as string;
  read.mockResolvedValueOnce({ status: 404, body: "not found" });
  read.mockResolvedValueOnce({
    status: 200,
    body: JSON.stringify({
      data: [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }],
    }),
  });
  await expect(api.fetchModels(id, signal())).resolves.toEqual([
    "deepseek-chat",
    "deepseek-reasoner",
  ]);
  expect(read.mock.calls).toEqual([
    ["c-00000000", deepseekTarget, "/models"],
    ["c-00000000", deepseekTarget, "/v1/models"],
  ]);
});

it("explains a refused key or a service without a model list", async () => {
  const { api, read } = await fixture();
  const id = (await api.save(deepseek)) as string;
  read.mockResolvedValueOnce({ status: 401, body: "bad key" });
  await expect(api.fetchModels(id, signal())).rejects.toThrow("API Key");
  expect(read).toHaveBeenCalledTimes(1);
  await expect(api.fetchModels(id, signal())).rejects.toThrow("手动");
  read.mockRejectedValueOnce(
    Object.assign(new Error("已取消发送，请求未发出。"), {
      outcome: "not-dispatched",
    }),
  );
  await expect(api.fetchModels(id, signal())).rejects.toThrow("已取消发送");
});

it("asks for the key before fetching models of a provider without one", async () => {
  const { api, read, connections } = await fixture();
  const id = (await api.save(deepseek)) as string;
  connections.clear();
  await api.refresh();
  await expect(api.fetchModels(id, signal())).rejects.toThrow("录入");
  expect(read).not.toHaveBeenCalled();
});
