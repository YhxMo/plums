import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAdapter } from "../src/platform";
import type {
  RecordPage,
  RecordWrite,
  StateBatchReceipt,
} from "../modules/sdk";

let values: Map<string, string>;
let failAfter = Infinity;
beforeEach(() => {
  values = new Map();
  failAfter = Infinity;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failAfter-- === 0)
        throw new DOMException("full", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const owner = "extension.sample";
async function adapter() {
  const platform = new PlatformAdapter();
  await platform.grant(owner, [
    "state.read",
    "state.write",
    "state.batch",
    "records.list",
    "records.search",
  ]);
  const call = (capability: string) => (payload?: unknown) =>
    platform.call(owner, capability, payload);
  return {
    platform,
    read: call("state.read"),
    batch: call("state.batch") as (p: unknown) => Promise<StateBatchReceipt>,
    list: call("records.list") as (p: unknown) => Promise<RecordPage>,
    search: call("records.search") as (p: unknown) => Promise<RecordPage>,
  };
}
const put = (collection: string, id: string, text: string): RecordWrite => ({
  collection,
  id,
  revision: 0,
  value: { text },
  text,
});
const ids = (page: { records: { id: string }[] }) =>
  page.records.map((record) => record.id);

it("commits documents and records together", async () => {
  const { batch, read, list } = await adapter();
  expect(
    await batch({
      documents: [
        { revision: 0, value: "index" },
        { key: "a-1", revision: 0, value: 1 },
      ],
      records: [
        put("session:1", "m-1", "你好"),
        {
          collection: "session:1",
          id: "m-2",
          revision: 0,
          value: 2,
          parent: "m-1",
        },
      ],
    }),
  ).toEqual({
    documents: [{ revision: 1 }, { revision: 1 }],
    records: [
      { seq: 1, revision: 1 },
      { seq: 2, revision: 1 },
    ],
  });
  expect(await read()).toMatchObject({ value: "index" });
  expect(await list({ collection: "session:1" })).toEqual({
    records: [
      {
        collection: "session:1",
        id: "m-1",
        seq: 1,
        parent: null,
        revision: 1,
        value: { text: "你好" },
        text: "你好",
      },
      {
        collection: "session:1",
        id: "m-2",
        seq: 2,
        parent: "m-1",
        revision: 1,
        value: 2,
        text: null,
      },
    ],
    next: null,
  });
});

it("rejects the whole batch on one stale revision", async () => {
  const { batch, read, list } = await adapter();
  await batch({
    documents: [{ revision: 0, value: "index" }],
    records: [put("c", "a", "one")],
  });
  const before = new Map(values);
  for (const stale of [
    {
      documents: [{ revision: 1, value: "new" }],
      records: [put("c", "a", "again")],
    },
    {
      documents: [{ revision: 0, value: "new" }],
      records: [put("c", "b", "two")],
    },
  ])
    await expect(batch(stale)).rejects.toMatchObject({
      code: "revision-conflict",
      outcome: "not-committed",
    });
  expect(values).toEqual(before);
  expect(await read()).toMatchObject({ value: "index" });
  expect(ids(await list({ collection: "c" }))).toEqual(["a"]);
  const receipt = await batch({ records: [put("c", "b", "two")] });
  expect(receipt.records[0]).toEqual({ seq: 2, revision: 1 });
});

it("restores every key when storage fails part way", async () => {
  const { batch } = await adapter();
  await batch({
    documents: [{ revision: 0, value: "index" }],
    records: [put("c", "a", "one")],
  });
  const before = new Map(values);
  failAfter = 1;
  await expect(
    batch({
      documents: [{ revision: 1, value: "new" }],
      records: [put("c", "b", "two")],
    }),
  ).rejects.toMatchObject({ code: "state-write" });
  expect(values).toEqual(before);
});

it("keeps record order, revisions and removal like documents", async () => {
  const { batch, list } = await adapter();
  await batch({ records: [put("c", "a", "one"), put("c", "b", "two")] });
  const edited = await batch({
    records: [{ collection: "c", id: "a", revision: 1, value: "edited" }],
  });
  expect(edited.records[0]).toEqual({ seq: 1, revision: 2 });
  const remove = (id: string, revision: number) =>
    batch({ records: [{ collection: "c", id, revision, remove: true }] });
  await expect(remove("a", 1)).rejects.toMatchObject({
    code: "revision-conflict",
  });
  expect(await remove("a", 2)).toEqual({ documents: [], records: [null] });
  expect(await remove("a", 0)).toEqual({ documents: [], records: [null] });
  expect(ids(await list({ collection: "c" }))).toEqual(["b"]);
  const again = await batch({ records: [put("c", "a", "back")] });
  expect(again.records[0]).toEqual({ seq: 3, revision: 1 });
});

it("pages forwards and backwards by cursor", async () => {
  const { batch, list } = await adapter();
  await batch({
    records: [1, 2, 3, 4, 5].map((n) => put("c", `m-${n}`, "x")),
  });
  const first = await list({ collection: "c", limit: 2 });
  expect(ids(first)).toEqual(["m-1", "m-2"]);
  const second = await list({ collection: "c", limit: 2, after: first.next });
  expect(ids(second)).toEqual(["m-3", "m-4"]);
  const last = await list({ collection: "c", limit: 2, after: second.next });
  expect(ids(last)).toEqual(["m-5"]);
  expect(last.next).toBeNull();
  const newest = await list({ collection: "c", limit: 3, order: "desc" });
  expect(ids(newest)).toEqual(["m-5", "m-4", "m-3"]);
  const older = await list({
    collection: "c",
    limit: 3,
    order: "desc",
    after: newest.next,
  });
  expect(ids(older)).toEqual(["m-2", "m-1"]);
  for (const bad of [
    { collection: "c", limit: 0 },
    { collection: "c", limit: 201 },
    { collection: "c", order: "up" },
    { collection: "c", after: "x" },
    { collection: "c", after: 3 },
  ])
    await expect(list(bad)).rejects.toMatchObject({ code: "invalid-query" });
  await expect(list({})).rejects.toMatchObject({ code: "invalid-collection" });
});

it("clears a collection before the puts of the same batch", async () => {
  const { batch, list } = await adapter();
  await batch({
    records: [put("c", "a", "old"), put("c", "b", "old"), put("k", "k", "old")],
  });
  await batch({ clear: ["c"], records: [put("c", "a", "new")] });
  expect(ids(await list({ collection: "c" }))).toEqual(["a"]);
  expect(ids(await list({ collection: "k" }))).toEqual(["k"]);
});

it("finds substrings newest first, ignoring case", async () => {
  const { batch, search } = await adapter();
  await batch({
    records: [
      put("a", "1", "明天的会议改到三点"),
      put("a", "2", "Plums Meeting notes"),
      put("b", "3", "会议纪要"),
      put("a", "4", "100% done_ok"),
      { collection: "a", id: "5", revision: 0, value: "会议" },
    ],
  });
  const found = async (payload: object) => ids(await search(payload));
  expect(await found({ query: "会议" })).toEqual(["3", "1"]);
  expect(await found({ query: "会议", collection: "a" })).toEqual(["1"]);
  expect(await found({ query: "  NOTES " })).toEqual(["2"]);
  expect(await found({ query: "_" })).toEqual(["4"]);
  expect(await found({ query: "会议", limit: 1 })).toEqual(["3"]);
  for (const query of ["", "   ", 1, "x".repeat(257)])
    await expect(search({ query })).rejects.toMatchObject({
      code: "invalid-query",
    });
});

it.each([
  ["invalid-batch", null],
  ["invalid-batch", {}],
  ["invalid-batch", { records: {} }],
  [
    "invalid-batch",
    {
      documents: [
        { revision: 0, value: 1 },
        { key: null, revision: 0, value: 2 },
      ],
    },
  ],
  ["invalid-batch", { records: [put("c", "a", "x"), put("c", "a", "y")] }],
  ["invalid-batch", { clear: ["c", "c"] }],
  ["invalid-key", { documents: [{ key: "A", revision: 0, value: 1 }] }],
  ["missing-value", { documents: [{ revision: 0 }] }],
  ["missing-revision", { documents: [{ value: 1 }] }],
  ["invalid-collection", { records: [put("a b", "a", "x")] }],
  ["invalid-record", { records: [put("c", "-a", "x")] }],
  [
    "invalid-record",
    { records: [{ collection: "c", id: "a", revision: 0, value: 1, text: 7 }] },
  ],
  ["missing-value", { records: [{ collection: "c", id: "a", revision: 0 }] }],
  [
    "state-too-large",
    {
      records: [
        { collection: "c", id: "a", revision: 0, value: "x".repeat(8 << 20) },
      ],
    },
  ],
] as const)(
  "rejects with %s and writes nothing (case %#)",
  async (code, payload) => {
    const { batch } = await adapter();
    await expect(batch(payload)).rejects.toMatchObject({ code });
    expect(values.size).toBe(0);
  },
);

it("lets documents grow to one mebibyte and records to eight", async () => {
  const { platform } = await adapter();
  const write = (payload: object) =>
    platform.call(owner, "state.write", payload);
  await write({ revision: 0, value: "x".repeat((1 << 20) - 64) });
  await expect(
    write({ revision: 1, value: "x".repeat(1 << 20) }),
  ).rejects.toMatchObject({ code: "state-too-large" });
  const { batch } = await adapter();
  await batch({
    records: [
      {
        collection: "c",
        id: "a",
        revision: 0,
        value: "x".repeat((8 << 20) - 1024),
      },
    ],
  });
});

it("needs its own grant and fails writes the diagnostics inject", async () => {
  const platform = new PlatformAdapter();
  await platform.grant(owner, ["state.read", "state.write"]);
  await expect(
    platform.call(owner, "state.batch", { records: [put("c", "a", "x")] }),
  ).rejects.toThrow("Permission denied");
  const { platform: granted, batch } = await adapter();
  granted.failWrites = true;
  await expect(batch({ records: [put("c", "a", "x")] })).rejects.toMatchObject({
    outcome: "not-committed",
  });
  expect(values.size).toBe(0);
});

it("names the new capabilities in plain words", async () => {
  const { capabilityLabel } = await import("../modules/shell/capabilities");
  for (const capability of ["state.batch", "records.list", "records.search"])
    expect(capabilityLabel(capability)).not.toBe(capability);
});

it("ends a page before sixteen mebibytes, keeping at least one record", async () => {
  const { batch, list, search } = await adapter();
  const big = "x".repeat((8 << 20) - 1024);
  for (const id of ["a", "b", "c"])
    await batch({
      records: [{ collection: "c", id, revision: 0, value: big, text: "长" }],
    });
  const first = await list({ collection: "c" });
  expect(ids(first)).toEqual(["a", "b"]);
  const rest = await list({ collection: "c", after: first.next });
  expect(ids(rest)).toEqual(["c"]);
  expect(rest.next).toBeNull();
  const found = await search({ query: "长" });
  expect(ids(found)).toEqual(["c", "b"]);
  const older = await search({ query: "长", after: found.next });
  expect(ids(older)).toEqual(["a"]);
  expect(older.next).toBeNull();
});
