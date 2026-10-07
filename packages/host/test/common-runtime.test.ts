import { useSourceOfficialFixture } from "./official-fixture.js";
import { fixture as commonFixture } from "./common-fixture.js";
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { type ManifestV2 } from "@plums/core";
import { DesktopHost } from "../src/host.js";
const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const standalone = path.resolve(
  ".artifacts/node-v26.5.1-darwin-arm64/bin/node",
);
async function fixture(...args: Parameters<typeof commonFixture>) {
  const f = await commonFixture(...args);
  hosts.push(f.host);
  dirs.push(f.dir);
  return f;
}
it("independent frontend and isolate consumers use a fixed common binding and ordered terminal envelopes", async () => {
  const f = await fixture(),
    binding = await f.sdk.binding("backend");
  expect(binding?.provider.agentId).toBe(f.a.instanceId);
  expect(binding?.evidence).toBe("declared");
  const input = { value: "before" },
    start = f.sdk.invoke(binding!.handle, "echo", input);
  input.value = "after";
  const call = await start;
  expect(await call.result).toMatchObject({
    kind: "result",
    sequence: 1,
    executionState: "completed",
    outcome: { ok: true, value: { value: { value: "before" } } },
  });
  const isolated = await f.host.invoke(
    f.a.instanceId,
    "consumer",
    "consumer",
    "commands",
    "run",
    { fixture: true },
  );
  expect(isolated).toMatchObject({
    kind: "result",
    outcome: { ok: true, value: { value: { fixture: true } } },
  });
  expect(JSON.stringify(f.audit)).not.toContain("before");
  expect(JSON.stringify(f.audit)).not.toContain(f.dir);
});
it("common event order, replay and retention are bounded without re-executing the provider", async () => {
  const f = await fixture(),
    b = await f.sdk.binding("backend"),
    call = await f.sdk.invoke(b!.handle, "events", { count: 3 }),
    events = [];
  for await (const e of call.events) events.push(e);
  expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  expect((await call.result).sequence).toBe(4);
  const attached = await f.sdk.attach(call.taskId, 0),
    replayed = [];
  for await (const e of attached.events) replayed.push(e);
  expect(replayed).toEqual(events);
  expect(await attached.result).toEqual(await call.result);
  await expect(
    f.call("invoke", {
      binding: b!.handle,
      operation: "echo",
      input: null,
      options: { taskId: call.taskId },
    }),
  ).rejects.toMatchObject({ details: { reason: "STALE_BINDING" } });
});
it("cancellation waits for the actual fixed Node and supervisor; unknown work is never replayed", async () => {
  const f = await fixture("controlled-node"),
    b = await f.sdk.binding("backend"),
    call = await f.sdk.invoke(b!.handle, "hang", null);
  while (
    (await f.sdk.tasks.status(call.taskId)).status.executionState ===
    "not_started"
  )
    await new Promise((r) => setTimeout(r, 20));
  await call.cancel();
  expect(await call.result).toMatchObject({
    executionState: "unknown",
    outcome: { ok: false, error: { code: "CANCELLED" } },
  });
  expect((await f.sdk.tasks.status(call.taskId)).status.state).toBe("stopped");
}, 20000);
it("background requires management opt-in, survives frontend close, and can be attached only by its current owner", async () => {
  const f = await fixture("controlled-node");
  await expect(f.sdk.tasks.create({ lifetime: "agent" })).rejects.toMatchObject(
    { details: { reason: "NOT_AUTHORIZED" } },
  );
  await f.host.setComponentBackground(f.a.instanceId, "consumer", true);
  const front = await f.host.openFrontend(f.a.instanceId);
  if (!front) throw Error();
  const rpc = (m: string, a: Record<string, unknown>) =>
    f.host.frontendCommon(front.context.sessionId, front.context.handle, m, a);
  const task = (await rpc("create", { options: { lifetime: "agent" } })) as {
      taskId: string;
    },
    binding = (await rpc("binding", { requirementId: "backend" })) as {
      handle: string;
    };
  const call = (await rpc("invoke", {
    binding: binding.handle,
    operation: "hang",
    input: null,
    options: { taskId: task.taskId },
  })) as { taskId: string };
  f.host.closeFrontend(front.context.sessionId);
  await expect
    .poll(
      async () =>
        (await f.host.commonTasks(f.a.instanceId)).find(
          (t) => t.description.taskId === call.taskId,
        )?.snapshot.status.state,
      { timeout: 8000 },
    )
    .toBe("running");
  const other = await f.host.openFrontend(f.b.instanceId);
  if (!other) throw Error();
  await expect(
    f.host.frontendCommon(
      other.context.sessionId,
      other.context.handle,
      "status",
      { taskId: task.taskId },
    ),
  ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
  await f.host.stopCommonTask(f.a.instanceId, task.taskId);
  expect(
    (await f.host.commonTasks(f.a.instanceId)).find(
      (t) => t.description.taskId === task.taskId,
    )?.snapshot.status.state,
  ).toBe("stopped");
}, 20000);
it("real controlled Node cannot directly read external data, network, spawn or forge privileged identity", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "plums-outside-"));
  dirs.push(outside);
  await writeFile(path.join(outside, "data"), "fixture");
  const f = await fixture(
    "controlled-node",
    `import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';export function activate(s){s.register('tools','test',async()=>{let read=false;try{fs.readFileSync(${JSON.stringify(path.join(outside, "data"))});read=true;}catch{}const spawn=!!cp.spawnSync('/bin/echo').error;const network=await new Promise(r=>{const socket=net.connect(1,'127.0.0.1');socket.once('error',()=>r(false));socket.once('connect',()=>{socket.destroy();r(true);});});const c=await s.context();return {read,spawn,network,componentId:c.componentId};});}`,
  );
  const b = await f.sdk.binding("backend"),
    call = await f.sdk.invoke(b!.handle, "probe", {
      actor: { agentId: f.b.instanceId },
      mode: "full-access",
    });
  expect(await call.result).toMatchObject({
    outcome: {
      ok: true,
      value: {
        read: false,
        spawn: true,
        network: false,
        componentId: "provider",
      },
    },
  });
  expect(await readFile(path.join(outside, "data"), "utf8")).toBe("fixture");
}, 20000);
it("real command route executes a fixed host program with explicit read/write roots and no shell", async () => {
  const permission: ManifestV2["permissions"] = [
    {
      id: "run",
      kind: "exec",
      target: "echo",
      cwdRoots: ["work"],
      reason: "Fixture command",
    },
    {
      id: "read",
      kind: "fs",
      target: "work",
      operations: ["read"],
      reason: "Read fixture",
    },
  ];
  const f = await fixture(
    "controlled-node",
    `export function activate(s){s.register('tools','test',v=>s.capability('run',{kind:'exec',args:v.input.args,cwd:{root:'work',path:'.'}}));}`,
    permission,
  );
  const work = await mkdtemp(path.join(os.tmpdir(), "plums-command-"));
  dirs.push(work);
  await mkdir(path.join(work, "nested"));
  await f.host.bindRoot(f.a.instanceId, "work", work);
  await f.host.bindControlledProgram(
    f.a.instanceId,
    "echo",
    "/bin/echo",
    ["work"],
    [],
  );
  const frontend = await f.host.openFrontend(f.a.instanceId);
  if (!frontend) throw Error();
  const rpc = (m: string, a: Record<string, unknown>) =>
    f.host.frontendCommon(
      frontend.context.sessionId,
      frontend.context.handle,
      m,
      a,
    );
  const b = (await rpc("binding", { requirementId: "backend" })) as {
    handle: string;
  };
  const info = (await rpc("invoke", {
    binding: b.handle,
    operation: "exec",
    input: { args: ["literal $(echo escaped)"] },
  })) as { taskId: string };
  let status: any;
  do {
    await new Promise((r) => setTimeout(r, 20));
    status = await rpc("status", { taskId: info.taskId });
  } while (!status.result);
  expect(status.result).toMatchObject({
    executionState: "completed",
    outcome: {
      ok: true,
      value: {
        kind: "exec",
        result: { exitCode: 0, stdout: "literal $(echo escaped)\n" },
      },
    },
  });
}, 20000);
it("denies stale frontend handles, invalid JSON, and author attempts to choose task ownership", async () => {
  const f = await fixture(),
    b = await f.sdk.binding("backend");
  await expect(
    f.call("invoke", {
      binding: b!.handle,
      operation: "echo",
      input: { a: undefined },
    }),
  ).rejects.toMatchObject({ code: "CAPABILITY_FAILED" });
  await expect(
    f.call("create", {
      options: { lifetime: "foreign", owner: { agentId: f.b.instanceId } },
    }),
  ).rejects.toMatchObject({ details: { reason: "INVALID_REQUEST" } });
  f.host.closeFrontend(f.frontend.context.sessionId);
  const newFront = await f.host.openFrontend(f.a.instanceId);
  if (!newFront) throw Error();
  await expect(
    f.host.frontendCommon(
      newFront.context.sessionId,
      newFront.context.handle,
      "invoke",
      { binding: b!.handle, operation: "echo", input: null },
    ),
  ).rejects.toMatchObject({ details: { reason: "STALE_BINDING" } });
});
it("the owner deadline cancels actual program work, retains a terminal, and does not grant background I/O", async () => {
  const f = await fixture("controlled-node"),
    b = await f.sdk.binding("backend"),
    call = await f.sdk.invoke(b!.handle, "hang", null, { timeoutMs: 250 });
  expect(await call.result).toMatchObject({
    outcome: { ok: false, error: { code: "DEADLINE_EXCEEDED" } },
  });
  expect((await f.sdk.tasks.status(call.taskId)).status.state).toBe("stopped");
}, 10000);
it("host restart after a real broker crash preserves unknown metadata without body, events or restored execution", async () => {
  const { fork } = await import("node:child_process");
  const { readdir } = await import("node:fs/promises");
  const f = await fixture("controlled-node");
  await f.host.close();
  const child = fork(
    "packages/host/test/common-task-crash-child.mjs",
    [f.dir, standalone, f.a.instanceId],
    {
      execPath: standalone,
      execArgv: [],
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const taskId = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("No task ready")), 8000);
    child.once("message", (m: any) => {
      clearTimeout(timer);
      resolve(m.taskId);
    });
    child.once("error", reject);
  });
  child.send("crash");
  await new Promise((r) => child.once("exit", r));
  const host = new DesktopHost(f.options);
  hosts.push(host);
  await host.initialize();
  const tasks = await host.commonTasks(f.a.instanceId);
  expect(
    tasks.find((t) => t.description.taskId === taskId)?.snapshot,
  ).toMatchObject({ status: { state: "crashed", executionState: "unknown" } });
  expect(
    tasks.find((t) => t.description.taskId === taskId)?.snapshot.result,
  ).toBeUndefined();
  const metadata = (
    await Promise.all(
      (await readdir(path.join(f.dir, "common-tasks"))).map((file) =>
        readFile(path.join(f.dir, "common-tasks", file), "utf8"),
      ),
    )
  ).join("");
  expect(metadata).not.toContain("body-not-in-metadata");
  const frontend = await host.openFrontend(f.a.instanceId);
  if (!frontend) throw Error();
  await expect(
    host.frontendCommon(
      frontend.context.sessionId,
      frontend.context.handle,
      "poll",
      { taskId, afterSequence: -1 },
    ),
  ).rejects.toMatchObject({ details: { reason: "REPLAY_GAP" } });
}, 15000);
it("controlled Node uses the existing resource CAS service and cannot expand a read-only maximum", async () => {
  const { resourceFixture } = await import("./resource-fixture.js");
  const f = await resourceFixture({ nodePath: standalone }, "controlled-node");
  hosts.push(f.host);
  dirs.push(f.dir);
  const initial = (await f.invoke(f.a, {
    op: "write",
    resourceId: f.shared,
    key: "record",
    expectedRevision: "0",
    value: { fixture: 1 },
  })) as { revision: string };
  await f.host.grantResourceRange(
    f.a,
    (await f.host.resourcePlan(f.a)).fingerprint,
    "task",
    900000,
    [
      {
        componentId: "records-provider",
        resourceId: f.shared,
        operations: ["read"],
      },
    ],
  );
  expect(
    await f.invoke(f.a, { op: "read", resourceId: f.shared, key: "record" }),
  ).toMatchObject({
    exists: true,
    revision: initial.revision,
    value: { fixture: 1 },
  });
  await expect(
    f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "record",
      expectedRevision: initial.revision,
      value: { fixture: 2 },
    }),
  ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
});
it("only a trusted compatible takeover permits another component to see the task; grants are revocable", async () => {
  const f = await fixture(),
    b = await f.sdk.binding("backend"),
    call = await f.sdk.invoke(b!.handle, "echo", { private: "fixture" });
  await call.result;
  const status = () =>
    f.host.invoke(f.a.instanceId, "viewer", "viewer", "commands", "run", {
      taskId: call.taskId,
    });
  await expect(status()).rejects.toMatchObject({
    details: { reason: "NOT_AUTHORIZED" },
  });
  await f.host.permitTaskTakeover(f.a.instanceId, call.taskId, "viewer", true);
  expect(await status()).toMatchObject({
    status: { state: "completed" },
    result: { outcome: { ok: true } },
  });
  await f.host.permitTaskTakeover(f.a.instanceId, call.taskId, "viewer", false);
  await expect(status()).rejects.toMatchObject({
    details: { reason: "NOT_AUTHORIZED" },
  });
});

