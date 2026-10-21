import { expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { Platform, StoredState } from "../modules/sdk";
import { bytes, legacyAgent, memoryPlatform } from "./fixtures/agents";
import { agentExtension } from "../modules/agents/provider";
import type { Agent, AgentProvider } from "../modules/agents/contract";
import type { ChatService } from "../extensions/contracts";

const owner = "extension.agents.local";

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
  await host.grant("agents.local", ["state.read", "state.write"]);
  await host.start("chat.test");
  // A failed activation rejects here; the Host records it for inspection.
  await host.start("agents.local").catch(() => {});
  return host;
}

const provider = (host: Host) => host.peekService<AgentProvider>("agents", 1)!;

type Index = {
  version: 3;
  agents: { sessions: { id: string; pages: string[]; messages?: unknown }[] }[];
};
const index = (states: Map<string, StoredState>) =>
  states.get(owner)!.value as Index;
/** A session's messages as stored: its pages' text joined in order. */
const stored = (states: Map<string, StoredState>, pages: string[]) =>
  JSON.parse(
    pages
      .map(
        (key) =>
          (states.get(`${owner}+${key}`)!.value as { part: string }).part,
      )
      .join(""),
  ) as { text: string }[];

it("stores an index plus each session's pages in its own namespace", async () => {
  const { platform, states } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "新角色" });
  await provider(host).send(agent.id, "你好");
  const saved = index(states);
  expect(saved.version).toBe(3);
  const session = saved.agents[0].sessions[0];
  expect(session).not.toHaveProperty("messages");
  expect(session.pages).toHaveLength(1);
  expect(session.pages[0]).toMatch(/^p-[0-9a-f]{16}$/);
  expect(states.get(`${owner}+${session.pages[0]}`)!.value).toMatchObject({
    version: 2,
  });
  expect(stored(states, session.pages).map((m) => m.text)).toEqual([
    "你好",
    "回复：你好",
  ]);
  expect([...states.keys()].sort()).toEqual([
    owner,
    `${owner}+${session.pages[0]}`,
  ]);
});

it("keeps a conversation of several MB in 64 KiB pages, rewriting only its tail", async () => {
  const { platform, states, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "长上下文" });
  const text = (i: number) => `${i}` + "长".repeat(200_000);
  for (let i = 0; i < 3; i++) await provider(host).send(agent.id, text(i));
  const before = index(states).agents[0].sessions[0].pages;
  write.mockClear();
  await provider(host).send(agent.id, text(3));
  const pages = index(states).agents[0].sessions[0].pages;
  // Every page but the old last one is kept; only new pages and the index are written.
  expect(pages.slice(0, before.length - 1)).toEqual(before.slice(0, -1));
  expect(write.mock.calls.length).toBeLessThan(
    pages.length - before.length + 4,
  );
  const total = pages.reduce(
    (sum, key) => sum + bytes(states.get(`${owner}+${key}`)),
    0,
  );
  expect(total).toBeGreaterThan(4 * 1024 * 1024);
  expect(states.has(`${owner}+${before.at(-1)}`)).toBe(false);
  const restarted = await start(platform);
  expect(
    provider(restarted)
      .list()[0]
      .sessions[0].messages.map((m) => m.text),
  ).toEqual([0, 1, 2, 3].flatMap((i) => [text(i), `回复：${text(i)}`]));
});

it("reads a long conversation's pages together, within the activation time", async () => {
  const { platform } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "长上下文" });
  for (let i = 0; i < 2; i++)
    await provider(host).send(agent.id, "长".repeat(300_000));
  // Each page read takes 50 ms; one after another, these ~60 pages would
  // pass the Host's 800 ms activation limit.
  const slow: Platform = {
    ...platform,
    async call(key, capability, payload, signal) {
      if (capability === "state.read" && (payload as { key?: string })?.key)
        await new Promise((resolve) => setTimeout(resolve, 50));
      return platform.call(key, capability, payload, signal);
    },
  };
  const restarted = await start(slow);
  expect(restarted.inspect("agents.local").status).toBe("active");
  expect(provider(restarted).list()[0].sessions[0].messages).toHaveLength(4);
});

it("saves more than 64 KiB in total across sessions and restores it", async () => {
  const { platform, states } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({
    name: "长对话",
  });
  const text = "长".repeat(8_000);
  for (let i = 0; i < 4; i++) {
    if (i) await provider(host).session(agent.id, "create");
    await provider(host).send(agent.id, text);
  }
  const total = [...states.values()].reduce(
    (sum, state) => sum + bytes(state),
    0,
  );
  expect(total).toBeGreaterThan(65_536);
  const restarted = await start(platform);
  const sessions = provider(restarted).list()[0].sessions;
  expect(sessions).toHaveLength(4);
  for (const session of sessions)
    expect(session.messages.map((m) => m.text)).toEqual([
      text,
      `回复：${text}`,
    ]);
});

it("writes only the changed session and removes a deleted session's pages", async () => {
  const { platform, states, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({
    name: "多会话",
  });
  await provider(host).send(agent.id, "一");
  const first = provider(host).list()[0].currentSessionId;
  await provider(host).session(agent.id, "create");
  await provider(host).send(agent.id, "二");
  write.mockClear();
  await provider(host).send(agent.id, "三");
  const keys = write.mock.calls.map(([, update]) => update.key);
  const [other, current] = index(states).agents[0].sessions;
  expect(keys[0]).toBe(current.pages[0]);
  expect(keys).not.toContain(other.pages[0]);
  const removed = index(states).agents[0].sessions[0].pages[0];
  await provider(host).session(agent.id, "delete", first);
  expect(states.has(`${owner}+${removed}`)).toBe(false);
  expect(index(states).agents[0].sessions).toHaveLength(1);
});

it("a refused page write leaves everything stored as it was", async () => {
  const { platform, states, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "边界" });
  await provider(host).send(agent.id, "保留");
  const before = structuredClone(Object.fromEntries(states));
  write.mockRejectedValueOnce(
    Object.assign(new Error("状态超过 64 KiB 实验上限，未保存。"), {
      code: "state-too-large",
      outcome: "not-committed",
    }),
  );
  await expect(provider(host).send(agent.id, "大")).rejects.toThrow("64 KiB");
  expect(Object.fromEntries(states)).toEqual(before);
  await provider(host).send(agent.id, "之后");
  expect(provider(host).list()[0].sessions[0].messages).toHaveLength(4);
});

