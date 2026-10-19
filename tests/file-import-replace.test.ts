import { expect, it, vi } from "vitest";
import { importExtensionFile } from "../modules/shell/extension-actions";
import { readExtensionFile } from "../modules/shell/file-import";
import {
  definition,
  file,
  id,
  installedImport,
  newHost,
} from "./fixtures/file-import";

it("replaces an imported extension: stops, revokes, swaps the record and code", async () => {
  const { host, state, sources, states, old } = await installedImport();
  await host.start(id);
  const next = await readExtensionFile(file("export default 'new';"));
  const result = await importExtensionFile(
    host,
    state,
    next,
    definition("2"),
    sources,
    async () => {},
  );
  expect(result.replaced).toBe(true);
  expect(host.manifest(id).version).toBe("2");
  expect(host.inspect(id).status).toBe("disabled");
  expect(state.imports).toEqual([{ id, url: next.url, label: id }]);
  expect(state.catalog).toEqual([{ id, url: next.url, label: id }]);
  await expect(sources.read(old.hash)).rejects.toThrow("已丢失");
  expect(await sources.read(next.hash)).toBe("export default 'new';");
  expect(states.size).toBe(1);
});

it("disables the old version's credential bindings before the replacement is saved", async () => {
  const { host, state, sources } = await installedImport();
  const calls: string[] = [];
  state.save = vi.fn(async () => {
    calls.push("save");
  });
  const next = await readExtensionFile(file("export default 'new';"));
  await importExtensionFile(
    host,
    state,
    next,
    definition("2"),
    sources,
    async (owner, declared) => {
      calls.push(`retain ${owner} ${declared}`);
    },
  );
  expect(calls).toEqual([`retain extension.${id} false`, "save"]);
});

it("keeps the old version when its credential bindings cannot be disabled", async () => {
  const { host, state, sources, old, entry } = await installedImport();
  state.save = vi.fn(async () => {});
  const next = await readExtensionFile(file("export default 'new';"));
  await expect(
    importExtensionFile(
      host,
      state,
      next,
      definition("2"),
      sources,
      async () => {
        throw new Error("凭据绑定未能禁用");
      },
    ),
  ).rejects.toThrow("未能禁用");
  expect(state.save).not.toHaveBeenCalled();
  expect(host.manifest(id).version).toBe("1");
  expect(state.imports).toEqual([entry]);
  expect(await sources.read(old.hash)).toBe("export default 'old';");
  await expect(sources.read(next.hash)).rejects.toThrow("已丢失");
});

it("drops a replaced extension from the saved composition", async () => {
  const { host, state, sources } = await installedImport();
  const kept = { id: "other.ext", version: "1" };
  state.composition = { schema: 1, enabled: [{ id, version: "1" }, kept] };
  const next = await readExtensionFile(file("export default 'new';"));
  await importExtensionFile(
    host,
    state,
    next,
    definition("2"),
    sources,
    async () => {},
  );
  const composition = { schema: 1, enabled: [kept] };
  expect(state.save).toHaveBeenLastCalledWith({
    imports: [{ id, url: next.url, label: id }],
    composition,
  });
  expect(state.composition).toEqual(composition);
});

it("repairs an import that failed to load by importing the file again", async () => {
  const { state, sources, old } = await installedImport();
  const host = newHost();
  state.catalog = [];
  const next = await readExtensionFile(file("export default 'fixed';"));
  const result = await importExtensionFile(
    host,
    state,
    next,
    definition("2"),
    sources,
    async () => {},
  );
  expect(result.replaced).toBe(true);
  expect(host.manifest(id).version).toBe("2");
  expect(state.imports).toEqual([{ id, url: next.url, label: id }]);
  expect(state.catalog).toEqual([{ id, url: next.url, label: id }]);
  await expect(sources.read(old.hash)).rejects.toThrow("已丢失");
});

it("keeps the old version and its source when a replacement is not saved", async () => {
  const { host, state, sources, old, entry } = await installedImport();
  state.save = vi.fn(async () => {
    throw Object.assign(new Error("disk full"), { outcome: "not-committed" });
  });
  const next = await readExtensionFile(file("export default 'new';"));
  await expect(
    importExtensionFile(
      host,
      state,
      next,
      definition("2"),
      sources,
      async () => {},
    ),
  ).rejects.toThrow("disk full");
  expect(host.manifest(id).version).toBe("1");
  expect(state.imports).toEqual([entry]);
  expect(await sources.read(old.hash)).toBe("export default 'old';");
  await expect(sources.read(next.hash)).rejects.toThrow("已丢失");
});

it("drops the old version's saved enablement and grants", async () => {
  const { host, state, sources } = await installedImport();
  state.composition = {
    schema: 1,
    enabled: [{ id, version: "1" }],
    granted: [{ id, version: "1", capabilities: ["state.read"] }],
  };
  const next = await readExtensionFile(file("export default 'new';"));
  await importExtensionFile(
    host,
    state,
    next,
    definition("2"),
    sources,
    async () => {},
  );
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      composition: { schema: 1, enabled: [], granted: [] },
    }),
  );
});
