import { expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { Platform, StateBatch, StoredState } from "../modules/sdk";
import { legacyAgent, memoryPlatform } from "./fixtures/agents";
import { agentExtension } from "../modules/agents/provider";
import type { Agent, AgentProvider } from "../modules/agents/contract";
import type { ChatService } from "../extensions/contracts";

const owner = "extension.agents.local";
const capabilities = ["state.read", "state.batch", "records.list"];

async function start(
  platform: Platform,
  options: Parameters<typeof agentExtension>[0] = {},
) {
  const host = new Host(platform);
  host.install({
    manifest: {
      id: "chat.test",
      apiVersion: 1,
      version: "1",
      provides: { chat: 1 },
    },
    activate(ctx) {
      ctx.provide("chat", 1, {
        name: "测试",
        models: () => [{ id: "m", label: "M", description: "" }],
        subscribe: () => () => {},
        reply: async ({ input }) => `回复：${input}`,
      } satisfies ChatService);
    },
  });
  host.install(agentExtension(options));
  await host.grant("agents.local", capabilities);
  await host.start("chat.test");
  // A failed activation rejects here; the Host records it for inspection.
  await host.start("agents.local").catch(() => {});
  return host;
}

const provider = (host: Host) => host.peekService<AgentProvider>("agents", 1)!;

type Index = {
  version: number;
  agents: (Record<string, unknown> & {
    sessions: Record<string, unknown>[];
  })[];
};
const index = (documents: Record<string, StoredState>) =>
  documents[owner].value as Index;
/** The batches written, newest last. */
const batches = (write: ReturnType<typeof memoryPlatform>["write"]) =>
  write.mock.calls
    .filter(([, capability]) => capability === "state.batch")
    .map(([, , payload]) => payload as StateBatch);
const texts = (agent: Agent | undefined, session = 0) =>
  agent!.sessions[session].messages.map((m) => m.text);

it("keeps the index as a document and each message as a record", async () => {
  const { platform, documents, records } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "新角色" });
  await provider(host).send(agent.id, "你好");
  const saved = index(documents());
  expect(saved.version).toBe(4);
  const session = saved.agents[0].sessions[0];
  expect(session).not.toHaveProperty("messages");
  expect(session).not.toHaveProperty("pages");
  expect(Object.keys(documents())).toEqual([owner]);
  const stored = records(owner, `session:${String(session.id)}`);
  const [question, answer] = provider(host).list()[0].sessions[0].messages;
  expect(stored).toMatchObject([
    { id: question.id, parent: null, text: "你好", value: question },
    {
      id: answer.id,
      parent: question.id,
      text: "回复：你好",
      value: answer,
    },
  ]);
});

it("writes only new messages, in one batch with the index", async () => {
  const { platform, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "长上下文" });
  const text = (i: number) => `${i}` + "长".repeat(200_000);
  for (let i = 0; i < 3; i++) await provider(host).send(agent.id, text(i));
  write.mockClear();
  await provider(host).send(agent.id, text(3));
  const [batch] = batches(write);
  expect(write).toHaveBeenCalledOnce();
  expect(batch.documents).toHaveLength(1);
  expect(batch.records!.map((record) => record.text)).toEqual([
    text(3),
    `回复：${text(3)}`,
  ]);
  const restarted = await start(platform);
  expect(texts(provider(restarted).list()[0])).toEqual(
    [0, 1, 2, 3].flatMap((i) => [text(i), `回复：${text(i)}`]),
  );
});

it("reads every session's records together, within the activation time", async () => {
  const { platform } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "多会话" });
  for (let i = 0; i < 20; i++) {
    if (i) await provider(host).session(agent.id, "create");
    await provider(host).send(agent.id, `第 ${i} 个`);
  }
  // One after another, twenty 50 ms reads would pass the Host's 800 ms limit.
  const slow: Platform = {
    ...platform,
    async call(key, capability, payload, signal) {
      if (capability === "records.list")
        await new Promise((resolve) => setTimeout(resolve, 50));
      return platform.call(key, capability, payload, signal);
    },
  };
  const restarted = await start(slow);
  expect(restarted.inspect("agents.local").status).toBe("active");
  expect(provider(restarted).list()[0].sessions).toHaveLength(20);
});

