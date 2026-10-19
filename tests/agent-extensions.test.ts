import { expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { ExtensionDefinition } from "../modules/sdk";
import { agentExtension } from "../modules/agents/provider";
import { legacyAgent, memoryPlatform } from "./fixtures/agents";
import { restoreAgents } from "../modules/agents/store";
import {
  enabledExtensions,
  type AgentProvider,
} from "../modules/agents/contract";

const service = (id: string, prefix: string): ExtensionDefinition => ({
  manifest: {
    id,
    apiVersion: 1,
    version: "1",
    provides: { "text.transform": 1 },
  },
  activate(ctx) {
    ctx.provide("text.transform", 1, {
      name: prefix,
      description: `${prefix} 的回复`,
      transform: async (text: string) => `${prefix}：${text}`,
    });
  },
});

async function setup() {
  const host = new Host(memoryPlatform().platform);
  host.install(service("transform.a", "甲"));
  host.install(service("transform.b", "乙"));
  host.install(agentExtension());
  await host.grant("agents.local", ["state.read", "state.write"]);
  await host.start("transform.a");
  await host.start("agents.local");
  await host.start("transform.b");
  const agents = () => host.peekService<AgentProvider>("agents", 1)!;
  const last = (id: string) =>
    agents()
      .list()
      .find((agent) => agent.id === id)!
      .sessions[0].messages.at(-1)?.text;
  return { host, agents, last };
}

it("an Agent uses the extensions switched on for it, in the order they were added", async () => {
  const { host, agents, last } = await setup();
  expect(agents().extensionChoices!().map(({ id }) => id)).toEqual([
    "transform.a",
    "transform.b",
  ]);
  expect(agents().info.extensions).toEqual([
    { id: "agents.local", label: "agents.local" },
  ]);
  expect(agents().info.description).toBe("甲 的回复");
  const agent = await agents().create({ name: "写作助手" });
  expect(agent.extensions).toEqual(["transform.a"]);
  await agents().send(agent.id, "你好");
  expect(last(agent.id)).toBe("甲：你好");
  await agents().setExtension!(agent.id, "transform.b", true);
  await agents().send(agent.id, "再见");
  expect(last(agent.id)).toBe("乙：甲：再见");
  await agents().setExtension!(agent.id, "transform.a", false);
  await agents().send(agent.id, "三");
  expect(last(agent.id)).toBe("乙：三");
  await agents().setExtension!(agent.id, "transform.a", true);
  await agents().send(agent.id, "四");
  expect(last(agent.id)).toBe("甲：乙：四");
  await expect(
    agents().setExtension!(agent.id, "transform.none", true),
  ).rejects.toThrow("扩展未启用");
  await host.stop("agents.local");
  await host.start("agents.local");
  expect(agents().list()[0].extensions).toEqual(["transform.b", "transform.a"]);
});

it("an Agent with every extension switched off says so instead of replying", async () => {
  const { agents } = await setup();
  const agent = await agents().create({ name: "空" });
  await agents().setExtension!(agent.id, "transform.a", false);
  expect(agents().list()[0].extensions).toEqual([]);
  await expect(agents().send(agent.id, "你好")).rejects.toThrow(
    "没有开启的扩展",
  );
});

it("management lists every Agent under a service and switches each on or off", async () => {
  const { host, agents } = await setup();
  const a = await agents().create({ name: "代码助手" });
  const b = await agents().create({ name: "测试" });
  const named = (agent: typeof a) => ({ id: agent.id, label: agent.name });
  expect(host.users("transform.a")).toEqual([
    {
      owner: "agents.local",
      kind: "Agent",
      users: [named(a), named(b)],
      others: [],
      toggle: true,
    },
  ]);
  expect(host.users("transform.b")[0].others).toEqual([named(a), named(b)]);
  await host.toggleUser("agents.local", a.id, "transform.b", true);
  await host.toggleUser("agents.local", b.id, "transform.a", false);
  expect(host.users("transform.a")[0].users).toEqual([named(a)]);
  expect(host.users("transform.b")[0].users).toEqual([named(a)]);
  expect(
    agents()
      .list()
      .map((agent) => agent.extensions),
  ).toEqual([["transform.a", "transform.b"], []]);
});

it("sending a message does not republish the Agents to the host", async () => {
  const { host, agents } = await setup();
  const agent = await agents().create({ name: "安静" });
  const before = host.snapshot();
  await agents().send(agent.id, "你好");
  // Only the reply task starting and ending changes the host.
  expect(host.snapshot()).toBe(before + 2);
});

it("a stopped extension is skipped and returns when started again", async () => {
  const { host, agents, last } = await setup();
  const agent = await agents().create({ name: "测试" });
  await agents().setExtension!(agent.id, "transform.b", true);
  await host.stop("transform.b");
  expect(host.inspect("agents.local").status).toBe("active");
  await agents().send(agent.id, "一");
  expect(last(agent.id)).toBe("甲：一");
  expect(agents().list()[0].extensions).toEqual(["transform.a", "transform.b"]);
  expect(host.users("transform.a")[0].users).toHaveLength(1);
  await host.start("transform.b");
  await agents().send(agent.id, "二");
  expect(last(agent.id)).toBe("乙：甲：二");
  await host.stop("transform.b");
  await host.stop("transform.a");
  // Text services are optional: Agents stay available without any.
  expect(host.inspect("agents.local").status).toBe("active");
  await expect(agents().send(agent.id, "三")).rejects.toThrow("扩展管理");
});

it("Agents start without any text service and use the first one enabled later", async () => {
  const host = new Host(memoryPlatform().platform);
  host.install(service("transform.a", "甲"));
  host.install(agentExtension());
  await host.grant("agents.local", ["state.read", "state.write"]);
  await host.start("agents.local");
  const agents = () => host.peekService<AgentProvider>("agents", 1)!;
  expect(host.inspect("agents.local").status).toBe("active");
  expect(agents().info.description).toContain("添加模型连接");
  const agent = await agents().create({ name: "先建" });
  await expect(agents().send(agent.id, "早")).rejects.toThrow("扩展管理");
  await host.start("transform.a");
  await agents().send(agent.id, "好");
  expect(agents().list()[0].sessions[0].messages.at(-1)?.text).toBe("甲：好");
});

it("saved Agents without a list use the first service; a list must hold IDs", () => {
  const agent = legacyAgent();
  const sources = [
    { id: "x", label: "X", description: "" },
    { id: "y", label: "Y", description: "" },
  ];
  expect(enabledExtensions({}, sources)).toEqual(["x"]);
  expect(
    enabledExtensions({ extensions: ["y", "gone", "x"] }, sources),
  ).toEqual(["y", "x"]);
  expect(
    restoreAgents([{ ...agent, extensions: ["transform.a"] }])[0],
  ).toMatchObject({ extensions: ["transform.a"] });
  expect(() => restoreAgents([{ ...agent, extensions: [1] }])).toThrow(
    "Agent 配置损坏",
  );
  expect(() => restoreAgents([{ ...agent, extensions: "x" }])).toThrow(
    "Agent 配置损坏",
  );
});

it("a reply in flight is not saved when its extension stops meanwhile", async () => {
  const { host, agents } = await setup();
  let finish!: () => void;
  host.install({
    manifest: {
      id: "transform.slow",
      apiVersion: 1,
      version: "1",
      provides: { "text.transform": 1 },
    },
    activate(ctx) {
      ctx.provide("text.transform", 1, {
        name: "慢",
        transform: (text: string) =>
          new Promise<string>((resolve) => (finish = () => resolve(text))),
      });
    },
  });
  await host.start("transform.slow");
  const agent = await agents().create({ name: "慢回复" });
  await agents().setExtension!(agent.id, "transform.a", false);
  await agents().setExtension!(agent.id, "transform.slow", true);
  // Another service stopping and starting mid-reply does not discard it.
  const kept = agents().send(agent.id, "保留");
  await host.stop("transform.b");
  await host.start("transform.b");
  finish();
  await kept;
  const sent = agents().send(agent.id, "你好");
  await host.stop("transform.slow");
  finish();
  await expect(sent).rejects.toThrow("扩展已停用");
  expect(
    agents()
      .list()
      .find((a) => a.id === agent.id)!
      .sessions[0].messages.map((m) => m.text),
  ).toEqual(["保留", "保留"]);
});
