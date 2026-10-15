import { expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { Platform } from "../modules/sdk";
import { uninstallImport } from "../modules/shell/uninstall";

const id = "sample.imported";
const imports = [{ id, url: "/sample.js", label: "Sample" }];
function setup(broken = false) {
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: vi.fn(async () => {}),
    call: vi.fn(async () => null),
  };
  const host = new Host(platform);
  host.install({
    manifest: { id, version: "1", apiVersion: 1 },
    activate(ctx) {
      if (broken)
        ctx.onDispose(() => {
          throw Error("cleanup failed");
        });
    },
  });
  return { host, platform };
}
it("stops and revokes before persisting removal, never deletes stored data", async () => {
  const { host, platform } = setup();
  await host.start(id);
  const save = vi.fn(async (next) => {
    expect(next).toEqual([]);
    expect(host.inspect(id).status).toBe("disabled");
    expect(platform.grant).toHaveBeenCalledWith("extension." + id, []);
  });
  expect(await uninstallImport(host, id, imports, save)).toEqual([]);
  expect(host.ids()).toEqual([]);
  expect(platform.call).not.toHaveBeenCalled();
  expect(imports).toHaveLength(1);
});
it("preserves installed path and record when persistence fails, then retries", async () => {
  const { host } = setup();
  await host.start(id);
  const save = vi
    .fn()
    .mockRejectedValueOnce(Error("write failed"))
    .mockResolvedValue(undefined);
  await expect(uninstallImport(host, id, imports, save)).rejects.toThrow(
    "write failed",
  );
  expect(host.ids()).toContain(id);
  expect(host.inspect(id).status).toBe("disabled");
  await uninstallImport(host, id, imports, save);
  expect(host.ids()).toEqual([]);
});
it("refuses builtin removal and does not save when cleanup fails", async () => {
  const { host } = setup(true);
  const save = vi.fn();
  await host.start(id);
  await expect(
    uninstallImport(host, "builtin", imports, save),
  ).rejects.toThrow();
  await expect(uninstallImport(host, id, imports, save)).rejects.toThrow(
    "cleanup failed",
  );
  expect(save).not.toHaveBeenCalled();
});
it("does not persist removal if revocation fails", async () => {
  const { host, platform } = setup();
  const save = vi.fn();
  vi.mocked(platform.grant).mockRejectedValueOnce(Error("revoke failed"));
  await expect(uninstallImport(host, id, imports, save)).rejects.toThrow(
    "revoke failed",
  );
  expect(save).not.toHaveBeenCalled();
  expect(host.ids()).toContain(id);
});

it("keeps the record if final revocation fails after durable path removal", async () => {
  const { host, platform } = setup();
  vi.mocked(platform.grant)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(Error("final revoke failed"));
  const save = vi.fn(async () => {});
  await expect(uninstallImport(host, id, imports, save)).rejects.toThrow(
    "final revoke failed",
  );
  expect(save).toHaveBeenCalledWith([]);
  expect(host.ids()).toContain(id);
  await uninstallImport(host, id, imports, save);
  expect(host.ids()).toEqual([]);
});
it("does not remove the live record on an unknown save receipt", async () => {
  const { host } = setup();
  let durable = imports;
  await expect(
    uninstallImport(host, id, imports, async (next) => {
      durable = next;
      throw Error("unknown receipt");
    }),
  ).rejects.toThrow("unknown receipt");
  expect(host.ids()).toContain(id);
  expect(durable).toEqual([]);
});
