import { expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { ExtensionDefinition } from "../modules/sdk";
import type { ChatService } from "../extensions/contracts";
import { agentExtension } from "../modules/agents/provider";
import { restoreAgents } from "../modules/agents/store";
import type { AgentProvider } from "../modules/agents/contract";
import { legacyAgent, memoryPlatform } from "./fixtures/agents";

type Request = Parameters<ChatService["reply"]>[0];

/** A chat provider that answers with what it was sent. */
function chat(
  id: string,
  models: string[],
  requests: Request[],
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

async function setup() {
  const requests: Request[] = [];
  const host = new Host(memoryPlatform().platform);
  host.install(chat("chat.a", ["m1", "m2"], requests));
  host.install(agentExtension());
  await host.grant("agents.local", ["state.read", "state.write"]);
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
  const agent = await agents().create({ name: "多会话", multiSession: true });
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

it("management lists each Agent under the connector it uses", async () => {
  const { host, agents } = await setup();
  const agent = await agents().create({ name: "用户" });
  expect(host.users("chat.a")).toEqual([
    {
      owner: "agents.local",
      kind: "Agent",
      users: [{ id: agent.id, label: "用户" }],
      others: [],
      toggle: false,
    },
  ]);
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
  expect(picked.extensions).toEqual([]);
  const none = await agents().create({ name: "未选", model: null });
  expect(none.model).toBeUndefined();
  await expect(
    agents().create({ name: "错", model: { provider: "chat.a", model: "x" } }),
  ).rejects.toThrow("模型不可用");
});