it("reads a session longer than one page", async () => {
  const { platform } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "很多条" });
  for (let i = 0; i < 120; i++) await provider(host).send(agent.id, `${i}`);
  const restarted = await start(platform);
  expect(texts(provider(restarted).list()[0])).toEqual(
    Array.from({ length: 120 }, (_, i) => [`${i}`, `回复：${i}`]).flat(),
  );
});

it("touches only the changed session and clears a deleted one", async () => {
  const { platform, write, records } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "多会话" });
  await provider(host).send(agent.id, "一");
  const first = provider(host).list()[0].currentSessionId;
  await provider(host).session(agent.id, "create");
  await provider(host).send(agent.id, "二");
  const second = provider(host).list()[0].currentSessionId;
  write.mockClear();
  await provider(host).send(agent.id, "三");
  expect(
    new Set(batches(write)[0].records!.map((record) => record.collection)),
  ).toEqual(new Set([`session:${second}`]));
  write.mockClear();
  await provider(host).session(agent.id, "delete", first);
  expect(batches(write)[0]).toMatchObject({ clear: [`session:${first}`] });
  expect(records(owner, `session:${first}`)).toEqual([]);
  expect(records(owner, `session:${second}`)).toHaveLength(4);
});

it("a refused batch leaves everything stored as it was", async () => {
  const { platform, storage, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "边界" });
  await provider(host).send(agent.id, "保留");
  const before = new Map(storage);
  // A message over the record limit is refused by the store itself.
  await expect(
    provider(host).send(agent.id, "\u0001".repeat(1_000_000)),
  ).rejects.toThrow();
  write.mockRejectedValueOnce(
    Object.assign(new Error("disk full"), { outcome: "not-committed" }),
  );
  await expect(provider(host).send(agent.id, "大")).rejects.toThrow(
    "disk full",
  );
  expect(storage).toEqual(before);
  await provider(host).send(agent.id, "之后");
  expect(texts(provider(host).list()[0])).toEqual([
    "保留",
    "回复：保留",
    "之后",
    "回复：之后",
  ]);
});

it("refuses further writes after an unknown write receipt", async () => {
  const { platform, write } = memoryPlatform();
  const host = await start(platform);
  write.mockRejectedValueOnce(
    Object.assign(new Error("receipt lost"), { outcome: "unknown" }),
  );
  await expect(provider(host).create({ name: "一" })).rejects.toThrow(
    "receipt lost",
  );
  await expect(provider(host).create({ name: "二" })).rejects.toThrow(
    "重新加载",
  );
  expect(write).toHaveBeenCalledOnce();
});

it("allows a retry after a write that was definitely not committed", async () => {
  const { platform, write } = memoryPlatform();
  const host = await start(platform);
  write.mockRejectedValueOnce(
    Object.assign(new Error("disk full"), { outcome: "not-committed" }),
  );
  await expect(provider(host).create({ name: "一" })).rejects.toThrow(
    "disk full",
  );
  await provider(host).create({ name: "二" });
  expect(
    provider(host)
      .list()
      .map((agent) => agent.name),
  ).toEqual(["二"]);
});

/** A version 3 store: the index names each session's pages and the picture. */
function version3() {
  const { sessions, ...agent } = legacyAgent();
  const { messages, ...meta } = sessions[0];
  const json = JSON.stringify(messages);
  return {
    [owner]: {
      revision: 5,
      value: {
        version: 3,
        agents: [
          {
            ...agent,
            avatar: "a-0000000000000001",
            sessions: [
              {
                ...meta,
                pages: ["p-0000000000000001", "p-0000000000000002"],
              },
            ],
          },
        ],
      },
    },
    [`${owner}+p-0000000000000001`]: {
      revision: 1,
      value: { version: 2, part: json.slice(0, 20) },
    },
    [`${owner}+p-0000000000000002`]: {
      revision: 1,
      value: { version: 2, part: json.slice(20) },
    },
    [`${owner}+a-0000000000000001`]: {
      revision: 1,
      value: { version: 1, image },
    },
  };
}

