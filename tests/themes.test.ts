import { expect, test } from "vitest";
import { Host } from "../modules/extension-host/host";
import type {
  ExtensionContext,
  ExtensionDefinition,
  Platform,
} from "../modules/sdk";

const colors = Object.fromEntries(
  [
    "text",
    "muted",
    "background",
    "surface",
    "card",
    "overlay",
    "subtle",
    "border",
    "control-border",
    "accent",
    "accent-hover",
    "accent-ink",
    "accent-soft",
    "accent-text",
    "error",
    "running",
    "shadow",
  ].map((key) => [key, "#123456"]),
);
const palette = () => ({
  id: "test.blue",
  label: "蓝色",
  appearance: "light" as const,
  colors: { ...colors },
});
const platform: Platform = {
  kind: "browser",
  available: () => false,
  grant: async () => {},
  call: async () => {
    throw Error("No capabilities");
  },
};
function definition(
  id: string,
  activate: ExtensionDefinition["activate"],
  extra = {},
): ExtensionDefinition {
  return { manifest: { id, version: "1", apiVersion: 1, ...extra }, activate };
}

test("theme registration snapshots input and query values and releases on stop/restart", async () => {
  const host = new Host(platform);
  const input = palette();
  let ctx!: ExtensionContext;
  host.install(
    definition("author", (c) => {
      ctx = c;
      c.theme(input as import("../modules/sdk").Theme);
    }),
  );
  await host.start("author");
  const first = host.themes()[0];
  expect(first).toMatchObject({
    id: input.id,
    owner: "author",
    colors: { text: "#123456" },
  });
  input.colors.text = "#ffffff";
  first.colors.text = "#000000";
  expect(host.themes()[0].colors.text).toBe("#123456");
  await host.stop("author");
  expect(host.themes()).toEqual([]);
  expect(() => ctx.theme(palette() as import("../modules/sdk").Theme)).toThrow(
    "Extension stopped",
  );
  await host.start("author");
  expect(host.themes()).toHaveLength(1);
  expect(host.themes()[0].generation).toBeGreaterThan(first.generation);
  await host.stop("author");
  await host.uninstall("author");
  expect(host.themes()).toEqual([]);
});

test("duplicate ids fail without replacing active owner", async () => {
  const host = new Host(platform);
  for (const id of ["one", "two"])
    host.install(
      definition(id, (c) =>
        c.theme(palette() as import("../modules/sdk").Theme),
      ),
    );
  await host.start("one");
  await expect(host.start("two")).rejects.toThrow("Theme conflict");
  expect(host.themes().map((t) => t.owner)).toEqual(["one"]);
  await host.stop("one");
  await host.start("two");
  expect(host.themes()[0].owner).toBe("two");
});

test("invalid palette, id, fields and CSS injection are rejected atomically", async () => {
  const invalid = [
    { ...palette(), id: "light" },
    { ...palette(), id: "dark" },
    { ...palette(), id: "Bad" },
    { ...palette(), label: "  " },
    { ...palette(), label: "a".repeat(81) },
    { ...palette(), appearance: "auto" },
    { ...palette(), extra: "unexpected" },
    { ...palette(), colors: { ...colors, text: "red; display:none" } },
    { ...palette(), colors: { ...colors, text: "#12345678" } },
    { ...palette(), colors: { ...colors, unknown: "#123456" } },
    { ...palette(), colors: { text: "#123456" } },
    null,
  ];
  for (const input of invalid) {
    const host = new Host(platform);
    host.install(
      definition("bad", (c) =>
        c.theme(input as import("../modules/sdk").Theme),
      ),
    );
    await expect(host.start("bad")).rejects.toThrow("Invalid theme");
    expect(host.themes()).toEqual([]);
    expect(host.inspect("bad").status).toBe("failed");
  }
});

test("partial activation failure withdraws all themes and notifies observers", async () => {
  const host = new Host(platform);
  const seen: number[] = [];
  host.subscribe(() => seen.push(host.themes().length));
  host.install(
    definition("broken", (c) => {
      c.theme(palette() as import("../modules/sdk").Theme);
      throw Error("failed activation");
    }),
  );
  await expect(host.start("broken")).rejects.toThrow("failed activation");
  expect(host.themes()).toEqual([]);
  expect(seen.every((n) => n === 0)).toBe(true);
});

