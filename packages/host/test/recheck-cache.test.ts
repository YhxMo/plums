import { expect, it, vi } from "vitest";
import { EpochMemo } from "../src/recheck-cache.js";
it("concurrent inflight reads share one Promise", async () => {
  const memo = new EpochMemo<number>(),
    run = vi.fn(async () => 1);
  const a = memo.inflight("a", "key", run),
    b = memo.inflight("a", "key", run);
  expect(a).toBe(b);
  expect(await a).toBe(1);
  expect(run).toHaveBeenCalledOnce();
});
it("a changed token clears the cached values", () => {
  const memo = new EpochMemo<number>();
  memo.set("a", "key", 1);
  expect(memo.get("b", "key")).toBeUndefined();
  expect(memo.get("a", "key")).toBeUndefined();
});
it("failed reads are not cached", async () => {
  const memo = new EpochMemo<number>(),
    run = vi
      .fn()
      .mockRejectedValueOnce(Error("synthetic"))
      .mockResolvedValueOnce(2);
  await expect(memo.inflight("a", "key", run)).rejects.toThrow("synthetic");
  expect(await memo.inflight("a", "key", run)).toBe(2);
  expect(run).toHaveBeenCalledTimes(2);
});
it("an old generation cannot overwrite a newer epoch", async () => {
  const memo = new EpochMemo<number>();
  let finish!: (v: number) => void;
  const old = memo.inflight(
    "a",
    "key",
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await Promise.resolve();
  memo.set("b", "key", 2);
  finish(1);
  await old;
  expect(memo.get("b", "key")).toBe(2);
});
it("caller mutations cannot change later cache hits", async () => {
  const memo = new EpochMemo<{
    detail: { value: number };
    state: { revision: number };
  }>();
  const first = await memo.inflight("a", "key", async () => ({
    detail: { value: 1 },
    state: { revision: 2 },
  }));
  first.detail.value = 99;
  first.state.revision = 99;
  const next = await memo.inflight("a", "key", async () => {
    throw Error("must use cache");
  });
  expect(next).toEqual({ detail: { value: 1 }, state: { revision: 2 } });
  next.detail.value = 88;
  expect(memo.get("a", "key")!.detail.value).toBe(1);
});
