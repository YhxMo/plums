import { expect, test, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { ExtensionContext, ShellBridge } from "../modules/sdk";

const platform = () => ({
  kind: "browser" as const,
  available: () => true,
  grant: async () => {},
  call: async () => null,
});
const bridge = (open = vi.fn(async () => {})): ShellBridge => ({
  open,
  readPage: () => undefined,
  savePage: async () => {},
  label: (id) => `名称 ${id}`,
});

/** a provides s; b requires s, provides t; c requires t; d is unrelated. */
async function chain(connect = true) {
  const host = new Host(platform());
  if (connect) host.connectShell(bridge());
  const contexts: Record<string, ExtensionContext> = {};
  const install = (
    id: string,
    requires?: Record<string, number>,
    provides?: Record<string, number>,
  ) =>
    host.install({
      manifest: { id, version: "1", apiVersion: 1, requires, provides },
      activate(ctx) {
        contexts[id] = ctx;
        for (const name of Object.keys(requires ?? {})) ctx.use(name);
        for (const name of Object.keys(provides ?? {}))
          ctx.provide(name, 1, {});
      },
    });
  install("a", undefined, { s: 1 });
  install("b", { s: 1 }, { t: 1 });
  install("c", { t: 1 });
  install("d");
  for (const id of ["a", "b", "c", "d"]) await host.start(id);
  return { host, contexts };
}

test("open can target one extension in management or one dialog view", async () => {
  const open = vi.fn(async () => {});
  const host = new Host(platform());
  host.connectShell(bridge(open));
  let ctx!: ExtensionContext;
  host.install({
    manifest: { id: "third.party", version: "1", apiVersion: 1 },
    activate: (context) => {
      ctx = context;
    },
  });
  await host.start("third.party");
  await ctx.shell.open("extensions", "transform.upper");
  expect(open).toHaveBeenCalledWith(
    "extensions",
    "third.party",
    "transform.upper",
  );
  await expect(ctx.shell.open("settings", "transform.upper")).rejects.toThrow(
    "Invalid shell target",
  );
  await ctx.shell.open("view", "model-connections");
  expect(open).toHaveBeenLastCalledWith(
    "view",
    "third.party",
    "model-connections",
  );
  await expect(ctx.shell.open("view")).rejects.toThrow("Invalid shell target");
});

test("dependencies list the extension and its providers, transitively", async () => {
  const { contexts } = await chain();
  expect(contexts.c.shell.dependencies()).toEqual([
    { id: "c", label: "名称 c" },
    { id: "b", label: "名称 b" },
    { id: "a", label: "名称 a" },
  ]);
  expect(contexts.d.shell.dependencies()).toEqual([
    { id: "d", label: "名称 d" },
  ]);
  const bare = await chain(false);
  expect(bare.contexts.b.shell.dependencies()).toEqual([
    { id: "b", label: "b" },
    { id: "a", label: "a" },
  ]);
});

test("published users appear under every extension the publisher relies on", async () => {
  const { host, contexts } = await chain();
  const users = [{ id: "1", label: "写作助手" }];
  contexts.c.shell.publishUsers("Agent", users);
  users.push({ id: "2", label: "改动不应泄漏" });
  const expected = [
    {
      owner: "c",
      kind: "Agent",
      users: [users[0]],
      others: [],
      toggle: false,
    },
  ];
  for (const id of ["a", "b", "c"]) expect(host.users(id)).toEqual(expected);
  expect(host.users("d")).toEqual([]);
  const before = host.snapshot();
  contexts.c.shell.publishUsers("Agent", [{ id: "1", label: "写作助手" }]);
  expect(host.snapshot()).toBe(before);
  expect(() =>
    contexts.c.shell.publishUsers("Agent", [{ id: 1 }] as never),
  ).toThrow("Invalid users");
  await host.stop("a");
  expect(host.users("a")).toEqual([]);
  expect(host.users("c")).toEqual([]);
  expect(() => contexts.c.shell.dependencies()).toThrow("Extension stopped");
});
