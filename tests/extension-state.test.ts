import { beforeEach, expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import { createPersistence } from "../src/shell/persistence";
import type { PlatformAdapter } from "../src/platform";
import {
  createExtensionState,
  type ExtensionPreferences,
} from "../src/shell/extension-state";
import type { Composition } from "../modules/shell/composition";
import type { ExtensionDefinition, StoredState } from "../modules/sdk";
import {
  configureExtension,
  installExtension,
  uninstallExtension,
  persistComposition,
} from "../modules/shell/extension-actions";

const runtimeFixture = { write: vi.fn() };
beforeEach(() => {
  runtimeFixture.write.mockReset().mockImplementation(async (next) => ({
    revision: next.revision + 1,
    value: next.value,
  }));
});
const definition = (id: string): ExtensionDefinition => ({
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
});
function deferred() {
  let resolve!: (receipt: StoredState) => void;
  const promise = new Promise<StoredState>((done) => (resolve = done));
  return { promise, resolve };
}
async function setup(enabled: Composition["enabled"] = []) {
  const host = new Host({
    kind: "browser",
    available: () => true,
    grant: async () => {},
    call: async () => null,
  });
  const initial: ExtensionPreferences = {
    imports: [],
    configurations: {},
    composition: { schema: 1 as const, enabled },
  };
  const { save } = createPersistence(
    {
      call: (_owner, _capability, payload) => runtimeFixture.write(payload),
    } as PlatformAdapter,
    {
      ...initial,
      version: 1,
      layout: "agents",
      theme: "light",
      themeId: null,
      agents: [],
    },
    7,
  );
  const services = {
    catalog: [],
    save: vi.fn(save),
  };
  let value = initial;
  const publish = vi.fn((next: typeof initial) => {
    value = next;
  });
  const current = () => value;
  const run = createExtensionState(initial, services, publish);
  // The folder's manifest names the extension: /<id>/.
  const load = vi.fn(async (url: string) =>
    definition(new URL(url).pathname.slice(1, -1)),
  );
  const install = (id: string) =>
    run((draft) =>
      installExtension(
        host,
        draft,
        { url: `/${id}/`, baseUrl: "https://app.test/" },
        load,
      ),
    );
  const configure = (id: string, step: number) =>
    run((draft) => configureExtension(host, draft, id, { step }));
  return {
    host,
    initial,
    current,
    run,
    install,
    configure,
    load,
    publish,
    save,
  };
}

it("keeps the confirmed import snapshot while a write is pending and after rejection", async () => {
  const { host, initial, current, install, publish } = await setup();
  const receipt = deferred();
  runtimeFixture.write.mockImplementationOnce(() => receipt.promise);
  const pending = install("one");
  await vi.waitFor(() => expect(runtimeFixture.write).toHaveBeenCalledOnce());
  expect(current().imports).toBe(initial.imports);
  expect(publish).not.toHaveBeenCalled();
  expect(host.ids()).not.toContain("one");
  receipt.resolve({ revision: 8, value: {} });
  await pending;
  const confirmed = current().imports;
  runtimeFixture.write.mockRejectedValueOnce(
    Object.assign(Error("rejected"), { outcome: "not-committed" }),
  );
  await expect(install("two")).rejects.toThrow("rejected");
  expect(current().imports).toBe(confirmed);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(host.ids()).not.toContain("two");
  await install("two");
  expect(current().imports.map(({ id }) => id)).toEqual(["one", "two"]);
});

it("serializes concurrent import changes before deriving the next saved array", async () => {
  const { current, install } = await setup();
  const receipt = deferred();
  runtimeFixture.write.mockImplementationOnce(() => receipt.promise);
  const first = install("one");
  const second = install("two");
  await vi.waitFor(() => expect(runtimeFixture.write).toHaveBeenCalledOnce());
  receipt.resolve({ revision: 8, value: {} });
  await Promise.all([first, second]);
  expect(runtimeFixture.write.mock.calls[1][0]).toMatchObject({
    revision: 8,
    value: { imports: [{ id: "one" }, { id: "two" }] },
  });
  expect(current().imports.map(({ id }) => id)).toEqual(["one", "two"]);
});

it("does not start a queued extension operation before its predecessor settles", async () => {
  const { install, load } = await setup();
  const receipt = deferred();
  runtimeFixture.write.mockImplementationOnce(() => receipt.promise);
  const first = install("one");
  const second = install("two");
  await vi.waitFor(() => expect(runtimeFixture.write).toHaveBeenCalledOnce());
  const loadsBeforeReceipt = load.mock.calls.length;
  receipt.resolve({ revision: 8, value: {} });
  await Promise.all([first, second]);
  expect(loadsBeforeReceipt).toBe(1);
  expect(load).toHaveBeenCalledTimes(2);
});

it("serializes configuration merges without discarding another extension's confirmed value", async () => {
  const { host, current, configure } = await setup();
  host.install(definition("one"));
  host.install(definition("two"));
  const receipt = deferred();
  runtimeFixture.write.mockImplementationOnce(() => receipt.promise);
  const first = configure("one", 2);
  const second = configure("two", 3);
  await vi.waitFor(() => expect(runtimeFixture.write).toHaveBeenCalledOnce());
  receipt.resolve({ revision: 8, value: {} });
  await Promise.all([first, second]);
  expect(current().configurations).toEqual({
    one: { version: 1, values: { step: 2 } },
    two: { version: 1, values: { step: 3 } },
  });
  expect(runtimeFixture.write.mock.calls[1][0]).toMatchObject({
    revision: 8,
    value: { configurations: current().configurations },
  });
});

it("a rejected configuration keeps its old value and permits queued saves", async () => {
  const { host, current, configure } = await setup();
  host.install(definition("one"));
  host.install(definition("two"));
  await configure("one", 2);
  const confirmed = current().configurations;
  runtimeFixture.write.mockRejectedValueOnce(
    Object.assign(Error("rejected"), { outcome: "not-committed" }),
  );
  const first = configure("one", 9);
  const second = configure("two", 3);
  await expect(first).rejects.toThrow("rejected");
  expect(confirmed.one).toEqual({ version: 1, values: { step: 2 } });
  await second;
  expect(current().configurations).toEqual({
    one: { version: 1, values: { step: 2 } },
    two: { version: 1, values: { step: 3 } },
  });
  expect(host.configuration("one").value.values.step).toBe(2);
});

it("unknown writes lock later state changes without publishing either patch", async () => {
  const { current, install } = await setup();
  const initial = current().imports;
  runtimeFixture.write.mockRejectedValueOnce(
    Object.assign(Error("unknown"), { outcome: "unknown" }),
  );
  const first = install("one");
  const second = install("two");
  await expect(first).rejects.toThrow("unknown");
  await expect(second).rejects.toThrow("保存回执未确认");
  expect(current().imports).toBe(initial);
  expect(runtimeFixture.write).toHaveBeenCalledOnce();
});

it("final uninstall failure retains live imports and the already-confirmed composition prune", async () => {
  const { host, current, run, install } = await setup([
    { id: "one", version: "1" },
  ]);
  await install("one");
  vi.spyOn(host, "uninstall").mockRejectedValueOnce(Error("final revoke"));
  await expect(
    run((draft) => uninstallExtension(host, draft, "one", async () => {})),
  ).rejects.toThrow("final revoke");
  expect(current().imports.map(({ id }) => id)).toEqual(["one"]);
  expect(current().composition!.enabled).toEqual([]);
});

it("failed composition persistence retains the rendered snapshot", async () => {
  const { host, current, run, publish } = await setup();
  host.install(definition("one"));
  await host.start("one");
  const previous = current();
  runtimeFixture.write.mockRejectedValueOnce(
    Object.assign(Error("rejected"), { outcome: "not-committed" }),
  );
  await expect(run((draft) => persistComposition(host, draft))).rejects.toThrow(
    "rejected",
  );
  expect(current()).toBe(previous);
  expect(publish).not.toHaveBeenCalled();
});

it("post-save install failure publishes the confirmed path without changing the startup snapshot", async () => {
  const { host, initial, current, install, publish } = await setup();
  vi.spyOn(host, "install").mockImplementationOnce(() => {
    throw Error("install failed");
  });
  await expect(install("one")).rejects.toThrow("install failed");
  expect(current().imports.map(({ id }) => id)).toEqual(["one"]);
  expect(initial.imports).toEqual([]);
  expect(publish).toHaveBeenCalledOnce();
});

it("shares persistence revisions with non-extension saves and preserves both domains", async () => {
  const { install, save } = await setup();
  const receipt = deferred();
  runtimeFixture.write.mockImplementationOnce(() => receipt.promise);
  const first = install("one");
  await vi.waitFor(() => expect(runtimeFixture.write).toHaveBeenCalledOnce());
  const appearance = save({ theme: "dark" });
  const second = install("two");
  receipt.resolve({ revision: 8, value: {} });
  await Promise.all([first, appearance, second]);
  expect(runtimeFixture.write.mock.calls[2][0]).toMatchObject({
    revision: 9,
    value: { theme: "dark", imports: [{ id: "one" }, { id: "two" }] },
  });
});
