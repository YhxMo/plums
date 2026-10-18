import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareRuntime, runtimeFixture } from "./runtime-fixture";
import { boot } from "../src/application";
import { bootShell, CompositionRecovery } from "../src/shell/runtime";
import { parsePersistedState } from "../src/shell/persisted-state";
import { ContractError } from "../modules/sdk/errors";

beforeEach(() => prepareRuntime());
afterEach(() => vi.unstubAllGlobals());

it.each(
  [null, [], {}, { version: 2 }, { version: "1" }].map((value) => ({ value })),
)(
  "rejects an unsupported persisted version without writes: $value",
  async ({ value }) => {
    prepareRuntime(value);
    await expect(boot()).rejects.toMatchObject({ code: "state.version" });
    expect(runtimeFixture.write).not.toHaveBeenCalled();
  },
);
it.each([null, [], "pages", { view: 1 }].map((pages) => ({ pages })))(
  "rejects corrupt page preferences: $pages",
  async ({ pages }) => {
    prepareRuntime({ version: 1, pages });
    await expect(boot()).rejects.toMatchObject({ code: "state.corrupt" });
    expect(runtimeFixture.write).not.toHaveBeenCalled();
  },
);
it.each(
  [null, [], "configurations"].map((configurations) => ({ configurations })),
)(
  "rejects a corrupt configuration map: $configurations",
  async ({ configurations }) => {
    prepareRuntime({ version: 1, configurations });
    await expect(boot()).rejects.toMatchObject({ code: "state.corrupt" });
  },
);
const entry = { id: "external", url: "/external.js", label: "External" };
it.each(
  [
    null,
    {},
    [null],
    Array(1),
    [{ url: entry.url, label: entry.label }],
    [{ id: entry.id, label: entry.label }],
    [{ id: entry.id, url: entry.url }],
    [{ ...entry, url: "https://other.invalid/extension.js" }],
    [entry, entry],
    [{ ...entry, id: "agents.local" }],
    [{ ...entry, id: "ui.agents" }],
    [{ ...entry, id: "ui.workbench-board" }],
  ].map((imports) => ({ imports })),
)(
  "rejects invalid imported paths without installing them: $imports",
  async ({ imports }) => {
    prepareRuntime({ version: 1, imports });
    await expect(boot()).rejects.toMatchObject({ code: "state.imports" });
    expect(runtimeFixture.install).not.toHaveBeenCalled();
    expect(runtimeFixture.write).not.toHaveBeenCalled();
  },
);
it.each([
  [{ layout: "default" }, "agents"],
  [{ layout: "default", layoutIntent: "explicit" }, "default"],
  [{ layout: "default", composition: { schema: 1, enabled: [] } }, "default"],
  [{ layout: "external" }, "external"],
  [{ layout: "" }, "agents"],
  [{ layout: "   " }, "agents"],
] as const)("preserves layout compatibility: %j", async (value, layout) => {
  prepareRuntime({ version: 1, ...value });
  expect((await boot()).initial.layout).toBe(layout);
});
it.each([true, false])("falls back to the media theme (%s)", async (dark) => {
  prepareRuntime({ version: 1, theme: "invalid" });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: dark })),
  );
  expect((await boot()).initial.theme).toBe(dark ? "dark" : "light");
  expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
});
it("accepts absent state and preserves composition recovery with the original snapshot", async () => {
  runtimeFixture.saved = null;
  expect((await boot()).initial.layout).toBe("agents");
  const original = { version: 1, composition: { schema: 2 } };
  prepareRuntime(original);
  await expect(boot()).rejects.toBeInstanceOf(CompositionRecovery);
  await expect(boot()).rejects.toMatchObject({
    saved: { revision: 7, value: original },
  });
});
it("surfaces platform initialization failures at boot", async () => {
  runtimeFixture.documentsError = "ipc unavailable";
  runtimeFixture.credentialsError = "keychain locked";
  const runtime = await boot();
  expect(runtime.initial.platformErrors).toEqual([
    "文档服务初始化失败：ipc unavailable",
    "凭据服务初始化失败：keychain locked",
  ]);
});
it("parses page and configuration maps without losing opaque snapshot fields", () => {
  const value = {
    version: 1,
    layout: "default",
    layoutIntent: "legacy-marker",
    theme: "light",
    themeId: "custom",
    composition: { schema: 1, enabled: [] },
    pages: { "__proto__/view": "route" },
    configurations: { external: { version: 1, values: { title: "kept" } } },
    opaque: { kept: true },
  };
  const before = structuredClone(value);
  const parsed = parsePersistedState(value);
  expect(parsed).toMatchObject(value);
  expect(Object.getPrototypeOf(parsed.pages)).toBeNull();
  expect(Object.getPrototypeOf(parsed.configurations)).toBeNull();
  expect(value).toEqual(before);
  expect(parsePersistedState(undefined)).not.toHaveProperty("pages");
});
it("exposes ContractError and a field path for direct parser callers", () => {
  try {
    parsePersistedState({ version: 1, pages: { view: 42 } });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(ContractError);
    expect(error).toMatchObject({
      code: "state.corrupt",
      detail: "pages.view",
    });
  }
});
it("rejects a collision with the fetched catalog before installing any module", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => [entry],
    })),
  );
  runtimeFixture.saved!.value = { version: 1, imports: [entry] };
  await expect(boot()).rejects.toMatchObject({ code: "state.imports" });
  expect(runtimeFixture.install).not.toHaveBeenCalled();
});
it("rejects an undefined value in an existing snapshot instead of treating it as fresh state", async () => {
  runtimeFixture.saved = { revision: 7, value: undefined };
  await expect(boot()).rejects.toMatchObject({ code: "state.version" });
});