it("upgrades a version 1 document in place into pages", async () => {
  const { platform, states } = memoryPlatform({
    [owner]: { revision: 3, value: { version: 1, agents: [legacyAgent()] } },
  });
  const host = await start(platform);
  expect(provider(host).list()[0].sessions[0].messages).toHaveLength(2);
  const session = index(states).agents[0].sessions[0];
  expect(states.get(owner)!.revision).toBe(4);
  expect(stored(states, session.pages).map((m) => m.text)).toEqual([
    "你好",
    "旧回复",
  ]);
});

it("reads version 2 shards and moves them into pages on the next save", async () => {
  const { sessions, ...agent } = legacyAgent();
  const { messages, ...meta } = sessions[0];
  const { platform, states, write } = memoryPlatform({
    [owner]: {
      revision: 3,
      value: {
        version: 2,
        agents: [{ ...agent, sessions: [{ ...meta, shard: "s-old" }] }],
      },
    },
    [`${owner}+s-old`]: { revision: 1, value: { version: 1, messages } },
  });
  const host = await start(platform);
  expect(write).not.toHaveBeenCalled();
  const agentId = provider(host).list()[0].id;
  expect(provider(host).list()[0].sessions[0].messages).toHaveLength(2);
  await provider(host).setModel!(agentId, {
    provider: "chat.test",
    model: "m",
  });
  await provider(host).send(agentId, "新");
  const session = index(states).agents[0].sessions[0];
  expect(index(states).version).toBe(3);
  expect(stored(states, session.pages).map((m) => m.text)).toEqual([
    "你好",
    "旧回复",
    "新",
    "回复：新",
  ]);
  expect(states.has(`${owner}+s-old`)).toBe(false);
});

it("migrates legacy shell Agents once, then retires the legacy field", async () => {
  const { platform, states } = memoryPlatform();
  const retireLegacy = vi.fn(async () => {});
  const host = await start(platform, {
    legacy: [legacyAgent()],
    retireLegacy,
  });
  expect(host.inspect("agents.local").status).toBe("active");
  const saved = index(states).agents[0] as unknown as Agent;
  expect(saved).toMatchObject({ name: "旧角色", status: "idle" });
  expect(saved).not.toHaveProperty("canCancel");
  expect(provider(host).list()[0].sessions[0].messages).toHaveLength(2);
  expect(retireLegacy).toHaveBeenCalledOnce();
});

it("prefers already migrated state and still retires a leftover legacy field", async () => {
  const current = { version: 2, agents: [] };
  const { platform, write } = memoryPlatform({
    [owner]: { revision: 3, value: current },
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
              ...legacyAgent(),
              sessions: [
                {
                  ...legacyAgent().sessions[0],
                  messages: undefined,
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
            {
              ...legacyAgent(),
              sessions: [
                {
                  ...legacyAgent().sessions[0],
                  messages: undefined,
                  shard: "s-1",
                },
              ],
            },
          ],
        },
      },
      [`${owner}+s-1`]: { revision: 1, value: { version: 1, messages: "x" } },
    },
  ],
])(
  "corrupt %s fails only the Agent provider and keeps the data",
  async (_label, options, initial) => {
    const { platform, states, write } = memoryPlatform(initial);
    const retireLegacy = vi.fn(async () => {});
    const host = await start(platform, { ...options, retireLegacy });
    expect(host.inspect("chat.test").status).toBe("active");
    expect(host.inspect("agents.local")).toMatchObject({ status: "failed" });
    expect(write).not.toHaveBeenCalled();
    expect(retireLegacy).not.toHaveBeenCalled();
    expect(Object.fromEntries(states)).toEqual(initial);
  },
);

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

it("a refused index write leaves the conversation as it was and allows a retry", async () => {
  const { platform, states, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "一" });
  const before = structuredClone(Object.fromEntries(states));
  write
    .mockImplementationOnce(write.getMockImplementation()!)
    .mockRejectedValueOnce(
      Object.assign(new Error("index rejected"), { outcome: "not-committed" }),
    );
  // New pages are invisible until the index names them, and are cleared up.
  await expect(provider(host).send(agent.id, "你好")).rejects.toMatchObject({
    message: "index rejected",
  });
  expect(Object.fromEntries(states)).toEqual(before);
  await provider(host).send(agent.id, "再试");
  expect(
    provider(host)
      .list()[0]
      .sessions[0].messages.map((m) => m.text),
  ).toEqual(["再试", "回复：再试"]);
});

it("an unconfirmed page write fails only that save", async () => {
  const { platform, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "一" });
  write.mockRejectedValueOnce(
    Object.assign(new Error("receipt lost"), { outcome: "unknown" }),
  );
  await expect(provider(host).send(agent.id, "你好")).rejects.toMatchObject({
    outcome: "not-committed",
  });
  await provider(host).send(agent.id, "再试");
  expect(provider(host).list()[0].sessions[0].messages).toHaveLength(2);
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
