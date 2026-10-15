import { describe, expect, it } from "vitest";
import {
  AgentStore,
  parseRoleCard,
  restoreAgents,
} from "../modules/agents/store";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("agent extension data", () => {
  it("adds, pins and restores independent sessions without persisting runtime status", async () => {
    let saved: unknown;
    const store = new AgentStore(
      [],
      async (agents) => {
        saved = structuredClone(agents);
      },
      async (text) => text.toUpperCase(),
    );
    const a = await store.create({ name: "本地助手", multiSession: true });
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
    const a = await store.create({ name: "test", multiSession: true });
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
  const a = await store.create({ name: "sessions", multiSession: true });
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

it("round trips a maximum length service reply below the snapshot capacity", async () => {
  let saved: unknown;
  const store = new AgentStore(
    [],
    async (agents) => {
      saved = structuredClone(agents);
    },
    async () => "x".repeat(32000),
  );
  const a = await store.create({ name: "boundary" });
  await store.send(a.id, "short");
  expect(new TextEncoder().encode(JSON.stringify(saved)).length).toBeLessThan(
    65536,
  );
  expect(restoreAgents(saved)[0].sessions[0].messages[1].text.length).toBe(
    32000,
  );
});
for (const [label, invalid] of [
  ["oversized", "x".repeat(32001)],
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
