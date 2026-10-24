import { expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { ExtensionDefinition } from "../modules/sdk";
import type { ChatService, Effort } from "../extensions/contracts";
import { agentExtension } from "../modules/agents/provider";
import { restoreAgents } from "../modules/agents/validation";
import type { AgentProvider } from "../modules/agents/contract";
import { legacyAgent, memoryPlatform } from "./fixtures/agents";

type Request = Parameters<ChatService["reply"]>[0];

/** A chat provider that answers with what it was sent. */
function chat(
  id: string,
  models: string[],
  requests: Request[],
  reasoning: Record<string, readonly Effort[]> = {},
  vision: readonly string[] = [],
): ExtensionDefinition {
  return {
    manifest: { id, apiVersion: 1, version: "1", provides: { chat: 1 } },
    activate(ctx) {
      ctx.provide("chat", 1, {
        name: id,
        models: () =>
          models.map((model) => ({
            id: model,
            label: model.toUpperCase(),
            description: `${id} 的 ${model}`,
            ...(reasoning[model] && { reasoning: reasoning[model] }),
            ...(vision.includes(model) && { vision: true }),
          })),
        subscribe: () => () => {},
        async reply(request: Request) {
          requests.push(structuredClone(request));
          return `${request.model}:${request.history.length}:${request.input}`;
        },
      } satisfies ChatService);
    },
  };
}

async function setup(
  reasoning: Record<string, readonly Effort[]> = {},
  vision: readonly string[] = [],
) {
  const requests: Request[] = [];
  const host = new Host(memoryPlatform().platform);
  host.install(chat("chat.a", ["m1", "m2"], requests, reasoning, vision));
  host.install(agentExtension());
  await host.grant("agents.local", [
    "state.read",
    "state.batch",
    "records.list",
  ]);
  await host.start("chat.a");
  await host.start("agents.local");
  const agents = () => host.peekService<AgentProvider>("agents", 1)!;
  const find = (id: string) =>
    agents()
      .list()
      .find((agent) => agent.id === id)!;
  return { host, agents, find, requests };
}

it("sends the conversation so far and the role description to the Agent's model", async () => {
  const { agents, find, requests } = await setup();
  expect(agents().modelChoices!()).toEqual([
    {
      provider: "chat.a",
      providerLabel: "chat.a",
      group: "chat.a",
      id: "m1",
      label: "M1",
      description: "chat.a 的 m1",
    },
    {
      provider: "chat.a",
      providerLabel: "chat.a",
      group: "chat.a",
      id: "m2",
      label: "M2",
      description: "chat.a 的 m2",
    },
  ]);
  const agent = await agents().create({
    name: "助手",
    description: "简洁回答。",
  });
  expect(agent.model).toEqual({ provider: "chat.a", model: "m1" });
  await agents().send(agent.id, "我是 nanan");
  await agents().send(agent.id, "我是谁？");
  expect(requests[1]).toEqual({
    model: "m1",
    instructions: "简洁回答。",
    history: [
      { role: "user", text: "我是 nanan" },
      { role: "agent", text: "m1:0:我是 nanan" },
    ],
    input: "我是谁？",
  });
  expect(find(agent.id).sessions[0].messages.at(-1)?.text).toBe(
    "m1:2:我是谁？",
  );
});

it("gives new Agents a description usable as instructions", async () => {
  const { agents } = await setup();
  const agent = await agents().create({ name: "默认" });
  expect(agent.description).toBe("简洁、友好地回答用户的问题。");
});

it("lets each Agent use its own model and keeps it across restarts", async () => {
  const { host, agents, requests } = await setup();
  const a = await agents().create({ name: "甲" });
  const b = await agents().create({ name: "乙" });
  await agents().setModel!(b.id, { provider: "chat.a", model: "m2" });
  await agents().send(a.id, "一");
  await agents().send(b.id, "二");
  expect(requests.map((request) => request.model)).toEqual(["m1", "m2"]);
  await expect(
    agents().setModel!(a.id, { provider: "chat.a", model: "missing" }),
  ).rejects.toThrow("模型不可用");
  await host.stop("agents.local");
  await host.start("agents.local");
  expect(
    agents()
      .list()
      .map((agent) => agent.model?.model),
  ).toEqual(["m1", "m2"]);
});

it("sends only the current session's messages", async () => {
  const { agents, requests } = await setup();
  const agent = await agents().create({ name: "多会话" });
  await agents().send(agent.id, "旧会话");
  await agents().session(agent.id, "create");
  await agents().send(agent.id, "新会话");
  expect(requests[1].history).toEqual([]);
});

it("asks for a model when an Agent has none, and names a stopped connector", async () => {
  const { host, agents } = await setup();
  const agent = await agents().create({ name: "无模型" });
  await agents().setModel!(agent.id, null);
  await expect(agents().send(agent.id, "你好")).rejects.toThrow("选择模型");
  await agents().setModel!(agent.id, { provider: "chat.a", model: "m1" });
  await host.stop("chat.a");
  await expect(agents().send(agent.id, "你好")).rejects.toThrow(
    "模型连接已停用",
  );
});

it("management lists each Agent under its connection and switches it on or off", async () => {
  const { host, agents, find } = await setup();
  const agent = await agents().create({ name: "用户" });
  const other = await agents().create({ name: "未选", model: null });
  const named = (a: typeof agent) => ({ id: a.id, label: a.name });
  expect(host.users("chat.a")).toEqual([
    {
      owner: "agents.local",
      kind: "Agent",
      users: [named(agent)],
      others: [named(other)],
      toggle: true,
    },
  ]);
  await host.toggleUser("agents.local", agent.id, "chat.a", false);
  expect(find(agent.id).off).toEqual(["chat.a"]);
  await host.toggleUser("agents.local", agent.id, "chat.a", true);
  expect(find(agent.id).off).toBeUndefined();
  // Switching on an Agent without this connection's model picks its first.
  await host.toggleUser("agents.local", other.id, "chat.a", true);
  expect(find(other.id).model).toEqual({ provider: "chat.a", model: "m1" });
  expect(host.users("chat.a")[0].users).toEqual([named(agent), named(other)]);
});

it("sending a message does not republish the Agents to the host", async () => {
  const { host, agents } = await setup();
  const agent = await agents().create({ name: "安静" });
  const before = host.snapshot();
  await agents().send(agent.id, "你好");
  // Only the reply task starting and ending changes the host.
  expect(host.snapshot()).toBe(before + 2);
});

it("replies come from the model alone; text services are not used", async () => {
  const { host, agents, find } = await setup();
  host.install({
    manifest: {
      id: "transform.a",
      apiVersion: 1,
      version: "1",
      provides: { "text.transform": 1 },
    },
    activate(ctx) {
      ctx.provide("text.transform", 1, {
        name: "甲",
        transform: async (text: string) => `甲：${text}`,
      });
    },
  });
  await host.start("transform.a");
  const agent = await agents().create({ name: "纯模型" });
  await agents().send(agent.id, "一");
  expect(find(agent.id).sessions[0].messages.at(-1)?.text).toBe("m1:0:一");
  expect(host.users("transform.a")).toEqual([]);
});

it.each([{ provider: "chat.a" }, { provider: 1, model: "m1" }, "chat.a/m1"])(
  "rejects a saved model choice of %j",
  (model) => {
    expect(() => restoreAgents([{ ...legacyAgent(), model }])).toThrow(
      "Agent 配置损坏",
    );
  },
);

it("a new Agent can start with a chosen model or none", async () => {
  const { agents } = await setup();
  const picked = await agents().create({
    name: "选了",
    model: { provider: "chat.a", model: "m2" },
  });
  expect(picked.model).toEqual({ provider: "chat.a", model: "m2" });
  const none = await agents().create({ name: "未选", model: null });
  expect(none.model).toBeUndefined();
  await expect(
    agents().create({ name: "错", model: { provider: "chat.a", model: "x" } }),
  ).rejects.toThrow("模型不可用");
});

it("an Agent can switch off its model connection, its provider or any other part", async () => {
  const { host, agents, find, requests } = await setup();
  expect(agents().connectors!()).toEqual([{ id: "chat.a", label: "chat.a" }]);
  const agent = await agents().create({ name: "拼装", off: ["ui.x"] });
  expect(agent.off).toEqual(["ui.x"]);
  // Off keeps the chosen model for when it is switched on again.
  await agents().setOff!(agent.id, "chat.a", true);
  expect(find(agent.id).model).toEqual({ provider: "chat.a", model: "m1" });
  expect(host.users("chat.a")[0].users).toEqual([]);
  await expect(agents().send(agent.id, "你好")).rejects.toThrow(
    "已关闭「chat.a」",
  );
  expect(requests).toEqual([]);
  // Picking a model switches its connection back on.
  await agents().setModel!(agent.id, { provider: "chat.a", model: "m2" });
  expect(find(agent.id).off).toEqual(["ui.x"]);
  await agents().setOff!(agent.id, "agents.local", true);
  await expect(agents().send(agent.id, "二")).rejects.toThrow(
    "已关闭「agents.local」",
  );
  expect(requests).toEqual([]);
  await host.stop("agents.local");
  await host.start("agents.local");
  expect(find(agent.id).off).toEqual(["ui.x", "agents.local"]);
  await agents().setOff!(agent.id, "agents.local", false);
  await agents().send(agent.id, "三");
  expect(requests.map((request) => request.model)).toEqual(["m2"]);
});

it.each([{ off: "ui.x" }, { off: [1] }, { off: ["x".repeat(65)] }])(
  "rejects saved switched-off extensions of %j",
  (patch) => {
    expect(() => restoreAgents([{ ...legacyAgent(), ...patch }])).toThrow(
      "Agent 配置损坏",
    );
  },
);

it("keeps a thinking strength per Agent, only for models that list it, and sends it with replies", async () => {
  const { host, agents, find, requests } = await setup({
    m1: ["low", "high"],
  });
  expect(agents().modelChoices!().map((m) => m.reasoning)).toEqual([
    ["low", "high"],
    undefined,
  ]);
  const a = await agents().create({ name: "甲" });
  expect(find(a.id).effort).toBeUndefined();
  await agents().send(a.id, "默认");
  expect(requests[0]).not.toHaveProperty("effort");
  await expect(agents().setEffort!(a.id, "max")).rejects.toThrow("不支持");
  await agents().setEffort!(a.id, "high");
  await agents().send(a.id, "高");
  expect(requests[1].effort).toBe("high");
  // A model without strengths is never sent one, and the choice stays for m1.
  await agents().setModel!(a.id, { provider: "chat.a", model: "m2" });
  await agents().send(a.id, "换模型");
  expect(requests[2]).not.toHaveProperty("effort");
  await expect(agents().setEffort!(a.id, "low")).rejects.toThrow("不支持");
  await agents().setModel!(a.id, { provider: "chat.a", model: "m1" });
  await host.stop("agents.local");
  await host.start("agents.local");
  expect(find(a.id).effort).toBe("high");
  await agents().setEffort!(a.id, null);
  expect(find(a.id).effort).toBeUndefined();
});

it("refuses a saved thinking strength that is not one of the five", () => {
  const [agent] = [legacyAgent()];
  expect(restoreAgents([{ ...agent, effort: "high" }])[0].effort).toBe("high");
  expect(() => restoreAgents([{ ...agent, effort: "extreme" }])).toThrow(
    "Agent 配置损坏",
  );
});

const note = { kind: "text" as const, name: "笔记.md", text: "第一行\n第二行" };
const photo = {
  kind: "image" as const,
  name: "照片.webp",
  mime: "image/webp" as const,
  data: "QUJD",
};

it("keeps attachments with the message, and tells a model that cannot read pictures so in their place", async () => {
  const { host, agents, find, requests } = await setup({}, ["m2"]);
  const a = await agents().create({ name: "甲" });
  expect(agents().info.attachments).toBe(true);
  await agents().send(a.id, "看看", [note, photo]);
  // m1 reads no pictures: the file is in the text, the picture only an error line.
  expect(requests[0].input).toBe(
    '文件「笔记.md」：\n```\n第一行\n第二行\n```\n\n看看\nERROR: Cannot read "照片.webp" (this model does not support image input). Inform the user.',
  );
  expect(requests[0]).not.toHaveProperty("images");
  expect(find(a.id).sessions[0].messages[0]).toMatchObject({
    text: "看看",
    attachments: [note, photo],
  });
  await agents().setModel!(a.id, { provider: "chat.a", model: "m2" });
  await agents().send(a.id, "再看", [photo]);
  expect(requests[1].images).toEqual([{ mime: "image/webp", data: "QUJD" }]);
  expect(requests[1].input).toBe("再看");
  // The earlier turn keeps its own picture too: still among the latest three.
  expect(requests[1].history[0].images).toHaveLength(1);
  await host.stop("agents.local");
  await host.start("agents.local");
  expect(find(a.id).sessions[0].messages[0].attachments).toEqual([note, photo]);
});

it("refuses attachments that are malformed, too many, or past the session's picture budget", async () => {
  const { agents } = await setup();
  const a = await agents().create({ name: "甲" });
  await expect(
    agents().send(a.id, "x", [{ kind: "pdf" }] as never),
  ).rejects.toThrow("附件");
  await expect(
    agents().send(
      a.id,
      "x",
      Array.from({ length: 6 }, () => note),
    ),
  ).rejects.toThrow("最多");
  const big = { ...photo, data: "A".repeat(400_000) };
  for (let i = 0; i < 20; i++) await agents().send(a.id, `图${i}`, [big]);
  await expect(agents().send(a.id, "再来", [big])).rejects.toThrow("上限");
  expect(agents().list()[0].sessions[0].messages).toHaveLength(40);
});
