import { describe, expect, it } from "vitest";
import {
  AgentStore,
  MAX_TEXT,
  parseRoleCard,
  restoreAgents,
} from "../modules/agents/store";
import { legacyAgent } from "./fixtures/agents";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("agent extension data", () => {
  it("drops fields older versions saved and gives every Agent several sessions", async () => {
    const [restored] = restoreAgents([legacyAgent()]);
    expect(restored).not.toHaveProperty("capabilities");
    expect(restored).not.toHaveProperty("multiSession");
    expect(restored).not.toHaveProperty("extensions");
    const store = new AgentStore(
      [restored],
      async () => {},
      async (t) => t,
    );
    await store.session(restored.id, "create");
    expect(store.list()[0].sessions).toHaveLength(2);
  });
  it("reads role cards that still carry the old multiSession field", () => {
    expect(
      parseRoleCard('{"version":1,"name":"旧卡","multiSession":true}'),
    ).toEqual({ name: "旧卡", description: undefined });
  });
  it("adds, pins and restores independent sessions without persisting runtime status", async () => {
    let saved: unknown;
    const store = new AgentStore(
      [],
      async (agents) => {
        saved = structuredClone(agents);
      },
      async (text) => text.toUpperCase(),
    );
    const a = await store.create({ name: "本地助手" });
    await store.update(a.id, { pinned: true });
    await store.send(a.id, "first");
    await store.session(a.id, "create");
    await store.send(a.id, "second");
    const restored = restoreAgents(saved);
    expect(restored[0].pinned).toBe(true);
    expect(restored[0].sessions.map((s) => s.messages.at(-1)?.text)).toEqual([
      "FIRST",
      "SECOND",
    ]);
    expect(restored[0].status).toBe("idle");
  });
  it("a rejected write does not falsely add or remove an agent", async () => {
    const store = new AgentStore(
      [],
      async () => {
        throw Error("disk full");
      },
      async (text) => text,
    );
    await expect(store.create({ name: "unsaved" })).rejects.toThrow(
      "disk full",
    );
    expect(store.list()).toEqual([]);
  });
  it("cancel and a failed response leave the last saved conversation intact", async () => {
    let finish: (text: string) => void = () => {};
    const store = new AgentStore(
      [],
      async () => {},
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const a = await store.create({ name: "test" });
    const pending = store.send(a.id, "cancel me");
    await Promise.resolve();
    store.cancel(a.id);
    finish("late");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(store.list()[0].sessions[0].messages).toEqual([]);
    expect(store.list()[0].status).toBe("idle");
  });
  it("refuses malformed or unsupported cards and preserves corrupt saved data", () => {
    expect(
      parseRoleCard('{"name":"写作助手","description":"帮助整理结构"}').name,
    ).toBe("写作助手");
    expect(() => parseRoleCard('{"name":"","model":"x"}')).toThrow();
    expect(() => restoreAgents([{ id: "bad" }])).toThrow();
  });
  it("serializes changes and retains a session after deleting the current last session", async () => {
    const store = new AgentStore(
      [],
      async () => {},
      async (text) => text,
    );
    const a = await store.create({ name: "test" });
    await Promise.all([
      store.update(a.id, { name: "renamed" }),
      store.update(a.id, { pinned: true }),
    ]);
    await store.session(a.id, "delete", a.currentSessionId);
    expect(store.list()[0]).toMatchObject({ name: "renamed", pinned: true });
    expect(store.list()[0].sessions).toHaveLength(1);
  });
});

it("cancels before a queued save dispatches and accepts a dispatched commit receipt", async () => {
  let hold = false;
  let dispatched = false;
  let enter = deferred();
  let release = deferred();
  let writes = 0;
  const store = new AgentStore(
    [],
    async (_agents, options) => {
      if (hold) {
        if (dispatched) options?.onCommit?.();
        enter.resolve();
        await release.promise;
      }
      options?.signal?.throwIfAborted();
      options?.onCommit?.();
      writes++;
    },
    async (text) => text.toUpperCase(),
  );
  const a = await store.create({ name: "queued" });
  hold = true;
  const cancelled = store.send(a.id, "cancel before dispatch");
  await enter.promise;
  store.cancel(a.id);
  release.resolve();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  expect(writes).toBe(1);
  expect(store.list()[0].sessions[0].messages).toEqual([]);
  enter = deferred();
  release = deferred();
  dispatched = true;
  const committed = store.send(a.id, "receipt wins");
  await enter.promise;
  expect(store.list()[0].canCancel).toBe(false);
  store.cancel(a.id);
  release.resolve();
  await committed;
  expect(writes).toBe(2);
  expect(store.list()[0].sessions[0].messages.at(-1)?.text).toBe(
    "RECEIPT WINS",
  );
});

it("reserves session changes until saved so sending cannot use the old session", async () => {
  let hold = false;
  const enter = deferred();
  const release = deferred();
  const store = new AgentStore(
    [],
    async () => {
      if (hold) {
        enter.resolve();
        await release.promise;
      }
    },
    async (text) => text,
  );
  const a = await store.create({ name: "sessions" });
  hold = true;
  const switching = store.session(a.id, "create");
  await enter.promise;
  expect(store.list()[0]).toMatchObject({ status: "busy", canCancel: false });
  await expect(store.send(a.id, "overlap")).rejects.toThrow("暂不可运行");
  release.resolve();
  await switching;
  hold = false;
  await store.send(a.id, "new session");
  expect(store.list()[0].sessions.map((s) => s.messages.length)).toEqual([
    0, 2,
  ]);
  await store.update(a.id, { description: "updated role" });
  expect(store.list()[0].description).toBe("updated role");
});

it("round trips a maximum length input and service reply, room for a 1M-token context", async () => {
  expect(MAX_TEXT).toBeGreaterThanOrEqual(1_000_000);
  let saved: unknown;
  const store = new AgentStore(
    [],
    async (agents) => {
      saved = structuredClone(agents);
    },
    async () => "x".repeat(MAX_TEXT),
  );
  const a = await store.create({ name: "boundary" });
  await expect(store.send(a.id, "y".repeat(MAX_TEXT + 1))).rejects.toThrow(
    "个字符",
  );
  await store.send(a.id, "y".repeat(MAX_TEXT));
  expect(
    restoreAgents(saved)[0].sessions[0].messages.map((m) => m.text.length),
  ).toEqual([MAX_TEXT, MAX_TEXT]);
});
for (const [label, invalid] of [
  ["oversized", "x".repeat(MAX_TEXT + 1)],
  ["non-string", 42],
  ["missing", undefined],
] as const) {
  it(`rejects a ${label} service reply before persisting an unreadable snapshot`, async () => {
    let saved: unknown;
    let output: unknown = "safe";
    let writes = 0;
    const store = new AgentStore(
      [],
      async (agents) => {
        saved = structuredClone(agents);
        writes++;
      },
      async () => output as string,
    );
    const a = await store.create({ name: "recoverable" });
    await store.send(a.id, "first");
    const before = JSON.stringify(saved);
    output = invalid;
    const rejected = await store.send(a.id, "retain draft").then(
      () => false,
      () => true,
    );
    expect(rejected).toBe(true);
    expect(writes).toBe(2);
    expect(JSON.stringify(saved)).toBe(before);
    expect(restoreAgents(saved)[0].sessions[0].messages).toHaveLength(2);
    expect(store.list()[0].status).toBe("idle");
  });
}

it("shows the sent text at once, persists it only with the reply and drops it on failure", async () => {
  const saved: unknown[] = [];
  let answer = deferred();
  let fail = false;
  const store = new AgentStore(
    [],
    async (agents) => {
      saved.push(structuredClone(agents));
    },
    async (text) => {
      await answer.promise;
      if (fail) throw new Error("service failed");
      return text.toUpperCase();
    },
  );
  const a = await store.create({ name: "quick" });
  const session = a.currentSessionId;
  const sent = store.send(a.id, "hello");
  expect(store.list()[0].pending).toEqual({
    sessionId: session,
    text: "hello",
  });
  expect(store.list()[0].sessions[0].messages).toEqual([]);
  answer.resolve();
  await sent;
  expect(store.list()[0].pending).toBeUndefined();
  expect(store.list()[0].sessions[0].messages.map((m) => m.text)).toEqual([
    "hello",
    "HELLO",
  ]);
  answer = deferred();
  fail = true;
  const failed = store.send(a.id, "lost");
  expect(store.list()[0].pending?.text).toBe("lost");
  answer.resolve();
  await expect(failed).rejects.toThrow("service failed");
  expect(store.list()[0].pending).toBeUndefined();
  expect(store.list()[0].sessions[0].messages).toHaveLength(2);
  expect(JSON.stringify(saved)).not.toContain(`"pending"`);
});

it("stamps each saved message with its own time and restores older messages without one", async () => {
  let saved: unknown;
  let clock = 1_000;
  const now = Date.now;
  Date.now = () => clock;
  try {
    const store = new AgentStore(
      [],
      async (agents) => {
        saved = structuredClone(agents);
      },
      async (text) => {
        clock = 4_000;
        return text.toUpperCase();
      },
    );
    const a = await store.create({ name: "timed" });
    await store.send(a.id, "hi");
    const [sent, reply] = restoreAgents(saved)[0].sessions[0].messages;
    expect([sent.at, reply.at]).toEqual([1_000, 4_000]);
  } finally {
    Date.now = now;
  }
  const legacy = structuredClone(saved) as {
    sessions: { messages: { at?: unknown }[] }[];
  }[];
  delete legacy[0].sessions[0].messages[0].at;
  expect(restoreAgents(legacy)[0].sessions[0].messages[0].at).toBeUndefined();
  for (const bad of ["1000", Number.NaN, null]) {
    legacy[0].sessions[0].messages[0].at = bad;
    expect(() => restoreAgents(legacy)).toThrow("会话配置损坏");
  }
});

it("removes one saved message, keeps the rest and refuses while a reply is running", async () => {
  let saved: unknown;
  const answer = deferred();
  let hold = false;
  const store = new AgentStore(
    [],
    async (agents) => {
      saved = structuredClone(agents);
    },
    async (text) => {
      if (hold) await answer.promise;
      return text.toUpperCase();
    },
  );
  const a = await store.create({ name: "tidy" });
  await store.send(a.id, "one");
  const session = store.list()[0].sessions[0];
  await store.removeMessage(a.id, session.id, session.messages[0].id);
  expect(
    restoreAgents(saved)[0].sessions[0].messages.map((m) => m.text),
  ).toEqual(["ONE"]);
  await expect(
    store.removeMessage(a.id, session.id, "missing"),
  ).rejects.toThrow("消息不存在。");
  hold = true;
  const running = store.send(a.id, "two");
  await expect(
    store.removeMessage(a.id, session.id, session.messages[1].id),
  ).rejects.toThrow("请等待回复完成或先停止当前任务，再删除消息。");
  answer.resolve();
  await running;
  expect(store.list()[0].sessions[0].messages).toHaveLength(3);
});

it("restores the longest model id the model connector offers and refuses longer ones", async () => {
  let saved: unknown;
  // A provider id, "/", and a 120-character model name.
  const longest = `p-abcdefgh/${"m".repeat(120)}`;
  const tooLong = "m".repeat(257);
  const choice = (id: string) => ({
    provider: "connector.models",
    providerLabel: "模型连接",
    group: "服务",
    id,
    label: id,
    description: "",
  });
  const store = new AgentStore(
    [],
    async (agents) => {
      saved = structuredClone(agents);
    },
    async (text) => text,
    [],
    () => [choice(longest), choice(tooLong)],
  );
  const a = await store.create({ name: "长模型名" });
  await store.setModel(a.id, { provider: "connector.models", model: longest });
  expect(restoreAgents(saved)[0].model?.model).toBe(longest);
  await expect(
    store.setModel(a.id, { provider: "connector.models", model: tooLong }),
  ).rejects.toThrow();
  expect(restoreAgents(saved)[0].model?.model).toBe(longest);
});

it("does not ask the model while saving is blocked, so retries cost nothing", async () => {
  let asked = 0;
  const lock: { reason?: string } = {};
  const store = new AgentStore(
    [],
    async () => {},
    async (text) => {
      asked++;
      return text;
    },
    [],
    () => [],
    () => lock.reason,
  );
  const a = await store.create({ name: "锁定" });
  lock.reason = "Agent 保存回执未确认，请重新加载应用后再修改。";
  await expect(store.send(a.id, "你好")).rejects.toThrow(lock.reason);
  expect(asked).toBe(0);
});
