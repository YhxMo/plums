import { expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type {
  ExtensionContext,
  ExtensionDefinition,
  Platform,
} from "../modules/sdk";

const definition = (
  activate: ExtensionDefinition["activate"] = () => {},
): ExtensionDefinition => ({
  manifest: {
    id: "author.example",
    version: "1",
    apiVersion: 1,
    capabilities: ["state.read"],
  },
  activate,
});
const platform = (): Platform => ({
  kind: "browser",
  available: () => true,
  grant: vi.fn(async () => {}),
  call: vi.fn(async () => ({ revision: 1, value: "retained" })),
});

it("requires an explicit clean stop before uninstall without requesting data deletion", async () => {
  const adapter = platform();
  const host = new Host(adapter);
  let ctx!: ExtensionContext;
  const extension = definition((context) => {
    ctx = context;
    context.on("sample", () => {});
  });
  host.install(extension);
  await host.grant(extension.manifest.id, ["state.read"]);
  await host.start(extension.manifest.id);
  await expect(host.uninstall(extension.manifest.id)).rejects.toThrow(/stop/i);
  expect(host.inspect(extension.manifest.id).status).toBe("active");
  await host.stop(extension.manifest.id);
  await host.uninstall(extension.manifest.id);
  expect(host.ids()).toEqual([]);
  expect(adapter.grant).toHaveBeenLastCalledWith(
    "extension.author.example",
    [],
  );
  expect(adapter.call).not.toHaveBeenCalled();
  await expect(ctx.platform("state.read")).rejects.toThrow(/stopped/i);
  host.install(extension);
  await host.start(extension.manifest.id);
  expect(host.inspect(extension.manifest.id).error).toContain(
    "Permission required",
  );
  await host.grant(extension.manifest.id, ["state.read"]);
  expect(await ctx.platform("state.read")).toEqual({
    revision: 1,
    value: "retained",
  });
});

it("retains diagnostics after cleanup failure instead of reporting uninstall", async () => {
  const host = new Host(platform());
  host.install(
    definition((ctx) =>
      ctx.onDispose(() => {
        throw new Error("release failure");
      }),
    ),
  );
  await host.grant("author.example", ["state.read"]);
  await host.start("author.example");
  await expect(host.stop("author.example")).rejects.toThrow("release failure");
  await expect(host.uninstall("author.example")).rejects.toThrow(/stop/i);
  expect(host.inspect("author.example").status).toBe("cleanup-failed");
});

it("keeps the installed record if platform revocation fails and permits retry", async () => {
  const adapter = platform();
  const host = new Host(adapter);
  host.install(definition());
  vi.mocked(adapter.grant).mockRejectedValueOnce(
    new Error("revocation failed"),
  );
  await expect(host.uninstall("author.example")).rejects.toThrow(
    "revocation failed",
  );
  expect(host.ids()).toEqual(["author.example"]);
  await host.uninstall("author.example");
  expect(host.ids()).toEqual([]);
});

it("does not uninstall a waiting extension until desired activation is stopped", async () => {
  const host = new Host(platform());
  host.install(definition());
  await host.start("author.example");
  await expect(host.uninstall("author.example")).rejects.toThrow(/stop/i);
  await host.stop("author.example");
  await host.uninstall("author.example");
  await expect(host.uninstall("author.example")).rejects.toThrow(
    "Unknown extension",
  );
});
