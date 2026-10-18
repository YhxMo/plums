import { expect, test } from "vitest";
import { migrateState } from "../modules/sdk/state-migration";
import type { ExtensionContext, StoredState } from "../modules/sdk";
const old = { version: 1, data: { label: "plum" } };
const plan = {
  from: 1,
  to: 2,
  migrate(data: unknown) {
    const d = data as { label?: unknown };
    if (typeof d?.label !== "string") throw Error("bad source");
    return { labels: [d.label] };
  },
  validate(data: unknown) {
    const d = data as { labels?: unknown };
    return (
      Array.isArray(d?.labels) && d.labels.every((v) => typeof v === "string")
    );
  },
};
function fixture(value: unknown = old) {
  let saved: StoredState = { revision: 1, value: structuredClone(value) };
  let writes = 0;
  const lifetime = new AbortController();
  const ctx = {
    signal: lifetime.signal,
    task: <T>(run: (s: AbortSignal) => Promise<T>) => run(lifetime.signal),
    platform: async (cap: string, payload?: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (cap === "state.read") return structuredClone(saved);
      const next = payload as StoredState;
      if (next.revision !== saved.revision)
        throw Object.assign(Error("conflict"), { outcome: "not-committed" });
      saved = {
        revision: saved.revision + 1,
        value: structuredClone(next.value),
      };
      writes++;
      return structuredClone(saved);
    },
  } as unknown as ExtensionContext;
  return { ctx, lifetime, saved: () => saved, writes: () => writes };
}
test("migration retains original in same commit and target reentry never writes", async () => {
  const f = fixture();
  await migrateState(f.ctx, plan);
  expect(f.saved()).toEqual({
    revision: 2,
    value: {
      version: 2,
      data: { labels: ["plum"] },
      previous: { revision: 1, value: old },
    },
  });
  await migrateState(f.ctx, plan);
  expect(f.writes()).toBe(1);
});
test("unsupported and malformed source are preserved", async () => {
  for (const value of [
    { version: 3, data: {} },
    { version: 1, data: { label: 3 } },
    null,
  ]) {
    const f = fixture(value);
    await expect(migrateState(f.ctx, plan)).rejects.toThrow();
    expect(f.saved().value).toEqual(value);
    expect(f.writes()).toBe(0);
  }
});
test("throwing or invalid transformation cannot modify original", async () => {
  for (const migrate of [
    (d: unknown) => {
      (d as { label: string }).label = "changed";
      throw Error("failed");
    },
    () => ({ labels: [3] }),
    () => ({ labels: ["x"], lost: undefined }),
  ]) {
    const f = fixture();
    await expect(migrateState(f.ctx, { ...plan, migrate })).rejects.toThrow();
    expect(f.saved().value).toEqual(old);
    expect(f.writes()).toBe(0);
  }
});
test("cancel or lifetime stop during conversion preserves original", async () => {
  for (const lifetime of [true, false]) {
    const f = fixture();
    const c = new AbortController();
    await expect(
      migrateState(
        f.ctx,
        {
          ...plan,
          migrate: () => {
            (lifetime ? f.lifetime : c).abort();
            return { labels: ["x"] };
          },
        },
        c.signal,
      ),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
  }
});
test("conflicting writer wins and migration cannot overwrite it", async () => {
  const f = fixture();
  await expect(
    migrateState(f.ctx, {
      ...plan,
      migrate: async (d) => {
        await f.ctx.platform("state.write", {
          revision: 1,
          value: { version: 1, data: { label: "concurrent" } },
        });
        return plan.migrate(d);
      },
    }),
  ).rejects.toThrow("conflict");
  expect(f.saved().value).toEqual({
    version: 1,
    data: { label: "concurrent" },
  });
});
test("lost write receipt stays unknown; reread recognizes committed target", async () => {
  const f = fixture();
  const base = f.ctx.platform;
  f.ctx.platform = async (...args) => {
    const result = await base(...args);
    if (args[0] === "state.write")
      throw Object.assign(Error("lost"), { outcome: "unknown" });
    return result;
  };
  await expect(migrateState(f.ctx, plan)).rejects.toMatchObject({
    outcome: "unknown",
  });
  await migrateState(f.ctx, plan);
  expect(f.writes()).toBe(1);
});

test("non-JSON callback output is rejected instead of silently converted", async () => {
  for (const data of [
    new Date(),
    NaN,
    Infinity,
    // eslint-disable-next-line no-sparse-arrays -- the hole is the rejected input
    [, 1],
    { x: () => 1 },
    { toJSON: () => ({ labels: ["hidden"] }) },
  ]) {
    const f = fixture();
    await expect(
      migrateState(f.ctx, {
        ...plan,
        migrate: () => data,
        validate: () => true,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
  }
});
test("known write failure preserves original; confirmed receipt wins late cancellation", async () => {
  const f = fixture();
  f.ctx.platform = async (cap) => {
    if (cap === "state.read") return f.saved();
    throw Object.assign(Error("disk"), { outcome: "not-committed" });
  };
  await expect(migrateState(f.ctx, plan)).rejects.toMatchObject({
    outcome: "not-committed",
  });
  expect(f.saved().value).toEqual(old);
  const g = fixture();
  const base = g.ctx.platform;
  g.ctx.platform = async (...args) => {
    const result = await base(...args);
    if (args[0] === "state.write") g.lifetime.abort();
    return result;
  };
  expect((await migrateState(g.ctx, plan)).revision).toBe(2);
});
test("missing state and invalid target reject without writing", async () => {
  const f = fixture();
  f.ctx.platform = async () => null;
  await expect(migrateState(f.ctx, plan)).rejects.toThrow("existing");
  const g = fixture({ version: 2, data: { labels: 3 } });
  await expect(migrateState(g.ctx, plan)).rejects.toThrow("target");
  expect(g.writes()).toBe(0);
});

test("non-boolean validator result is rejected", async () => {
  const f = fixture();
  await expect(
    migrateState(f.ctx, {
      ...plan,
      validate: (() => Promise.resolve(true)) as unknown as (
        value: unknown,
      ) => boolean,
    }),
  ).rejects.toThrow();
  expect(f.writes()).toBe(0);
});
