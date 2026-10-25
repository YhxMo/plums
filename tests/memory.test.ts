import { expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { ExtensionDefinition } from "../modules/sdk";
import type { ChatService } from "../extensions/contracts";
import { agentExtension } from "../modules/agents/provider";
import { OWNER, type AgentProvider } from "../modules/agents/contract";
import { memoryExtension } from "../modules/agents/memory/extension";
import { IDLE, MemoryStore } from "../modules/agents/memory/store";
import { emptyMemory } from "../modules/agents/memory/persistence";
import type { MemoryMessage } from "../modules/agents/memory/contract";
import { CONSOLIDATION_INSTRUCTIONS } from "../modules/agents/memory/consolidate";
import { memoryPlatform } from "./fixtures/agents";

type Request = Parameters<ChatService["reply"]>[0];

/**
 * A chat provider with two models: replies echo, and a consolidation
 * answers with whatever `answer` holds for it.
 */
function chat(
  requests: Request[],
  answer: { text: string },
): ExtensionDefinition {
  return {
    manifest: {
      id: "chat.a",
      apiVersion: 1,
      version: "1",
      provides: { chat: 1 },
    },
    activate(ctx) {
      ctx.provide("chat", 1, {
        name: "chat.a",
        models: () =>
          ["m1", "cheap"].map((id) => ({ id, label: id, description: "" })),
        subscribe: () => () => {},
        async reply(request: Request) {
          requests.push(structuredClone(request));
          if (request.instructions === CONSOLIDATION_INSTRUCTIONS)
            return answer.text;
          return `回复：${request.input}`;
        },
      } satisfies ChatService);
    },
  };
}

async function setup(platform = memoryPlatform()) {
  const requests: Request[] = [];
  const answer = { text: '{"add":[],"update":[],"delete":[]}' };
  const host = new Host(platform.platform);
  host.install(chat(requests, answer));
  host.install(memoryExtension());
  host.install(agentExtension());
  for (const id of ["memory.local", "agents.local"])
    await host.grant(id, ["state.read", "state.batch", "records.list"]);
  await host.start("chat.a");
  await host.start("memory.local");
  await host.start("agents.local");
  const agents = () => host.peekService<AgentProvider>("agents", 1)!;
  const memory = () => host.peekService<MemoryStore>("memory", 1)!;
  const replies = () =>
    requests.filter((r) => r.instructions !== CONSOLIDATION_INSTRUCTIONS);
  const consolidations = () =>
    requests.filter((r) => r.instructions === CONSOLIDATION_INSTRUCTIONS);
  return {
    host,
    platform,
    agents,
    memory,
    requests,
    replies,
    consolidations,
    answer,
  };
}

it("learns from a conversation and tells only that Agent what it learned", async () => {
  const { agents, memory, replies, consolidations, answer } = await setup();
  const a = await agents().create({ name: "甲", instructions: "设定甲" });
  const b = await agents().create({ name: "乙" });
  await memory().add({ kind: "person", person: "me" }, { text: "叫小叶" });
  await agents().send(a.id, "我对花生过敏");
  answer.text =
    '```json\n{"add":[{"text":"对花生过敏"}],"update":[],"delete":[]}\n```';
  await memory().consolidate(a.id);
  expect(consolidations()).toHaveLength(1);
  expect(consolidations()[0]).toMatchObject({ model: "m1", history: [] });
  expect(consolidations()[0].input).toContain("对方：我对花生过敏");
  expect(memory().count(a.id, "me")).toBe(1);
  expect(memory().reports()[0]).toMatchObject({
    agent: a.id,
    added: ["对花生过敏"],
  });
  // Nothing new: no second call.
  await memory().consolidate(a.id);
  expect(consolidations()).toHaveLength(1);
  await agents().send(a.id, "晚饭吃什么？");
  await agents().send(b.id, "你好");
  const [, toA, toB] = replies();
  expect(toA.instructions).toMatch(
    /设定甲\n\n## 关于对方\n.*\n- 叫小叶\n\n## 你记得的事\n.*\n- 对花生过敏$/s,
  );
  expect(toB.instructions).toContain("叫小叶");
  expect(toB.instructions).not.toContain("花生");
});

it("keeps a failed consolidation pending and never falls back to another model", async () => {
  const { agents, memory, consolidations, answer } = await setup();
  const a = await agents().create({ name: "甲" });
  await agents().send(a.id, "我下周三有课");
  answer.text = "好的，我记住了";
  await memory().consolidate(a.id);
  const agent = () =>
    memory()
      .snapshot()
      .agents.find((x) => x.id === a.id)!;
  expect(agent()).toMatchObject({ pending: true });
  expect(agent().problem).toContain("JSON");
  expect(memory().count(a.id, "me")).toBe(0);
  // A chosen model that is gone is not swapped for the Agent's own.
  await memory().setModel(a.id, { provider: "chat.a", model: "gone" });
  await memory().consolidate(a.id);
  expect(consolidations()).toHaveLength(1);
  expect(agent().problem).toContain("gone");
  await memory().setModel(a.id, { provider: "chat.a", model: "cheap" });
  answer.text = '{"add":[{"text":"10月28日有课","at":"2026-10-28"}]}';
  await memory().consolidate(a.id);
  expect(consolidations().at(-1)?.model).toBe("cheap");
  expect(agent()).toMatchObject({ pending: false });
  expect(agent()).not.toHaveProperty("problem");
});

it("learns nothing said while memory was off, and forgets an Agent that is removed", async () => {
  const { agents, memory, replies, consolidations, answer } = await setup();
  const a = await agents().create({ name: "甲" });
  await memory().add(
    { kind: "agent", agent: a.id, person: "me" },
    { text: "喜欢猫" },
  );
  await agents().setOff!(a.id, "memory.local", true);
  await agents().send(a.id, "我搬家了");
  expect(replies()[0].instructions).not.toContain("喜欢猫");
  expect(
    memory()
      .snapshot()
      .agents.map((x) => x.id),
  ).not.toContain(a.id);
  await agents().setOff!(a.id, "memory.local", false);
  answer.text = '{"add":[{"text":"搬家了"}]}';
  await memory().consolidate(a.id);
  expect(consolidations()).toHaveLength(0);
  await agents().send(a.id, "还在吗");
  expect(replies()[1].instructions).toContain("喜欢猫");
  await agents().remove(a.id);
  await expect.poll(() => memory().snapshot().items.length).toBe(0);
});

it("keeps memory across restarts, and does not learn conversations from before it was added", async () => {
  const platform = memoryPlatform();
  const before = new Host(platform.platform);
  before.install(chat([], { text: "" }));
  before.install(agentExtension());
  await before.grant("agents.local", [
    "state.read",
    "state.batch",
    "records.list",
  ]);
  await before.start("chat.a");
  await before.start("agents.local");
  const service = before.peekService<AgentProvider>("agents", 1)!;
  const old = await service.create({ name: "老朋友" });
  await service.send(old.id, "很久以前说的话");
  await before.stop("agents.local");
  const { host, agents, memory, consolidations, answer } =
    await setup(platform);
  await expect
    .poll(() => platform.documents()["extension.memory.local"])
    .toBeDefined();
  await memory().consolidate(old.id);
  expect(consolidations()).toHaveLength(0);
  // Two messages within one millisecond are rare outside tests.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await agents().send(old.id, "我叫小叶");
  answer.text = '{"add":[{"text":"叫小叶"}]}';
  await memory().consolidate(old.id);
  expect(consolidations()[0].input).not.toContain("很久以前");
  await host.stop("agents.local");
  await host.stop("memory.local");
  await host.start("memory.local");
  await host.start("agents.local");
  expect(
    memory()
      .snapshot()
      .items.map((i) => i.text),
  ).toEqual(["叫小叶"]);
  expect(agents().list()[0].id).toBe(old.id);
});

it("undoes a consolidation while its items are as it left them", async () => {
  const { agents, memory, answer } = await setup();
  const a = await agents().create({ name: "甲" });
  await memory().add(
    { kind: "agent", agent: a.id, person: "me" },
    { text: "住在上海" },
  );
  await agents().send(a.id, "我搬到新加坡了");
  answer.text = '{"update":[{"id":1,"text":"住在新加坡"}]}';
  await memory().consolidate(a.id);
  const [report] = memory().reports();
  expect(report.changed).toEqual(["住在新加坡"]);
  await memory().undo(report.id);
  expect(
    memory()
      .snapshot()
      .items.map((i) => i.text),
  ).toEqual(["住在上海"]);
  await expect(memory().undo(report.id)).rejects.toThrow("没有可撤销");
});

it("consolidates once a conversation rests, or at once when the person leaves it", async () => {
  vi.useFakeTimers();
  try {
    const asked: string[] = [];
    const messages: MemoryMessage[] = [];
    const store = new MemoryStore(
      emptyMemory(),
      async () => {},
      async ({ input }) => {
        asked.push(input);
        return '{"add":[]}';
      },
      () => [
        {
          provider: "chat.a",
          providerLabel: "A",
          group: "A",
          id: "m1",
          label: "m1",
          description: "",
        },
      ],
      async () => {},
      { now: () => 10, timeZone: () => "Asia/Singapore" },
    );
    store.connect({
      agents: () => [
        { id: "a", name: "甲", model: { provider: "chat.a", model: "m1" } },
      ],
      messages: (_agent, after) => messages.filter((m) => m.at > after),
      subscribe: () => () => {},
    });
    const say = (text: string, at: number) => {
      messages.push({
        id: text,
        session: "s",
        from: "me",
        role: "user",
        text,
        at,
      });
      store.notify("a", "saved");
    };
    say("一", 20);
    await vi.advanceTimersByTimeAsync(IDLE - 1000);
    say("二", 30);
    await vi.advanceTimersByTimeAsync(IDLE - 1000);
    expect(asked).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/一[\s\S]*二/);
    say("三", 40);
    store.notify("a", "left");
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toHaveLength(2);
    expect(asked[1]).not.toContain("二");
    // Leaving with nothing new asks nothing.
    store.notify("a", "left");
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(asked).toHaveLength(2);
    await store.close();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a new Agent's unconsolidated messages pending across a restart", async () => {
  const { host, agents, memory, consolidations, answer } = await setup();
  const a = await agents().create({ name: "甲" });
  await agents().send(a.id, "我对花生过敏");
  await host.stop("agents.local");
  await host.stop("memory.local");
  await host.start("memory.local");
  await host.start("agents.local");
  expect(memory().snapshot().agents[0]).toMatchObject({ pending: true });
  answer.text = '{"add":[{"text":"对花生过敏"}]}';
  await memory().consolidate(a.id);
  expect(consolidations()[0].input).toContain("我对花生过敏");
});

it("clears the expired items of one scope at once, and nothing else", async () => {
  let saved = emptyMemory();
  const now = Date.UTC(2026, 9, 25, 12);
  const store = new MemoryStore(
    emptyMemory(),
    async (data) => {
      saved = structuredClone(data);
    },
    async () => '{"add":[]}',
    () => [],
    async () => {},
    { now: () => now, timeZone: () => "UTC" },
  );
  const mine = { kind: "agent", agent: "a", person: OWNER } as const;
  const theirs = { kind: "agent", agent: "b", person: OWNER } as const;
  await store.add(mine, { text: "上周的课", at: now - 7 * 864e5 });
  await store.add(mine, { text: "已结束的旅行", until: now - 864e5 });
  await store.add(mine, { text: "对花生过敏" });
  await store.add(theirs, { text: "别人的旧事", at: now - 864e5 });
  await store.clearExpired(mine);
  expect(saved.items.map((item) => item.text).sort()).toEqual(
    ["别人的旧事", "对花生过敏"].sort(),
  );
});
