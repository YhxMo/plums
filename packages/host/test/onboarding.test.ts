import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  type ManifestV2,
  type Core,
} from "@plums/core";
import { DesktopHost, type AgentRecord } from "../src/host.js";
import { enablePrepared } from "../src/agent-launch.js";
import * as assembly from "../src/assembly.js";
const dirs: string[] = [],
  hosts: DesktopHost[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((h) => h.close());
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-onboarding-"));
  dirs.push(dir);
  const stores = new Map<string, MemorySecretStore>();
  const host = new DesktopHost({
    dataDir: dir,
    egress: new RecordingEgressSink(),
    fs: new RecordingFsSink(),
    confirm: {
      async ask() {
        return true;
      },
    },
    secretStore(id) {
      let store = stores.get(id);
      if (!store) {
        store = new MemorySecretStore();
        stores.set(id, store);
      }
      return store;
    },
  });
  hosts.push(host);
  await host.initialize();
  return { host, dir, stores };
}
function manifest(
  id: string,
  kind: ManifestV2["kind"] = "character",
  version = "1.0.0",
): ManifestV2 {
  return {
    formatVersion: "2.0",
    id,
    kind,
    name: id,
    version,
    description: "",
    dependencies: [],
    permissions: [],
    payload: { opaque: true },
  };
}
it("serializes queued Agent creation across a failure and continues after the queue settles", async () => {
  const { host } = await fixture();
  const pending = [
    host.createAgent("first"),
    host.createAgent(""),
    host.createAgent("second"),
  ];
  const results = await Promise.allSettled(pending);
  expect(results.map((r) => r.status)).toEqual([
    "fulfilled",
    "rejected",
    "fulfilled",
  ]);
  const third = await host.createAgent("third");
  const agents = await host.listAgents();
  expect(agents.map((a) => a.name).sort()).toEqual([
    "first",
    "second",
    "third",
  ]);
  expect(
    agents.find((a) => a.instanceId === third.instanceId)?.components,
  ).toEqual([]);
});
async function zip(m: ManifestV2) {
  return createArchive({
    "manifest.json": Buffer.from(JSON.stringify(m)),
    ...(m.kind === "extension"
      ? {
          "index.html": Buffer.from("<h1>Ready</h1>"),
          "main.js": Buffer.from(
            "export function activate(s){s.register('commands','roles',()=>s.characters())}",
          ),
        }
      : {}),
  });
}
async function add(host: DesktopHost, m: ManifestV2) {
  const preview = (await host.preview(await zip(m))) as { token: string };
  return host.importLibrary(preview.token);
}
function extension(
  id: string,
  dependencies: ManifestV2["dependencies"],
): ManifestV2 {
  return {
    ...manifest(id, "extension"),
    dependencies,
    payload: {
      plumsDesktop: {
        sdkVersion: "1",
        runtime: "main.js",
        frontend: "index.html",
        contributes: { commands: [{ name: "roles", title: "Roles" }] },
      },
    },
  };
}
function model(): ManifestV2 {
  return {
    ...manifest("model", "connector"),
    permissions: [
      { id: "api", kind: "egress", target: "example.com", reason: "请求模型" },
    ],
    settingsSchema: {
      type: "object",
      required: ["model", "apiKey"],
      properties: {
        model: { type: "string", title: "模型名称", description: "模型名称" },
        apiKey: {
          type: "string",
          title: "API Key",
          description: "模型凭据",
          "x-secret": true,
        },
      },
    },
  };
}
async function prepared() {
  const f = await fixture(),
    card = await add(f.host, manifest("persona")),
    connector = await add(f.host, model()),
    app = await add(
      f.host,
      extension("workspace", [
        { id: "model", kind: "connector", range: "^1.0.0" },
      ]),
    ),
    unused = await add(f.host, manifest("standalone", "connector"));
  const agent = await f.host.createAgent(
    "Ready",
    [app.digest, card.digest, connector.digest, unused.digest],
    "persona",
    "workspace",
  );
  return { ...f, agent };
}
it("plans required dependencies in compatible version order without installing or granting consent", async () => {
  const { host } = await fixture();
  await add(host, manifest("model", "connector", "2.0.0"));
  const compatible = await add(host, manifest("model", "connector", "1.4.0")),
    older = await add(host, manifest("model", "connector", "1.0.0")),
    optional = await add(host, manifest("optional", "connector")),
    app = await add(
      host,
      extension("workspace", [
        { id: "model", kind: "connector", range: "^1.0.0" },
        { id: "optional", kind: "connector", range: "*", optional: true },
      ]),
    );
  expect(await host.planAssembly([app.digest])).toEqual({
    digests: [compatible.digest, app.digest],
    additions: [{ digest: compatible.digest, name: "model", version: "1.4.0" }],
    protocols: [],
  });
  expect((await host.planAssembly([older.digest, app.digest])).digests).toEqual(
    [older.digest, app.digest],
  );
  expect((await host.planAssembly([app.digest])).digests).not.toContain(
    optional.digest,
  );
  expect(await host.listAgents()).toEqual([]);
});
it("backs off an automatically selected version when its transitive requirements conflict", async () => {
  const { host } = await fixture(),
    shared = await add(host, manifest("shared", "connector"));
  await add(host, {
    ...manifest("model", "connector", "2.0.0"),
    dependencies: [{ id: "shared", kind: "connector", range: "^2.0.0" }],
  });
  const compatible = await add(host, {
      ...manifest("model", "connector"),
      dependencies: [{ id: "shared", kind: "connector", range: "^1.0.0" }],
    }),
    app = await add(
      host,
      extension("workspace", [{ id: "model", kind: "connector", range: "*" }]),
    );
  expect(
    (await host.planAssembly([app.digest, shared.digest])).digests,
  ).toEqual([shared.digest, compatible.digest, app.digest]);
});
it("reports missing dependencies and preserves explicitly selected incompatible versions", async () => {
  const { host } = await fixture(),
    app = await add(
      host,
      extension("workspace", [
        { id: "model", kind: "connector", range: "^1.0.0" },
      ]),
    );
  await expect(host.planAssembly([app.digest])).rejects.toMatchObject({
    code: "IMPORT_INVALID",
    message: expect.stringContaining("请先导入"),
  });
  const wrong = await add(host, manifest("model", "connector", "2.0.0"));
  await expect(
    host.planAssembly([app.digest, wrong.digest]),
  ).rejects.toMatchObject({
    code: "IMPORT_INVALID",
    message: expect.stringContaining("不兼容"),
  });
  expect(await host.listAgents()).toEqual([]);
});
it("enables assembled components and cards together after configuration, with independent Agent state", async () => {
  const { host, agent, stores } = await prepared();
  const before = (await host.agentEnablePlan(agent.instanceId)) as {
    fingerprint: string;
    entries: { packageId: string }[];
    missing: unknown[];
  };
  expect(before.entries.map((p) => p.packageId)).toEqual([
    "model",
    "workspace",
    "persona",
    "standalone",
  ]);
  expect(before.missing).toHaveLength(1);
  await host.setSettings(
    agent.instanceId,
    "model",
    { model: "demo-model" },
    { apiKey: "fake-onboarding-key" },
  );
  const plan = (await host.agentEnablePlan(agent.instanceId)) as {
    fingerprint: string;
    missing: unknown[];
  };
  expect(plan.missing).toEqual([]);
  expect(JSON.stringify(plan)).not.toContain("fake-onboarding-key");
  await host.enableAgent(agent.instanceId, plan.fingerprint);
  const resources = (await host.resources(agent.instanceId)) as {
    packages: { id: string; enabled: boolean; consented: boolean }[];
  };
  expect(
    resources.packages
      .filter((p) => p.enabled)
      .map((p) => p.id)
      .sort(),
  ).toEqual(["model", "persona", "standalone", "workspace"]);
  expect(resources.packages.find((p) => p.id === "standalone")).toMatchObject({
    enabled: true,
    consented: true,
  });
  expect((await host.frontend(agent.instanceId))?.entry).toBe("index.html");
  expect(
    await host.invoke(
      agent.instanceId,
      "workspace",
      "workspace",
      "commands",
      "roles",
      {},
    ),
  ).toEqual([{ id: "persona", name: "persona", version: "1.0.0" }]);
  const other = await host.createAgent(
    "Other",
    agent.components!.map((p) => p.digest),
    "persona",
    "workspace",
  );
  expect(
    ((await host.agentEnablePlan(other.instanceId)) as { missing: unknown[] })
      .missing,
  ).toHaveLength(1);
  expect(stores.get(agent.instanceId)).not.toBe(stores.get(other.instanceId));
  expect(await host.frontend(other.instanceId)).toBeNull();
});
it("missing configuration prevents every consent and enable operation", async () => {
  const { host, agent } = await prepared(),
    plan = (await host.agentEnablePlan(agent.instanceId)) as {
      fingerprint: string;
    };
  await expect(
    host.enableAgent(agent.instanceId, plan.fingerprint),
  ).rejects.toMatchObject({ code: "SETTINGS_INVALID", path: "/settings" });
  const resources = (await host.resources(agent.instanceId)) as {
    packages: { enabled: boolean; consented: boolean }[];
  };
  expect(resources.packages.every((p) => !p.enabled && !p.consented)).toBe(
    true,
  );
});
it("permission/state changes during approval invalidate the plan before enabling further components", async () => {
  const { host, agent } = await prepared();
  await host.setSettings(
    agent.instanceId,
    "model",
    { model: "demo" },
    { apiKey: "fake-key" },
  );
  const plan = (await host.agentEnablePlan(agent.instanceId)) as {
    fingerprint: string;
  };
  await host.enable(agent.instanceId, "persona");
  await expect(
    host.enableAgent(agent.instanceId, plan.fingerprint),
  ).rejects.toMatchObject({
    code: "IMPORT_INVALID",
    message: expect.stringContaining("状态已变化"),
  });
  const resources = (await host.resources(agent.instanceId)) as {
    packages: { id: string; consented: boolean }[];
  };
  expect(
    resources.packages.filter((p) => p.consented).map((p) => p.id),
  ).toEqual(["persona"]);
});
it("clearing the default card invalidates an in-flight permission plan", async () => {
  const { host, agent } = await prepared();
  await host.setSettings(
    agent.instanceId,
    "model",
    { model: "demo" },
    { apiKey: "fake-key" },
  );
  const plan = (await host.agentEnablePlan(agent.instanceId)) as {
    fingerprint: string;
  };
  await host.setCharacter(agent.instanceId, undefined);
  await expect(
    host.enableAgent(agent.instanceId, plan.fingerprint),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  expect(
    (
      (await host.resources(agent.instanceId)) as {
        packages: { enabled: boolean }[];
      }
    ).packages.every((p) => !p.enabled),
  ).toBe(true);
});
it.each(["character", "startup", "bind", "unbind"] as const)(
  "publishes %s changes to concurrent readers after the record commit",
  async (change) => {
    const { host, agent } = await prepared();
    let root = "";
    if (change === "bind" || change === "unbind") {
      const selected = await mkdtemp(path.join(os.tmpdir(), "plums-binding-"));
      dirs.push(selected);
      root = await realpath(selected);
      if (change === "unbind")
        await host.bindRoot(agent.instanceId, "workspace", root);
    }
    const save = assembly.saveRecord;
    let entered!: () => void, release!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = vi
      .spyOn(assembly, "saveRecord")
      .mockImplementation(async (dir, record) => {
        entered();
        await blocked;
        await save(dir, record);
      });
    const task =
      change === "character"
        ? host.setCharacter(agent.instanceId, undefined)
        : change === "startup"
          ? host.setStartup(agent.instanceId, undefined)
          : change === "bind"
            ? host.bindRoot(agent.instanceId, "workspace", root)
            : host.unbindRoot(agent.instanceId, "workspace");
    try {
      await writing;
      await host.resources(agent.instanceId);
      release();
      await task;
      const detail = (await host.resources(agent.instanceId)) as {
        record: AgentRecord;
      };
      if (change === "character") {
        expect(detail.record.characterId).toBeUndefined();
        expect(detail.record.agent.character).toBeUndefined();
      } else if (change === "startup")
        expect(detail.record.agent.startup).toBeUndefined();
      else
        expect(detail.record.roots.workspace).toBe(
          change === "bind" ? root : undefined,
        );
    } finally {
      release();
      await task.catch(() => {});
      writer.mockRestore();
    }
  },
);
it("rolls back only newly enabled components when a later enable fails", async () => {
  const a = manifest("a"),
    b = manifest("b"),
    c = manifest("c");
  const core = {
    listInstalled: async () => [a, b, c],
    getPackage: async (id: string) => ({
      manifest: [a, b, c].find((p) => p.id === id)!,
      installed: { enabled: id === "a" },
    }),
    describeSettings: async () => ({ values: {}, secrets: {} }),
    listBackgroundConsents: async () => [],
    grantConsent: vi.fn(async () => {}),
    enable: vi.fn(async (id: string) => {
      if (id === "c") throw Error("failed");
    }),
    disable: vi.fn(async () => {}),
  } as unknown as Core;
  const record = { agent: { startup: "a" }, characterId: "c" } as AgentRecord;
  a.dependencies = [{ id: "b", kind: "character", range: "*" }];
  const { enablePlan } = await import("../src/agent-launch.js");
  const plan = await enablePlan(core, record);
  await expect(enablePrepared(core, record, plan.fingerprint)).rejects.toThrow(
    "failed",
  );
  expect(core.enable).toHaveBeenCalledWith("b");
  expect(core.disable).toHaveBeenCalledTimes(1);
  expect(core.disable).toHaveBeenCalledWith("b");
});
it("imports an incomplete ZIP as library components without publishing an Agent, then completes assembly", async () => {
  const { host, dir } = await fixture(),
    app = extension("workspace", [
      { id: "model", kind: "connector", range: "^1.0.0" },
    ]);
  const raw = await createArchive({
    "agent.json": Buffer.from(
      JSON.stringify({
        bundleVersion: "1.0",
        id: "partial",
        name: "Partial",
        version: "1.0.0",
        extensions: ["workspace.zip"],
        connectors: [],
        startup: "workspace",
      }),
    ),
    "workspace.zip": await zip(app),
  });
  const preview = (await host.preview(raw)) as {
    token: string;
    incomplete: boolean;
  };
  expect(preview.incomplete).toBe(true);
  await expect(host.install(preview.token)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect(await readdir(path.join(dir, "instances"))).toEqual([]);
  const items = await host.importBundleComponents(preview.token);
  expect(items).toHaveLength(1);
  expect(await host.listAgents()).toEqual([]);
  const model = await add(host, manifest("model", "connector"));
  const plan = await host.planAssembly([items[0]!.digest]);
  expect(plan.digests).toEqual([model.digest, items[0]!.digest]);
  const agent = await host.createAgent(
    "Completed",
    plan.digests,
    undefined,
    "workspace",
  );
  expect(agent.components).toHaveLength(2);
});
it("the incomplete ZIP path still rejects invalid runtime entries and archive paths", async () => {
  const { host } = await fixture(),
    bad = extension("workspace", [
      { id: "missing", kind: "connector", range: "*" },
    ]);
  (bad.payload as { plumsDesktop: { runtime: string } }).plumsDesktop.runtime =
    "../escape.js";
  const raw = await createArchive({
    "agent.json": Buffer.from(
      JSON.stringify({
        bundleVersion: "1.0",
        id: "partial",
        name: "Partial",
        version: "1.0.0",
        extensions: ["workspace.zip"],
        connectors: [],
      }),
    ),
    "workspace.zip": await zip(bad),
  });
  await expect(host.preview(raw)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect(await host.listLibrary()).toEqual([]);
});