it("allow-audit failure never dispatches, while result-audit failure reports completed without rejected content", async () => {
  const f = await fixture(),
    b = await f.sdk.binding("backend");
  f.options.audit = async (_id, e) => {
    if (e.phase === "allow") throw Error("private audit value");
  };
  const first = await f.sdk.invoke(b!.handle, "echo", { rejected: "body" });
  expect(await first.result).toMatchObject({
    executionState: "not_started",
    outcome: { ok: false, error: { code: "PROVIDER_FAILED" } },
  });
  f.options.audit = async (_id, e) => {
    if (e.phase === "result" && e.outcome === "completed")
      throw Error("private audit value");
  };
  const second = await f.sdk.invoke(b!.handle, "echo", { rejected: "body" });
  expect(await second.result).toMatchObject({
    executionState: "completed",
    outcome: { ok: false, error: { code: "PROVIDER_FAILED" } },
  });
  expect(JSON.stringify(await second.result)).not.toContain("body");
});
it("cross-process disable and re-enable during an audit wait cannot revive an old common edge", async () => {
  const { createCore, MemorySecretStore, RecordingEgressSink } = await import(
    "@plums/core"
  );
  const f = await fixture(),
    b = await f.sdk.binding("backend");
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  f.options.audit = async (_id, e) => {
    if (e.phase === "allow") {
      entered();
      await gate;
    }
  };
  const call = await f.sdk.invoke(b!.handle, "echo", null);
  await reached;
  const core = createCore({
    dataDir: path.join(f.dir, "instances", f.a.instanceId, "core"),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
    confirm: { ask: async () => true },
  });
  try {
    await core.disable("provider");
    await core.enable("provider");
  } finally {
    core.close();
  }
  release();
  await expect(f.sdk.tasks.status(call.taskId)).rejects.toBeDefined();
  await expect(call.result).rejects.toBeDefined();
  expect(
    (await f.host.commonTasks(f.a.instanceId)).find(
      (t) => t.description.taskId === call.taskId,
    )?.snapshot.status.executionState,
  ).toBe("not_started");
});
it("replacement of a trusted command directory before submission is refused", async () => {
  const { rename } = await import("node:fs/promises");
  const permissions: ManifestV2["permissions"] = [
    {
      id: "run",
      kind: "exec",
      target: "echo",
      cwdRoots: ["work"],
      reason: "Fixture",
    },
    {
      id: "read",
      kind: "fs",
      target: "work",
      operations: ["read"],
      reason: "Fixture",
    },
  ];
  const f = await fixture(
    "controlled-node",
    `export function activate(s){s.register('tools','test',()=>s.capability('run',{kind:'exec',args:['fixture'],cwd:{root:'work',path:'.'}}));}`,
    permissions,
  );
  const outer = await mkdtemp(path.join(os.tmpdir(), "plums-replaced-root-"));
  dirs.push(outer);
  const work = path.join(outer, "work");
  await mkdir(work);
  await f.host.bindRoot(f.a.instanceId, "work", work);
  await f.host.bindControlledProgram(
    f.a.instanceId,
    "echo",
    "/bin/echo",
    ["work"],
    [],
  );
  await rename(work, path.join(outer, "old"));
  await mkdir(work);
  const front = await f.host.openFrontend(f.a.instanceId);
  if (!front) throw Error();
  const rpc = (m: string, a: Record<string, unknown>) =>
    f.host.frontendCommon(front.context.sessionId, front.context.handle, m, a);
  const b = (await rpc("binding", { requirementId: "backend" })) as {
    handle: string;
  };
  const call = (await rpc("invoke", {
    binding: b.handle,
    operation: "exec",
    input: null,
  })) as { taskId: string };
  await expect
    .poll(
      async () =>
        ((await rpc("status", { taskId: call.taskId })) as any).result,
      // Wait for asynchronous preparation to publish the refusal. The security
      // assertion below still requires the command never to succeed.
      { timeout: 5_000 },
    )
    .toBeDefined();
  expect(
    ((await rpc("status", { taskId: call.taskId })) as any).result.outcome.ok,
  ).toBe(false);
}, 20000);

