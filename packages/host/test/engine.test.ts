import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
} from "@plumsjs/core";
import { InstallStore } from "../../core/src/install/store.js";
import { DesktopHost } from "../src/host.js";
import { EngineManager, type EngineHooks } from "../src/engine-manager.js";
import {
  engineManifest,
  engineFiles,
  connectorManifest,
  connectorRuntime,
} from "./platform-fixtures.js";
const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture(
  code?: string,
  credentialProbe = false,
  tier?: "project",
  authorized = true,
  event?: import("../src/host.js").HostOptions["event"],
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-engine-"));
  dirs.push(dir);
  const manifest = engineManifest();
  if (tier) Object.assign(manifest.permissions[0]!, { tier });
  const files = await engineFiles();
  if (credentialProbe) {
    manifest.settingsSchema = {
      type: "object",
      properties: {
        key: {
          type: "string",
          title: "Fixture credential",
          description: "Credential isolation fixture",
          "x-secret": true,
        },
      },
    };
    manifest.payload.plumsDesktop.contributes.commands.push({
      name: "probe",
      title: "Credential isolation probe",
    });
    files["runtime/main.js"] = Buffer.from(
      Buffer.from(files["runtime/main.js"]!)
        .toString()
        .replace(
          "export function activate(sdk) {",
          `export function activate(sdk) {
        sdk.register("commands", "probe", async input => {
          const result = await sdk.engine.request("local", "run", {mode: "full", actions: [{type: "read", path: input.path}]});
          return {exposed: result.results[0] === ["credential", "fixture", "value"].join("-")};
        });`,
        ),
    );
  }
  if (code) files["engine/main.mjs"] = Buffer.from(code);
  const builder = createCore({
    dataDir: path.join(dir, "builder"),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  const bytes = await builder.exportPackage({ manifest, files });
  builder.close();
  const fs = new RecordingFsSink(),
    egress = new RecordingEgressSink(),
    secrets = new Map<string, MemorySecretStore>();
  const confirm = { ask: vi.fn(async () => true) };
  const host = new DesktopHost({
    event,
    dataDir: dir,
    confirm,
    fs,
    egress,
    secretStore: (id) => {
      if (!secrets.has(id)) secrets.set(id, new MemorySecretStore());
      return secrets.get(id)!;
    },
  });
  hosts.push(host);
  await host.initialize();
  const p = (await host.preview(bytes)) as { token: string };
  const item = await host.importLibrary(p.token);
  const record = await host.createAgent(
    "Engine test",
    [item.digest],
    undefined,
    "engine-demo",
  );
  const id = record.instanceId;
  await host.enable(id, "engine-demo");
  const invoke = (name: string, input: unknown = {}) =>
    host.invoke(id, "engine-demo", "engine-demo", "commands", name, input);
  async function update(version: string, changePermission = false) {
    const m = {
      ...manifest,
      version,
      permissions: manifest.permissions.map(
        (p: { kind: string; reason: string }) =>
          p.kind === "engine" && changePermission
            ? { ...p, reason: "Changed engine authority" }
            : p,
      ),
    };
    const core = createCore({
      dataDir: path.join(dir, "update"),
      secrets: new MemorySecretStore(),
      egress,
    });
    const bytes = await core.exportPackage({ manifest: m, files });
    core.close();
    const preview = (await host.previewComponent(id, bytes)) as {
      token: string;
    };
    await host.updatePackage(id, preview.token, "engine-demo", true);
  }
  const approve = async () => {
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components: ["engine-demo"],
    };
    const plan = await host.tierPlan(id, selection);
    return host.confirmTier(id, plan.fingerprint, selection);
  };
  if (authorized && !tier) await approve();
  return {
    dir,
    host,
    id,
    confirm,
    fs,
    egress,
    invoke,
    update,
    item,
    bytes,
    approve,
  };
}
const simple = `import{createInterface}from'node:readline';const send=(id,result)=>console.log(JSON.stringify({jsonrpc:'2.0',id,result}));createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')send(m.id,{protocol:'jsonrpc-jsonl-v1'});else if(m.method==='echo')send(m.id,m.params);});`;
it("readiness reflects explicit local authorization and preserves project unavailability", async () => {
  const f = await fixture(undefined, false, undefined, false);
  expect((await f.host.agentReadinessPlan(f.id)).reasons).toContainEqual({
    code: "LOCAL_TIER_REQUIRED",
    blocking: true,
    action: "permissions",
    packageId: "engine-demo",
    engineId: "local",
  });
  expect(
    (await f.host.engineStatus(f.id, "engine-demo", "local")).trusted,
  ).toBe(false);
  await f.approve();
  expect(
    (await f.host.agentReadinessPlan(f.id)).reasons.some(
      (r) =>
        r.code === "LOCAL_TIER_REQUIRED" ||
        r.code === "LOCAL_AUTHORIZATION_REQUIRED",
    ),
  ).toBe(false);
  const project = await fixture(undefined, false, "project");
  expect(
    (await project.host.agentReadinessPlan(project.id)).reasons,
  ).toContainEqual({
    code: "PROJECT_UNAVAILABLE",
    blocking: true,
    action: "permissions",
    packageId: "engine-demo",
    engineId: "local",
  });
});
it("accepts project declarations but cannot launch them through the unsandboxed compatibility path", async () => {
  const f = await fixture(simple, false, "project");
  await expect(
    f.host.startEngine(f.id, "engine-demo", "local"),
  ).rejects.toMatchObject({ code: "TIER_REQUIRED" });
  await expect(
    f.host.engineCall(f.id, "engine-demo", "start", { engineId: "local" }),
  ).rejects.toMatchObject({ code: "TIER_REQUIRED" });
  await expect(
    f.host.engineCall(f.id, "engine-demo", "request", {
      engineId: "local",
      method: "echo",
      input: {},
    }),
  ).rejects.toMatchObject({ code: "TIER_REQUIRED" });
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "stopped", trusted: false },
  );
  expect(f.confirm.ask).not.toHaveBeenCalled();
});
it("does not auto-start, merges concurrent startup and performs autonomous file, process and network I/O", async () => {
  const f = await fixture(undefined, false, undefined, false);
  expect(await f.invoke("status")).toMatchObject({
    state: "stopped",
    trusted: false,
  });
  await f.approve();
  await Promise.all([
    f.invoke("start"),
    f.host.startEngine(f.id, "engine-demo", "local"),
  ]);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  const server = createServer((_q, r) => r.end("fixture network"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const file = path.join(f.dir, "project.txt"),
      port = (server.address() as { port: number }).port;
    const result = await f.invoke("run", {
      mode: "full",
      actions: [
        { type: "write", path: file, text: "private task text" },
        { type: "read", path: file },
        {
          type: "exec",
          cwd: f.dir,
          code: "process.stdout.write('child result')",
        },
        { type: "network", url: `http://127.0.0.1:${port}` },
      ],
    });
    expect(result).toMatchObject({
      results: [
        { written: true },
        "private task text",
        { exitCode: 0, output: "child result" },
        { status: 200, text: "fixture network" },
      ],
    });
    expect(f.fs.records).toHaveLength(0);
    expect(f.egress.records).toHaveLength(0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  await f.host.revokeTaskScope(f.id);
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "running", trusted: true },
  );
  const audit = JSON.stringify(await f.host.audit(f.id));
  expect(audit).toContain("LOCAL_AUTHORIZATION_CONFIRMED");
  expect(audit).not.toContain("private task text");
  expect(audit).not.toContain(f.dir);
}, 15_000);
it("supports tasks longer than the isolate budget and real per-operation confirmation", async () => {
  const f = await fixture();
  await f.invoke("start");
  const file = path.join(f.dir, "ask.txt");
  await f.invoke("run", {
    actions: [
      { type: "write", path: file, text: "written after user approval" },
      { type: "wait", ms: 5500 },
    ],
  });
  expect(await readFile(file, "utf8")).toBe("written after user approval");
  expect(f.confirm.ask).toHaveBeenCalledTimes(3);
  f.confirm.ask.mockResolvedValue(false);
  await expect(
    f.invoke("run", {
      actions: [{ type: "write", path: file, text: "refused" }],
    }),
  ).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { executionState: "completed" },
  });
  expect(await readFile(file, "utf8")).toBe("written after user approval");
}, 15_000);
it.each([false, undefined, "true", 1])(
  "requires Boolean true for summary authorization (%s)",
  async (answer) => {
    const f = await fixture(undefined, false, undefined, false);
    f.confirm.ask.mockResolvedValue(answer as boolean);
    expect(await f.approve()).toBe(false);
    await expect(f.invoke("start")).rejects.toMatchObject({
      code: "TIER_REQUIRED",
    });
    expect(await f.invoke("status")).toMatchObject({
      state: "stopped",
      trusted: false,
    });
  },
);
it("reuses trust after restart and normal update, but changes in engine permissions require trust again", async () => {
  const f = await fixture();
  await f.invoke("start");
  await f.host.close();
  await f.host.initialize();
  await f.invoke("start");
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  await f.update("1.1.0");
  expect(await f.invoke("status")).toMatchObject({
    state: "stopped",
    trusted: true,
  });
  await f.invoke("start");
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  await f.update("1.2.0", true);
  expect(await f.invoke("status")).toMatchObject({ trusted: false });
  await expect(f.invoke("start")).rejects.toMatchObject({
    code: "LOCAL_CONFIRM_REQUIRED",
  });
  await f.approve();
  await f.invoke("start");
  expect(f.confirm.ask).toHaveBeenCalledTimes(2);
}, 15_000);
it("new Agent, exported Agent and reinstall do not inherit trust", async () => {
  const f = await fixture();
  await f.invoke("start");
  const other = await f.host.createAgent("Same component", [f.item.digest]);
  await f.host.enable(other.instanceId, "engine-demo");
  expect(
    await f.host.engineStatus(other.instanceId, "engine-demo", "local"),
  ).toMatchObject({ trusted: false });
  const preview = (await f.host.preview(await f.host.exportAgent(f.id))) as {
    token: string;
  };
  const exported = await f.host.install(preview.token);
  expect(
    await f.host.engineStatus(exported.instanceId, "engine-demo", "local"),
  ).toMatchObject({ trusted: false });
  await f.host.uninstallPackage(f.id, "engine-demo");
  await f.host.addLibraryComponent(f.id, f.item.digest);
  await f.host.enable(f.id, "engine-demo");
  expect(await f.invoke("status")).toMatchObject({ trusted: false });
});
it("revocation during first confirmation cancels startup and cannot be undone by a late answer", async () => {
  const f = await fixture(undefined, false, undefined, false);
  let approve!: (v: boolean) => void;
  f.confirm.ask.mockImplementation(
    () =>
      new Promise((r) => {
        approve = r;
      }),
  );
  const start = f.approve();
  const rejection = expect(start).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await vi.waitFor(() => expect(f.confirm.ask).toHaveBeenCalledTimes(1));
  await f.host.revokeEngine(f.id, "engine-demo", "local");
  approve(true);
  await rejection;
  expect(await f.invoke("status")).toMatchObject({
    state: "stopped",
    trusted: false,
  });
});
it.each(["update", "delete"])(
  "%s while confirming does not launch stale code",
  async (operation) => {
    const f = await fixture(undefined, false, undefined, false);
    let approve!: (v: boolean) => void;
    f.confirm.ask.mockImplementation(
      () =>
        new Promise((r) => {
          approve = r;
        }),
    );
    const start = f.approve();
    const rejected = expect(start).resolves.toBe(false);
    await vi.waitFor(() => expect(f.confirm.ask).toHaveBeenCalledTimes(1));
    if (operation === "update") await f.update("1.1.0");
    else await f.host.removeAgent(f.id);
    approve(true);
    await rejected;
    if (operation === "update")
      expect(await f.invoke("status")).toMatchObject({
        state: "stopped",
        trusted: false,
      });
  },
);
it("does not launch when saving user trust fails or lifecycle auditing fails", async () => {
  const f = await fixture(undefined, false, undefined, false);
  vi.spyOn(
    InstallStore.prototype,
    "commitLocalAuthorization",
  ).mockImplementationOnce(() => {
    throw Error("private database error");
  });
  await expect(f.approve()).rejects.toBeDefined();
  expect(await f.invoke("status")).toMatchObject({
    trusted: false,
    state: "stopped",
  });
  f.host.options.audit = async () => {
    throw Error("private audit error");
  };
  await expect(f.approve()).rejects.toBeDefined();
  expect(await f.invoke("status")).toMatchObject({ state: "stopped" });
});
it("refuses corrupted installed engine files before launch", async () => {
  const f = await fixture();
  await writeFile(
    path.join(
      f.dir,
      "instances",
      f.id,
      "core",
      "packages",
      "engine-demo",
      "engine",
      "main.mjs",
    ),
    "throw Error('tampered')",
  );
  await expect(f.invoke("start")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await expect(f.invoke("status")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "stopped" },
  );
});
it("cancels a cooperative task and keeps the trusted engine usable", async () => {
  let entered!: () => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const f = await fixture(
    undefined,
    false,
    undefined,
    true,
    (_id, _pkg, topic, data) => {
      if (
        topic === "engine.event" &&
        (data as { topic?: string }).topic === "fixture.wait.started"
      )
        entered();
    },
  );
  await f.invoke("start");
  const task = f.invoke("run", {
    requestId: "cancellable",
    mode: "full",
    actions: [{ type: "wait", ms: 60_000 }],
  });
  const rejected = expect(task).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { executionState: "completed" },
  });
  await ready;
  await f.host.engineCall(f.id, "engine-demo", "cancel", {
    engineId: "local",
    requestId: "cancellable",
  });
  await rejected;
  expect(await f.invoke("status")).toMatchObject({ state: "running" });
});
it("enforces request and message limits; cancellation kills an unresponsive engine without replay", async () => {
  let entered!: () => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const f = await fixture(
    `let received=0;${simple.replace("else if(m.method==='echo')", "else if(m.method==='run'){console.log(JSON.stringify({jsonrpc:'2.0',method:'engine.event',params:{topic:'fixture.received',data:++received}}));}else if(m.method==='echo')")}`,
    false,
    undefined,
    true,
    (_id, _pkg, topic, data) => {
      const event = data as { topic?: string; data?: unknown };
      if (
        topic === "engine.event" &&
        event.topic === "fixture.received" &&
        event.data === 32
      )
        entered();
    },
  );
  await f.invoke("start");
  // The ordinary contribution still supplies the owning identity; run is unanswered by this fixture engine.
  const tasks = Array.from({ length: 32 }, (_, i) =>
    f.host.engineCall(f.id, "engine-demo", "request", {
      engineId: "local",
      method: "run",
      requestId: "pending-" + i,
      input: {},
    }),
  );
  const settled = Promise.allSettled(tasks);
  await ready;
  await expect(
    f.host.engineCall(f.id, "engine-demo", "request", {
      engineId: "local",
      method: "run",
      requestId: "overflow",
      input: {},
    }),
  ).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { executionState: "not_started" },
  });
  await f.host.engineCall(f.id, "engine-demo", "cancel", {
    engineId: "local",
    requestId: "pending-0",
  });
  await settled;
  expect(await f.invoke("status")).toMatchObject({
    state: "crashed",
    trusted: true,
  });
}, 15_000);
it.each([
  ["request count", 31, ""],
  ["callback byte budget", 8, "x".repeat(900_000)],
] as const)(
  "releases completed callbacks and enforces the shared %s limit",
  async (_name, count, payload) => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "plums-engine-callbacks-"),
    );
    dirs.push(dir);
    const entry = path.join(dir, "engine.mjs");
    await writeFile(
      entry,
      `
    import { createInterface } from 'node:readline';
    let owner, remaining;
    const send = m => console.log(JSON.stringify({jsonrpc: '2.0', ...m}));
    createInterface({input: process.stdin}).on('line', line => {
      const m = JSON.parse(line);
      if (m.method === 'initialize') send({id: m.id, result: {protocol: 'jsonrpc-jsonl-v1'}});
      else if (m.method === 'burst') {
        owner = m.id; remaining = m.params.count;
        for (let i = 0; i < remaining; i++) send({id: 'callback-' + i, method: 'host.confirm', params: {payload: m.params.payload}});
      } else if (--remaining === 0) send({id: owner, result: true});
    });
  `,
    );
    const releases: (() => void)[] = [];
    const hooks: EngineHooks = {
      prepare: async () => ({ entry, cwd: dir }),
      active: async () => {},
      event: () => {},
      audit: async () => {},
      callback: async (_method, _input, signal) =>
        new Promise((resolve) => {
          const abort = () => resolve(null);
          signal.addEventListener("abort", abort, { once: true });
          releases.push(() => {
            signal.removeEventListener("abort", abort);
            resolve(null);
          });
        }),
    };
    const manager = new EngineManager();
    try {
      await manager.start("callbacks", hooks);
      for (let attempt = 0; attempt < 2; attempt++) {
        const task = manager.request("callbacks", hooks, "burst", {
          count,
          payload,
        });
        void task.catch(() => {});
        await expect.poll(() => releases.length).toBe(count);
        for (const release of releases.splice(0)) release();
        await expect(task).resolves.toBe(true);
      }
      await expect(
        manager.request("callbacks", hooks, "burst", {
          count: count + 1,
          payload,
        }),
      ).rejects.toMatchObject({ code: "CAPABILITY_FAILED" });
      expect(manager.state("callbacks")).toBe("crashed");
    } finally {
      await manager.stop("callbacks", hooks);
    }
  },
);