it("reads version 3 pages as they are and moves them into records on the next save", async () => {
  const { platform, documents, records, write } = memoryPlatform(version3());
  const host = await start(platform);
  expect(write).not.toHaveBeenCalled();
  const [agent] = provider(host).list();
  expect(texts(agent)).toEqual(["你好", "旧回复"]);
  expect(agent.avatar).toBe(image);
  await provider(host).update(agent.id, { name: "新名字" });
  expect(Object.keys(documents())).toEqual([owner]);
  expect(index(documents())).toMatchObject({ version: 4 });
  expect(index(documents()).agents[0]).not.toHaveProperty("avatar");
  expect(records(owner, "session:s1").map((record) => record.text)).toEqual([
    "你好",
    "旧回复",
  ]);
  expect(records(owner, "avatars")).toMatchObject([
    { id: "a1", value: { version: 1, image } },
  ]);
  const restarted = await start(platform);
  expect(provider(restarted).list()[0]).toMatchObject({
    name: "新名字",
    avatar: image,
  });
});

it("moves version 2 shards and a version 1 document into records too", async () => {
  const { sessions, ...agent } = legacyAgent();
  const { messages, ...meta } = sessions[0];
  for (const initial of [
    {
      [owner]: {
        revision: 3,
        value: {
          version: 2,
          agents: [{ ...agent, sessions: [{ ...meta, shard: "s-old" }] }],
        },
      },
      [`${owner}+s-old`]: { revision: 1, value: { version: 1, messages } },
    },
    {
      [owner]: { revision: 3, value: { version: 1, agents: [legacyAgent()] } },
    },
  ] as Record<string, StoredState>[]) {
    const { platform, documents, records } = memoryPlatform(initial);
    const host = await start(platform);
    const [restored] = provider(host).list();
    expect(texts(restored)).toEqual(["你好", "旧回复"]);
    await provider(host).setModel!(restored.id, {
      provider: "chat.test",
      model: "m",
    });
    await provider(host).send(restored.id, "新");
    expect(Object.keys(documents())).toEqual([owner]);
    expect(records(owner, "session:s1").map((record) => record.text)).toEqual([
      "你好",
      "旧回复",
      "新",
      "回复：新",
    ]);
  }
});

it("moves a large store in several batches, writing the index last", async () => {
  const initial = version3();
  const big = { ...legacyAgent().sessions[0] };
  big.messages = Array.from({ length: 1500 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 ? ("agent" as const) : ("user" as const),
    text: `${i}`,
  }));
  const json = JSON.stringify(big.messages);
  const value = initial[owner].value as Index;
  value.agents[0].sessions[0].pages = ["p-0000000000000001"];
  initial[`${owner}+p-0000000000000001`].value.part = json;
  delete (initial as Record<string, unknown>)[`${owner}+p-0000000000000002`];
  const { platform, documents, records, write } = memoryPlatform(initial);
  const host = await start(platform);
  const [agent] = provider(host).list();
  // The second batch fails: the version 3 index still names every page.
  write
    .mockImplementationOnce(write.getMockImplementation()!)
    .mockRejectedValueOnce(
      Object.assign(new Error("disk full"), { outcome: "not-committed" }),
    );
  await expect(
    provider(host).update(agent.id, { name: "改名" }),
  ).rejects.toThrow("disk full");
  expect(index(documents()).version).toBe(3);
  const again = await start(platform);
  expect(texts(provider(again).list()[0])).toHaveLength(1500);
  write.mockClear();
  await provider(again).update(agent.id, { name: "改名" });
  // Parts with records and no index, then the index, then removing the pages.
  const written = batches(write);
  const indexed = written.findIndex((batch) =>
    batch.documents?.some((document) => !document.remove),
  );
  expect(indexed).toBeGreaterThan(0);
  expect(
    written.slice(0, indexed).every((batch) => !batch.documents?.length),
  ).toBe(true);
  expect(
    written
      .slice(indexed + 1)
      .every((batch) => batch.documents!.every((document) => document.remove)),
  ).toBe(true);
  expect(records(owner, "session:s1")).toHaveLength(1500);
  expect(index(documents()).version).toBe(4);
});

