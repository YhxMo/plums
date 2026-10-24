import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformAdapter } from "../src/platform";

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

async function adapter() {
  const platform = new PlatformAdapter();
  await platform.grant("extension.sample", ["state.read", "state.write"]);
  const write = (payload: object) =>
    platform.call("extension.sample", "state.write", payload);
  const read = (key?: string) =>
    platform.call("extension.sample", "state.read", key ? { key } : undefined);
  return { write, read };
}

it("keeps keyed documents beside the main one with their own revision", async () => {
  const { write, read } = await adapter();
  await write({ revision: 0, value: "index" });
  await write({ key: "s-1", revision: 0, value: "one" });
  await write({ key: "s-1", revision: 1, value: "two" });
  await expect(
    write({ key: "s-1", revision: 0, value: "stale" }),
  ).rejects.toMatchObject({ code: "revision-conflict" });
  expect(await read()).toMatchObject({ revision: 1, value: "index" });
  expect(await read("s-1")).toMatchObject({ revision: 2, value: "two" });
  expect(await read("s-2")).toBeNull();
  expect([...values.keys()].sort()).toEqual([
    "plums:extension.sample",
    "plums:extension.sample+s-1",
  ]);
});

it("caps each key separately", async () => {
  const { write } = await adapter();
  const big = "x".repeat(60_000);
  await write({ key: "s-1", revision: 0, value: big });
  await write({ key: "s-2", revision: 0, value: big });
  await write({ revision: 0, value: "index" });
});

it.each(["", "-a", "A", "a.b", "a+b", "a".repeat(65), 7])(
  "rejects key %s without writing",
  async (key) => {
    const { write } = await adapter();
    await expect(write({ key, revision: 0, value: 1 })).rejects.toMatchObject({
      code: "invalid-key",
    });
    expect(values.size).toBe(0);
  },
);

it("removes one key after a revision check", async () => {
  const { write, read } = await adapter();
  await write({ revision: 0, value: "index" });
  await write({ key: "s-1", revision: 0, value: "one" });
  await expect(
    write({ key: "s-1", revision: 0, remove: true }),
  ).rejects.toMatchObject({ code: "revision-conflict" });
  expect(await write({ key: "s-1", revision: 1, remove: true })).toBeNull();
  expect(await write({ key: "s-1", revision: 0, remove: true })).toBeNull();
  expect(await read("s-1")).toBeNull();
  expect(await read()).toMatchObject({ value: "index" });
});
