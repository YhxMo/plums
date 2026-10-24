import { expect, it, vi } from "vitest";
import { importExtensionPackage } from "../modules/shell/extension-actions";
import { readPackage } from "../modules/shell/extension-package";
import {
  definition,
  files,
  id,
  installedImport,
  newHost,
} from "./fixtures/extension-package";

it("replaces an imported extension: stops, revokes, swaps the record and code", async () => {
  const { host, state, packages, stored, old } = await installedImport();
  await host.start(id);
  const next = await readPackage(files("export default 'new';"));
  const result = await importExtensionPackage(
    host,
    state,
    next,
    definition("2"),
    packages,
    async () => {},
  );
  expect(result.replaced).toBe(true);
  expect(host.manifest(id).version).toBe("2");
  expect(host.inspect(id).status).toBe("disabled");
  expect(state.imports).toEqual([{ id, url: next.url, label: id }]);
  expect(state.catalog).toEqual([{ id, url: next.url, label: id }]);
  await expect(packages.read(old.url)).rejects.toThrow("已丢失");
  expect((await packages.read(next.url)).main).toBe("export default 'new';");
  expect(stored()).toHaveLength(1);
});

it("disables the old version's credential bindings before the replacement is saved", async () => {
  const { host, state, packages } = await installedImport();
  const calls: string[] = [];
  state.save = vi.fn(async () => {
    calls.push("save");
  });
  const next = await readPackage(files("export default 'new';"));
  await importExtensionPackage(
    host,
    state,
    next,
    definition("2"),
    packages,
    async (owner, declared) => {
      calls.push(`retain ${owner} ${declared}`);
    },
  );
  expect(calls).toEqual([`retain extension.${id} false`, "save"]);
});

it("keeps the old version when its credential bindings cannot be disabled", async () => {
  const { host, state, packages, old, entry } = await installedImport();
  state.save = vi.fn(async () => {});
  const next = await readPackage(files("export default 'new';"));
  await expect(
    importExtensionPackage(
      host,
      state,
      next,
      definition("2"),
      packages,
      async () => {
        throw new Error("凭据绑定未能禁用");
      },
    ),
  ).rejects.toThrow("未能禁用");
  expect(state.save).not.toHaveBeenCalled();
  expect(host.manifest(id).version).toBe("1");
  expect(state.imports).toEqual([entry]);
  expect((await packages.read(old.url)).main).toBe("export default 'old';");
  await expect(packages.read(next.url)).rejects.toThrow("已丢失");
});

it("drops a replaced extension from the saved composition", async () => {
  const { host, state, packages } = await installedImport();
  const kept = { id: "other.ext", version: "1" };
  state.composition = { schema: 1, enabled: [{ id, version: "1" }, kept] };
  const next = await readPackage(files("export default 'new';"));
  await importExtensionPackage(
    host,
    state,
    next,
    definition("2"),
    packages,
    async () => {},
  );
  const composition = { schema: 1, enabled: [kept] };
  expect(state.save).toHaveBeenLastCalledWith({
    imports: [{ id, url: next.url, label: id }],
    composition,
  });
  expect(state.composition).toEqual(composition);
});

it("repairs an import that failed to load by importing the package again", async () => {
  const { state, packages, old } = await installedImport();
  const host = newHost();
  state.catalog = [];
  const next = await readPackage(files("export default 'fixed';"));
  const result = await importExtensionPackage(
    host,
    state,
    next,
    definition("2"),
    packages,
    async () => {},
  );
  expect(result.replaced).toBe(true);
  expect(host.manifest(id).version).toBe("2");
  expect(state.imports).toEqual([{ id, url: next.url, label: id }]);
  expect(state.catalog).toEqual([{ id, url: next.url, label: id }]);
  await expect(packages.read(old.url)).rejects.toThrow("已丢失");
});

it("keeps the old version and its source when a replacement is not saved", async () => {
  const { host, state, packages, old, entry } = await installedImport();
  state.save = vi.fn(async () => {
    throw Object.assign(new Error("disk full"), { outcome: "not-committed" });
  });
  const next = await readPackage(files("export default 'new';"));
  await expect(
    importExtensionPackage(
      host,
      state,
      next,
      definition("2"),
      packages,
      async () => {},
    ),
  ).rejects.toThrow("disk full");
  expect(host.manifest(id).version).toBe("1");
  expect(state.imports).toEqual([entry]);
  expect((await packages.read(old.url)).main).toBe("export default 'old';");
  await expect(packages.read(next.url)).rejects.toThrow("已丢失");
});

it("drops the old version's saved enablement and grants", async () => {
  const { host, state, packages } = await installedImport();
  state.composition = {
    schema: 1,
    enabled: [{ id, version: "1" }],
    granted: [{ id, version: "1", capabilities: ["state.read"] }],
  };
  const next = await readPackage(files("export default 'new';"));
  await importExtensionPackage(
    host,
    state,
    next,
    definition("2"),
    packages,
    async () => {},
  );
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      composition: { schema: 1, enabled: [], granted: [] },
    }),
  );
});
