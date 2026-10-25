import { describe, expect, it } from "vitest";
import { AgentStore } from "../modules/agents/store";
import {
  MAX_AVATAR,
  MAX_TEXT,
  parseRoleCard,
  restoreAgents,
} from "../modules/agents/validation";
import { unreadReplies } from "../modules/agents/unread";
import { OWNER, speaker, type Agent } from "../modules/agents/contract";
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
  it("keeps the introduction a saved Agent was answering by as its 设定, and reads a card's own 设定", () => {
    const [restored] = restoreAgents([legacyAgent()]);
    expect(restored).toMatchObject({
      description: "旧说明",
      instructions: "旧说明",
    });
    const [split] = restoreAgents([
      { ...legacyAgent(), description: "介绍", instructions: "" },
    ]);
    expect(split).toMatchObject({ description: "介绍", instructions: "" });
    expect(() =>
      restoreAgents([{ ...legacyAgent(), instructions: 1 }]),
    ).toThrow("Agent 配置损坏");
    expect(
      parseRoleCard(
        JSON.stringify({
          name: "卡",
          description: "给人看",
          instructions: "给模型",
        }),
      ),
    ).toEqual({ name: "卡", description: "给人看", instructions: "给模型" });
    expect(() =>
      parseRoleCard(JSON.stringify({ name: "卡", instructions: ["x"] })),
    ).toThrow("instructions");
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

it("records who said each message, and reads older messages by their role", async () => {
  let saved: unknown;
  const store = new AgentStore(
    [],
    async (agents) => {
      saved = structuredClone(agents);
    },
    async (text) => text,
  );
  const a = await store.create({ name: "speaker" });
  await store.send(a.id, "hi");
  const messages = restoreAgents(saved)[0].sessions[0].messages;
  expect(messages.map((m) => m.from)).toEqual([OWNER, a.id]);
  const legacy = structuredClone(saved) as {
    sessions: { messages: { from?: unknown }[] }[];
  }[];
  delete legacy[0].sessions[0].messages[0].from;
  expect(speaker(restoreAgents(legacy)[0], messages[0])).toBe(OWNER);
  expect(speaker(restoreAgents(legacy)[0], messages[1])).toBe(a.id);
  for (const bad of [1, "", "x".repeat(129)]) {
    legacy[0].sessions[0].messages[0].from = bad;
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

describe("Agent avatars", () => {
  const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const image = `data:image/png;base64,${PNG}`;
  const make = () =>
    new AgentStore(
      [],
      async () => {},
      async (t) => t,
    );

  it("keeps a small base64 image and removes it again", async () => {
    const store = make();
    const a = await store.create({ name: "头像" });
    await store.update(a.id, { avatar: image });
    expect(store.list()[0].avatar).toBe(image);
    await store.update(a.id, { avatar: null });
    expect(store.list()[0]).not.toHaveProperty("avatar");
  });

  it("refuses links, other types, bad base64 and oversized images", async () => {
    const store = make();
    const a = await store.create({ name: "头像" });
    for (const avatar of [
      "https://example.com/a.png",
      `data:image/gif;base64,${PNG}`,
      "data:image/svg+xml;base64,PHN2Zy8+",
      "data:image/png;base64,not base64!",
      `data:image/png;base64,${"A".repeat(MAX_AVATAR)}`,
      "",
    ])
      await expect(store.update(a.id, { avatar })).rejects.toThrow("头像");
    expect(store.list()[0]).not.toHaveProperty("avatar");
  });

  it("takes an avatar from a role card, and refuses a bad one", async () => {
    expect(
      parseRoleCard(JSON.stringify({ name: "卡", avatar: image })),
    ).toEqual({ name: "卡", description: undefined, avatar: image });
    expect(() =>
      parseRoleCard(JSON.stringify({ name: "卡", avatar: "http://x/y.png" })),
    ).toThrow("头像");
    const a = await make().create({ name: "卡", avatar: image });
    expect(a.avatar).toBe(image);
  });

  it("restoring drops a damaged avatar instead of failing", () => {
    const [good, bad] = restoreAgents([
      { ...legacyAgent(), id: "g", avatar: image },
      { ...legacyAgent(), id: "b", avatar: "javascript:alert(1)" },
    ]);
    expect(good.avatar).toBe(image);
    expect(bad).not.toHaveProperty("avatar");
  });
});

describe("unread replies", () => {
  function chat() {
    const saved: Agent[][] = [];
    const store = new AgentStore(
      [],
      async (agents) => {
        saved.push(structuredClone(agents));
      },
      async (text) => `答：${text}`,
    );
    const current = () => store.list()[0].sessions[0];
    return { store, saved, current };
  }
  it("a reply that arrives while its Agent is away stays unread until it is viewed, also after a restart", async () => {
    const { store, saved, current } = chat();
    const a = await store.create({ name: "助手" });
    await store.send(a.id, "你好");
    expect(unreadReplies(current())).toBe(1);
    expect(unreadReplies(restoreAgents(saved.at(-1))[0].sessions[0])).toBe(1);
    store.view(a.id);
    await expect.poll(() => unreadReplies(current())).toBe(0);
    expect(unreadReplies(restoreAgents(saved.at(-1))[0].sessions[0])).toBe(0);
  });
  it("a reply that arrives on screen is read in the save that brings it", async () => {
    const { store, saved, current } = chat();
    const a = await store.create({ name: "助手" });
    store.view(a.id);
    const writes = saved.length;
    await store.send(a.id, "你好");
    expect(unreadReplies(current())).toBe(0);
    expect(saved).toHaveLength(writes + 1);
    store.view(null);
    await store.send(a.id, "还在吗");
    expect(unreadReplies(current())).toBe(1);
  });
  it("viewing with nothing unread saves nothing", async () => {
    const { store, saved } = chat();
    const a = await store.create({ name: "助手" });
    const writes = saved.length;
    store.view(a.id);
    store.view(null);
    await store.update(a.id, { pinned: true });
    expect(saved).toHaveLength(writes + 1);
  });
  it("sessions saved before read times count nothing as unread, and a damaged time is refused", () => {
    const [agent] = restoreAgents([legacyAgent()]);
    expect(agent.sessions.map(unreadReplies)).toEqual(
      agent.sessions.map(() => 0),
    );
    const damaged = legacyAgent();
    (damaged.sessions[0] as { lastReadAt?: unknown }).lastReadAt = "昨天";
    expect(() => restoreAgents([damaged])).toThrow("会话配置损坏");
  });
});

describe("sessions while a reply is awaited", () => {
  function slow() {
    let finish: (text: string) => void = () => {};
    const store = new AgentStore(
      [],
      async () => {},
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    return { store, finish: (text: string) => finish(text) };
  }
  const sessionsOf = (store: AgentStore) => store.list()[0].sessions;
  it("other sessions can be created, opened, renamed and edited; the replying one stays", async () => {
    const { store, finish } = slow();
    const a = await store.create({ name: "助手" });
    const replying = a.currentSessionId;
    const sent = store.send(a.id, "第一句");
    await Promise.resolve();
    await store.session(a.id, "create");
    const other = store.list()[0].currentSessionId;
    await store.renameSession(a.id, other, "  预算  ");
    await store.session(a.id, "select", replying);
    await store.session(a.id, "select", other);
    await expect(store.session(a.id, "delete", replying)).rejects.toThrow(
      "正在等待这个会话的回复",
    );
    await expect(store.send(a.id, "第二句")).rejects.toThrow(
      "正在等待此 Agent 的另一条回复",
    );
    finish("答");
    await sent;
    const [first, second] = sessionsOf(store);
    expect(first.messages.map((m) => m.text)).toEqual(["第一句", "答"]);
    expect(first.title).toBe("第一句");
    expect(second.title).toBe("预算");
    // The reply landed in a session that was not on screen.
    expect(unreadReplies(first)).toBe(1);
  });
  it("a session renamed before its first reply keeps the name", async () => {
    const { store, finish } = slow();
    const a = await store.create({ name: "助手" });
    const sent = store.send(a.id, "你好");
    await Promise.resolve();
    await store.renameSession(a.id, a.currentSessionId, "问候");
    finish("你好呀");
    await sent;
    expect(sessionsOf(store)[0].title).toBe("问候");
  });
  it("refuses empty or long session names and unknown sessions", async () => {
    const { store } = slow();
    const a = await store.create({ name: "助手" });
    await expect(
      store.renameSession(a.id, a.currentSessionId, " "),
    ).rejects.toThrow("会话名称需要 1–60 个字符。");
    await expect(
      store.renameSession(a.id, a.currentSessionId, "长".repeat(61)),
    ).rejects.toThrow("会话名称需要 1–60 个字符。");
    await expect(store.renameSession(a.id, "missing", "名")).rejects.toThrow(
      "会话不存在。",
    );
  });
});
