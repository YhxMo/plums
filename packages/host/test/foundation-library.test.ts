import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createArchive,
  MemorySecretStore,
  type ManifestV2,
  type AuditEvent,
} from "@plumsjs/core";
import type {
  FoundationProvider,
  FoundationRequirement,
  FoundationSelection,
} from "@plumsjs/sdk";
import { DesktopHost } from "../src/index.js";
import { FoundationRegistry } from "../src/foundation-factory.js";
import {
  createFoundationSession,
  registerLibraryFoundation,
} from "../src/index.js";
import {
  ControlledExecution,
  ControlledProcess,
} from "../src/controlled-execution.js";
import { SecureFsSink } from "../src/io.js";
const roots: string[] = [],
  hosts: DesktopHost[] = [],
  sessions: { close(): Promise<void> }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    [...hosts.splice(0), ...sessions.splice(0)].map((h) => h.close()),
  );
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
const node = path.resolve(".build-cache/node-v26.5.1-darwin-arm64/bin/node");
const requirement: FoundationRequirement = {
  requirementVersion: "1.0",
  protocolRange: "^1.0.0",
  sdk: { id: "org.plums.sdk", version: "2.0.0" },
  features: ["sdk.register", "sdk.settings", "sdk.context", "sdk.capability"],
};
const provider: FoundationProvider = {
  declarationVersion: "1.0",
  id: "org.example.independent",
  foundationVersion: "1.0",
  entry: "provider.mjs",
  execution: "controlled-node",
  platforms: ["darwin-arm64"],
  features: ["session.invoke", "session.callback", "session.cancel"],
  hostFeatures: [],
  sdks: [
    { id: "org.plums.sdk", range: "^2.0.0", features: requirement.features },
  ],
};
const manifest = (
  id: string,
  payload: unknown,
  permissions: ManifestV2["permissions"] = [],
): ManifestV2 => ({
  formatVersion: "2.0",
  id,
  kind: "extension",
  name: id,
  version: "1.0.0",
  description: "Internal platform fixture",
  dependencies: [],
  permissions,
  payload,
});
async function packProvider(declaration: unknown = provider, source?: string) {
  return createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify(manifest(provider.id, { plumsFoundation: declaration })),
    ),
    "provider.mjs": Buffer.from(
      source ??
        (await readFile(
          "packages/host/test/fixtures/independent-foundation.mjs",
          "utf8",
        )),
    ),
  });
}
async function setup(foundation?: FoundationSelection) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "plums-foundation-library-"),
  );
  roots.push(root);
  await mkdir(path.join(root, "work"));
  await writeFile(path.join(root, "work", "business.txt"), "fixture");
  const audit: AuditEvent[] = [];
  const confirm = vi.fn(async () => true);
  const options = {
    dataDir: path.join(root, "data"),
    nodePath: node,
    fs: new SecureFsSink(path.resolve("packages/host/dist/secure-fs")),
    confirm: { ask: confirm },
    secretStore: () => new MemorySecretStore(),
    audit: async (_id, event) => {
      audit.push(event);
    },
    ...(foundation ? { foundation } : {}),
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  return { root, host, audit, confirm, options };
}
async function importInto(host: DesktopHost, bytes: Uint8Array) {
  const preview = (await host.preview(bytes)) as { token: string };
  return host.importLibrary(preview.token);
}

it("rejects malformed foundation declarations during public offline import, before storing any artifact", async () => {
  const f = await setup();
  await expect(
    f.host.preview(await packProvider({ ...provider, entry: "missing.mjs" })),
  ).rejects.toBeDefined();
  expect(await f.host.listLibrary()).toEqual([]);
  expect(f.audit).toEqual([]);
  expect(f.confirm).not.toHaveBeenCalled();
});

