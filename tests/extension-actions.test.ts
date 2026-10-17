import { expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { ExtensionDefinition, Platform } from "../modules/sdk";
import {
  installExtension,
  retryImport,
  removeFailedImport,
  uninstallExtension,
  saveComposition,
  configureExtension,
  type ExtensionState,
} from "../modules/shell/extension-actions";

const id = "sample.imported";
const entry = { id, url: "/sample.js", label: "Sample" };
const definition: ExtensionDefinition = {
  manifest: {
    id,
    version: "1",
    apiVersion: 1,
    configuration: {
      version: 1,
      fields: {
        step: { type: "number", label: "Step", default: 1, min: 1, max: 10 },
      },
    },
  },
  activate() {},
};
function setup() {
  const data = { messages: ["keep"] };
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: vi.fn(async () => {}),
    call: vi.fn(async () => data),
  };
  const host = new Host(platform);
  const state: ExtensionState = {
    imports: [],
    catalog: [],
    configurations: {},
    composition: { schema: 1, enabled: [] },
    save: vi.fn(async () => {}),
  };
  const prepareUninstall = vi.fn(async () => {});
  const load = vi.fn(async () => definition);
  const request = {
    id,
    url: "/sample.js?v=1#ignored",
    baseUrl: "https://app.test/",
  };
  return { host, state, platform, data, prepareUninstall, load, request };
}
function installed() {
  const fixture = setup();
  fixture.host.install(definition);
  fixture.state.imports = [entry];
  fixture.state.catalog = [entry];
  fixture.state.configurations[id] = { version: 1, values: { step: 1 } };
  fixture.state.composition!.enabled = [{ id, version: "1" }];
  return fixture;
}

it("publishes a saved import before installing and preserves unrelated paths", async () => {
  const { host, state, load, request } = setup();
  const other = { id: "other", url: "/other.js", label: "Other" };
  state.imports = [other];
  state.save = vi.fn(async () => {
    expect(host.ids()).not.toContain(id);
    expect(state.imports).toEqual([other]);
    expect(state.catalog).toEqual([]);
  });
  await installExtension(host, state, request, load);
  expect(load).toHaveBeenCalledWith(
    "https://app.test/sample.js?v=1#ignored",
    id,
  );
  expect(state.imports).toEqual([
    other,
    { id, url: "/sample.js?v=1", label: id },
  ]);
  expect(host.ids()).toContain(id);
  expect(state.catalog).toEqual([{ id, url: "/sample.js?v=1", label: id }]);
});

it("failed installation persistence retains memory and can retry", async () => {
  const { host, state, load, request } = setup();
  vi.mocked(state.save).mockRejectedValueOnce(Error("write failed"));
  await expect(installExtension(host, state, request, load)).rejects.toThrow(
    "write failed",
  );
  expect(host.ids()).toEqual([]);
  expect(state.imports).toEqual([]);
  expect(state.catalog).toEqual([]);
  await installExtension(host, state, request, load);
  expect(host.ids()).toEqual([id]);
  expect(state.imports).toHaveLength(1);
});

it("load failure does not save or install", async () => {
  const { host, state, load, request } = setup();
  load.mockRejectedValueOnce(Error("module unavailable"));
  await expect(installExtension(host, state, request, load)).rejects.toThrow(
    "module unavailable",
  );
  expect(state.save).not.toHaveBeenCalled();
  expect(host.ids()).toEqual([]);
});

it("cross-origin installation is refused before loading code", async () => {
  const { host, state, load, request } = setup();
  await expect(
    installExtension(
      host,
      state,
      { ...request, url: "https://other.test/module.js" },
      load,
    ),
  ).rejects.toThrow("本地可信 ESM");
  expect(load).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
});

it("an existing ID keeps its original record and paths", async () => {
  const { host, state, load, request } = installed();
  await expect(installExtension(host, state, request, load)).rejects.toThrow(
    "此扩展 ID 已存在。",
  );
  expect(load).toHaveBeenCalledOnce();
  expect(state.save).not.toHaveBeenCalled();
  expect(state.imports).toEqual([entry]);
});

it("a post-save install failure retains the confirmed path without publishing a catalog entry", async () => {
  const { host, state, load, request } = setup();
  vi.spyOn(host, "install").mockImplementation(() => {
    throw Error("install failed");
  });
  await expect(installExtension(host, state, request, load)).rejects.toThrow(
    "install failed",
  );
  expect(state.save).toHaveBeenCalledOnce();
  expect(state.imports).toHaveLength(1);
  expect(state.catalog).toEqual([]);
});

it("retry loads a fresh URL with the saved configuration and keeps the durable path", async () => {
  const { host, state, load } = setup();
  state.imports = [entry];
  state.configurations[id] = { version: 1, values: { step: 3 } };
  await retryImport(host, state, id, "https://app.test/", 123, load);
  expect(load).toHaveBeenCalledWith(
    "https://app.test/sample.js?_retry=123",
    id,
  );
  expect(host.configuration(id).value.values.step).toBe(3);
  expect(state.imports).toEqual([entry]);
  expect(state.catalog).toEqual([entry]);
  expect(state.save).not.toHaveBeenCalled();
});

