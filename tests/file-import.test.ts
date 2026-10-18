import { afterEach, expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type {
  ExtensionDefinition,
  Platform,
  StoredState,
} from "../modules/sdk";
import {
  importExtensionFile,
  uninstallExtension,
  removeFailedImport,
  retryImport,
  type ExtensionState,
} from "../modules/shell/extension-actions";
import {
  readExtensionFile,
  sourceStore,
  sourceLabel,
} from "../modules/shell/file-import";
import { parsePersistedState } from "../src/shell/persisted-state";
import { installImports } from "../src/shell/extensions";

afterEach(() => vi.unstubAllGlobals());

const id = "author.echo";
const definition = (version = "1"): ExtensionDefinition => ({
  manifest: { id, version, apiVersion: 1 },
  activate() {},
});
const file = (text: string) => new Blob([text], { type: "text/javascript" });

function memory() {
  const states = new Map<string, StoredState>();
  const call = vi.fn(async (capability: string, payload?: unknown) => {
    const { key, revision, value, remove } = payload as {
      key: string;
      revision?: number;
      value?: unknown;
      remove?: boolean;
    };
    if (capability === "state.read") return states.get(key) ?? null;
    if (revision !== (states.get(key)?.revision ?? 0))
      throw Object.assign(new Error("conflict"), { outcome: "not-committed" });
    if (remove) {
      states.delete(key);
      return null;
    }
    const next = { revision: revision! + 1, value: structuredClone(value) };
    states.set(key, next);
    return next;
  });
  return { states, call, sources: sourceStore(call) };
}

function newHost() {
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: vi.fn(async () => {}),
    call: vi.fn(async () => null),
  };
  return new Host(platform);
}
function setup() {
  const host = newHost();
  const state: ExtensionState = {
    imports: [],
    catalog: [],
    configurations: {},
    save: vi.fn(async () => {}),
  };
  return { host, state, ...memory() };
}

