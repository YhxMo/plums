import { expect, it } from "vitest";
import { AgentStore, type ReplyContext } from "../modules/agents/store";
import { restoreAgents } from "../modules/agents/validation";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function setup() {
  let saved: unknown;
  let count = 0;
  let hold: Promise<void> | undefined;
  const asked: { text: string; history: ReplyContext["history"] }[] = [];
  const store = new AgentStore(
    [],
    async (agents) => {
      saved = structuredClone(agents);
    },
    async (text, signal, { history }) => {
      asked.push({ text, history });
      await hold;
      signal.throwIfAborted();
      return `${text.toUpperCase()}${++count}`;
    },
  );
  const a = await store.create({ name: "改写" });
  const session = () => store.list()[0].sessions[0];
  const texts = () => session().messages.map((m) => m.text);
  return {
    store,
    a,
    session,
    texts,
    asked,
    saved: () =>
      restoreAgents(saved)[0].sessions[0].messages.map((m) => m.text),
    holdReplies: (until?: Promise<void>) => (hold = until),
  };
}

it("editing a message sends the new text from there and drops what followed", async () => {
  const { store, a, session, texts, asked, saved } = await setup();
  await store.send(a.id, "one");
  await store.send(a.id, "two");
  const [first] = session().messages;
  await store.edit(a.id, session().id, first.id, "uno");
  expect(texts()).toEqual(["uno", "UNO3"]);
  expect(saved()).toEqual(["uno", "UNO3"]);
  // The model sees only what came before the edited message.
  expect(asked.at(-1)).toEqual({ text: "uno", history: [] });
  await store.undo(a.id);
  expect(texts()).toEqual(["one", "ONE1", "two", "TWO2"]);
});

it("regenerating a reply asks again with the message before it", async () => {
  const { store, a, session, texts, asked } = await setup();
  await store.send(a.id, "one");
  await store.send(a.id, "two");
  const replies = session().messages.filter((m) => m.role === "agent");
  await store.regenerate(a.id, session().id, replies[1].id);
  expect(texts()).toEqual(["one", "ONE1", "two", "TWO3"]);
  expect(asked.at(-1)?.history.map((h) => h.text)).toEqual(["one", "ONE1"]);
  // An earlier reply takes the later turns with it.
  await store.regenerate(a.id, session().id, session().messages[1].id);
  expect(texts()).toEqual(["one", "ONE4"]);
  await store.undo(a.id);
  expect(texts()).toEqual(["one", "ONE1", "two", "TWO3"]);
});

it("keeps attachments of the message it rewrites", async () => {
  const { store, a, session } = await setup();
  const file = { kind: "text" as const, name: "a.txt", text: "内容" };
  await store.send(a.id, "看看", [file]);
  const [mine, reply] = session().messages;
  await store.regenerate(a.id, session().id, reply.id);
  expect(session().messages[0]).toMatchObject({
    text: "看看",
    attachments: [file],
  });
  await store.edit(a.id, session().id, session().messages[0].id, "再看");
  expect(session().messages[0]).toMatchObject({
    text: "再看",
    attachments: [file],
  });
  expect(session().messages[0].id).not.toBe(mine.id);
});

it("shows where a rewrite starts while waiting, and a stop saves nothing", async () => {
  const { store, a, session, texts, holdReplies } = await setup();
  await store.send(a.id, "one");
  const [first] = session().messages;
  const wait = deferred();
  holdReplies(wait.promise);
  const editing = store.edit(a.id, session().id, first.id, "uno");
  expect(store.list()[0].pending).toMatchObject({
    sessionId: session().id,
    text: "uno",
    replaces: first.id,
  });
  store.cancel(a.id);
  wait.resolve();
  await expect(editing).rejects.toThrow();
  expect(texts()).toEqual(["one", "ONE1"]);
  expect(store.list()[0].pending).toBeUndefined();
});

it("edits only own messages and regenerates only replies", async () => {
  const { store, a, session } = await setup();
  await store.send(a.id, "one");
  const [mine, reply] = session().messages;
  await expect(store.edit(a.id, session().id, reply.id, "x")).rejects.toThrow(
    "只能编辑自己发送的消息。",
  );
  await expect(store.regenerate(a.id, session().id, mine.id)).rejects.toThrow(
    "只能重新生成回复。",
  );
  await expect(store.edit(a.id, session().id, mine.id, "  ")).rejects.toThrow(
    "请输入",
  );
});