it("uninstall prunes the composition and retains configuration and extension data", async () => {
  const { host, state, platform, data, prepareUninstall } = installed();
  await host.start(id);
  const configuration = state.configurations[id];
  state.save = vi.fn(async (patch) => {
    expect(prepareUninstall).toHaveBeenCalledWith("extension." + id, false);
    expect(host.inspect(id).status).toBe("disabled");
    expect(state.imports).toEqual([entry]);
    expect(patch).toEqual({
      imports: [],
      composition: { schema: 1, enabled: [] },
    });
  });
  await uninstallExtension(host, state, id, prepareUninstall);
  expect(state.imports).toEqual([]);
  expect(state.catalog).toEqual([]);
  expect(state.configurations[id]).toBe(configuration);
  expect(data).toEqual({ messages: ["keep"] });
  expect(platform.call).not.toHaveBeenCalled();
  expect(host.ids()).toEqual([]);
});

it("failed uninstall persistence preserves imports, catalog and composition", async () => {
  const { host, state, prepareUninstall } = installed();
  const composition = state.composition;
  vi.mocked(state.save).mockRejectedValueOnce(Error("write failed"));
  await expect(
    uninstallExtension(host, state, id, prepareUninstall),
  ).rejects.toThrow("write failed");
  expect(state.imports).toEqual([entry]);
  expect(state.catalog).toEqual([entry]);
  expect(state.composition).toBe(composition);
  expect(host.ids()).toContain(id);
});

it("failed final revocation keeps the live import while retaining the confirmed composition prune", async () => {
  const { host, state, platform, prepareUninstall } = installed();
  vi.mocked(platform.grant)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(Error("final revoke failed"));
  await expect(
    uninstallExtension(host, state, id, prepareUninstall),
  ).rejects.toThrow("final revoke failed");
  expect(state.imports).toEqual([entry]);
  expect(state.catalog).toEqual([entry]);
  expect(state.composition!.enabled).toEqual([]);
  expect(state.save).toHaveBeenCalledOnce();
});

it("removing an unavailable import prepares retained credentials and prunes only its saved reference", async () => {
  const { host, state, prepareUninstall } = setup();
  state.imports = [entry];
  state.composition!.enabled = [
    { id, version: "1" },
    { id: "other", version: "2" },
  ];
  await removeFailedImport(host, state, id, prepareUninstall);
  expect(prepareUninstall).toHaveBeenCalledWith("extension." + id, false);
  expect(state.imports).toEqual([]);
  expect(state.composition!.enabled).toEqual([{ id: "other", version: "2" }]);
});

it("credential preparation failure prevents saved-path removal", async () => {
  const { host, state, prepareUninstall } = installed();
  prepareUninstall.mockRejectedValueOnce(Error("credentials unavailable"));
  await expect(
    removeFailedImport(host, state, id, prepareUninstall),
  ).rejects.toThrow("credentials unavailable");
  expect(state.save).not.toHaveBeenCalled();
  expect(state.imports).toEqual([entry]);
});

it("conflicting desired providers cannot replace the saved composition", async () => {
  const { host, state } = setup();
  const previous = state.composition;
  for (const name of ["one", "two"])
    host.install({
      manifest: {
        id: name,
        version: "1",
        apiVersion: 1,
        provides: { text: 1 },
      },
      activate(ctx) {
        ctx.provide("text", 1, {});
      },
    });
  await host.start("one");
  await expect(host.start("two")).rejects.toThrow();
  await expect(saveComposition(host, state, "agents")).rejects.toThrow("冲突");
  expect(state.save).not.toHaveBeenCalled();
  expect(state.composition).toBe(previous);
});

it("composition failure retains the previous snapshot and success saves only composition and layout", async () => {
  const { host, state } = installed();
  await host.start(id);
  const previous = state.composition;
  vi.mocked(state.save).mockRejectedValueOnce(Error("write failed"));
  await expect(saveComposition(host, state, "agents")).rejects.toThrow(
    "write failed",
  );
  expect(state.composition).toBe(previous);
  await saveComposition(host, state, "agents");
  expect(state.save).toHaveBeenLastCalledWith({
    composition: { schema: 1, enabled: [{ id, version: "1" }] },
    layout: "agents",
  });
  expect(state.composition).not.toBe(previous);
});

it("configuration persistence failure leaves old preferences and a stopped extension", async () => {
  const { host, state } = installed();
  await host.start(id);
  const previous = state.configurations;
  vi.mocked(state.save).mockRejectedValueOnce(Error("write failed"));
  await expect(
    configureExtension(host, state, id, { step: 4 }),
  ).rejects.toThrow("write failed");
  expect(state.configurations).toBe(previous);
  expect(host.configuration(id).value.values.step).toBe(1);
  expect(host.inspect(id).status).toBe("disabled");
  await configureExtension(host, state, id, { step: 4 });
  expect(state.configurations[id]).toEqual({ version: 1, values: { step: 4 } });
  expect(Object.getPrototypeOf(state.configurations)).toBeNull();
  expect(host.inspect(id).status).toBe("disabled");
});
