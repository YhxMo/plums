import { expect, it } from "vitest";
import { AgentStore } from "../modules/agents/store";
import { restoreAgents } from "../modules/agents/validation";

async function setup() {
  let saved: unknown;
  let failSave = false;
  const store = new AgentStore(
    [],
    async (agents) => {
      if (failSave) throw new Error("保存失败");
      saved = structuredClone(agents);
    },
    async (text) => text.toUpperCase(),
  );
  const a = await store.create({ name: "撤销" });
  const texts = () =>
    store.list()[0].sessions.map((s) => s.messages.map((m) => m.text));
  return {
    store,
    a,
    texts,
    saved: () => restoreAgents(saved),
    failNextSaves: (on: boolean) => (failSave = on),
  };
}

it("puts a deleted message back where it was, and only once", async () => {
  const { store, a, texts, saved } = await setup();
  await store.send(a.id, "one");
  await store.send(a.id, "two");
  const s = store.list()[0].sessions[0];
  await store.removeMessage(a.id, s.id, s.messages[1].id);
  expect(texts()).toEqual([["one", "two", "TWO"]]);
  await store.undo(a.id);
  expect(texts()).toEqual([["one", "ONE", "two", "TWO"]]);
  expect(saved()[0].sessions[0].messages.map((m) => m.text)).toEqual([
    "one",
    "ONE",
    "two",
    "TWO",
  ]);
  await expect(store.undo(a.id)).rejects.toThrow("没有可撤销的删除。");
});

it("refuses to undo once the conversation has moved on", async () => {
  const { store, a, texts } = await setup();
  await store.send(a.id, "one");
  const s = store.list()[0].sessions[0];
  await store.removeMessage(a.id, s.id, s.messages[0].id);
  await store.send(a.id, "two");
  await expect(store.undo(a.id)).rejects.toThrow(
    "会话已有新的变化，无法撤销删除。",
  );
  expect(texts()).toEqual([["ONE", "two", "TWO"]]);
});

it("brings a deleted session back to its place and opens it again", async () => {
  const { store, a, texts } = await setup();
  await store.send(a.id, "first");
  await store.session(a.id, "create");
  await store.send(a.id, "second");
  const [first] = store.list()[0].sessions;
  await store.session(a.id, "select", first.id);
  await store.session(a.id, "delete", first.id);
  expect(texts()).toEqual([["second", "SECOND"]]);
  await store.undo(a.id);
  expect(texts()).toEqual([
    ["first", "FIRST"],
    ["second", "SECOND"],
  ]);
  expect(store.list()[0].currentSessionId).toBe(first.id);
});

it("undoing the last session's deletion drops the empty one put in its place", async () => {
  const { store, a } = await setup();
  await store.send(a.id, "only");
  const [only] = store.list()[0].sessions;
  await store.session(a.id, "delete", only.id);
  expect(store.list()[0].sessions).toHaveLength(1);
  expect(store.list()[0].sessions[0].id).not.toBe(only.id);
  await store.undo(a.id);
  expect(store.list()[0].sessions.map((s) => s.id)).toEqual([only.id]);
  expect(store.list()[0].currentSessionId).toBe(only.id);
});

it("keeps the chance to undo when saving the undo fails", async () => {
  const { store, a, texts, failNextSaves } = await setup();
  await store.send(a.id, "one");
  const s = store.list()[0].sessions[0];
  await store.removeMessage(a.id, s.id, s.messages[0].id);
  failNextSaves(true);
  await expect(store.undo(a.id)).rejects.toThrow("保存失败");
  expect(texts()).toEqual([["ONE"]]);
  failNextSaves(false);
  await store.undo(a.id);
  expect(texts()).toEqual([["one", "ONE"]]);
});