it("gives legacy ids that cannot name a record new ones", async () => {
  const legacy = legacyAgent();
  legacy.id = "Agent 一";
  legacy.sessions[0].id = "会话";
  legacy.currentSessionId = "会话";
  legacy.sessions[0].messages[1].id = "m1";
  const { platform, records } = memoryPlatform({
    [owner]: { revision: 1, value: { version: 1, agents: [legacy] } },
  });
  const host = await start(platform);
  const [agent] = provider(host).list();
  const session = agent.sessions[0];
  expect(agent.currentSessionId).toBe(session.id);
  expect(new Set(session.messages.map((m) => m.id)).size).toBe(2);
  await provider(host).update(agent.id, { avatar: image });
  expect(
    records(owner, `session:${session.id}`).map((record) => record.text),
  ).toEqual(["你好", "旧回复"]);
  expect(records(owner, "avatars")).toMatchObject([{ id: agent.id }]);
});

it("migrates legacy shell Agents once, then retires the legacy field", async () => {
  const { platform, documents } = memoryPlatform();
  const retireLegacy = vi.fn(async () => {});
  const host = await start(platform, {
    legacy: [legacyAgent()],
    retireLegacy,
  });
  expect(host.inspect("agents.local").status).toBe("active");
  const saved = index(documents()).agents[0];
  expect(saved).toMatchObject({ name: "旧角色", status: "idle" });
  expect(saved).not.toHaveProperty("canCancel");
  expect(provider(host).list()[0].sessions[0].messages).toHaveLength(2);
  expect(retireLegacy).toHaveBeenCalledOnce();
});

it("prefers already migrated state and still retires a leftover legacy field", async () => {
  const { platform, write } = memoryPlatform({
    [owner]: { revision: 3, value: { version: 4, agents: [] } },
  });
  const retireLegacy = vi.fn(async () => {});
  const host = await start(platform, {
    legacy: [legacyAgent()],
    retireLegacy,
  });
  expect(provider(host).list()).toEqual([]);
  expect(write).not.toHaveBeenCalled();
  expect(retireLegacy).toHaveBeenCalledOnce();
});

it("keeps the extension usable when retiring the legacy field fails", async () => {
  const { platform } = memoryPlatform();
  const host = await start(platform, {
    legacy: [legacyAgent()],
    retireLegacy: async () => {
      throw new Error("shell write failed");
    },
  });
  expect(host.inspect("agents.local").status).toBe("active");
  expect(provider(host).list()).toHaveLength(1);
});

const {
  sessions: [legacySession],
  ...legacyEntry
} = legacyAgent();
const { messages: _messages, ...legacyMeta } = legacySession;
it.each([
  ["legacy shell field", { legacy: { malformed: true } }, {}],
  [
    "own state",
    {},
    { [owner]: { revision: 2, value: { version: 1, agents: [{ id: 1 }] } } },
  ],
  [
    "own state without its Agent list",
    {},
    { [owner]: { revision: 2, value: { version: 1 } } },
  ],
  [
    "own state version",
    {},
    { [owner]: { revision: 2, value: { version: 9 } } },
  ],
  [
    "session page",
    {},
    {
      [owner]: {
        revision: 2,
        value: {
          version: 3,
          agents: [
            {
              ...legacyEntry,
              sessions: [
                {
                  ...legacyMeta,
                  pages: ["p-0000000000000001", "p-0000000000000002"],
                },
              ],
            },
          ],
        },
      },
      [`${owner}+p-0000000000000001`]: {
        revision: 1,
        value: { version: 2, part: '[{"id":"m1",' },
      },
    },
  ],
  [
    "session shard",
    {},
    {
      [owner]: {
        revision: 2,
        value: {
          version: 2,
          agents: [
            { ...legacyEntry, sessions: [{ ...legacyMeta, shard: "s-1" }] },
          ],
        },
      },
      [`${owner}+s-1`]: { revision: 1, value: { version: 1, messages: "x" } },
    },
  ],
])(
  "corrupt %s fails only the Agent provider and keeps the data",
  async (_label, options, initial) => {
    const { platform, documents, write } = memoryPlatform(initial);
    const retireLegacy = vi.fn(async () => {});
    const host = await start(platform, { ...options, retireLegacy });
    expect(host.inspect("chat.test").status).toBe("active");
    expect(host.inspect("agents.local")).toMatchObject({ status: "failed" });
    expect(write).not.toHaveBeenCalled();
    expect(retireLegacy).not.toHaveBeenCalled();
    expect(documents()).toEqual(initial);
  },
);