it("boots an alternative composition without interpreting opaque Agent data", async () => {
  const retained = {
    format: "owned-by-an-uninstalled-provider",
    draft: "keep",
  };
  prepareRuntime({ version: 1, agents: retained, layout: "notes" });
  const runtime = await bootShell({
    catalog: [],
    restore: (state: ReturnType<typeof parsePersistedState>) => state,
    extensions: () => [],
    start: [],
  });
  expect(runtimeFixture.install).not.toHaveBeenCalled();
  expect(runtimeFixture.start).not.toHaveBeenCalled();
  await runtime.save({ theme: "dark" });
  expect(runtimeFixture.write.mock.calls[0][0].value.agents).toEqual(retained);
  expect(runtime.initial.layout).toBe("notes");
});

it("keeps legacy roles, sessions and opaque draft fields in the shared snapshot", async () => {
  const { AgentStore } = await import("../modules/agents/store");
  const store = new AgentStore(
    [],
    async () => {},
    async () => "旧回复",
  );
  const role = await store.create({
    name: "旧角色",
    description: "旧说明",
    multiSession: true,
  });
  await store.send(role.id, "旧输入");
  const savedAgents = structuredClone(store.list()).map((agent) => ({
    ...agent,
    status: "busy",
    canCancel: true,
  }));
  const opaque = {
    drafts: { [role.id]: "未发送草稿" },
    future: { kept: true },
  };
  prepareRuntime({ version: 1, agents: savedAgents, ...opaque });
  const before = structuredClone(runtimeFixture.saved);
  const runtime = await boot();
  await runtime.save({ theme: "dark" });
  const saved = runtimeFixture.write.mock.calls[0][0].value;
  expect(saved).toMatchObject(opaque);
  expect(saved.agents[0]).toMatchObject({
    name: "旧角色",
    description: "旧说明",
    status: "idle",
    sessions: savedAgents[0].sessions,
  });
  expect(saved.agents[0]).not.toHaveProperty("canCancel");
  expect(runtimeFixture.saved).toEqual(before);
});

it("validates business data before default application installation or writes", async () => {
  prepareRuntime({ version: 1, agents: { malformed: true } });
  await expect(boot()).rejects.toMatchObject({
    code: "state.corrupt",
    detail: "agents",
  });
  expect(runtimeFixture.install).not.toHaveBeenCalled();
  expect(runtimeFixture.write).not.toHaveBeenCalled();
});