it("an author cannot bypass the RSS limit by forging process memory reports", async () => {
  const f = await fixture(
      "controlled-node",
      `const allocations=[];export function activate(s){s.register('tools','test',()=>{process.memoryUsage=()=>({rss:0});allocations.push(Buffer.alloc(300*1024*1024,1));return {pid:process.pid};});}`,
    ),
    b = await f.sdk.binding("backend");
  const call = await f.sdk.invoke(b!.handle, "allocate", null),
    result = await call.result;
  if (result.outcome.ok) {
    const pid = (result.outcome.value as { pid: number }).pid;
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 6000 },
      )
      .toBe(false);
  } else expect(result.executionState).toBe("unknown");
}, 15000);
it("pending controlled preparation excludes a legacy engine and revocation prevents author startup", async () => {
  const { vi } = await import("vitest"),
    { ControlledExecution } = await import("../src/controlled-execution.js"),
    { createArchive } = await import("@plums/core"),
    { access } = await import("node:fs/promises");
  const f = await fixture("controlled-node");
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    id: "legacy",
    kind: "extension",
    name: "Legacy internal fixture",
    version: "1.0.0",
    description: "Internal platform fixture",
    dependencies: [],
    permissions: [
      {
        id: "local",
        kind: "engine",
        target: "local",
        reason: "Fixture ordinary permission",
      },
    ],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        engines: [
          {
            id: "local",
            title: "Local fixture",
            entry: "engine.js",
            runtime: "node",
            platforms: ["darwin-arm64"],
            protocol: "jsonrpc-jsonl-v1",
          },
        ],
      },
    },
  };
  const preview = (await f.host.preview(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "engine.js": Buffer.from(
        `import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocol:'jsonrpc-jsonl-v1'}}));});`,
      ),
    }),
  )) as { token: string };
  await f.host.addLibraryComponent(
    f.a.instanceId,
    (await f.host.importLibrary(preview.token)).digest,
  );
  await f.host.enable(f.a.instanceId, "legacy");
  let reached!: () => void,
    release!: () => void,
    snapshot = "",
    observed = false;
  const ready = new Promise<void>((r) => (reached = r)),
    gate = new Promise<void>((r) => (release = r)),
    spy = vi.fn();
  await useSourceOfficialFixture(f.host, (controlled, componentId) => {
    if (componentId !== "provider" || observed) return;
    observed = true;
    const prepare = controlled.prepare.bind(controlled);
    controlled.prepare = async (files) => {
      spy();
      const p = await prepare(files);
      snapshot = p.snapshot;
      reached();
      await gate;
      return p;
    };
  });
  try {
    const pending = f.host.invoke(
      f.a.instanceId,
      "provider",
      "provider",
      "tools",
      "test",
      { operation: "echo", input: null },
    );
    void pending.catch(() => {});
    await ready;
    await expect(
      f.host.startEngine(f.a.instanceId, "legacy", "local"),
    ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
    const stopping = f.host.revokeTaskScope(f.a.instanceId);
    release();
    await stopping;
    await expect(pending).rejects.toBeDefined();
    await expect(access(snapshot)).rejects.toBeDefined();
    await f.host.startEngine(f.a.instanceId, "legacy", "local");
    const front = await f.host.openFrontend(f.a.instanceId);
    if (!front) throw Error();
    await expect(
      f.host.frontendCommon(
        front.context.sessionId,
        front.context.handle,
        "create",
        { options: { lifetime: "frontend" } },
      ),
    ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
    await f.host.stopEngine(f.a.instanceId, "legacy", "local");
  } finally {
    release();
    spy.mockRestore();
  }
}, 20000);
it("post-launch authorization exceptions wait for the actual process and snapshot cleanup", async () => {
  const { vi } = await import("vitest"),
    { ControlledExecution } = await import("../src/controlled-execution.js"),
    { createCore, MemorySecretStore, RecordingEgressSink } = await import(
      "@plums/core"
    ),
    f = await fixture("controlled-node"),
    binding = await f.sdk.binding("backend"),
    original = ControlledExecution.prototype.launchNode;
  let processHandle: Awaited<ReturnType<typeof original>> | undefined,
    cleaned = false,
    observed = false;
  const spy = vi.fn();
  await useSourceOfficialFixture(f.host, (controlled, componentId) => {
    if (componentId !== "provider" || observed) return;
    observed = true;
    const launch = controlled.launchNode.bind(controlled);
    controlled.launchNode = async (...args) => {
      spy();
      const p = await launch(...args);
      processHandle = p;
      void p.cleaned?.then(() => {
        cleaned = true;
      });
      const core = createCore({
        dataDir: path.join(f.dir, "instances", f.a.instanceId, "core"),
        secrets: new MemorySecretStore(),
        egress: new RecordingEgressSink(),
        confirm: { ask: async () => true },
      });
      try {
        await core.disable("provider");
      } finally {
        core.close();
      }
      return p;
    };
  });
  try {
    const call = await f.sdk.invoke(binding!.handle, "echo", null);
    await expect(call.result).rejects.toBeDefined();
    await expect
      .poll(async () =>
        ["stopped", "crashed"].includes(
          (await f.host.commonTasks(f.a.instanceId)).find(
            (t) => t.description.taskId === call.taskId,
          )?.snapshot.status.state ?? "",
        ),
      )
      .toBe(true);
    expect(cleaned).toBe(true);
    expect(processHandle?.pid).toBeDefined();
    if (processHandle?.pid)
      expect(() => process.kill(processHandle!.pid!, 0)).toThrow();
    expect(
      (await f.host.commonTasks(f.a.instanceId)).find(
        (t) => t.description.taskId === call.taskId,
      )?.snapshot.status.executionState,
    ).toBe("not_started");
  } finally {
    spy.mockRestore();
  }
}, 15000);
it("two Agents run the same controlled artifact concurrently and stopping one preserves the other", async () => {
  const { createCommonPlatformSdk } = await import("@plums/sdk");
  const f = await fixture(
    "controlled-node",
    `export function activate(s){s.register('tools','test',async()=>{await s.emit('ready',{pid:process.pid});await new Promise(()=>{});});}`,
  );
  const front = await f.host.openFrontend(f.b.instanceId);
  if (!front) throw Error();
  const peer = createCommonPlatformSdk(
    (m, a) =>
      f.host.frontendCommon(
        front.context.sessionId,
        front.context.handle,
        m,
        a,
      ),
    f.sdk.resources,
  );
  const [a, b] = await Promise.all([
    f.sdk.binding("backend"),
    peer.binding("backend"),
  ]);
  expect(a!.provider.artifactDigest).toBe(b!.provider.artifactDigest);
  const [first, second] = await Promise.all([
    f.sdk.invoke(a!.handle, "hang", null),
    peer.invoke(b!.handle, "hang", null),
  ]);
  const [ae, be] = await Promise.all([
    first.events[Symbol.asyncIterator]().next(),
    second.events[Symbol.asyncIterator]().next(),
  ]);
  const ap = (ae.value.data as { pid: number }).pid,
    bp = (be.value.data as { pid: number }).pid;
  expect(ap).not.toBe(bp);
  await first.cancel();
  expect((await first.result).executionState).toBe("unknown");
  expect(() => process.kill(ap, 0)).toThrow();
  expect(() => process.kill(bp, 0)).not.toThrow();
  expect((await peer.tasks.status(second.taskId)).status.state).toBe("running");
  await second.cancel();
  await second.result;
  expect(() => process.kill(bp, 0)).toThrow();
}, 20000);
it("controlled Node file work uses the actual host file adapter and complete consumer permissions", async () => {
  const permission: ManifestV2["permissions"] = [
    {
      id: "files",
      kind: "fs",
      target: "work",
      operations: ["read", "write"],
      reason: "Fixture files",
    },
  ];
  const f = await fixture(
    "controlled-node",
    `export function activate(s){s.register('tools','test',async()=>{await s.capability('files',{kind:'fs',operation:'write',path:'record',data:[70,105,120,116,117,114,101]});return s.capability('files',{kind:'fs',operation:'read',path:'record'});});}`,
    permission,
  );
  const work = await mkdtemp(
    path.join(os.tmpdir(), "plums-node-bridge-files-"),
  );
  dirs.push(work);
  await f.host.bindRoot(f.a.instanceId, "work", work);
  const front = await f.host.openFrontend(f.a.instanceId);
  if (!front) throw Error();
  const { createCommonPlatformSdk } = await import("@plums/sdk"),
    sdk = createCommonPlatformSdk(
      (m, a) =>
        f.host.frontendCommon(
          front.context.sessionId,
          front.context.handle,
          m,
          a,
        ),
      f.sdk.resources,
    ),
    b = await sdk.binding("backend"),
    call = await sdk.invoke(b!.handle, "files", null);
  expect(await call.result).toMatchObject({
    executionState: "completed",
    outcome: {
      ok: true,
      value: {
        kind: "fs",
        operation: "read",
        data: [70, 105, 120, 116, 117, 114, 101],
      },
    },
  });
  expect(await readFile(path.join(work, "record"), "utf8")).toBe("Fixture");
}, 20000);
