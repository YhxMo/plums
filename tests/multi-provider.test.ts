import { expect, test, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { ExtensionContext } from "../modules/sdk";

const platform = () => ({
  kind: "browser" as const,
  available: () => true,
  grant: async () => {},
  call: async () => null,
});

/** a and b provide s@1, old provides s@2; `live` lists providers, `bound` uses one. */
async function setup() {
  const host = new Host(platform());
  const contexts: Record<string, ExtensionContext> = {};
  const provider = (id: string, version = 1) =>
    host.install({
      manifest: { id, version: "1", apiVersion: 1, provides: { s: version } },
      activate(ctx) {
        ctx.provide("s", version, { from: id });
      },
    });
  const consumer = (id: string) =>
    host.install({
      manifest: { id, version: "1", apiVersion: 1, requires: { s: 1 } },
      activate(ctx) {
        contexts[id] = ctx;
      },
    });
  provider("a");
  provider("b");
  provider("old", 2);
  consumer("live");
  consumer("bound");
  for (const id of ["a", "b", "old", "live", "bound"]) await host.start(id);
  return { host, contexts };
}

test("several extensions provide one service at the same time", async () => {
  const { host, contexts } = await setup();
  expect(host.inspect("b").status).toBe("active");
  expect(contexts.bound.use("s")).toEqual({ from: "a" });
  expect(
    contexts.live.providers("s").map(({ id, value }) => [id, value]),
  ).toEqual([
    ["a", { from: "a" }],
    ["b", { from: "b" }],
  ]);
  expect(host.serviceNames()).toEqual(["s"]);
});

test("an extension still cannot provide one service twice", async () => {
  const host = new Host(platform());
  host.install({
    manifest: { id: "twice", version: "1", apiVersion: 1, provides: { s: 1 } },
    activate(ctx) {
      ctx.provide("s", 1, 1);
      ctx.provide("s", 1, 2);
    },
  });
  await expect(host.start("twice")).rejects.toThrow("already provided");
});

test("provider lists stay live and consumers outlive all but the last provider", async () => {
  const { host, contexts } = await setup();
  const changes = vi.fn();
  contexts.live.providers("s", (providers) =>
    changes(providers.map(({ id }) => id)),
  );
  contexts.bound.use("s");
  await host.stop("b");
  expect(changes).toHaveBeenLastCalledWith(["a"]);
  expect(host.inspect("live").status).toBe("active");
  expect(host.inspect("bound").status).toBe("active");
  await host.start("b");
  expect(changes).toHaveBeenLastCalledWith(["a", "b"]);
  const calls = changes.mock.calls.length;
  host.install({
    manifest: { id: "other", version: "1", apiVersion: 1 },
    activate() {},
  });
  await host.start("other");
  expect(changes).toHaveBeenCalledTimes(calls);
  // The provider taken with use() restarts its consumer, which picks the next one.
  await host.stop("a");
  expect(host.inspect("live").status).toBe("active");
  expect(host.inspect("bound").status).toBe("active");
  expect(contexts.bound.use("s")).toEqual({ from: "b" });
  await host.stop("b");
  expect(host.inspect("live").status).toBe("waiting");
  expect(host.inspect("bound").status).toBe("waiting");
});

test("dependencies follow the providers taken with use()", async () => {
  const { contexts } = await setup();
  expect(contexts.live.shell.dependencies().map(({ id }) => id)).toEqual([
    "live",
  ]);
  contexts.bound.use("s");
  expect(contexts.bound.shell.dependencies().map(({ id }) => id)).toEqual([
    "bound",
    "a",
  ]);
});

test("users name the providers they use and can be switched on or off per provider", async () => {
  const { host, contexts } = await setup();
  const set = vi.fn(async () => {});
  const users = [
    { id: "1", label: "写作助手", uses: ["a"] },
    { id: "2", label: "代码助手", uses: ["b"] },
  ];
  contexts.live.shell.publishUsers("Agent", users);
  expect(host.users("a")).toEqual([
    {
      owner: "live",
      kind: "Agent",
      users: [{ id: "1", label: "写作助手" }],
      others: [],
      toggle: false,
    },
  ]);
  expect(host.users("live")[0].users).toHaveLength(2);
  await expect(host.toggleUser("live", "1", "a", false)).rejects.toThrow(
    "Invalid toggle",
  );
  contexts.live.shell.publishUsers("Agent", users, { service: "s", set });
  expect(host.users("a")[0]).toMatchObject({
    others: [{ id: "2", label: "代码助手" }],
    toggle: true,
  });
  // Only providers of the service the publisher requires can be toggled.
  expect(host.users("old")).toEqual([]);
  await host.toggleUser("live", "2", "a", true);
  expect(set).toHaveBeenLastCalledWith("2", "a", true);
  await host.toggleUser("live", "1", "a", false);
  expect(set).toHaveBeenLastCalledWith("1", "a", false);
  // Switching on a user that already uses it, or off one that does not, is refused.
  await expect(host.toggleUser("live", "1", "a", true)).rejects.toThrow(
    "Invalid toggle",
  );
  await expect(host.toggleUser("live", "2", "a", false)).rejects.toThrow(
    "Invalid toggle",
  );
  await expect(host.toggleUser("live", "2", "old", true)).rejects.toThrow(
    "Invalid toggle",
  );
  expect(() =>
    contexts.live.shell.publishUsers("Agent", users, { service: "x", set }),
  ).toThrow("Invalid users");
  await host.stop("live");
  expect(host.users("a")).toEqual([]);
  await expect(host.toggleUser("live", "2", "a", true)).rejects.toThrow(
    "Invalid toggle",
  );
});

test("a consumer closes at once when all its providers fail together", async () => {
  const host = new Host(platform());
  const contexts: Record<string, ExtensionContext> = {};
  host.install({
    manifest: { id: "base", version: "1", apiVersion: 1, provides: { b: 1 } },
    activate(ctx) {
      ctx.provide("b", 1, {});
      ctx.view({
        id: "base.view",
        label: "base",
        mount: () => () => {
          throw new Error("unmount failed");
        },
      });
    },
  });
  for (const id of ["p1", "p2"])
    host.install({
      manifest: {
        id,
        version: "1",
        apiVersion: 1,
        requires: { b: 1 },
        provides: { s: 1 },
      },
      activate(ctx) {
        ctx.provide("s", 1, { from: id });
      },
    });
  host.install({
    manifest: { id: "c", version: "1", apiVersion: 1, requires: { s: 1 } },
    activate(ctx) {
      contexts.c = ctx;
    },
  });
  for (const id of ["base", "p1", "p2", "c"]) await host.start(id);
  const close = host.mountView("base.view", {} as HTMLElement);
  expect(close).toThrow("unmount failed");
  // Both providers go down in the same failure, so the consumer's entry closes with them.
  expect(contexts.c.signal.aborted).toBe(true);
  expect(host.inspect("c").status).toBe("stopping");
  await host.stop("base").catch(() => {});
});

test("an optional service never holds a consumer back", async () => {
  const host = new Host(platform());
  const contexts: Record<string, ExtensionContext> = {};
  const changes = vi.fn();
  host.install({
    manifest: { id: "c", version: "1", apiVersion: 1, optional: { s: 1 } },
    activate(ctx) {
      contexts.c = ctx;
      ctx.providers("s", (next) => changes(next.map(({ id }) => id)));
    },
  });
  host.install({
    manifest: { id: "p", version: "1", apiVersion: 1, provides: { s: 1 } },
    activate(ctx) {
      ctx.provide("s", 1, {});
    },
  });
  await host.start("c");
  expect(host.inspect("c").status).toBe("active");
  expect(contexts.c.providers("s")).toEqual([]);
  await host.start("p");
  expect(changes).toHaveBeenLastCalledWith(["p"]);
  const set = vi.fn(async () => {});
  contexts.c.shell.publishUsers("用户", [{ id: "1", label: "一" }], {
    service: "s",
    set,
  });
  expect(host.users("p")[0].toggle).toBe(true);
  await host.stop("p");
  expect(changes).toHaveBeenLastCalledWith([]);
  expect(host.inspect("c").status).toBe("active");
});

test("optional services are declared like required ones, never both", () => {
  const host = new Host(platform());
  const install = (manifest: object) => () =>
    host.install({
      manifest: { id: "bad", version: "1", apiVersion: 1, ...manifest },
      activate() {},
    });
  expect(install({ optional: { s: 0 } })).toThrow();
  expect(install({ optional: "s" })).toThrow();
  expect(install({ requires: { s: 1 }, optional: { s: 1 } })).toThrow();
});
