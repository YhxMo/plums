import { expect, test, vi } from "vitest";
import {
  TextWorkbenchStore,
  readTextDocument,
  type TextDocument,
} from "../modules/text-workbench/store";

function fixture(transform = async (text: string) => text.toUpperCase()) {
  const saved: TextDocument[] = [];
  const persist = vi.fn(async (value: TextDocument) => {
    saved.push(structuredClone(value));
  });
  const store = new TextWorkbenchStore(
    undefined,
    "Uppercase",
    transform,
    persist,
  );
  store.create();
  store.edit("Text item", "hello");
  return { store, persist, saved };
}
test("text workbench saves actual transform output and restores input/results by version", async () => {
  const { store, saved } = fixture();
  await store.run();
  expect(store.snapshot().phase).toBe("saved");
  expect(saved[0].items[0].results[0]).toMatchObject({
    input: "hello",
    output: "HELLO",
    provider: "Uppercase",
  });
  const restored = new TextWorkbenchStore(
    saved[0],
    "Reverse",
    async (text) => text,
    async () => {},
  );
  expect(restored.snapshot().items[0].results[0].output).toBe("HELLO");
  expect(restored.snapshot().items[0].input).toBe("hello");
});
test("cancel and quiesce reject a late transform before persistence", async () => {
  let finish!: (value: string) => void;
  const { store, persist } = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const run = store.run();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const close = store.quiesce();
  finish("late");
  await Promise.all([run, close]);
  expect(store.snapshot().phase).toBe("cancelled");
  expect(persist).not.toHaveBeenCalled();
  expect(store.snapshot().items[0].input).toBe("hello");
});
test("a dispatched commit wins over late cancellation and quiesce waits for its receipt", async () => {
  let committed!: () => void;
  const { store, persist } = fixture();
  persist.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        committed = resolve;
      }),
  );
  const run = store.run();
  await vi.waitFor(() => expect(store.snapshot().phase).toBe("saving"));
  let left = false;
  const leave = store.quiesce().then(() => {
    left = true;
  });
  await Promise.resolve();
  expect(left).toBe(false);
  committed();
  await Promise.all([run, leave]);
  expect(store.snapshot().phase).toBe("saved");
});
test("known save failure retains previous results and retry; unknown receipt locks mutation", async () => {
  const { store, persist } = fixture();
  await store.run();
  persist.mockRejectedValueOnce(
    Object.assign(Error("write failed"), { outcome: "not-committed" }),
  );
  store.edit("Text item", "retry");
  await store.run();
  expect(store.snapshot()).toMatchObject({ phase: "failed" });
  expect(store.snapshot().items[0].results).toHaveLength(1);
  persist.mockRejectedValueOnce(Error("lost receipt"));
  await store.run();
  expect(store.snapshot().phase).toBe("uncertain");
  expect(() => store.edit("bad", "")).toThrow("未确认");
  expect(store.snapshot().items[0].results).toHaveLength(1);
});
test("invalid persisted state and invalid transform results never overwrite prior data", async () => {
  expect(() => readTextDocument({ version: 99, items: [] })).toThrow("保留");
  const { store, persist } = fixture(async () => "x".repeat(32001));
  await store.run();
  expect(store.snapshot().phase).toBe("failed");
  expect(persist).not.toHaveBeenCalled();
});

test("known failed save concurrent with shutdown does not become a cleanup failure", async () => {
  let reject!: (error: unknown) => void;
  const { store, persist } = fixture();
  persist.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const save = store.saveDraft();
  const stopped = store.close();
  reject(Object.assign(Error("not committed"), { outcome: "not-committed" }));
  await expect(save).rejects.toThrow("not committed");
  await expect(stopped).resolves.toBeUndefined();
  expect(store.snapshot().phase).toBe("failed");
});

test.each([
  ["saveDraft", true],
  ["saveDraft", false],
  ["remove", true],
  ["remove", false],
] as const)(
  "%s keeps items on rejection; known receipt=%s",
  async (action, known) => {
    const { store, persist } = fixture();
    const before = structuredClone(store.snapshot());
    const error = known
      ? Object.assign(Error("rejected commit"), { outcome: "not-committed" })
      : Error("unknown commit");
    persist.mockRejectedValueOnce(error);
    await expect(store[action]()).rejects.toThrow(error.message);
    expect(store.snapshot().items).toEqual(before.items);
    expect(store.snapshot().selected).toBe(before.selected);
    expect(store.snapshot().phase).toBe(known ? "failed" : "uncertain");
    if (known) {
      await store[action]();
      expect(store.snapshot().phase).toBe("saved");
      expect(store.snapshot().items).toHaveLength(action === "remove" ? 0 : 1);
    } else {
      expect(() => store.create()).toThrow("未确认");
    }
  },
);