it("imports and discovers a foundation without running its entry or requesting permission", async () => {
  const f = await setup();
  const item = await importInto(
    f.host,
    await packProvider(
      undefined,
      "throw Error('must never run during import');",
    ),
  );
  const available = await f.host.listFoundations();
  expect(available).toContainEqual({
    selection: {
      selectionVersion: "1.0",
      source: "library",
      id: provider.id,
      version: "1.0.0",
      digest: item.digest,
    },
    provider,
  });
  expect(f.audit).toEqual([]);
  expect(f.confirm).not.toHaveBeenCalled();
  available[0]!.provider.sdks[0]!.features.length = 0;
  expect((await f.host.listFoundations())[0]!.provider).toEqual(provider);
});
async function runtimeFixture(providerSource?: string) {
  const f = await setup();
  const item = await importInto(
    f.host,
    await packProvider(undefined, providerSource),
  );
  const selection = (await f.host.listFoundations())[0]!.selection;
  const component = await importInto(
    f.host,
    await createArchive({
      "manifest.json": Buffer.from(
        JSON.stringify(
          manifest(
            "consumer",
            {
              plumsDesktop: {
                sdkVersion: "2",
                runtime: "main.js",
                foundation: requirement,
                contributes: { commands: [{ name: "check", title: "Check" }] },
              },
            },
            [
              {
                id: "files",
                kind: "fs",
                target: "work",
                reason: "List fixture",
                operations: ["list"],
              },
            ],
          ),
        ),
      ),
      "main.js": Buffer.from(
        "export function activate(s){s.register('commands','check',async i=>({settings:await s.settings(),context:await s.context(),files:await s.capability('files',{kind:'fs',operation:'list',path:'.'}),value:i.value}));}",
      ),
    }),
  );
  const a = await f.host.createAgent(
    "A",
    [component.digest],
    undefined,
    undefined,
    [],
    { requirement, selection },
  );
  const b = await f.host.createAgent(
    "B",
    [component.digest],
    undefined,
    undefined,
    [],
    { requirement, selection },
  );
  await f.host.close();
  const host = new DesktopHost({ ...f.options, foundation: selection });
  hosts.push(host);
  await host.initialize();
  for (const agent of [a, b]) {
    await host.bindRoot(agent.instanceId, "work", path.join(f.root, "work"));
    await host.enable(agent.instanceId, "consumer");
  }
  const invoke = (
    id = a.instanceId,
    input: unknown = { value: 7 },
    signal?: AbortSignal,
  ) =>
    host.invoke(id, "consumer", "consumer", "commands", "check", input, signal);
  return { ...f, host, a, b, invoke, selection, item, component };
}
it("runs an imported independent provider through the public DesktopHost factory with fixed identities and real audited file I/O", async () => {
  const owned: ControlledProcess[] = [];
  const actors = new Map<number, string>();
  const write = ControlledProcess.prototype.write;
  vi.spyOn(ControlledProcess.prototype, "write").mockImplementation(
    function (message) {
      const m = message as { type: string; binding?: { agentId: string } };
      if (m.type === "prepare" && m.binding)
        actors.set(this.pid!, m.binding.agentId);
      return write.call(this, message);
    },
  );
  const launch = ControlledExecution.prototype.launchFoundation;
  vi.spyOn(
    ControlledExecution.prototype,
    "launchFoundation",
  ).mockImplementation(async function (...args) {
    const p = await launch.apply(this, args);
    owned.push(p);
    return p;
  });
  const factory = vi.spyOn(FoundationRegistry.prototype, "create");
  const f = await runtimeFixture();
  const [a, b] = await Promise.all([
    f.invoke(undefined, { value: 7, agentId: "victim", instanceId: "fake" }),
    f.invoke(f.b.instanceId, { value: 8 }),
  ]);
  expect(a).toMatchObject({
    value: 7,
    context: { agentId: f.a.instanceId, componentId: "consumer" },
    files: {
      kind: "fs",
      operation: "list",
      entries: [{ name: "business.txt", type: "file" }],
    },
  });
  expect(b).toMatchObject({ value: 8, context: { agentId: f.b.instanceId } });
  expect(factory.mock.calls).toHaveLength(2);
  for (const [reference, options] of factory.mock.calls) {
    expect(reference).toEqual({
      id: provider.id,
      version: "1.0.0",
      digest: f.selection.digest,
    });
    expect(options.actor.componentDigest).toBe(f.component.digest);
    expect(options.actor.installationId).toBeTruthy();
  }
  expect(new Set(owned.map((p) => p.pid)).size).toBe(2);
  expect(f.confirm).toHaveBeenCalledTimes(2);
  expect(f.audit.filter((e) => e.phase === "result")).toHaveLength(2);
  expect(JSON.stringify(f.audit)).not.toContain(f.root);
  await expect(f.host.removeLibrary(f.selection.digest)).rejects.toBeDefined();
  await f.host.disable(f.a.instanceId, "consumer");
  const ap = owned.find((p) => actors.get(p.pid!) === f.a.instanceId)!;
  expect(() => process.kill(ap.pid!, 0)).toThrow();
  expect(await f.invoke(f.b.instanceId)).toMatchObject({ value: 7 });
  await f.host.close();
  for (const p of owned) {
    await p.cleaned;
    expect(() => process.kill(p.pid!, 0)).toThrow();
  }
});
it("blocks a consumer revocation during pending confirmation and never replays the unknown contribution", async () => {
  const f = await runtimeFixture();
  const sink = vi.spyOn(f.options.fs, "list");
  let entered!: () => void, release!: (v: boolean) => void;
  const entering = new Promise<void>((r) => {
    entered = r;
  });
  f.confirm.mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((r) => {
      release = r;
    });
  });
  const call = f.invoke();
  const rejected = expect(call).rejects.toMatchObject({
    details: { executionState: "unknown" },
  });
  await entering;
  await f.host.disable(f.a.instanceId, "consumer");
  release(true);
  await rejected;
  expect(sink).not.toHaveBeenCalled();
  await expect(f.invoke()).rejects.toBeDefined();
  expect(f.confirm).toHaveBeenCalledTimes(1);
  expect(await f.invoke(f.b.instanceId)).toMatchObject({ value: 7 });
});
it("rejects a corrupted or absent provider artifact instead of falling back to the official adapter", async () => {
  const f = await runtimeFixture();
  const factory = vi.spyOn(FoundationRegistry.prototype, "create");
  await writeFile(
    path.join(
      f.options.dataDir,
      "library",
      "objects",
      f.selection.digest + ".zip",
    ),
    "corrupt",
  );
  await expect(f.invoke()).rejects.toBeDefined();
  expect(factory).not.toHaveBeenCalled();
  expect(f.confirm).not.toHaveBeenCalled();
});
async function adapterFixture(source?: string, limits = {}) {
  const f = await runtimeFixture(source);
  const registry = new FoundationRegistry();
  const reference = await registerLibraryFoundation(
    registry,
    f.host.library,
    f.selection,
    {
      nodePath: node,
      handshakeTimeoutMs: 1000,
      callTimeoutMs: 1000,
      ...limits,
    },
  );
  const component = (await f.host.library.get(f.component.digest)).contents;
  const bridge = vi.fn(async () => ({}));
  let active = true;
  const session = await createFoundationSession(registry, reference, {
    component,
    actor: {
      agentId: f.a.instanceId,
      componentId: "consumer",
      installationId: "installed-a",
      componentVersion: "1.0.0",
      componentDigest: f.component.digest,
    },
    assertActive: async () => {
      if (!active) throw Error("revoked");
    },
    assertCurrent: () => {
      if (!active) throw Error("revoked");
    },
    bridge,
  });
  sessions.push(session);
  const context = {
    callers: [],
    ancestry: ["consumer"],
    signal: new AbortController().signal,
  };
  return {
    ...f,
    registry,
    reference,
    session,
    bridge,
    context,
    revoke: () => {
      active = false;
    },
  };
}
const carrier = (prepare = "", invoke = "") =>
  `import readline from 'node:readline';let base;const send=m=>console.log(JSON.stringify({...base,...m}));readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='prepare'){base={foundationVersion:'1.0',sessionId:m.sessionId};${prepare}send({type:'ready',sdk:m.sdk,features:m.features});}if(m.type==='activate')send({type:'activated'});if(m.type==='invoke'){${invoke}}});`;
