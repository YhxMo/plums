import { expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { Platform, StoredState } from "../modules/sdk";
import { bytes, legacyAgent, memoryPlatform } from "./fixtures/agents";
import { agentExtension } from "../modules/agents/provider";
import type { Agent, AgentProvider } from "../modules/agents/contract";

const owner = "extension.agents.local";

async function start(
  platform: Platform,
  options: Parameters<typeof agentExtension>[0] = {},
) {
  const host = new Host(platform);
  host.install({
    manifest: {
      id: "transform.test",
      apiVersion: 1,
      version: "1",
      provides: { "text.transform": 1 },
    },
    activate(ctx) {
      ctx.provide("text.transform", 1, {
        name: "测试",
        transform: async (text: string) => `回复：${text}`,
      });
    },
  });
  host.install(agentExtension(options));
  await host.grant("agents.local", ["state.read", "state.write"]);
  await host.start("transform.test");
  // A failed activation rejects here; the Host records it for inspection.
  await host.start("agents.local").catch(() => {});
  return host;
}

const provider = (host: Host) => host.peekService<AgentProvider>("agents", 1)!;

type Index = {
  version: 2;
  agents: { sessions: { id: string; shard: string; messages?: unknown }[] }[];
};
const index = (states: Map<string, StoredState>) =>
  states.get(owner)!.value as Index;
const shard = (states: Map<string, StoredState>, key: string) =>
  states.get(`${owner}+${key}`)?.value as
    { version: 1; messages: { text: string }[] } | undefined;

it("stores an index plus one shard per session in its own namespace", async () => {
  const { platform, states } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "新角色" });
  await provider(host).send(agent.id, "你好");
  const saved = index(states);
  expect(saved.version).toBe(2);
  const session = saved.agents[0].sessions[0];
  expect(session).not.toHaveProperty("messages");
  expect(session.shard).toMatch(/^s-[0-9a-f-]{36}$/);
  expect(shard(states, session.shard)!.messages.map((m) => m.text)).toEqual([
    "你好",
    "回复：你好",
  ]);
  expect([...states.keys()].sort()).toEqual([
    owner,
    `${owner}+${session.shard}`,
  ]);
});

it("saves more than 64 KiB in total across sessions and restores it", async () => {
  const { platform, states } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({
    name: "长对话",
    multiSession: true,
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

it("writes only the changed shard and removes a deleted session's shard", async () => {
  const { platform, states, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({
    name: "多会话",
    multiSession: true,
  });
  await provider(host).send(agent.id, "一");
  const first = provider(host).list()[0].currentSessionId;
  await provider(host).session(agent.id, "create");
  await provider(host).send(agent.id, "二");
  write.mockClear();
  await provider(host).send(agent.id, "三");
  const keys = write.mock.calls.map(([, update]) => update.key);
  const [other, current] = index(states).agents[0].sessions;
  // The index is rewritten only if its metadata (e.g. lastMessageAt) changed.
  expect(keys[0]).toBe(current.shard);
  expect(keys).not.toContain(other.shard);
  const removed = index(states).agents[0].sessions[0].shard;
  await provider(host).session(agent.id, "delete", first);
  expect(states.has(`${owner}+${removed}`)).toBe(false);
  expect(index(states).agents[0].sessions).toHaveLength(1);
});

it("rejects one oversized session without losing the others", async () => {
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

it("upgrades a version 1 document in place into shards", async () => {
  const { platform, states } = memoryPlatform({
    [owner]: { revision: 3, value: { version: 1, agents: [legacyAgent()] } },
  });
  const host = await start(platform);
  expect(provider(host).list()[0].sessions[0].messages).toHaveLength(2);
  const session = index(states).agents[0].sessions[0];
  expect(states.get(owner)!.revision).toBe(4);
  expect(shard(states, session.shard)!.messages.map((m) => m.text)).toEqual([
    "你好",
    "旧回复",
  ]);
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
    expect(host.inspect("transform.test").status).toBe("active");
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

it("refuses further writes when the index fails after a shard was committed", async () => {
  const { platform, write } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "一" });
  write
    .mockImplementationOnce(write.getMockImplementation()!)
    .mockRejectedValueOnce(
      Object.assign(new Error("index rejected"), { outcome: "not-committed" }),
    );
  await expect(provider(host).send(agent.id, "你好")).rejects.toThrow(
    "index rejected",
  );
  await expect(provider(host).create({ name: "二" })).rejects.toThrow(
    "重新加载",
  );
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
