import { expect, it, vi } from "vitest";
import { resolveConfiguration } from "../modules/sdk/configuration";
import { Host } from "../modules/extension-host/host";
import { saveConfiguration } from "../modules/shell/configuration";
import type { Platform, ExtensionContext } from "../modules/sdk";
const declaration = {
  version: 1,
  fields: {
    title: {
      type: "string" as const,
      label: "Title",
      default: "Count",
      maxLength: 20,
    },
    step: {
      type: "number" as const,
      label: "Step",
      default: 1,
      min: 1,
      max: 10,
    },
    shown: { type: "boolean" as const, label: "Shown", default: true },
  },
};
const input = { version: 1, values: { title: "Hello", step: 2, shown: false } };
function setup() {
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: async () => {},
    call: async () => null,
  };
  return new Host(platform);
}
it("validates defaults, unknown fields, value bounds and versions", () => {
  expect(resolveConfiguration(declaration, undefined).values.step).toBe(1);
  for (const value of [
    { version: 2, values: input.values },
    { ...input, values: { ...input.values, token: "bad" } },
    { ...input, values: { ...input.values, step: NaN } },
    { ...input, values: { ...input.values, step: 11 } },
    { ...input, values: { ...input.values, title: "x".repeat(21) } },
  ])
    expect(() => resolveConfiguration(declaration, value)).toThrow();
});
it("isolates immutable activation values and blocks bad persisted configuration", async () => {
  const host = setup();
  let a: ExtensionContext | undefined;
  let b: ExtensionContext | undefined;
  host.install(
    {
      manifest: {
        id: "a",
        version: "1",
        apiVersion: 1,
        configuration: declaration,
      },
      activate(ctx) {
        a = ctx;
      },
    },
    input,
  );
  host.install(
    {
      manifest: {
        id: "b",
        version: "1",
        apiVersion: 1,
        configuration: declaration,
      },
      activate(ctx) {
        b = ctx;
      },
    },
    { version: 2, values: {} },
  );
  await host.start("a");
  await host.start("b");
  expect(a?.configuration.step).toBe(2);
  expect(b).toBeUndefined();
  expect(host.inspect("b").status).toBe("waiting");
  expect(host.configuration("b").error).toBeTruthy();
  expect(() => {
    (a!.configuration as Record<string, unknown>).step = 9;
  }).toThrow();
  input.values.step = 3;
  expect(a?.configuration.step).toBe(2);
  input.values.step = 2;
});
it("failed persistence leaves stopped old configuration; retry applies and restarts", async () => {
  const host = setup();
  const values: number[] = [];
  host.install({
    manifest: {
      id: "a",
      version: "1",
      apiVersion: 1,
      configuration: declaration,
    },
    activate(ctx) {
      values.push(ctx.configuration.step as number);
    },
  });
  await host.start("a");
  const save = vi
    .fn()
    .mockRejectedValueOnce(Error("write failed"))
    .mockResolvedValue(undefined);
  await expect(saveConfiguration(host, "a", input, save)).rejects.toThrow();
  expect(values).toEqual([1]);
  expect(host.configuration("a").value.values.step).toBe(1);
  expect(host.inspect("a").status).toBe("disabled");
  await saveConfiguration(host, "a", input, save);
  expect(host.configuration("a").value.values.step).toBe(2);
  expect(host.inspect("a").status).toBe("disabled");
  await host.start("a");
  expect(values).toEqual([1, 2]);
});
it("active configuration changes stop old activation, save and restart with new immutable values", async () => {
  const host = setup();
  const seen: number[] = [];
  const cleanup = vi.fn();
  host.install({
    manifest: {
      id: "a",
      version: "1",
      apiVersion: 1,
      configuration: declaration,
    },
    activate(ctx) {
      seen.push(ctx.configuration.step as number);
      ctx.onDispose(cleanup);
    },
  });
  await host.start("a");
  await saveConfiguration(host, "a", input, async () => {
    expect(host.inspect("a").status).toBe("disabled");
    expect(seen).toEqual([1]);
  });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(seen).toEqual([1, 2]);
  await expect(host.configure("a", input)).rejects.toThrow("Stop extension");
});
it("invalid input and failed cleanup never save configuration", async () => {
  const host = setup();
  const save = vi.fn();
  host.install({
    manifest: {
      id: "a",
      version: "1",
      apiVersion: 1,
      configuration: declaration,
    },
    activate(ctx) {
      ctx.onDispose(() => {
        throw Error("cleanup failed");
      });
    },
  });
  await host.start("a");
  await expect(
    saveConfiguration(host, "a", { ...input, version: 99 }, save),
  ).rejects.toThrow();
  expect(host.inspect("a").status).toBe("active");
  await expect(saveConfiguration(host, "a", input, save)).rejects.toThrow(
    "cleanup failed",
  );
  expect(save).not.toHaveBeenCalled();
});
it("rejects invalid declarations and undeclared configuration", () => {
  expect(() => resolveConfiguration(undefined, input)).toThrow();
  for (const configuration of [
    { ...declaration, version: 0 },
    {
      version: 1,
      fields: { bad: { type: "secret", label: "Bad", default: "" } },
    },
    {
      version: 1,
      fields: {
        bad: { type: "number", label: "Bad", default: 1, min: 4, max: 2 },
      },
    },
  ])
    expect(() =>
      resolveConfiguration(configuration as never, undefined),
    ).toThrow();
});
