import { expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import type {
  ExtensionDefinition,
  Platform,
  StoredState,
} from "../modules/sdk";
import { agentExtension } from "../modules/agents/provider";
import { restoreAgents } from "../modules/agents/store";
import type { AgentProvider } from "../modules/agents/contract";

function memoryPlatform(): Platform {
  const states = new Map<string, StoredState>();
  return {
    kind: "browser",
    available: () => true,
    grant: async () => {},
    async call(owner, capability, payload) {
      const { key, revision, value } = (payload ?? {}) as Partial<
        StoredState & { key: string }
      >;
      const slot = key ? `${owner}+${key}` : owner;
      if (capability === "state.read") return states.get(slot) ?? null;
      const next = { revision: (revision ?? 0) + 1, value };
      states.set(slot, next);
      return next;
    },
  };
}
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
  const host = new Host(memoryPlatform());
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

it("lists every text service and keeps each Agent's choice", async () => {
  const { host, agents, last } = await setup();
  expect(agents().replySources!().map(({ id }) => id)).toEqual([
    "transform.a",
    "transform.b",
  ]);
  expect(agents().info.extensions).toEqual([
    { id: "agents.local", label: "agents.local" },
  ]);
  expect(agents().info.description).toBe("甲 的回复");
  const agent = await agents().create({ name: "写作助手" });
  expect(agent.replySource).toBe("transform.a");
  await agents().send(agent.id, "你好");
  expect(last(agent.id)).toBe("甲：你好");
  await agents().setReplySource!(agent.id, "transform.b");
  await agents().send(agent.id, "再见");
  expect(last(agent.id)).toBe("乙：再见");
  await expect(
    agents().setReplySource!(agent.id, "transform.none"),
  ).rejects.toThrow("回复来源不可用");
  await host.stop("agents.local");
  await host.start("agents.local");
  expect(agents().list()[0].replySource).toBe("transform.b");
});

it("management shows who uses a service and can move an Agent onto it", async () => {
  const { host, agents } = await setup();
  const agent = await agents().create({ name: "代码助手" });
  const user = { id: agent.id, label: "代码助手" };
  expect(host.users("transform.a")).toEqual([
    {
      owner: "agents.local",
      kind: "Agent",
      users: [user],
      others: [],
      fallback: "transform.b",
    },
  ]);
  expect(host.users("transform.b")[0].others).toEqual([user]);
  await host.assign("agents.local", agent.id, "transform.b");
  expect(agents().list()[0].replySource).toBe("transform.b");
  expect(host.users("transform.b")[0].users).toEqual([user]);
});

it("an Agent falls back while its service is stopped and returns after", async () => {
  const { host, agents, last } = await setup();
  const agent = await agents().create({ name: "测试" });
  await agents().setReplySource!(agent.id, "transform.b");
  await host.stop("transform.b");
  expect(host.inspect("agents.local").status).toBe("active");
  await agents().send(agent.id, "一");
  expect(last(agent.id)).toBe("甲：一");
  expect(agents().list()[0].replySource).toBe("transform.b");
  expect(host.users("transform.a")[0].users).toHaveLength(1);
  await host.start("transform.b");
  await agents().send(agent.id, "二");
  expect(last(agent.id)).toBe("乙：二");
  await host.stop("transform.b");
  await host.stop("transform.a");
  expect(host.inspect("agents.local").status).toBe("waiting");
});

it("rejects a saved reply source that is not text", () => {
  const session = {
    id: "s",
    title: "会话",
    createdAt: 1,
    lastMessageAt: 1,
    messages: [],
  };
  const agent = {
    id: "a",
    name: "名",
    description: "",
    pinned: false,
    multiSession: false,
    extensionId: "agents.local",
    capabilities: [],
    sessions: [session],
    currentSessionId: "s",
  };
  expect(
    restoreAgents([{ ...agent, replySource: "transform.a" }])[0],
  ).toMatchObject({
    replySource: "transform.a",
  });
  expect(() => restoreAgents([{ ...agent, replySource: 1 }])).toThrow(
    "Agent 配置损坏",
  );
});
