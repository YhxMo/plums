import { it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  type ManifestV2,
} from "@plums/core";
import { createAgentBundle } from "@plums/sdk";
import { DesktopHost } from "../src/host.js";
const dirs: string[] = [];
const hosts: DesktopHost[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((h) => h.close());
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-host-"));
  dirs.push(dir);
  const stores = new Map<string, MemorySecretStore>();
  const fs = new RecordingFsSink();
  const host = new DesktopHost({
    dataDir: dir,
    confirm: {
      async ask() {
        return true;
      },
    },
    egress: new RecordingEgressSink(),
    fs,
    secretStore: (id) => {
      let s = stores.get(id);
      if (!s) {
        s = new MemorySecretStore();
        stores.set(id, s);
      }
      return s;
    },
  });
  hosts.push(host);
  await host.initialize();
  return { host, dir, fs };
}
it("defaults to automatic DNS and preserves explicit network preferences across restart", async () => {
  const { host } = await fixture();
  expect(host.getDesktopSettings()).toEqual({ dnsMode: "auto" });
  for (const dnsMode of ["system", "cloudflare", "auto"]) {
    await host.setDesktopSettings(dnsMode);
    await host.initialize();
    expect(host.getDesktopSettings()).toEqual({ dnsMode });
  }
});
async function bundle(dir: string) {
  const core = createCore({
    dataDir: path.join(dir, "builder"),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  const card: ManifestV2 = {
    formatVersion: "2.0",
    kind: "character",
    id: "card",
    name: "Card",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [],
    payload: { persona: "hello" },
  };
  const ext: ManifestV2 = {
    ...card,
    kind: "extension",
    id: "workspace",
    name: "Workspace",
    permissions: [
      {
        id: "data",
        kind: "fs",
        target: "agent-data",
        operations: ["list"],
        reason: "list",
      },
    ],
    payload: {
      plumsDesktop: {
        sdkVersion: "1",
        runtime: "main.js",
        frontend: "index.html",
        contributes: { commands: [{ name: "check", title: "check" }] },
      },
    },
  };
  const c = await core.exportPackage({ manifest: card });
  const e = await core.exportPackage({
    manifest: ext,
    files: {
      "index.html": "<h1>custom</h1>",
      "main.js": `export function activate(s){s.register('commands','check',()=>s.character())}`,
    },
  });
  core.close();
  return createAgentBundle(
    {
      bundleVersion: "1.0",
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      character: "card.zip",
      extensions: ["workspace.zip"],
      connectors: [],
      startup: "workspace",
    },
    { "card.zip": c, "workspace.zip": e },
  );
}
it("imports duplicate bundles as isolated disabled instances and loads only enabled frontends", async () => {
  const { host, dir } = await fixture();
  const bytes = await bundle(dir);
  const a = (await host.preview(bytes)) as { token: string };
  const b = (await host.preview(bytes)) as { token: string };
  const one = await host.install(a.token),
    two = await host.install(b.token);
  expect(one.instanceId).not.toBe(two.instanceId);
  expect(await host.frontend(one.instanceId)).toBeNull();
  await host.enable(one.instanceId, "card");
  await host.enable(one.instanceId, "workspace");
  expect((await host.frontend(one.instanceId))?.entry).toBe("index.html");
  expect(await host.frontend(two.instanceId)).toBeNull();
  expect(
    await host.invoke(
      one.instanceId,
      "workspace",
      "workspace",
      "commands",
      "check",
      {},
    ),
  ).toEqual({ persona: "hello" });
  await host.removeAgent(one.instanceId);
  expect((await host.listAgents()).map((a) => a.instanceId)).toEqual([
    two.instanceId,
  ]);
});
it("recovers only staging directories and rejects forged instance ids", async () => {
  const { host, dir } = await fixture();
  await expect(host.resources("../other")).rejects.toThrow();
  expect(await readdir(path.join(dir, "instances"))).toEqual([]);
});
it("recovers a committed component change and keeps an uncommitted import disabled", async () => {
  const { host, dir } = await fixture();
  const preview = (await host.preview(await bundle(dir))) as { token: string };
  const agent = await host.install(preview.token);
  const recordPath = path.join(
    dir,
    "instances",
    agent.instanceId,
    "record.json",
  );
  const f = await import("node:fs/promises");
  const original = await host.exportAgent(agent.instanceId);
  const agentDir = path.dirname(recordPath);
  await f.writeFile(path.join(agentDir, "component.pending.zip"), original);
  await f.writeFile(
    path.join(agentDir, "component-transaction.json"),
    JSON.stringify({
      packageId: "workspace",
      version: "1.0.0",
      agent: { ...agent.agent, name: "recovered" },
    }),
  );
  host.close();
  await host.initialize();
  const record = JSON.parse(await f.readFile(recordPath, "utf8"));
  expect(record.agent.name).toBe("recovered");
  await expect(
    f.readFile(path.join(agentDir, "component-transaction.json")),
  ).rejects.toThrow();
  expect(await host.frontend(agent.instanceId)).toBeNull();
});
it("keeps distinct instance settings and rejects binding the host library", async () => {
  const { host, dir } = await fixture();
  const data = await bundle(dir);
  const p = (await host.preview(data)) as { token: string },
    q = (await host.preview(data)) as { token: string };
  const a = await host.install(p.token),
    b = await host.install(q.token);
  await host.setSettings(a.instanceId, "workspace", { label: "one" }, {});
  const fa = await import("node:fs/promises");
  const one = JSON.parse(
    await fa.readFile(
      path.join(
        dir,
        "instances",
        a.instanceId,
        "core/data/workspace/settings.json",
      ),
      "utf8",
    ),
  );
  expect(one.label).toBe("one");
  await expect(
    fa.readFile(
      path.join(
        dir,
        "instances",
        b.instanceId,
        "core/data/workspace/settings.json",
      ),
    ),
  ).rejects.toThrow();
  await expect(
    host.bindRoot(a.instanceId, "workspace", dir),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});