it("keeps create and readiness business-free and rejects prepare callbacks through the shared factory", async () => {
  const launch = vi.spyOn(ControlledExecution.prototype, "launchFoundation");
  const f = await adapterFixture(
    carrier(
      "send({type:'callback',callId:'fake',callbackId:'rpc',method:'settings',args:{}});",
    ),
  );
  expect(launch).not.toHaveBeenCalled();
  expect(f.bridge).not.toHaveBeenCalled();
  await expect(f.session.ready()).rejects.toMatchObject({
    details: { reason: "INVALID_REQUEST", executionState: "not_started" },
  });
  expect(f.bridge).not.toHaveBeenCalled();
  await f.session.close();
});
it("preserves two exact archives with the same provider id/version and rejects an unpinned registry lookup", async () => {
  const f = await adapterFixture(carrier());
  const other = await importInto(
    f.host,
    await packProvider(undefined, carrier("/* another artifact */")),
  );
  const selection = { ...f.selection, digest: other.digest };
  const second = await registerLibraryFoundation(
    f.registry,
    f.host.library,
    selection,
    { nodePath: node },
  );
  expect(second.digest).not.toBe(f.reference.digest);
  expect(f.registry.list()).toHaveLength(2);
  expect(() =>
    f.registry.describe({ id: provider.id, version: "1.0.0" }),
  ).toThrow();
  selection.id = "mutated";
  expect(f.registry.describe(second)).toEqual(provider);
  await expect(
    registerLibraryFoundation(f.registry, f.host.library, f.selection, {
      nodePath: node,
    }),
  ).rejects.toMatchObject({
    details: { reason: "FOUNDATION_ALREADY_REGISTERED" },
  });
});
it.each(["crash", "timeout", "cancel"])(
  "cleans an imported provider on %s without dispatching any business callback",
  async (mode) => {
    const f = await adapterFixture(
      carrier(
        "",
        mode === "crash" ? "process.exit(0);" : "process.on('SIGTERM',()=>{});",
      ),
      { callTimeoutMs: 200 },
    );
    await f.session.ready();
    await f.session.activate();
    const controller = new AbortController();
    const call = f.session.invoke(
      "commands",
      "check",
      {},
      { ...f.context, signal: controller.signal },
    );
    const rejected = expect(call).rejects.toMatchObject({
      details: { executionState: "unknown" },
    });
    if (mode === "cancel") {
      await new Promise((r) => setTimeout(r, 50));
      controller.abort();
    }
    await rejected;
    await f.session.close();
    expect(f.session.alive).toBe(false);
    expect(f.bridge).not.toHaveBeenCalled();
  },
);
it("rejects spoofed callback authority and rechecks revocation before a queued dispatch", async () => {
  const f = await adapterFixture(
    carrier(
      "",
      "send({type:'callback',callId:m.callId,callbackId:'rpc',method:'settings',args:{agentId:'victim'}});",
    ),
  );
  await f.session.ready();
  await f.session.activate();
  await expect(
    f.session.invoke("commands", "check", {}, f.context),
  ).rejects.toMatchObject({
    details: { reason: "INVALID_REQUEST", executionState: "unknown" },
  });
  expect(f.bridge).not.toHaveBeenCalled();
  const g = await adapterFixture(
    carrier("", "send({type:'result',callId:m.callId,ok:true,value:1});"),
  );
  await g.session.ready();
  await g.session.activate();
  g.revoke();
  await expect(
    g.session.invoke("commands", "check", {}, g.context),
  ).rejects.toBeDefined();
  expect(g.bridge).not.toHaveBeenCalled();
});
it("denies imported provider direct file, network and process access under the same public factory", async () => {
  const f = await setup();
  const probe = `import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';`;
  const run = `let file=false,write=false;try{fs.readFileSync(${JSON.stringify(path.join(f.root, "work", "business.txt"))});file=true}catch{}try{fs.writeFileSync(${JSON.stringify(path.join(f.root, "work", "forbidden"))},'bad');write=true}catch{}const processAllowed=!cp.spawnSync('/bin/echo',['positive']).error;const sock=net.connect(9,'127.0.0.1');sock.on('error',e=>{REPORT;sock.destroy();});`;
  const { spawnSync } = await import("node:child_process");
  const control = spawnSync(
    node,
    [
      "--input-type=module",
      "-e",
      probe +
        run.replace(
          "REPORT",
          "console.log(JSON.stringify({file,write,process:processAllowed,network:e.code!=='EPERM'&&e.code!=='EACCES'}))",
        ),
    ],
    { env: {}, encoding: "utf8" },
  );
  expect(control.status).toBe(0);
  expect(JSON.parse(control.stdout)).toEqual({
    file: true,
    write: true,
    process: true,
    network: true,
  });
  const g = await adapterFixture(
    probe +
      carrier(
        "",
        run.replace(
          "REPORT",
          "send({type:'result',callId:m.callId,ok:true,value:{file,write,process:processAllowed,network:e.code!=='EPERM'&&e.code!=='EACCES'}})",
        ),
      ),
  );
  await g.session.ready();
  await g.session.activate();
  expect(await g.session.invoke("commands", "check", {}, g.context)).toEqual({
    file: false,
    write: false,
    process: false,
    network: false,
  });
  expect(g.bridge).not.toHaveBeenCalled();
});
it("keeps SDK error provenance and does not stop an otherwise valid instance for a rejected call edge", async () => {
  const f = await adapterFixture(
    carrier("", "send({type:'result',callId:m.callId,ok:true,value:1});"),
  );
  await f.session.ready();
  await f.session.activate();
  const { PlumsError } = await import("@plumsjs/core");
  const error = new PlumsError({
    code: "PERMISSION_DENIED",
    message: "Denied",
    details: { reason: "EDGE_DENIED" },
  });
  let checks = 0;
  await expect(
    f.session.invoke(
      "commands",
      "check",
      {},
      {
        ...f.context,
        assertActive: async () => {
          if (++checks === 4) throw error;
        },
      },
    ),
  ).rejects.toBe(error);
  expect(f.session.alive).toBe(true);
  expect(await f.session.invoke("commands", "check", {}, f.context)).toBe(1);
});
it("reports cleanup failure with a fixed public error", async () => {
  const f = await adapterFixture(carrier());
  await f.session.ready();
  await f.session.activate();
  const close = ControlledExecution.prototype.close;
  const spy = vi
    .spyOn(ControlledExecution.prototype, "close")
    .mockImplementation(async function () {
      await close.call(this);
      throw Error("secret private cleanup path");
    });
  try {
    await expect(f.session.close()).rejects.toMatchObject({
      details: { reason: "CLEANUP_FAILED" },
    });
  } finally {
    spy.mockRestore();
  }
});
it("retains factory-owned third-party cleanup failure when the installation becomes invalid before delivery", async () => {
  const f = await adapterFixture(carrier());
  const component = (await f.host.library.get(f.component.digest)).contents;
  const close = ControlledExecution.prototype.close;
  const spy = vi
    .spyOn(ControlledExecution.prototype, "close")
    .mockImplementation(async function () {
      await close.call(this);
      throw Error("private cleanup failure");
    });
  let currentChecks = 0;
  try {
    await expect(
      createFoundationSession(f.registry, f.reference, {
        component,
        actor: {
          agentId: f.b.instanceId,
          componentId: "consumer",
          installationId: "installed-b",
          componentVersion: "1.0.0",
          componentDigest: f.component.digest,
        },
        bridge: f.bridge,
        assertActive: async () => {},
        assertCurrent: () => {
          if (++currentChecks === 3) throw Error("withdrawn");
        },
      }),
    ).rejects.toMatchObject({
      details: { reason: "FOUNDATION_CLEANUP_FAILED" },
    });
    await expect(
      f.registry.settleCleanup(f.b.instanceId),
    ).rejects.toMatchObject({
      details: { reason: "FOUNDATION_CLEANUP_FAILED" },
    });
    await expect(
      f.registry.settleCleanup(f.a.instanceId),
    ).resolves.toBeUndefined();
    expect(f.bridge).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it("waits for a switching Agent's real provider, cancels pending confirmation and preserves another Agent", async () => {
  const launch = ControlledExecution.prototype.launchFoundation,
    owned: ControlledProcess[] = [];
  vi.spyOn(
    ControlledExecution.prototype,
    "launchFoundation",
  ).mockImplementation(async function (...args) {
    const p = await launch.apply(this, args);
    owned.push(p);
    return p;
  });
  const f = await runtimeFixture();
  const defaults = new DesktopHost(f.options);
  hosts.push(defaults);
  await defaults.initialize();
  const temporary = await defaults.createAgent("Default pin");
  const official = temporary.foundation!.selection;
  await defaults.removeAgent(temporary.instanceId);
  await defaults.close();
  await f.invoke(f.b.instanceId);
  const other = owned[0]!;
  const sink = vi.spyOn(f.options.fs, "list");
  sink.mockClear();
  let entered!: () => void, release!: (v: boolean) => void;
  const entering = new Promise<void>((r) => (entered = r));
  f.confirm.mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((r) => (release = r));
  });
  const call = f.invoke();
  const failed = expect(call).rejects.toMatchObject({
    details: { executionState: "unknown" },
  });
  await entering;
  const previous = owned[1]!,
    plan = await f.host.foundationPlan(f.a.instanceId, official);
  await f.host.switchFoundation(f.a.instanceId, plan.fingerprint, official);
  release(true);
  await failed;
  expect(() => process.kill(previous.pid!, 0)).toThrow();
  expect(() => process.kill(other.pid!, 0)).not.toThrow();
  expect(sink).not.toHaveBeenCalled();
  expect(await f.invoke()).toMatchObject({ value: 7 });
  expect(await f.invoke(f.b.instanceId)).toMatchObject({ value: 7 });
  expect(sink).toHaveBeenCalledTimes(2);
});
