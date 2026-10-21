import { expect, it } from "vitest";
import {
  owner,
  deepseek,
  KEY,
  deepseekTarget,
  claude,
  fixture,
  signal,
  body,
} from "./model-connector-fixture";

import type { ChatService } from "../extensions/contracts";
it("adds a provider with the key typed in the form and offers each of its models", async () => {
  const { api, chat, connect, send, states } = await fixture();
  const id = await api.save(deepseek, undefined, KEY);
  expect(connect).toHaveBeenCalledWith({
    action: "save",
    protocol: "openai-chat",
    label: "DeepSeek",
    target: deepseekTarget,
    key: KEY,
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
    version: 6,
    providers: [{ ...deepseek, id: provider.id, alias: "c-00000000" }],
  });
  expect(chat().models()).toEqual(
    deepseek.models.map((model) => ({
      id: `${provider.id}/${model}`,
      label: model,
      group: "DeepSeek",
      description: "DeepSeek",
      reasoning: ["off", "low", "high", "max"],
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
  // A chosen strength replaces the preset's default and reaches the service.
  await chat().reply(
    {
      model: `${provider.id}/user-model-b`,
      history: [],
      input: "想一想",
      effort: "max",
    },
    signal(),
  );
  expect(body(send, 1)).toMatchObject({
    thinking: { type: "enabled" },
    reasoning_effort: "max",
  });
});

it("refuses pictures that are not base64 images before anything is sent", async () => {
  const { api, chat, send } = await fixture();
  await api.save(deepseek, undefined, KEY);
  const model = `${api.list()[0].id}/user-model-a`;
  for (const images of [
    [{ mime: "image/gif", data: "QUJD" }],
    [{ mime: "image/png", data: "not base64!" }],
    "x",
  ])
    await expect(
      chat().reply(
        { model, history: [], input: "看", images } as never,
        signal(),
      ),
    ).rejects.toMatchObject({ outcome: "not-dispatched" });
  expect(send).not.toHaveBeenCalled();
});

it("keeps providers apart and uses each one's protocol", async () => {
  const { api, chat, send } = await fixture();
  await api.save(deepseek, undefined, KEY);
  await api.save(claude, undefined, KEY);
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

it("needs the key only when the address changes, or to replace it", async () => {
  const { api, connect } = await fixture();
  await api.save(deepseek, undefined, KEY);
  const { id } = api.list()[0];
  await api.save(
    { ...deepseek, name: "主力", models: ["user-model-c"], maxTokens: 4000 },
    id,
  );
  expect(connect).toHaveBeenCalledTimes(1);
  expect(api.list()[0]).toMatchObject({
    name: "主力",
    models: ["user-model-c"],
    maxTokens: 4000,
  });
  const moved = {
    ...api.list()[0],
    base: "https://proxy.example/v1/chat/completions/",
  };
  await expect(api.save(moved, id)).rejects.toThrow("请填写 API Key");
  await api.save(moved, id, KEY);
  expect(connect).toHaveBeenLastCalledWith(
    expect.objectContaining({
      alias: "c-00000000",
      target: "https://proxy.example/v1/chat/completions",
    }),
  );
  await api.save(api.list()[0], id, "sk-replaced");
  expect(connect).toHaveBeenCalledTimes(3);
  expect(connect).toHaveBeenLastCalledWith(
    expect.objectContaining({ alias: "c-00000000", key: "sk-replaced" }),
  );
});

it("never sends to an address whose record failed to save", async () => {
  const { api, chat, connect, send, failNextWrite } = await fixture();
  await api.save(deepseek, undefined, KEY);
  const { id, alias } = api.list()[0];
  failNextWrite();
  // The key is saved for the new address, then the record write fails.
  await expect(
    api.save({ ...deepseek, base: "https://proxy.example/v1" }, id, KEY),
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
  // Saving again with the key binds the shown address to the same connection.
  await expect(api.save(api.list()[0], id)).rejects.toThrow("API Key");
  await api.save(api.list()[0], id, KEY);
  expect(connect).toHaveBeenLastCalledWith(
    expect.objectContaining({ alias, target: deepseekTarget }),
  );
  expect(api.list()[0].status).toBe("ready");
});

it("reuses the connection of a new provider whose record failed to save", async () => {
  const { api, connect, connections, failNextWrite } = await fixture();
  failNextWrite();
  await expect(api.save(deepseek, undefined, KEY)).rejects.toThrow("磁盘已满");
  expect(api.list()).toEqual([]);
  const [spare] = connections.keys();
  // Retrying, or adding another provider, takes over that connection.
  await api.save(claude, undefined, KEY);
  expect(connect).toHaveBeenLastCalledWith(
    expect.objectContaining({ alias: spare }),
  );
  expect(connections.size).toBe(1);
  expect(api.list()[0]).toMatchObject({ alias: spare, status: "ready" });
});

it("returns a committed provider id even when refreshing its key status fails", async () => {
  const { api, connect, connections, states, failLists } = await fixture();
  failLists(1);
  const id = await api.save(deepseek, undefined, KEY);
  expect(api.list()).toEqual([
    expect.objectContaining({ id, status: "pending" }),
  ]);
  // The form keeps this id, so its next save edits rather than duplicates it.
  await api.save({ ...deepseek, name: "已修改" }, id);
  expect(api.list()).toEqual([
    expect.objectContaining({ id, name: "已修改", status: "ready" }),
  ]);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(connections.size).toBe(1);
  expect(states.get(owner)?.value).toMatchObject({
    providers: [expect.objectContaining({ id, name: "已修改" })],
  });
});

it("preserves the write failure when refreshing key status also fails", async () => {
  const { api, states, failNextWrite, failLists } = await fixture();
  failNextWrite();
  failLists(1);
  await expect(api.save(deepseek, undefined, KEY)).rejects.toThrow("磁盘已满");
  expect(api.list()).toEqual([]);
  expect(states.has(owner)).toBe(false);
});

it("keeps a committed deletion successful when its final refresh fails", async () => {
  const { api, connect, connections, states, failLists } = await fixture();
  const id = await api.save(deepseek, undefined, KEY);
  connect.mockImplementationOnce(async () => {
    failLists(1);
    return "saved";
  });
  await expect(api.remove(id)).resolves.toBe(true);
  expect(api.list()).toEqual([]);
  expect(connections.size).toBe(0);
  expect(states.get(owner)?.value).toMatchObject({ providers: [] });
});

it("does not keep showing or using a stale ready state when re-reading keys fails", async () => {
  const { api, chat, send, failLists } = await fixture();
  await api.save(deepseek, undefined, KEY);
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

it.each([
  [undefined, "请填写 API Key"],
  ["", "请填写 API Key"],
  ["sk has space", "API Key 须为"],
  ["k".repeat(4097), "API Key 须为"],
])("saves nothing for a new provider with key %j", async (key, message) => {
  const { api, connect, states } = await fixture();
  await expect(api.save(deepseek, undefined, key)).rejects.toThrow(message);
  expect(connect).not.toHaveBeenCalled();
  expect(states.has(owner)).toBe(false);
});

it("saves nothing when the platform refuses the key", async () => {
  const { api, connect, states } = await fixture();
  connect.mockResolvedValueOnce("rejected");
  await expect(api.save(deepseek, undefined, KEY)).rejects.toThrow(
    "密钥未保存",
  );
  expect(api.list()).toEqual([]);
  expect(states.has(owner)).toBe(false);
});

it("deletes the key before the record, and keeps both when cancelled", async () => {
  const { api, connect, connections } = await fixture();
  await api.save(deepseek, undefined, KEY);
  const { id } = api.list()[0];
  connect.mockResolvedValueOnce("cancelled");
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
  [{ maxTokens: 200_000 }, "最大输出"],
  [{ maxTokens: 128_000 }, "小于默认上下文窗口"],
  [{ context: 8000 }, "上下文窗口"],
  [{ context: 3_000_000 }, "上下文窗口"],
])("rejects %j before saving the key", async (patch, message) => {
  const { api, connect } = await fixture();
  await expect(
    api.save({ ...deepseek, ...patch }, undefined, KEY),
  ).rejects.toThrow(message);
  expect(connect).not.toHaveBeenCalled();
});

it("refuses unknown models and malformed requests without sending", async () => {
  const { api, chat, send } = await fixture();
  await api.save(deepseek, undefined, KEY);
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
  await api.save(deepseek, undefined, KEY);
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
  const { api, chat, connect } = await fixture();
  expect(await api.save({ ...deepseek, models: [] }, undefined, KEY)).toMatch(
    /^p-/,
  );
  expect(chat().models()).toEqual([]);
  const { id } = api.list()[0];
  await api.save({ ...deepseek, models: ["added-later"] }, id);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(
    chat()
      .models()
      .map((model) => model.id),
  ).toEqual([`${id}/added-later`]);
});

it("tests one model of a provider", async () => {
  const { api, send } = await fixture();
  await api.save(deepseek, undefined, KEY);
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
  // 1024 was the form's old default, not a choice: the service decides now.
  expect(api.list().map(({ maxTokens }) => maxTokens)).toEqual([null, null]);
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
  const big = (await api.save(
    { ...deepseek, context: 1_000_000 },
    undefined,
    KEY,
  )) as string;
  const small = (await api.save(
    { ...deepseek, name: "小" },
    undefined,
    KEY,
  )) as string;
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
  const id = (await api.save(
    { ...deepseek, models: [] },
    undefined,
    KEY,
  )) as string;
  read.mockResolvedValueOnce({ status: 404, body: "not found" });
  read.mockResolvedValueOnce({
    status: 200,
    body: JSON.stringify({
      data: [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }],
    }),
  });
  // Windows come from models.dev, matched by the provider's address.
  await expect(api.fetchModels(id, signal())).resolves.toEqual([
    { name: "deepseek-chat", context: 1_048_576 },
    { name: "deepseek-reasoner" },
  ]);
  expect(read.mock.calls).toEqual([
    ["c-00000000", deepseekTarget, "/models"],
    ["c-00000000", deepseekTarget, "/v1/models"],
  ]);
});

it("explains a refused key or a service without a model list", async () => {
  const { api, read } = await fixture();
  const id = (await api.save(deepseek, undefined, KEY)) as string;
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

it("needs the key again before fetching models of a provider without one", async () => {
  const { api, read, connections } = await fixture();
  const id = (await api.save(deepseek, undefined, KEY)) as string;
  connections.clear();
  await api.refresh();
  await expect(api.fetchModels(id, signal())).rejects.toThrow("填写");
  expect(read).not.toHaveBeenCalled();
});