test("activating theme remains hidden until successful activation", async () => {
  const host = new Host(platform);
  let finish!: () => void;
  host.install(
    definition("slow", async (c) => {
      c.theme(palette() as import("../modules/sdk").Theme);
      await new Promise<void>((r) => {
        finish = r;
      });
    }),
  );
  const starting = host.start("slow");
  await Promise.resolve();
  expect(host.themes()).toEqual([]);
  finish();
  await starting;
  expect(host.themes()).toHaveLength(1);
});

test("stop invalidates visible themes before abort callbacks and asynchronous disposal", async () => {
  const host = new Host(platform);
  let finish!: () => void;
  let ctx!: ExtensionContext;
  let observed = false;
  host.install(
    definition("slow", (c) => {
      ctx = c;
      c.theme(palette() as import("../modules/sdk").Theme);
      c.signal.addEventListener("abort", () => {
        observed = true;
        expect(host.themes()).toEqual([]);
        expect(() =>
          ctx.theme({
            ...palette(),
            id: "late",
          } as import("../modules/sdk").Theme),
        ).toThrow("Extension stopped");
      });
      c.onDispose(
        () =>
          new Promise<void>((r) => {
            finish = r;
          }),
      );
    }),
  );
  await host.start("slow");
  const notices: number[] = [];
  host.subscribe(() => notices.push(host.themes().length));
  const stopping = host.stop("slow");
  for (let i = 0; i < 5 && !finish; i++) await Promise.resolve();
  expect(observed).toBe(true);
  expect(host.themes()).toEqual([]);
  expect(notices).toContain(0);
  finish();
  await stopping;
});

test("cleanup failure cannot keep a theme active", async () => {
  const host = new Host(platform);
  host.install(
    definition("broken", (c) => {
      c.theme(palette() as import("../modules/sdk").Theme);
      c.onDispose(() => {
        throw Error("cleanup failed");
      });
    }),
  );
  await host.start("broken");
  await expect(host.stop("broken")).rejects.toThrow("cleanup failed");
  expect(host.themes()).toEqual([]);
  expect(host.inspect("broken").status).toBe("cleanup-failed");
});

test("dependent theme disappears when its service provider stops", async () => {
  const host = new Host(platform);
  host.install(
    definition("provider", (c) => c.provide("palette.data", 1, {}), {
      provides: { "palette.data": 1 },
    }),
  );
  host.install(
    definition(
      "consumer",
      (c) => {
        c.use("palette.data");
        c.theme(palette() as import("../modules/sdk").Theme);
      },
      { requires: { "palette.data": 1 } },
    ),
  );
  await host.start("consumer");
  await host.start("provider");
  expect(host.themes()).toHaveLength(1);
  await host.stop("provider");
  expect(host.themes()).toEqual([]);
  await host.start("provider");
  expect(host.themes()).toHaveLength(1);
});

test("non-string colors and changing getters cannot bypass palette snapshot validation", async () => {
  let value = "#123456";
  const mutable = { toString: () => value };
  const host = new Host(platform);
  host.install(
    definition("mutable", (ctx) =>
      ctx.theme({
        ...palette(),
        colors: { ...colors, text: mutable },
      } as unknown as import("../modules/sdk").Theme),
    ),
  );
  await expect(host.start("mutable")).rejects.toThrow("Invalid theme");
  value = "red";
  expect(host.themes()).toEqual([]);
  let reads = 0;
  const changing = {
    ...colors,
    get text() {
      return ++reads === 1 ? "#123456" : "not-a-color";
    },
  };
  host.install(
    definition("getter", (ctx) =>
      ctx.theme({
        ...palette(),
        colors: changing,
      } as import("../modules/sdk").Theme),
    ),
  );
  await host.start("getter");
  expect(host.themes()[0].colors.text).toBe("#123456");
  expect(reads).toBe(1);
});
