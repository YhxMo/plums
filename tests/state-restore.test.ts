import { expect, test } from "vitest";
import { restorePreviousState } from "../modules/sdk";
import type { ExtensionContext, StoredState } from "../modules/sdk";
const previous = {
  revision: 1,
  value: { version: 1, data: { label: "plum" } },
};
const current = {
  revision: 2,
  value: { version: 2, data: { labels: ["plum"] }, previous },
};
const plan = {
  revision: 2,
  from: 2,
  to: 1,
  validate: (d: unknown) =>
    typeof (d as { label?: unknown })?.label === "string",
};
function fixture(value: StoredState | null = current) {
  let saved = structuredClone(value);
  let writes = 0;
  const lifetime = new AbortController();
  const ctx = {
    task: <T>(run: (s: AbortSignal) => Promise<T>) => run(lifetime.signal),
    platform: async (cap: string, payload?: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (cap === "state.read") return structuredClone(saved);
      const next = payload as StoredState;
      if (next.revision !== saved?.revision)
        throw Object.assign(Error("conflict"), { outcome: "not-committed" });
      saved = {
        revision: next.revision + 1,
        value: structuredClone(next.value),
      };
      writes++;
      return structuredClone(saved);
    },
  } as ExtensionContext;
  return { ctx, lifetime, saved: () => saved, writes: () => writes };
}
test("explicit restore preserves replaced current state in the same commit", async () => {
  const f = fixture();
  await restorePreviousState(f.ctx, plan);
  expect(f.saved()).toEqual({
    revision: 3,
    value: { version: 1, data: { label: "plum" }, previous: current },
  });
  await expect(restorePreviousState(f.ctx, plan)).rejects.toThrow();
  expect(f.writes()).toBe(1);
});
test("missing, malformed or mismatched snapshot and stale confirmation never write", async () => {
  for (const value of [
    null,
    { revision: 2, value: { version: 2, data: {} } },
    { ...current, revision: 3 },
    {
      revision: 2,
      value: { ...current.value, previous: { ...previous, revision: 2 } },
    },
    {
      revision: 2,
      value: {
        ...current.value,
        previous: { revision: 1, value: { version: 3, data: { label: "x" } } },
      },
    },
  ]) {
    const f = fixture(value);
    await expect(restorePreviousState(f.ctx, plan)).rejects.toThrow();
    expect(f.saved()).toEqual(value);
    expect(f.writes()).toBe(0);
  }
});
test("invalid plan and validator failure preserve both snapshots", async () => {
  for (const change of [
    { revision: 0 },
    { from: 1 },
    { to: 2 },
    { to: 0 },
    { validate: () => false },
    {
      validate: () => {
        throw Error("bad schema");
      },
    },
  ]) {
    const f = fixture();
    await expect(
      restorePreviousState(f.ctx, { ...plan, ...change }),
    ).rejects.toThrow();
    expect(f.saved()).toEqual(current);
    expect(f.writes()).toBe(0);
  }
});
test("validation sees a copy and mutation cannot alter restored or retained data", async () => {
  const f = fixture();
  await restorePreviousState(f.ctx, {
    ...plan,
    validate: (d) => {
      (d as { label: string }).label = "mutated";
      return true;
    },
  });
  expect(f.saved()).toEqual({
    revision: 3,
    value: { version: 1, data: { label: "plum" }, previous: current },
  });
});
test("operation or lifetime cancellation during validation does not write", async () => {
  for (const own of [true, false]) {
    const f = fixture();
    const c = new AbortController();
    await expect(
      restorePreviousState(
        f.ctx,
        {
          ...plan,
          validate: () => {
            (own ? c : f.lifetime).abort();
            return true;
          },
        },
        c.signal,
      ),
    ).rejects.toThrow();
    expect(f.saved()).toEqual(current);
  }
});
test("concurrent write wins over restore CAS", async () => {
  const f = fixture();
  const base = f.ctx.platform;
  f.ctx.platform = async (...args) => {
    if (args[0] === "state.write")
      await base("state.write", {
        revision: 2,
        value: { version: 2, data: { labels: ["newer"] } },
      });
    return base(...args);
  };
  await expect(restorePreviousState(f.ctx, plan)).rejects.toMatchObject({
    outcome: "not-committed",
  });
  expect(f.saved()?.value).toEqual({ version: 2, data: { labels: ["newer"] } });
});
test("unknown receipt is not retried and stale plan remains rejected after reread", async () => {
  const f = fixture();
  const base = f.ctx.platform;
  f.ctx.platform = async (...args) => {
    const result = await base(...args);
    if (args[0] === "state.write")
      throw Object.assign(Error("lost"), { outcome: "unknown" });
    return result;
  };
  await expect(restorePreviousState(f.ctx, plan)).rejects.toMatchObject({
    outcome: "unknown",
  });
  expect(f.saved()?.revision).toBe(3);
  await expect(restorePreviousState(f.ctx, plan)).rejects.toThrow();
  expect(f.writes()).toBe(1);
});
test("confirmed receipt wins over late cancellation; rejection preserves current", async () => {
  const f = fixture();
  const base = f.ctx.platform;
  f.ctx.platform = async (...args) => {
    const result = await base(...args);
    if (args[0] === "state.write") f.lifetime.abort();
    return result;
  };
  expect((await restorePreviousState(f.ctx, plan)).revision).toBe(3);
  const g = fixture();
  const read = g.ctx.platform;
  g.ctx.platform = async (...args) => {
    if (args[0] === "state.write")
      throw Object.assign(Error("capacity"), { outcome: "not-committed" });
    return read(...args);
  };
  await expect(restorePreviousState(g.ctx, plan)).rejects.toMatchObject({
    outcome: "not-committed",
  });
  expect(g.saved()).toEqual(current);
});
