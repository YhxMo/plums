import { afterEach, expect, it, vi } from "vitest";
import {
  importExtensionPackage,
  uninstallExtension,
  removeFailedImport,
  retryImport,
} from "../modules/shell/extension-actions";
import {
  loadPackage,
  readPackage,
  readZip,
  sourceLabel,
} from "../modules/shell/extension-package";
import { parsePersistedState } from "../src/shell/persisted-state";
import { installImports } from "../src/shell/extensions";
import {
  definition,
  files,
  id,
  installedImport,
  manifest,
  newHost,
  setup,
} from "./fixtures/extension-package";

afterEach(() => vi.unstubAllGlobals());

it("reads a manifest and main.js into a content-addressed package without running it", async () => {
  const main = "globalThis.ranPackage = true; export default {};\n";
  const read = await readPackage(files(main));
  expect(read.manifest).toEqual(manifest());
  expect(read.main).toBe(main);
  expect(read.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(read.url).toBe(`package:sha256:${read.hash}`);
  expect(sourceLabel(read.url)).toBe(
    `导入的扩展包 · ${read.hash.slice(0, 12)}`,
  );
  expect(sourceLabel("/services/upper/")).toBe("/services/upper/");
  expect((globalThis as { ranPackage?: boolean }).ranPackage).toBeUndefined();
  expect((await readPackage(files(main))).hash).toBe(read.hash);
  expect((await readPackage(files(`${main} `))).hash).not.toBe(read.hash);
});

it("finds the package inside one top folder and ignores other files", async () => {
  const read = await readPackage([
    ...files(undefined, undefined, "echo/"),
    { path: "echo/README.md", data: new Blob(["# echo"]) },
    { path: "__MACOSX/echo/._main.js", data: new Blob(["junk"]) },
    { path: "echo/.DS_Store", data: new Blob(["junk"]) },
  ]);
  expect(read.manifest.id).toBe(id);
});

it.each([
  ["no manifest", [files()[1]], "manifest.json"],
  ["no main.js", [files()[0]], "main.js"],
  [
    "two packages",
    [
      ...files(undefined, undefined, "a/"),
      ...files(undefined, undefined, "b/"),
    ],
    "manifest.json",
  ],
  ["manifest not JSON", files(undefined, "{"), "不是有效的 JSON"],
  [
    "manifest not an extension",
    files(undefined, '{"id":"A"}'),
    "manifest.json 不是有效的扩展清单（manifest.id）",
  ],
  [
    "main.js not UTF-8",
    [files()[0], { path: "main.js", data: new Blob([new Uint8Array([0xff])]) }],
    "UTF-8",
  ],
  ["main.js too large", files("x".repeat(3 * 1024 * 1024 + 1)), "3 MiB"],
  [
    "manifest too large",
    files(
      undefined,
      JSON.stringify({ ...manifest(), description: "x".repeat(70_000) }),
    ),
    "64 KiB",
  ],
] as const)("rejects a package with %s", async (_label, input, message) => {
  await expect(readPackage([...input])).rejects.toThrow(message);
});

it("loads main.js only when asked, under the manifest it came with", async () => {
  // Node cannot import a Blob URL; the app's evaluator is covered end to end.
  const evaluating = (exported: unknown) =>
    vi.fn(async (_source: string) => ({ default: exported }));
  const read = await readPackage(files("main"));
  const evaluate = evaluating({ activate() {} });
  const loaded = await loadPackage(read, undefined, evaluate);
  expect(evaluate).toHaveBeenCalledWith("main");
  expect(loaded.manifest).toEqual(manifest());
  expect(typeof loaded.activate).toBe("function");
  await expect(loadPackage(read, undefined, evaluating({}))).rejects.toThrow(
    "activate",
  );
  await expect(
    loadPackage(
      read,
      undefined,
      evaluating({ manifest: { id: "other.id" }, activate() {} }),
    ),
  ).rejects.toThrow("manifest.json");
  await expect(
    loadPackage(read, "other.id", evaluating({ activate() {} })),
  ).rejects.toThrow();
});

it("stores a package once and refuses a missing or altered copy", async () => {
  const { packages, call, storage } = setup();
  const read = await readPackage(files("export default 2;"));
  await packages.write(read);
  await packages.write(read);
  expect(call.mock.calls.filter(([c]) => c === "state.batch")).toHaveLength(1);
  expect(await packages.read(read.url)).toMatchObject({
    main: "export default 2;",
    manifest: manifest(),
  });
  const key = "plums:host.shell#records";
  const saved = JSON.parse(storage.get(key)!);
  saved.records[0].value.main = "export default 3;";
  storage.set(key, JSON.stringify(saved));
  await expect(packages.read(read.url)).rejects.toThrow("已损坏");
  storage.clear();
  await expect(packages.read(read.url)).rejects.toThrow("已丢失");
});

it("writes the package before the shell record and installs only after both", async () => {
  const { host, state, packages, stored } = setup();
  const read = await readPackage(files("export default 'a';"));
  state.save = vi.fn(async () => {
    expect(stored()).toHaveLength(1);
    expect(host.ids()).not.toContain(id);
  });
  const result = await importExtensionPackage(
    host,
    state,
    read,
    definition(),
    packages,
    async () => {},
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

it("lists an import under its manifest name", async () => {
  const { host, state, packages } = setup();
  const read = await readPackage(files("export default 'n';"));
  const named = definition();
  named.manifest.name = "回声";
  const { entry } = await importExtensionPackage(
    host,
    state,
    read,
    named,
    packages,
    async () => {},
  );
  expect(entry.label).toBe("回声");
});

it("refuses to shadow a built-in extension", async () => {
  const { host, state, packages, stored } = setup();
  host.install(definition());
  state.catalog = [{ id, url: "/services/echo/", label: "内置" }];
  const read = await readPackage(files("export default 'b';"));
  await expect(
    importExtensionPackage(
      host,
      state,
      read,
      definition(),
      packages,
      async () => {},
    ),
  ).rejects.toThrow("内置扩展");
  expect(stored()).toHaveLength(0);
  expect(state.save).not.toHaveBeenCalled();
});

it("drops the new package when the shell record was definitely not saved", async () => {
  const { host, state, packages, stored } = setup();
  state.save = vi.fn(async () => {
    throw Object.assign(new Error("disk full"), { outcome: "not-committed" });
  });
  const read = await readPackage(files("export default 'c';"));
  await expect(
    importExtensionPackage(
      host,
      state,
      read,
      definition(),
      packages,
      async () => {},
    ),
  ).rejects.toThrow("disk full");
  expect(stored()).toHaveLength(0);
  expect(host.ids()).not.toContain(id);
});

it("keeps the new package when the shell record receipt is unknown", async () => {
  const { host, state, packages, stored } = setup();
  state.save = vi.fn(async () => {
    throw Object.assign(new Error("receipt lost"), { outcome: "unknown" });
  });
  const read = await readPackage(files("export default 'd';"));
  await expect(
    importExtensionPackage(
      host,
      state,
      read,
      definition(),
      packages,
      async () => {},
    ),
  ).rejects.toThrow("receipt lost");
  expect(stored()).toHaveLength(1);
});

it("removes the stored package after uninstall, and a failed removal is not an error", async () => {
  const { host, state, packages, stored, call } = await installedImport();
  call.mockImplementationOnce(async () => {
    throw new Error("disk busy");
  });
  await uninstallExtension(host, state, id, async () => {}, packages);
  expect(state.imports).toEqual([]);
  expect(stored()).toHaveLength(1);
  const again = await installedImport();
  await uninstallExtension(
    again.host,
    again.state,
    id,
    async () => {},
    again.packages,
  );
  expect(again.stored()).toHaveLength(0);
});

it("removes the stored package of a failed import record", async () => {
  const { state, packages, stored, entry } = await installedImport();
  const host = newHost();
  state.catalog = [];
  await removeFailedImport(host, state, id, async () => {}, packages);
  expect(state.imports).toEqual([]);
  expect(stored()).toHaveLength(0);
  expect(entry.url).toMatch(/^package:/);
});

it("retries a package import from its stored copy", async () => {
  const fixture = await installedImport();
  const host = newHost();
  fixture.state.catalog = [];
  const load = vi.fn(async () => definition());
  await retryImport(host, fixture.state, id, "https://app.test/", 1, {
    packages: fixture.packages,
    loadPackage: load,
  });
  expect(load).toHaveBeenCalledWith(
    expect.objectContaining({ main: "export default 'old';" }),
    id,
  );
  expect(host.ids()).toContain(id);
});

it("restores a package at start, and asks to re-import a retired single file", async () => {
  const fixture = await installedImport();
  const load = vi.fn(async () => definition());
  const retired = {
    id: "author.old",
    url: `imported:sha256:${"a".repeat(64)}`,
    label: "旧文件",
  };
  const restored = await installImports(
    newHost(),
    [...fixture.state.imports, retired],
    {},
    [],
    { packages: fixture.packages, loadPackage: load },
  );
  expect(restored.catalog).toEqual(fixture.state.imports);
  expect(restored.failedImports).toEqual({
    "author.old": expect.stringContaining("重新导入"),
  });
  expect(load).toHaveBeenCalledOnce();
});

it("accepts stored package and retired file imports and rejects a malformed one", () => {
  vi.stubGlobal("location", { href: "https://app.test/" });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  for (const url of [
    `package:sha256:${"a".repeat(64)}`,
    `imported:sha256:${"a".repeat(64)}`,
  ])
    expect(
      parsePersistedState({ version: 1, imports: [{ id, url, label: id }] })
        .imports,
    ).toEqual([{ id, url, label: id }]);
  expect(() =>
    parsePersistedState({
      version: 1,
      imports: [{ id, url: "package:sha256:zz", label: id }],
    }),
  ).toThrow();
});

it("reads a package from a zip, unpacking only its two files", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const zip = zipSync({
    "echo/manifest.json": strToU8(JSON.stringify(manifest())),
    "echo/main.js": strToU8("export default { activate() {} };"),
    "echo/assets/logo.png": new Uint8Array(10),
    "__MACOSX/echo/._main.js": strToU8("junk"),
  });
  const read = await readPackage(await readZip(new Blob([zip])));
  expect(read.manifest).toEqual(manifest());
  expect(read.main).toBe("export default { activate() {} };");
  await expect(readZip(new Blob(["not a zip"]))).rejects.toThrow("zip");
  const large = zipSync({
    "main.js": new Uint8Array(3 * 1024 * 1024 + 1),
    "manifest.json": strToU8("{}"),
  });
  await expect(readZip(new Blob([large]))).rejects.toThrow("3 MiB");
});
