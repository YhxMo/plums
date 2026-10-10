import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  type ManifestV2,
  type AuditEvent,
} from "@plumsjs/core";
import {
  createAgentBundle,
  validateAgentBundle,
  type DesktopContribution,
} from "@plumsjs/sdk";
import { DesktopHost } from "../src/host.js";
import { compose, binding } from "../src/assembly.js";

const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const protocol = "org.example.automatic";
async function component(
  id: string,
  role: "consumer" | "provider" | "both",
  optional = true,
  version = "1.0.0",
) {
  const c: DesktopContribution = {
    sdkVersion: "2",
    runtime: "main.js",
    contributes: { tools: [{ name: "echo", title: "Echo" }] },
    protocols: {
      ...(role !== "provider"
        ? { requires: [{ id: "store", protocol, range: "^1.0.0", optional }] }
        : {}),
      ...(role !== "consumer"
        ? {
            provides: [
              {
                id: "store",
                protocol,
                version: "1.0.0",
                contribution: { kind: "tools", name: "echo" },
              },
            ],
          }
        : {}),
    },
  };
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    id,
    kind: "extension",
    name: id,
    version,
    description: "Synthetic protocol fixture",
    dependencies: [],
    permissions: [
      {
        id: "files",
        kind: "fs",
        target: "agent-data",
        operations: ["write"],
        reason: "Synthetic data",
      },
    ],
    payload: { plumsDesktop: c },
  };
  return createArchive({
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    "main.js": Buffer.from(
      role === "consumer"
        ? "export function activate(s){s.register('tools','echo',v=>s.protocols.invoke('store',v));}"
        : "export function activate(s){s.register('tools','echo',v=>v.write?s.capability('files',{kind:'fs',operation:'write',path:'fixture.txt',data:[1]}):v);}",
    ),
  });
}
async function fixture(
  auditOverride?: (e: Readonly<AuditEvent>) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-auto-binding-"));
  dirs.push(dir);
  const stores = new Map<string, MemorySecretStore>(),
    audit: Readonly<AuditEvent>[] = [],
    confirm = { ask: vi.fn(async () => true) },
    fs = new RecordingFsSink();
  const options = {
    dataDir: dir,
    confirm,
    fs,
    egress: new RecordingEgressSink(),
    secretStore: (id: string) => {
      if (!stores.has(id)) stores.set(id, new MemorySecretStore());
      return stores.get(id)!;
    },
    audit: async (_id: string, e: Readonly<AuditEvent>) => {
      audit.push(e);
      await auditOverride?.(e);
    },
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  const put = async (bytes: Uint8Array) =>
    host.importLibrary(
      ((await host.preview(bytes)) as { token: string }).token,
    );
  return { host, dir, options, stores, put, audit, confirm, fs };
}

it("fixes required and optional single candidates without granting consent, enablement or I/O", async () => {
  const f = await fixture(),
    provider = await f.put(await component("provider", "provider")),
    required = await f.put(await component("required", "consumer", false)),
    optional = await f.put(await component("optional", "consumer"));
  const record = await f.host.createAgent("Automatic", [
      provider.digest,
      required.digest,
      optional.digest,
    ]),
    id = record.instanceId;
  expect((await f.host.protocolPlan(id)).requirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        consumerId: "required",
        state: "disabled",
        autoBound: true,
      }),
      expect.objectContaining({
        consumerId: "optional",
        state: "disabled",
        autoBound: true,
      }),
    ]),
  );
  await expect(
    f.host.invokeProtocol(id, "required", "store", {}),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(
    ((await f.host.resources(id)) as any).packages.every(
      (p: any) => !p.enabled && !p.consented,
    ),
  ).toBe(true);
  await f.host.enableAgent(id, (await f.host.agentEnablePlan(id)).fingerprint);
  expect(
    await f.host.invokeProtocol(id, "required", "store", { text: "synthetic" }),
  ).toEqual({ text: "synthetic" });
  f.confirm.ask.mockResolvedValueOnce(false);
  await expect(
    f.host.invokeProtocol(id, "required", "store", { write: true }),
  ).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
  expect(f.fs.records).toHaveLength(0);
  const events = f.audit.filter((e) => e.operation === "protocol.auto-bind");
  expect(events).toHaveLength(2);
  expect(events.every(Object.isFrozen)).toBe(true);
  expect(events[0]).toMatchObject({
    providerId: "provider",
    requirementId: "store",
    phase: "grant",
    outcome: "allowed",
    executionState: "not_started",
  });
  expect(JSON.stringify(events)).not.toContain(f.dir);
  await f.host.close();
  const restored = new DesktopHost(f.options);
  hosts.push(restored);
  await restored.initialize();
  expect(
    (await restored.protocolPlan(id)).requirements.every(
      (s) => s.autoBound && s.state === "bound",
    ),
  ).toBe(true);
});