it("a damaged message record fails only the Agent provider and keeps it", async () => {
  const { platform, storage } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "一" });
  await provider(host).send(agent.id, "你好");
  const key = `plums:${owner}#records`;
  const stored = JSON.parse(storage.get(key)!);
  stored.records[0].value = { role: "nobody" };
  storage.set(key, JSON.stringify(stored));
  const before = new Map(storage);
  const restarted = await start(platform);
  expect(restarted.inspect("agents.local")).toMatchObject({ status: "failed" });
  expect(storage).toEqual(before);
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const image = `data:image/png;base64,${PNG}`;

it("keeps an avatar as its own record, apart from the index, and restores it", async () => {
  const { platform, documents, records, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "有头像" });
  await provider(host).update(agent.id, { avatar: image });
  expect(JSON.stringify(index(documents()))).not.toContain(PNG);
  expect(records(owner, "avatars")).toMatchObject([
    { id: agent.id, value: { version: 1, image } },
  ]);
  // Messages saved later leave the avatar alone.
  write.mockClear();
  await provider(host).send(agent.id, "你好");
  expect(
    batches(write)[0].records!.some(
      (record) => record.collection === "avatars",
    ),
  ).toBe(false);
  const restarted = await start(platform);
  expect(provider(restarted).list()[0].avatar).toBe(image);
  const jpeg = image.replace("png", "jpeg");
  await provider(restarted).update(agent.id, { avatar: jpeg });
  expect(records(owner, "avatars")).toMatchObject([
    { id: agent.id, value: { image: jpeg }, revision: 2 },
  ]);
  await provider(restarted).update(agent.id, { avatar: null });
  expect(records(owner, "avatars")).toEqual([]);
});

it("starts without the avatar when its record is damaged, and replaces it later", async () => {
  const { platform, storage, records } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "有头像" });
  await provider(host).update(agent.id, { avatar: image });
  const key = `plums:${owner}#records`;
  const stored = JSON.parse(storage.get(key)!);
  for (const record of stored.records)
    if (record.collection === "avatars")
      record.value = { version: 1, image: 5 };
  storage.set(key, JSON.stringify(stored));
  const restarted = await start(platform);
  expect(restarted.inspect("agents.local").status).toBe("active");
  expect(provider(restarted).list()[0]).not.toHaveProperty("avatar");
  await provider(restarted).update(agent.id, { avatar: image });
  expect(records(owner, "avatars")).toMatchObject([{ value: { image } }]);
});

it("removing an Agent removes its avatar and messages", async () => {
  const { platform, records } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "有头像" });
  await provider(host).update(agent.id, { avatar: image });
  await provider(host).send(agent.id, "你好");
  const session = provider(host).list()[0].currentSessionId;
  await provider(host).remove(agent.id);
  expect(records(owner, "avatars")).toEqual([]);
  expect(records(owner, `session:${session}`)).toEqual([]);
});

it("restores a message put back by undo to its place after a restart", async () => {
  const { platform } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "撤销后重启" });
  await provider(host).send(agent.id, "一");
  await provider(host).send(agent.id, "二");
  const session = provider(host).list()[0].sessions[0];
  await provider(host).removeMessage!(
    agent.id,
    session.id,
    session.messages[1].id,
  );
  await provider(host).undo!(agent.id);
  const order = ["一", "回复：一", "二", "回复：二"];
  expect(texts(provider(host).list()[0])).toEqual(order);
  const restarted = await start(platform);
  expect(texts(provider(restarted).list()[0])).toEqual(order);
});