it("reads a UTF-8 file into a content-addressed import", async () => {
  const read = await readExtensionFile(file("export default 1;\n"));
  expect(read.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(read.url).toBe(`imported:sha256:${read.hash}`);
  expect(sourceLabel(read.url)).toBe(
    `本地导入的文件 · ${read.hash.slice(0, 12)}`,
  );
  expect(sourceLabel("/services/upper.js")).toBe("/services/upper.js");
  const again = await readExtensionFile(file("export default 1;\n"));
  expect(again.hash).toBe(read.hash);
});

it("rejects files that are too large to store or are not UTF-8 text", async () => {
  await expect(readExtensionFile(file("x".repeat(61 * 1024)))).rejects.toThrow(
    "60 KiB",
  );
  // Quotes double when stored as JSON, so the stored size is what counts.
  await expect(readExtensionFile(file('"'.repeat(40 * 1024)))).rejects.toThrow(
    "60 KiB",
  );
  await expect(
    readExtensionFile(new Blob([new Uint8Array([0xff, 0xfe, 0x41])])),
  ).rejects.toThrow("UTF-8");
});

it("stores a source once and refuses a missing or altered copy", async () => {
  const { states, sources, call } = memory();
  const read = await readExtensionFile(file("export default 2;"));
  await sources.write(read);
  await sources.write(read);
  expect(call.mock.calls.filter(([c]) => c === "state.write")).toHaveLength(1);
  expect(await sources.read(read.hash)).toBe("export default 2;");
  const [key] = [...states.keys()];
  expect(key).toMatch(/^x-[0-9a-f]{48}$/);
  states.get(key)!.value = { version: 1, source: "export default 3;" };
  await expect(sources.read(read.hash)).rejects.toThrow("已损坏");
  states.clear();
  await expect(sources.read(read.hash)).rejects.toThrow("已丢失");
});

it("writes the source before the shell record and installs only after both", async () => {
  const { host, state, sources, states } = setup();
  const read = await readExtensionFile(file("export default 'a';"));
  state.save = vi.fn(async () => {
    expect(states.size).toBe(1);
    expect(host.ids()).not.toContain(id);
  });
  const result = await importExtensionFile(
    host,
    state,
    read,
    definition(),
    sources,
  );
  expect(result).toEqual({
    entry: { id, url: read.url, label: id },
    replaced: false,
  });
  expect(state.save).toHaveBeenCalledWith({ imports: [result.entry] });
  expect(state.imports).toEqual([result.entry]);
  expect(state.catalog).toEqual([result.entry]);
  expect(host.inspect(id).status).toBe("disabled");
});

it("refuses to shadow a built-in extension", async () => {
  const { host, state, sources, states } = setup();
  const builtIn = { id, url: "/services/echo.js", label: "内置" };
  host.install(definition());
  state.catalog = [builtIn];
  const read = await readExtensionFile(file("export default 'b';"));
  await expect(
    importExtensionFile(host, state, read, definition(), sources),
  ).rejects.toThrow("内置扩展");
  expect(states.size).toBe(0);
  expect(state.save).not.toHaveBeenCalled();
});

it("drops the new source when the shell record was definitely not saved", async () => {
  const { host, state, sources, states } = setup();
  state.save = vi.fn(async () => {
    throw Object.assign(new Error("disk full"), { outcome: "not-committed" });
  });
  const read = await readExtensionFile(file("export default 'c';"));
  await expect(
    importExtensionFile(host, state, read, definition(), sources),
  ).rejects.toThrow("disk full");
  expect(states.size).toBe(0);
  expect(host.ids()).not.toContain(id);
});

it("keeps the new source when the shell record receipt is unknown", async () => {
  const { host, state, sources, states } = setup();
  state.save = vi.fn(async () => {
    throw Object.assign(new Error("receipt lost"), { outcome: "unknown" });
  });
  const read = await readExtensionFile(file("export default 'd';"));
  await expect(
    importExtensionFile(host, state, read, definition(), sources),
  ).rejects.toThrow("receipt lost");
  expect(states.size).toBe(1);
});

async function installedImport() {
  const fixture = setup();
  const old = await readExtensionFile(file("export default 'old';"));
  const { entry } = await importExtensionFile(
    fixture.host,
    fixture.state,
    old,
    definition("1"),
    fixture.sources,
  );
  return { ...fixture, old, entry };
}

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

it("keeps the old version and its source when a replacement is not saved", async () => {
  const { host, state, sources, old, entry } = await installedImport();
  state.save = vi.fn(async () => {
    throw Object.assign(new Error("disk full"), { outcome: "not-committed" });
  });
  const next = await readExtensionFile(file("export default 'new';"));
  await expect(
    importExtensionFile(host, state, next, definition("2"), sources),
  ).rejects.toThrow("disk full");
  expect(host.manifest(id).version).toBe("1");
  expect(state.imports).toEqual([entry]);
  expect(await sources.read(old.hash)).toBe("export default 'old';");
  await expect(sources.read(next.hash)).rejects.toThrow("已丢失");
});

it("removes the stored source after uninstall, and a failed removal is not an error", async () => {
  const { host, state, sources, states, call } = await installedImport();
  call.mockImplementationOnce(async () => {
    throw new Error("disk busy");
  });
  await uninstallExtension(host, state, id, async () => {}, sources);
  expect(state.imports).toEqual([]);
  expect(states.size).toBe(1);
  const again = await installedImport();
  await uninstallExtension(
    again.host,
    again.state,
    id,
    async () => {},
    again.sources,
  );
  expect(again.states.size).toBe(0);
});

it("removes the stored source of a failed import record", async () => {
  const { state, sources, states, entry } = await installedImport();
  const host = newHost();
  state.catalog = [];
  await removeFailedImport(host, state, id, async () => {}, sources);
  expect(state.imports).toEqual([]);
  expect(states.size).toBe(0);
  expect(entry.url).toMatch(/^imported:/);
});

it("retries a file import from its stored source", async () => {
  const fixture = await installedImport();
  const host = newHost();
  fixture.state.catalog = [];
  const loadSource = vi.fn(async () => definition());
  await retryImport(host, fixture.state, id, "https://app.test/", 1, {
    sources: fixture.sources,
    loadSource,
  });
  expect(loadSource).toHaveBeenCalledWith("export default 'old';", id);
  expect(host.ids()).toContain(id);
});

it("restores a file import at start and reports an altered source", async () => {
  const fixture = await installedImport();
  const loadSource = vi.fn(async () => definition());
  const restored = await installImports(
    newHost(),
    fixture.state.imports,
    {},
    [],
    {
      sources: fixture.sources,
      loadSource,
    },
  );
  expect(restored.failedImports).toEqual({});
  expect(restored.catalog).toEqual(fixture.state.imports);
  const [key] = [...fixture.states.keys()];
  fixture.states.get(key)!.value = { version: 1, source: "changed" };
  const failed = await installImports(
    newHost(),
    fixture.state.imports,
    {},
    [],
    {
      sources: fixture.sources,
      loadSource,
    },
  );
  expect(failed.failedImports[id]).toContain("已损坏");
  expect(loadSource).toHaveBeenCalledOnce();
});

it("accepts a stored file import and rejects a malformed one", () => {
  vi.stubGlobal("location", { href: "https://app.test/" });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const url = `imported:sha256:${"a".repeat(64)}`;
  expect(
    parsePersistedState({ version: 1, imports: [{ id, url, label: id }] })
      .imports,
  ).toEqual([{ id, url, label: id }]);
  expect(() =>
    parsePersistedState({
      version: 1,
      imports: [{ id, url: "imported:sha256:zz", label: id }],
    }),
  ).toThrow();
});
