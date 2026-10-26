import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareRuntime, runtimeFixture } from "./runtime-fixture";
import { boot } from "../src/application";
import type { Manifest, StoredState } from "../modules/sdk";
import { createPersistence, createShellBridge } from "../src/shell/persistence";
import { parsePersistedState } from "../src/shell/persisted-state";

beforeEach(() => prepareRuntime());
afterEach(() => vi.unstubAllGlobals());
function deferred() {
  let resolve!: (receipt: StoredState) => void;
  const promise = new Promise<StoredState>((done) => (resolve = done));
  return { promise, resolve };
}

it("serializes saves, increments revisions and retains preceding patches", async () => {
  const runtime = await boot();
  const first = deferred();
  runtimeFixture.write.mockImplementationOnce(() => first.promise);
  const a = runtime.save({ theme: "dark" });
  const b = runtime.save({ layout: "external" });
  await vi.waitFor(() => expect(runtimeFixture.write).toHaveBeenCalledTimes(1));
  expect(runtimeFixture.write.mock.calls[0][0].revision).toBe(7);
  first.resolve({ revision: 8, value: {} });
  await Promise.all([a, b]);
  expect(runtimeFixture.write.mock.calls[1][0]).toMatchObject({
    revision: 8,
    value: { theme: "dark", layout: "external", layoutIntent: "explicit" },
  });
});
it("does not dispatch a queued aborted save and allows retry", async () => {
  const runtime = await boot();
  const first = deferred();
  runtimeFixture.write.mockImplementationOnce(() => first.promise);
  const a = runtime.save({ theme: "dark" });
  const controller = new AbortController();
  const commit = vi.fn();
  const b = runtime.save(
    { layout: "cancelled" },
    { signal: controller.signal, onCommit: commit },
  );
  controller.abort();
  const aborted = expect(b).rejects.toMatchObject({ name: "AbortError" });
  first.resolve({ revision: 8, value: {} });
  await a;
  await aborted;
  expect(commit).not.toHaveBeenCalled();
  expect(runtimeFixture.write).toHaveBeenCalledTimes(1);
  await runtime.save({ themeId: "retry" });
  expect(runtimeFixture.write.mock.calls[1][0]).toMatchObject({
    revision: 8,
    value: { layout: "agents", theme: "dark", themeId: "retry" },
  });
});
it("honors a successful receipt after abort and stays writable", async () => {
  const runtime = await boot();
  const controller = new AbortController();
  runtimeFixture.write.mockImplementationOnce(async (next) => {
    controller.abort();
    return { revision: 8, value: next.value };
  });
  await runtime.save({ theme: "dark" }, { signal: controller.signal });
  await runtime.save({ themeId: "retry" });
  expect(runtimeFixture.write.mock.calls[1][0]).toMatchObject({
    revision: 8,
    value: { theme: "dark" },
  });
});
it.each([
  new DOMException("aborted before commit", "AbortError"),
  Object.assign(Error("disk rejected"), { outcome: "not-committed" }),
])("permits retry after a known rejection: %s", async (failure) => {
  const runtime = await boot();
  runtimeFixture.write.mockRejectedValueOnce(failure);
  await expect(runtime.save({ theme: "dark" })).rejects.toBe(failure);
  await runtime.save({ layout: "retry" });
  expect(runtimeFixture.write.mock.calls[1][0]).toMatchObject({
    revision: 7,
    value: { theme: "light", layout: "retry" },
  });
});
it("latches an unknown receipt and refuses queued and subsequent writes", async () => {
  const runtime = await boot();
  const failure = Object.assign(Error("lost receipt"), { outcome: "unknown" });
  runtimeFixture.write.mockRejectedValueOnce(failure);
  const a = runtime.save({ theme: "dark" });
  const b = runtime.save({ layout: "queued" });
  await expect(a).rejects.toBe(failure);
  await expect(b).rejects.toThrow("保存回执未确认");
  await expect(runtime.save({ layout: "retry" })).rejects.toThrow(
    "保存回执未确认",
  );
  expect(runtimeFixture.write).toHaveBeenCalledTimes(1);
});
it("does not publish a failed patch or discard opaque persisted fields", async () => {
  const opaque = { custom: { marker: "retained" } };
  prepareRuntime({ version: 1, ...opaque });
  const runtime = await boot();
  runtimeFixture.write.mockRejectedValueOnce(
    Object.assign(Error("not saved"), { outcome: "not-committed" }),
  );
  await expect(runtime.save({ theme: "dark" })).rejects.toThrow("not saved");
  await runtime.save({ themeId: "retry" });
  expect(runtimeFixture.write.mock.calls[1][0]).toMatchObject({
    revision: 7,
    value: { ...opaque, theme: "light", themeId: "retry" },
  });
});
it("current publishes only after a receipt and remains unchanged on rejection", async () => {
  const runtime = await boot();
  const initial = parsePersistedState({ version: 1, theme: "light" });
  const persistence = createPersistence(runtime.adapter, initial, 7);
  const receipt = deferred();
  runtimeFixture.write.mockImplementationOnce(() => receipt.promise);
  const saving = persistence.save({ theme: "dark" });
  await vi.waitFor(() => expect(runtimeFixture.write).toHaveBeenCalledOnce());
  expect(persistence.current()).toBe(initial);
  receipt.resolve({ revision: 8, value: {} });
  await saving;
  expect(persistence.current().theme).toBe("dark");
  const confirmed = persistence.current();
  runtimeFixture.write.mockRejectedValueOnce(
    Object.assign(Error("rejected"), { outcome: "not-committed" }),
  );
  await expect(persistence.save({ themeId: "failed" })).rejects.toThrow(
    "rejected",
  );
  expect(persistence.current()).toBe(confirmed);
});
it("serializes page patches, publishes after save and retains the preceding route on failure", async () => {
  const runtime = await boot();
  const persistence = createPersistence(
    runtime.adapter,
    parsePersistedState({ version: 1 }),
    7,
  );
  const bridge = createShellBridge(persistence, new EventTarget());
  const receipt = deferred();
  runtimeFixture.write.mockImplementationOnce(() => receipt.promise);
  const a = bridge.savePage("owner/one", "first");
  const b = bridge.savePage("owner/two", "second");
  expect(bridge.readPage("owner/one")).toBeUndefined();
  receipt.resolve({ revision: 8, value: {} });
  await Promise.all([a, b]);
  expect(persistence.current().pages).toEqual({
    "owner/one": "first",
    "owner/two": "second",
  });
  runtimeFixture.write.mockRejectedValueOnce(
    Object.assign(Error("rejected"), { outcome: "not-committed" }),
  );
  await expect(bridge.savePage("owner/one", "failed")).rejects.toThrow();
  expect(bridge.readPage("owner/one")).toBe("first");
  await bridge.savePage("owner/one", "retry");
  expect(bridge.readPage("owner/one")).toBe("retry");
});
it("names extensions as listed and forwards a management target", async () => {
  const runtime = await boot();
  const events = new EventTarget();
  const entries = [{ id: "a.b", url: "/a.js", label: "甲" }];
  const bridge = createShellBridge(
    createPersistence(runtime.adapter, parsePersistedState({ version: 1 }), 7),
    events,
    entries,
  );
  entries.push({ id: "c.d", url: "/c.js", label: "乙" });
  expect([
    bridge.label!("a.b"),
    bridge.label!("c.d"),
    bridge.label!("x"),
  ]).toEqual(["甲", "乙", "x"]);
  const seen = vi.fn();
  events.addEventListener("shell", (event) =>
    seen((event as CustomEvent).detail),
  );
  await bridge.open("extensions", "owner", "a.b");
  expect(seen).toHaveBeenCalledWith({ action: "extensions", target: "a.b" });
});
it("lends a bundle imported packages, built-ins by version only, and offers packages to management", async () => {
  const runtime = await boot();
  const events = new EventTarget();
  const manifests: Record<string, Manifest> = {
    "agents.local": { id: "agents.local", version: "0.0.4", apiVersion: 1 },
    "example.weather": {
      id: "example.weather",
      version: "1.2.0",
      apiVersion: 1,
      author: "某作者",
      license: "MIT",
    },
  };
  const read = vi.fn(async (url: string) => ({
    manifestText: `{"from":"${url}"}`,
    main: "export default {}",
  }));
  const bridge = createShellBridge(
    createPersistence(
      runtime.adapter,
      parsePersistedState({
        version: 1,
        imports: [
          {
            id: "example.weather",
            url: `package:sha256:${"a".repeat(64)}`,
            label: "天气查询",
          },
        ],
      }),
      7,
    ),
    events,
    [{ id: "agents.local", label: "Agent 核心" }],
    { manifest: (id) => manifests[id], packages: { read } },
  );
  await expect(
    bridge.bundle!(["agents.local", "example.weather", "missing.one"]),
  ).resolves.toEqual([
    { id: "agents.local", version: "0.0.4", label: "Agent 核心" },
    {
      id: "example.weather",
      version: "1.2.0",
      label: "天气查询",
      author: "某作者",
      license: "MIT",
      package: {
        manifest: `{"from":"package:sha256:${"a".repeat(64)}"}`,
        main: "export default {}",
      },
    },
  ]);
  // Nobody to ask: the offer fails rather than installing anything.
  await expect(
    bridge.offerPackages!("ui.agents", [{ manifest: "{}", main: "" }]),
  ).rejects.toThrow("扩展管理不可用");
  events.addEventListener("offer-packages", (event) => {
    event.preventDefault();
    const { packages, settle } = (event as CustomEvent).detail;
    settle(packages.map(() => ({ outcome: "declined" })));
  });
  await expect(
    bridge.offerPackages!("ui.agents", [{ manifest: "{}", main: "" }]),
  ).resolves.toEqual([{ outcome: "declined" }]);
});