it("times out a silent handshake without leaving an engine running", async () => {
  const f = await fixture("process.stdin.resume();setInterval(()=>{},1000)");
  await expect(f.invoke("start")).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { reason: "ENGINE_HANDSHAKE_TIMEOUT" },
  });
  expect(await f.invoke("status")).toMatchObject({ state: "crashed" });
}, 40_000);
it("supervisor cleans the engine and inherited descendants when its broker is killed", async () => {
  if (process.platform === "win32") return;
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-supervisor-"));
  dirs.push(dir);
  const entry = path.join(dir, "engine.mjs"),
    bootstrap = path.join(dir, "broker.mjs");
  await writeFile(
    entry,
    `import{spawn}from'node:child_process';import{createInterface}from'node:readline';const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"]);process.on('SIGTERM',()=>{});createInterface({input:process.stdin}).on('line',l=>{let m=JSON.parse(l);console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocol:'jsonrpc-jsonl-v1'}:{pid:process.pid,child:child.pid}}));});`,
  );
  await writeFile(
    bootstrap,
    `import{EngineManager}from ${JSON.stringify(pathToFileURL(path.resolve("packages/host/dist/engine-manager.js")).href)};const m=new EngineManager();const h={prepare:async()=>({entry:${JSON.stringify(entry)},cwd:${JSON.stringify(dir)}}),active:async()=>{},callback:async()=>{},event:()=>{},audit:async()=>{}};await m.start('test',h);process.send(await m.request('test',h,'pids',{}));`,
  );
  const broker = fork(bootstrap, [], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    const pids = await new Promise<{ pid: number; child: number }>(
      (resolve, reject) => {
        broker.once("message", resolve);
        broker.once("exit", () => reject(Error("broker exited")));
      },
    );
    broker.kill("SIGKILL");
    await vi.waitFor(
      () => {
        for (const pid of [pids.pid, pids.child])
          expect(() => process.kill(pid, 0)).toThrow();
      },
      { timeout: 6000, interval: 50 },
    );
  } finally {
    broker.kill("SIGKILL");
  }
}, 15_000);
it("rejects invalid replies and oversized messages from actual child processes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-engine-limits-"));
  dirs.push(dir);
  const entry = path.join(dir, "entry.mjs");
  await writeFile(
    entry,
    simple.replace(
      "else if(m.method==='echo')send(m.id,m.params);",
      "else console.log('x'.repeat(1024*1024+1));",
    ),
  );
  const manager = new EngineManager(),
    hooks = {
      prepare: async () => ({ entry, cwd: dir }),
      active: async () => {},
      callback: async () => null,
      event: () => {},
      audit: async () => {},
    };
  try {
    await manager.start("limits", hooks);
    await expect(
      manager.request("limits", hooks, "oversize", {}),
    ).rejects.toMatchObject({ details: { executionState: "unknown" } });
    expect(manager.state("limits")).toBe("crashed");
  } finally {
    await manager.stop("limits", hooks);
  }
});
it("autonomously chooses an optional external connector through the controlled dependency bridge", async () => {
  const f = await fixture();
  const manifest = connectorManifest();
  const files = { "runtime/main.js": Buffer.from(connectorRuntime) };
  const builder = createCore({
    dataDir: path.join(f.dir, "connector-builder"),
    secrets: new MemorySecretStore(),
    egress: f.egress,
  });
  const bytes = await builder.exportPackage({ manifest, files });
  builder.close();
  const p = (await f.host.preview(bytes)) as { token: string };
  const item = await f.host.importLibrary(p.token);
  await f.host.addLibraryComponent(f.id, item.digest);
  await f.host.setSettings(
    f.id,
    "model",
    {
      protocol: "OpenAI Chat Completions",
      model: "external-fixture-model",
      endpoint: "https://external-model.example/custom",
    },
    { apiKey: "fixture-bridge-key" },
  );
  await f.host.enable(f.id, "model");
  await f.host.enable(f.id, "engine-demo");
  vi.spyOn(f.egress, "send").mockImplementation(async (req) => {
    f.egress.records.push(req);
    return {
      status: 200,
      body: JSON.stringify({
        choices: [
          { message: { role: "assistant", content: "external response" } },
        ],
      }),
    };
  });
  await f.invoke("start");
  expect(
    await f.invoke("run", {
      mode: "full",
      actions: [{ type: "connector", text: "fixture prompt" }],
    }),
  ).toMatchObject({
    results: [{ choices: [{ message: { content: "external response" } }] }],
  });
  expect(f.egress.records).toHaveLength(1);
  expect(f.egress.records[0]?.headers?.Authorization).toBe(
    "Bearer fixture-bridge-key",
  );
  await f.host.disable(f.id, "model");
  await expect(
    f.host.engineCall(f.id, "engine-demo", "request", {
      engineId: "local",
      method: "run",
      input: { actions: [] },
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
}, 15_000);
it("completes cleanup despite audit failure and permits a later explicit restart", async () => {
  const f = await fixture();
  await f.invoke("start");
  f.host.options.audit = async (_id, event) => {
    if (event.reason === "ENGINE_STOP")
      throw Error("unavailable audit storage");
  };
  await expect(
    f.host.stopEngine(f.id, "engine-demo", "local"),
  ).rejects.toBeDefined();
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "stopped", trusted: true },
  );
  f.host.options.audit = undefined;
  await f.host.startEngine(f.id, "engine-demo", "local");
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});
it("redacts known credentials before sandbox code and confirmation receive engine data", async () => {
  const f = await fixture(undefined, true);
  await f.host.setSettings(
    f.id,
    "engine-demo",
    {},
    { key: "credential-fixture-value" },
  );
  const file = path.join(f.dir, "credential-fixture-value.txt");
  await writeFile(file, "credential-fixture-value");
  await f.invoke("start");
  expect(await f.invoke("probe", { path: file })).toEqual({ exposed: false });
  await f.invoke("run", { actions: [{ type: "read", path: file }] });
  expect(JSON.stringify(f.confirm.ask.mock.calls)).not.toContain(
    "credential-fixture-value",
  );
});
it("allows an explicitly trusted engine to operate across independent projects", async () => {
  const f = await fixture();
  const projects = await Promise.all(
    ["first", "second"].map(async (name) => {
      const directory = path.join(f.dir, name);
      await mkdir(directory);
      const file = path.join(directory, "project.txt");
      await writeFile(file, name);
      return file;
    }),
  );
  await f.invoke("start");
  expect(
    await f.invoke("run", {
      mode: "full",
      actions: projects.map((p) => ({ type: "read", path: p })),
    }),
  ).toEqual({ results: ["first", "second"] });
  expect(f.fs.records).toHaveLength(0);
});
it("rejects expired first trust and cannot revive it with a late answer", async () => {
  const f = await fixture(undefined, false, undefined, false);
  const deadline = new AbortController();
  const nativeTimeout = AbortSignal.timeout;
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
    ms === 120_000 ? deadline.signal : nativeTimeout(ms),
  );
  let answer!: (value: boolean) => void;
  f.confirm.ask.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const start = f.approve();
  await vi.waitFor(() => expect(f.confirm.ask).toHaveBeenCalledTimes(1));
  deadline.abort();
  await expect(start).resolves.toBe(false);
  answer(true);
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "stopped", trusted: false },
  );
  expect(JSON.stringify(await f.host.audit(f.id))).not.toContain(
    "ENGINE_START",
  );
});