it("leaves zero and multiple candidates for the user and never adds a public-library or other-Agent provider", async () => {
  const f = await fixture(),
    a = await f.put(await component("a", "provider")),
    b = await f.put(await component("b", "provider")),
    consumer = await f.put(await component("consumer", "consumer")),
    required = await f.put(await component("required", "consumer", false));
  await f.host.createAgent("Other", [a.digest]);
  const empty = await f.host.createAgent("Empty", [consumer.digest]);
  expect(
    (await f.host.protocolPlan(empty.instanceId)).requirements[0],
  ).toMatchObject({ state: "missing", candidates: [] });
  const choices = await f.host.createAgent("Choices", [
    consumer.digest,
    a.digest,
    b.digest,
  ]);
  expect(
    (await f.host.protocolPlan(choices.instanceId)).requirements[0],
  ).toMatchObject({ state: "choose" });
  await expect(
    f.host.createAgent("Required", [required.digest, a.digest, b.digest]),
  ).rejects.toMatchObject({
    code: "IMPORT_INVALID",
    details: { reason: "PROTOCOL_BINDING_REQUIRED" },
  });
  expect(
    f.audit.filter((e) => e.operation === "protocol.auto-bind"),
  ).toHaveLength(0);
});

it("retains an automatic or explicit choice when a second candidate arrives and lets the user replace it", async () => {
  const f = await fixture(),
    a = await f.put(await component("a", "provider")),
    b = await f.put(await component("b", "provider")),
    consumer = await f.put(await component("consumer", "consumer"));
  const record = await f.host.createAgent("Automatic", [
      a.digest,
      consumer.digest,
    ]),
    id = record.instanceId;
  await f.host.addLibraryComponent(id, b.digest);
  let plan = await f.host.protocolPlan(id);
  expect(plan.requirements[0]).toMatchObject({
    selected: { providerId: "a" },
    autoBound: true,
  });
  const choice = plan.requirements[0]!.candidates.find(
    (c) => c.intent.providerId === "b",
  )!.intent;
  await f.host.setProtocolBinding(
    id,
    plan.fingerprint,
    "consumer",
    "store",
    choice,
  );
  plan = await f.host.protocolPlan(id);
  expect(plan.requirements[0]).toMatchObject({ selected: { providerId: "b" } });
  expect(plan.requirements[0]!.autoBound).toBeUndefined();
  const explicit = await f.host.createAgent(
    "Explicit",
    [a.digest, b.digest, consumer.digest],
    undefined,
    undefined,
    [choice],
  );
  expect(explicit.protocolBindings![0]).toMatchObject({ providerId: "b" });
  expect(explicit.protocolBindings![0]!.autoBound).toBeUndefined();
});

