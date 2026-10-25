import { expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import {
  readComposition,
  captureComposition,
  restoreComposition,
  startNewDefaults,
} from "../modules/shell/composition";
import type { Platform } from "../modules/sdk";
function setup() {
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: async () => {},
    call: async () => null,
  };
  const host = new Host(platform);
  for (const id of ["one", "two"])
    host.install({
      manifest: { id, version: "1", apiVersion: 1, provides: { text: 1 } },
      activate(ctx) {
        ctx.provide("text", 1, {});
      },
    });
  host.install({
    manifest: {
      id: "protected",
      version: "1",
      apiVersion: 1,
      capabilities: ["state.read"],
    },
    activate() {},
  });
  return host;
}
it("rejects corrupt, duplicate and incompatible schema without changing input", () => {
  for (const value of [
    null,
    {},
    { schema: 2, enabled: [] },
    { schema: 1, enabled: Array(1) },
    { schema: 1, enabled: [{ id: "one", version: "" }] },
    {
      schema: 1,
      enabled: [
        { id: "one", version: "1" },
        { id: "one", version: "1" },
      ],
    },
    { schema: 1, enabled: [], granted: {} },
    { schema: 1, enabled: [], granted: [{ id: "one", version: "1" }] },
    {
      schema: 1,
      enabled: [],
      granted: [{ id: "one", version: "1", capabilities: [""] }],
    },
    { schema: 1, enabled: [], offered: "one" },
    { schema: 1, enabled: [], offered: ["One"] },
  ]) {
    const raw = JSON.stringify(value);
    expect(() => readComposition(value)).toThrow();
    expect(JSON.stringify(value)).toBe(raw);
  }
  expect(readComposition(undefined)).toBeUndefined();
});
it("restores chosen provider and the permissions granted to the same version", async () => {
  const host = setup();
  expect(
    await restoreComposition(host, {
      schema: 1,
      enabled: [
        { id: "two", version: "1" },
        { id: "protected", version: "1" },
      ],
      granted: [
        { id: "protected", version: "1", capabilities: ["state.read"] },
      ],
    }),
  ).toEqual([]);
  expect(host.inspect("two").status).toBe("active");
  expect(host.inspect("one").desired).toBe(false);
  expect(host.inspect("protected").status).toBe("active");
  expect(captureComposition(host)).toEqual({
    schema: 1,
    enabled: [
      { id: "two", version: "1" },
      { id: "protected", version: "1" },
    ],
    granted: [{ id: "protected", version: "1", capabilities: ["state.read"] }],
  });
});
it("asks again for permissions given to another version and skips extensions no longer installed", async () => {
  const host = setup();
  expect(
    await restoreComposition(host, {
      schema: 1,
      enabled: [
        { id: "missing", version: "1" },
        { id: "two", version: "0" },
        { id: "protected", version: "0" },
      ],
      granted: [
        { id: "protected", version: "0", capabilities: ["state.read"] },
        { id: "missing", version: "1", capabilities: ["state.read"] },
      ],
    }),
  ).toEqual([]);
  expect(host.inspect("two").status).toBe("active");
  expect(host.inspect("protected").status).toBe("waiting");
  expect(host.granted("protected")).toEqual([]);
});
it("keeps saved entries of imports that did not load and drops removed ones", () => {
  const host = setup();
  const previous = {
    schema: 1 as const,
    enabled: [
      { id: "pending", version: "1" },
      { id: "removed", version: "1" },
    ],
    granted: [{ id: "pending", version: "1", capabilities: ["state.read"] }],
  };
  expect(captureComposition(host, previous, ["pending"])).toEqual(
    previous && {
      schema: 1,
      enabled: [{ id: "pending", version: "1" }],
      granted: [{ id: "pending", version: "1", capabilities: ["state.read"] }],
    },
  );
});
it("restores and captures several providers of one service", async () => {
  const host = setup();
  const enabled = [
    { id: "one", version: "1" },
    { id: "two", version: "1" },
  ];
  expect(await restoreComposition(host, { schema: 1, enabled })).toEqual([]);
  expect(captureComposition(host).enabled).toEqual(enabled);
});
it("reports activation failure while restoring other items and keeps the failed item enabled", async () => {
  const host = setup();
  host.install({
    manifest: { id: "broken", version: "1", apiVersion: 1 },
    activate() {
      throw Error("activation failed");
    },
  });
  const errors = await restoreComposition(host, {
    schema: 1,
    enabled: [
      { id: "broken", version: "1" },
      { id: "two", version: "1" },
    ],
  });
  expect(errors.join()).toContain("activation failed");
  expect(host.inspect("two").status).toBe("active");
  expect(captureComposition(host).enabled.map(({ id }) => id)).toEqual([
    "two",
    "broken",
  ]);
});

it("starts a built-in default once when it is new to a saved composition", async () => {
  const host = setup();
  const saved = { schema: 1 as const, enabled: [], offered: ["one"] };
  await restoreComposition(host, saved);
  const { composition, errors } = await startNewDefaults(host, saved, [
    "one",
    "two",
  ]);
  expect(errors).toEqual([]);
  // "one" was offered before and the user turned it off; it stays off.
  expect(host.inspect("one").desired).toBe(false);
  expect(host.inspect("two").status).toBe("active");
  expect(composition.offered).toEqual(["one", "two"]);
  const again = await startNewDefaults(host, composition, ["one", "two"]);
  expect(again.composition).toBe(composition);
  // The user's later choices keep the defaults they have seen.
  await host.stop("two");
  expect(captureComposition(host, composition)).toEqual({
    schema: 1,
    enabled: [],
    offered: ["one", "two"],
  });
  const fresh = await startNewDefaults(host, { schema: 1, enabled: [] }, [
    "one",
  ]);
  expect(fresh.composition.offered).toEqual(["one"]);
});

it("restores only saved grants still declared, on top of what the app granted", async () => {
  const host = setup();
  host.install({
    manifest: {
      id: "store",
      version: "1",
      apiVersion: 1,
      capabilities: ["state.read", "state.batch", "records.list"],
    },
    activate() {},
  });
  // The app grants its built-in what this version needs.
  await host.grant("store", ["state.read", "state.batch", "records.list"]);
  // Saved when the same version still declared state.write.
  const errors = await restoreComposition(host, {
    schema: 1,
    enabled: [{ id: "store", version: "1" }],
    granted: [
      {
        id: "store",
        version: "1",
        capabilities: ["state.read", "state.write"],
      },
    ],
  });
  expect(errors).toEqual([]);
  expect(host.granted("store").sort()).toEqual([
    "records.list",
    "state.batch",
    "state.read",
  ]);
  expect(host.inspect("store").status).toBe("active");
});
