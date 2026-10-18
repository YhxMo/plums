import { expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { Platform, StoredState } from "../modules/sdk";
import { agentExtension } from "../modules/agents/provider";
import type { Agent, AgentProvider } from "../modules/agents/contract";

const owner = "extension.agents.local";

function memoryPlatform(initial: Record<string, StoredState> = {}) {
  const states = new Map(Object.entries(structuredClone(initial)));
  const grants = new Map<string, Set<string>>();
  const write = vi.fn(async (key: string, update: StoredState) => {
    if (update.revision !== (states.get(key)?.revision ?? 0))
      throw Object.assign(new Error("revision conflict"), {
        outcome: "not-committed",
      });
    const next = {
      revision: update.revision + 1,
      value: structuredClone(update.value),
    };
    states.set(key, next);
    return next;
  });
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: async (key, capabilities) => {
      grants.set(key, new Set(capabilities));
    },
    call: async (key, capability, payload) => {
      if (!grants.get(key)?.has(capability)) throw new Error("denied");
      if (capability === "state.read") return states.get(key) ?? null;
      return write(key, payload as StoredState);
    },
  };
  return { platform, states, write };
}

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

function legacyAgent(): Agent {
  return {
    id: "a1",
    name: "旧角色",
    description: "旧说明",
    status: "busy",
    canCancel: true,
    pinned: true,
    extensionId: "agents.local",
    capabilities: ["本地文本处理"],
    multiSession: false,
    currentSessionId: "s1",
    sessions: [
      {
        id: "s1",
        title: "旧会话",
        createdAt: 1,
        lastMessageAt: 2,
        messages: [
          { id: "m1", role: "user", text: "你好" },
          { id: "m2", role: "agent", text: "旧回复" },
        ],
      },
    ],
  };
}

it("stores Agents in its own state namespace, not the shell snapshot", async () => {
  const { platform, states } = memoryPlatform();
  const host = await start(platform);
  const agent = await provider(host).create({ name: "新角色" });
  await provider(host).send(agent.id, "你好");
  expect([...states.keys()]).toEqual([owner]);
  const saved = states.get(owner)!.value as { version: 1; agents: Agent[] };
  expect(saved.version).toBe(1);
  expect(saved.agents[0].sessions[0].messages.map((m) => m.text)).toEqual([
    "你好",
    "回复：你好",
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
  const saved = states.get(owner)!.value as { agents: Agent[] };
  expect(saved.agents[0]).toMatchObject({ name: "旧角色", status: "idle" });
  expect(saved.agents[0]).not.toHaveProperty("canCancel");
  expect(provider(host).list()[0].sessions[0].messages).toHaveLength(2);
  expect(retireLegacy).toHaveBeenCalledOnce();
});

it("prefers already migrated state and still retires a leftover legacy field", async () => {
  const current = { version: 1, agents: [] };
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
    "own state version",
    {},
    { [owner]: { revision: 2, value: { version: 9 } } },
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
