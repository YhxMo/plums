import { expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import {
  readComposition,
  captureComposition,
  restoreComposition,
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
    { schema: 1, enabled: [{ id: "one", version: "" }] },
    {
      schema: 1,
      enabled: [
        { id: "one", version: "1" },
        { id: "one", version: "1" },
      ],
    },
  ]) {
    const raw = JSON.stringify(value);
    expect(() => readComposition(value)).toThrow();
    expect(JSON.stringify(value)).toBe(raw);
  }
  expect(readComposition(undefined)).toBeUndefined();
});
it("restores chosen provider and waits for explicit permissions", async () => {
  const host = setup();
  expect(
    await restoreComposition(host, {
      schema: 1,
      enabled: [
        { id: "two", version: "1" },
        { id: "protected", version: "1" },
      ],
    }),
  ).toEqual([]);
  expect(host.inspect("two").status).toBe("active");
  expect(host.inspect("one").desired).toBe(false);
  expect(host.inspect("protected").status).toBe("waiting");
  expect(captureComposition(host).enabled.map((e) => e.id)).toEqual([
    "two",
    "protected",
  ]);
});
it("preflights missing, changed and conflicting providers before any activation", async () => {
  for (const enabled of [
    [{ id: "missing", version: "1" }],
    [{ id: "two", version: "2" }],
    [
      { id: "one", version: "1" },
      { id: "two", version: "1" },
    ],
  ]) {
    const host = setup();
    expect(
      (await restoreComposition(host, { schema: 1, enabled })).length,
    ).toBeGreaterThan(0);
    expect(host.ids().some((id) => host.inspect(id).desired)).toBe(false);
  }
});
it("refuses capturing conflicting desired providers", async () => {
  const host = setup();
  await host.start("one");
  await expect(host.start("two")).rejects.toThrow("Service already provided");
  expect(() => captureComposition(host)).toThrow();
});
it("reports activation failure while restoring other items and refuses a failed snapshot", async () => {
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
  expect(() => captureComposition(host)).toThrow("尚未恢复");
});