it.each(["library", "component"])(
  "automatically connects after a %s addition without enabling the new component",
  async (source) => {
    const f = await fixture(),
      consumer = await f.put(await component("consumer", "consumer")),
      bytes = await component("provider", "provider");
    const record = await f.host.createAgent("Add", [consumer.digest]),
      id = record.instanceId;
    if (source === "library")
      await f.host.addLibraryComponent(id, (await f.put(bytes)).digest);
    else
      await f.host.importComponent(
        id,
        ((await f.host.previewComponent(id, bytes)) as { token: string }).token,
      );
    expect((await f.host.protocolPlan(id)).requirements[0]).toMatchObject({
      state: "disabled",
      autoBound: true,
      selected: { providerId: "provider" },
    });
    await expect(
      f.host.invokeProtocol(id, "consumer", "store", {}),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const saved = JSON.parse(
      await readFile(path.join(f.dir, "instances", id, "record.json"), "utf8"),
    );
    expect(saved.protocolBindings[0]).toMatchObject({ autoBound: true });
  },
);

it("imports empty slots automatically and preserves portable choices ahead of automatic choices", async () => {
  const f = await fixture(),
    a = await component("a", "provider"),
    b = await component("b", "provider"),
    consumer = await component("consumer", "consumer", false);
  const bytes = await createAgentBundle(
    {
      bundleVersion: "1.0",
      id: "fixture-agent",
      name: "Bundle",
      version: "1.0.0",
      extensions: ["a.zip", "consumer.zip"],
      connectors: [],
    },
    { "a.zip": a, "consumer.zip": consumer },
  );
  const record = await f.host.install(
    ((await f.host.preview(bytes)) as { token: string }).token,
  );
  expect(record.protocolBindings![0]).toMatchObject({
    providerId: "a",
    autoBound: true,
  });
  const exported = await f.host.exportAgent(record.instanceId),
    parsed = await validateAgentBundle(exported);
  expect(parsed.agent.protocolBindings![0]).not.toHaveProperty("autoBound");
  expect(parsed.agent.protocolBindings![0]).not.toHaveProperty("agentId");
  const imported = await f.host.install(
    ((await f.host.preview(exported)) as { token: string }).token,
  );
  expect(imported.protocolBindings![0]).toMatchObject({ providerId: "a" });
  expect(imported.protocolBindings![0]).not.toHaveProperty("autoBound");
  await f.host.addLibraryComponent(
    imported.instanceId,
    (await f.put(b)).digest,
  );
  expect(
    (await f.host.protocolPlan(imported.instanceId)).requirements[0]!.selected!
      .providerId,
  ).toBe("a");
});

it("keeps an upgraded provider stale even after another component is added", async () => {
  const f = await fixture(),
    provider = await f.put(await component("provider", "provider")),
    consumer = await f.put(await component("consumer", "consumer"));
  const record = await f.host.createAgent("Stale", [
      provider.digest,
      consumer.digest,
    ]),
    id = record.instanceId;
  await f.host.updatePackage(
    id,
    (
      (await f.host.previewComponent(
        id,
        await component("provider", "provider", true, "1.1.0"),
      )) as { token: string }
    ).token,
    "provider",
    true,
  );
  await f.host.addLibraryComponent(
    id,
    (await f.put(await component("alternative", "provider"))).digest,
  );
  expect((await f.host.protocolPlan(id)).requirements[0]).toMatchObject({
    state: "stale",
    selected: { providerId: "provider" },
  });
  expect(
    f.audit.filter((e) => e.operation === "protocol.auto-bind"),
  ).toHaveLength(1);
});

it("rejects cycles before creation or component installation", async () => {
  const f = await fixture(),
    a = await f.put(await component("a", "both")),
    b = await f.put(await component("b", "both"));
  await expect(
    f.host.createAgent("Cycle", [a.digest, b.digest]),
  ).rejects.toMatchObject({
    code: "IMPORT_INVALID",
    details: { reason: "PROTOCOL_CYCLE" },
  });
  const record = await f.host.createAgent("One", [a.digest]);
  await expect(
    f.host.addLibraryComponent(record.instanceId, b.digest),
  ).rejects.toMatchObject({ details: { reason: "PROTOCOL_CYCLE" } });
  expect(
    ((await f.host.resources(record.instanceId)) as any).packages,
  ).toHaveLength(1);
  expect(f.audit).toHaveLength(0);
});

it("does not publish a new Agent when automatic-binding audit fails", async () => {
  const f = await fixture(async () => {
      throw Error("Synthetic audit failure");
    }),
    a = await f.put(await component("a", "provider")),
    consumer = await f.put(await component("consumer", "consumer"));
  await expect(
    f.host.createAgent("Audit failure", [a.digest, consumer.digest]),
  ).rejects.toThrow("Synthetic audit failure");
  expect(await f.host.listAgents()).toHaveLength(0);
});

it("recovers an interrupted addition and its automatic connection together", async () => {
  const f = await fixture(),
    consumer = await f.put(await component("consumer", "consumer")),
    bytes = await component("provider", "provider"),
    provider = await f.put(bytes);
  const record = await f.host.createAgent("Recover", [consumer.digest]),
    id = record.instanceId,
    dir = path.join(f.dir, "instances", id);
  await f.host.close();
  const core = createCore({
    dataDir: path.join(dir, "core"),
    secrets: f.options.secretStore(id),
    egress: f.options.egress,
  });
  await core.importPackage(bytes);
  core.close();
  const next = compose(record, [...record.components!, binding(provider)]);
  await writeFile(
    path.join(dir, "assembly-transaction.json"),
    JSON.stringify({
      packageId: "provider",
      version: "1.0.0",
      beforeVersion: null,
      next,
      automaticProtocols: true,
    }),
  );
  const restored = new DesktopHost(f.options);
  hosts.push(restored);
  await restored.initialize();
  expect((await restored.protocolPlan(id)).requirements[0]).toMatchObject({
    state: "disabled",
    autoBound: true,
    selected: { providerId: "provider" },
  });
  expect((await restored.listAgents())[0]!.components).toHaveLength(2);
  await expect(
    readFile(path.join(dir, "assembly-transaction.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("persists automatic connection audit through staging when using the default file audit", async () => {
  const f = await fixture(),
    provider = await f.put(await component("provider", "provider")),
    consumer = await f.put(await component("consumer", "consumer"));
  await f.host.close();
  const host = new DesktopHost({ ...f.options, audit: undefined });
  hosts.push(host);
  await host.initialize();
  const record = await host.createAgent("File audit", [
    provider.digest,
    consumer.digest,
  ]);
  const events = await host.audit(record.instanceId);
  expect(events).toEqual([
    expect.objectContaining({
      operation: "protocol.auto-bind",
      extensionId: "consumer",
      providerId: "provider",
      requirementId: "store",
    }),
  ]);
  expect(JSON.stringify(events)).not.toContain(f.dir);
});

it("retains a failed addition publication for recovery without exposing an unaudited connection", async () => {
  let fail = true;
  const f = await fixture(async (e) => {
      if (fail && e.operation === "protocol.auto-bind")
        throw Error("Synthetic audit failure");
    }),
    provider = await f.put(await component("provider", "provider")),
    consumer = await f.put(await component("consumer", "consumer"));
  const record = await f.host.createAgent("Recover audit", [consumer.digest]),
    id = record.instanceId;
  await expect(f.host.addLibraryComponent(id, provider.digest)).rejects.toThrow(
    "Synthetic audit failure",
  );
  const saved = JSON.parse(
    await readFile(path.join(f.dir, "instances", id, "record.json"), "utf8"),
  );
  expect(saved.protocolBindings).toEqual([]);
  const journal = JSON.parse(
    await readFile(
      path.join(f.dir, "instances", id, "assembly-transaction.json"),
      "utf8",
    ),
  );
  expect(journal.automaticProtocols).toBe(true);
  await f.host.close();
  fail = false;
  const restored = new DesktopHost(f.options);
  hosts.push(restored);
  await restored.initialize();
  expect((await restored.protocolPlan(id)).requirements[0]).toMatchObject({
    state: "disabled",
    autoBound: true,
  });
});
