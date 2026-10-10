import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  type AuditEvent,
  type ManifestV2,
} from "@plumsjs/core";
import { DesktopHost, type HostOptions } from "../src/host.js";
import { engineManifest } from "./platform-fixtures.js";
import { addPolicy, select } from "./policy-fixture.js";

const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const fsPermission = {
  id: "data",
  kind: "fs" as const,
  target: "agent-data",
  operations: ["write" as const],
  reason: "Fixture write",
};
const native = `import{createInterface}from'node:readline';import{writeFile}from'node:fs/promises';
let next=0,previous,last;const tasks=new Map,callbacks=new Map;const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));
createInterface({input:process.stdin}).on('line',async line=>{const m=JSON.parse(line);
if(m.method==='initialize'){send({id:m.id,result:{protocol:'jsonrpc-jsonl-v1'}});return;}
if(m.method==='$/cancelRequest'){if(tasks.get(m.params.id)==='ignore')return;tasks.delete(m.params.id);send({id:m.params.id,result:{cancelled:true}});return;}
if(callbacks.has(m.id)){const task=callbacks.get(m.id);callbacks.delete(m.id);last=m.error?m.error.data:m.result;if(task)send({id:task,result:m.error?{refused:m.error.data}:m.result});return;}
if(m.method==='write'){await writeFile(m.params.path,m.params.text);send({id:m.id,result:'written'});return;}
if(m.method==='wait'){previous=m.id;tasks.set(m.id,true);return;}
if(m.method==='ignore'){tasks.set(m.id,'ignore');send({method:'engine.event',params:{topic:'fixture.ignore.started',data:null}});return;}
if(m.method==='remember'){previous=m.id;send({id:m.id,result:true});return;}
if(m.method==='seen'){send({id:m.id,result:last??null});return;}
if(m.method==='callback'||m.method==='stale'||m.method==='unbound'){
const id='cb-'+(++next);callbacks.set(id,m.id);send({id,method:'host.invoke',...(m.method==='unbound'?{}:{parentRequestId:m.method==='stale'?previous:m.id}),params:{packageId:'store',kind:'commands',name:'write',input:m.params,callerIds:[],ancestry:['engine-demo']}});return;}
send({id:m.id,result:m.params});});`;
async function fixture(
  options: { callerFs?: boolean; approved?: boolean; policy?: string } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-local-invocation-"));
  dirs.push(dir);
  const confirm = { ask: vi.fn(async () => true) },
    fs = new RecordingFsSink(),
    audit: Readonly<AuditEvent>[] = [],
    events: { topic: string; data: unknown }[] = [];
  let auditHook: (e: Readonly<AuditEvent>) => Promise<void> = async () => {};
  const stores = new Map<string, MemorySecretStore>();
  let ignored!: () => void;
  const ignoreStarted = new Promise<void>((r) => {
    ignored = r;
  });
  const hostOptions: HostOptions = {
    event: (_id, _pkg, topic, data) => {
      events.push({ topic, data });
      if (
        topic === "engine.event" &&
        (data as { topic?: string }).topic === "fixture.ignore.started"
      )
        ignored();
    },
    dataDir: dir,
    confirm,
    fs,
    egress: new RecordingEgressSink(),
    secretStore: (id) => {
      if (!stores.has(id)) stores.set(id, new MemorySecretStore());
      return stores.get(id)!;
    },
    audit: async (_id, e) => {
      audit.push(e);
      await auditHook(e);
    },
  };
  const host = new DesktopHost(hostOptions);
  hosts.push(host);
  await host.initialize();
  const engine = engineManifest() as ManifestV2;
  engine.dependencies = [{ id: "store", kind: "extension", range: "^1.0.0" }];
  engine.permissions = [engine.permissions[0]!, fsPermission];
  const contribution = engine.payload as {
    plumsDesktop: Record<string, unknown>;
  };
  contribution.plumsDesktop.protocols = {
    provides: [
      {
        id: "local",
        protocol: "org.example.local-tool",
        version: "1.0.0",
        contribution: { kind: "commands", name: "run" },
      },
    ],
  };
  const caller: ManifestV2 = {
    formatVersion: "2.0",
    id: "caller",
    kind: "extension",
    name: "Caller fixture",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: options.callerFs ? [fsPermission] : [],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        contributes: { commands: [{ name: "run", title: "Run" }] },
        protocols: {
          requires: [
            { id: "tool", protocol: "org.example.local-tool", range: "^1.0.0" },
          ],
        },
      },
    },
  };
  const store: ManifestV2 = {
    formatVersion: "2.0",
    id: "store",
    kind: "extension",
    name: "Store fixture",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [fsPermission],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        contributes: { commands: [{ name: "write", title: "Write" }] },
      },
    },
  };
  const digests: string[] = [];
  for (const [manifest, files] of [
    [
      caller,
      {
        "main.js": Buffer.from(
          `export function activate(s){s.register('commands','run',v=>s.protocols.invoke('tool',v));}`,
        ),
      },
    ],
    [
      store,
      {
        "main.js": Buffer.from(
          `export function activate(s){s.register('commands','write',v=>s.capability('data',{kind:'fs',operation:'write',path:'result.txt',data:[1,2,3]}));}`,
        ),
      },
    ],
    [
      engine,
      {
        "runtime/main.js": Buffer.from(
          `export function activate(s){s.register('commands','run',async v=>{if(v.engineId)return s.engine.request(v.engineId,v.method,v.input);await s.engine.start('local');return s.engine.request('local',v.method,v.input,v.requestId);});}`,
        ),
        "engine/main.mjs": Buffer.from(native),
        "ui/index.html": Buffer.from("<p>fixture</p>"),
      },
    ],
  ] as [ManifestV2, Record<string, Buffer>][]) {
    const bytes = await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      ...files,
    });
    digests.push(
      (
        await host.importLibrary(
          ((await host.preview(bytes)) as { token: string }).token,
        )
      ).digest,
    );
  }
  const { instanceId: id } = await host.createAgent(
    "Local invocation",
    digests,
  );
  for (const pkg of ["store", "engine-demo", "caller"])
    await host.enable(id, pkg);
  if (options.policy) {
    await addPolicy(host, id, "test", options.policy);
    await select(host, id, "test");
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
  if (options.approved !== false) await approve();
  confirm.ask.mockClear();
  const run = (
    method = "echo",
    input: unknown = null,
    signal?: AbortSignal,
    requestId?: string,
  ) =>
    host.invoke(
      id,
      "caller",
      "caller",
      "commands",
      "run",
      { method, input, requestId },
      signal,
    );
  return {
    host,
    id,
    dir,
    fs,
    audit,
    events,
    ignoreStarted,
    confirm,
    run,
    approve,
    setAudit: (f: typeof auditHook) => (auditHook = f),
  };
}
it("delegates local execution to the confirmed tool without giving the caller engine/fs/exec permissions", async () => {
  const f = await fixture();
  const file = path.join(f.dir, "native.txt");
  expect(
    await f.run("write", { path: file, text: "private-native-body" }),
  ).toBe("written");
  expect(await readFile(file, "utf8")).toBe("private-native-body");
  expect(f.confirm.ask).not.toHaveBeenCalled();
  expect(
    f.audit.find(
      (e) =>
        e.kind === "engine" && e.phase === "allow" && e.operation === "write",
    ),
  ).toMatchObject({
    extensionId: "engine-demo",
    callerIds: ["caller"],
    tier: "machine",
  });
  expect(f.audit.find((e) => e.reason === "ENGINE_START")).toMatchObject({
    callerIds: ["caller"],
  });
  expect(JSON.stringify(f.audit)).not.toMatch(/private-native-body|native.txt/);
});
it("keeps missing local authorization pending and never opens a first-use confirmation", async () => {
  const f = await fixture({ approved: false });
  await expect(f.run()).rejects.toMatchObject({ code: "TIER_REQUIRED" });
  await f.approve();
  await f.host.revokeLocal(f.id, "engine-demo");
  f.confirm.ask.mockClear();
  await expect(f.run()).rejects.toMatchObject({
    code: "LOCAL_CONFIRM_REQUIRED",
  });
  expect(f.confirm.ask).not.toHaveBeenCalled();
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "stopped" },
  );
});
it.each([false, true])(
  "keeps every upstream principal on a real host callback with caller fs=%s",
  async (callerFs) => {
    const f = await fixture({ callerFs });
    const result = await f.run("callback", {
      private: "private-callback-body",
    });
    if (callerFs) {
      expect(result).toMatchObject({ kind: "fs" });
      expect(f.fs.records).toHaveLength(1);
      expect(
        f.audit.find((e) => e.kind === "fs" && e.phase === "allow"),
      ).toMatchObject({ callerIds: ["caller", "engine-demo"] });
    } else {
      expect(result).toMatchObject({
        refused: { code: "PERMISSION_DENIED", executionState: "not_started" },
      });
      expect(f.fs.records).toHaveLength(0);
      expect(f.confirm.ask).not.toHaveBeenCalled();
    }
    expect(JSON.stringify(f.audit)).not.toContain("private-callback-body");
  },
);
it.each(["unbound", "stale"])(
  "refuses %s callback association instead of replacing the delegated chain",
  async (method) => {
    const f = await fixture({ callerFs: true });
    await f.run("remember");
    expect(await f.run(method)).toMatchObject({
      refused: { code: "PERMISSION_DENIED", executionState: "not_started" },
    });
    expect(f.fs.records).toHaveLength(0);
    expect(f.confirm.ask).not.toHaveBeenCalled();
    expect(await f.run()).toBe(null);
  },
);
it("cannot reuse an old callback identity when the public cancellation label is reused", async () => {
  const f = await fixture({ callerFs: true });
  await f.run("remember", null, undefined, "reused-label");
  expect(await f.run("stale", null, undefined, "reused-label")).toMatchObject({
    refused: { code: "PERMISSION_DENIED", executionState: "not_started" },
  });
  expect(f.fs.records).toHaveLength(0);
});
it("keeps a delegated callback separate from a concurrent direct request with broader authority", async () => {
  const f = await fixture();
  await f.host.startEngine(f.id, "engine-demo", "local");
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  f.setAudit(async (e) => {
    if (e.kind === "engine" && e.phase === "allow" && e.operation === "wait")
      entered();
  });
  const direct = f.host.engineCall(f.id, "engine-demo", "request", {
    engineId: "local",
    method: "wait",
    requestId: "direct-wait",
    input: null,
  });
  await ready;
  expect(await f.run("callback")).toMatchObject({
    refused: { code: "PERMISSION_DENIED", executionState: "not_started" },
  });
  // The process cannot select the broader still-live direct request either.
  expect(await f.run("stale")).toMatchObject({
    refused: { code: "PERMISSION_DENIED", executionState: "not_started" },
  });
  expect(f.fs.records).toHaveLength(0);
  await f.host.engineCall(f.id, "engine-demo", "cancel", {
    engineId: "local",
    requestId: "direct-wait",
  });
  expect(await direct).toEqual({ cancelled: true });
});
it("cannot request an undeclared entry or gain caller-local execution by delegating", async () => {
  const f = await fixture();
  await expect(
    f.host.invoke(f.id, "caller", "caller", "commands", "run", {
      engineId: "other/local",
      method: "echo",
      input: null,
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    f.host.engineCall(f.id, "caller", "start", { engineId: "local" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "stopped" },
  );
});
it("rechecks the upstream edge during a callback confirmation before the sink", async () => {
  const f = await fixture({ callerFs: true });
  f.confirm.ask.mockImplementation(async () => {
    await f.host.disable(f.id, "caller");
    return true;
  });
  await expect(f.run("callback")).rejects.toBeDefined();
  expect(f.fs.records).toHaveLength(0);
});
it("cancels an unanswered native task from its upstream signal and keeps a cooperative process usable", async () => {
  const f = await fixture();
  const abort = new AbortController();
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  f.setAudit(async (e) => {
    if (e.kind === "engine" && e.phase === "allow" && e.operation === "wait")
      entered();
  });
  const task = f.run("wait", null, abort.signal, "waiting");
  const rejected = expect(task).rejects.toBeDefined();
  await ready;
  await new Promise((r) => setTimeout(r, 100));
  abort.abort();
  await rejected;
  await vi.waitFor(() =>
    expect(
      f.audit.find(
        (e) =>
          e.kind === "engine" && e.phase === "result" && e.operation === "wait",
      ),
    ).toMatchObject({ outcome: "failed", executionState: "completed" }),
  );
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "running" },
  );
  expect(await f.run()).toBe(null);
});
it("cancels an in-flight callback when the original caller aborts and a late confirmation cannot execute", async () => {
  const f = await fixture({ callerFs: true });
  const abort = new AbortController();
  let entered!: () => void, release!: (value: boolean) => void;
  const ready = new Promise<void>((r) => (entered = r));
  f.confirm.ask.mockImplementation(
    () =>
      new Promise<boolean>((r) => {
        release = r;
        entered();
      }),
  );
  const task = f.run("callback", null, abort.signal);
  const rejected = expect(task).rejects.toBeDefined();
  await ready;
  abort.abort();
  release(true);
  await rejected;
  expect(f.fs.records).toHaveLength(0);
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "running" },
  );
});
it("terminates a process that ignores upstream cancellation without replaying its task", async () => {
  const f = await fixture(),
    abort = new AbortController();
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  f.setAudit(async (e) => {
    if (e.kind === "engine" && e.phase === "allow" && e.operation === "ignore")
      entered();
  });
  const task = f.run("ignore", null, abort.signal),
    rejected = expect(task).rejects.toBeDefined();
  await ready;
  await f.ignoreStarted;
  abort.abort();
  await rejected;
  await expect
    .poll(
      async () =>
        (await f.host.engineStatus(f.id, "engine-demo", "local")).state,
      { timeout: 10_000 },
    )
    .toBe("crashed");
  await vi.waitFor(() =>
    expect(
      f.audit.find(
        (e) =>
          e.kind === "engine" &&
          e.phase === "result" &&
          e.operation === "ignore",
      ),
    ).toMatchObject({ outcome: "failed", executionState: "unknown" }),
  );
  expect(
    f.audit.filter(
      (e) =>
        e.kind === "engine" && e.phase === "allow" && e.operation === "ignore",
    ),
  ).toHaveLength(1);
  expect(await f.run()).toBe(null);
});
it("uses the complete delegated chain for local start and request policy without requiring caller local authorization", async () => {
  const f = await fixture({
    policy: `if(c.category!=='local'||c.actors.map(a=>a.componentId).join(',')!=='caller,engine-demo'||c.maximum.selection.length!==1||c.maximum.selection[0].componentId!=='engine-demo')throw Error('wrong chain');return decision('confirm');`,
  });
  expect(await f.run("echo", { value: "private-policy-body" })).toEqual({
    value: "private-policy-body",
  });
  expect(f.confirm.ask).not.toHaveBeenCalled();
  expect(
    f.audit
      .filter((e) => e.phase === "policy" && e.operation === "start")
      .every((e) => JSON.stringify(e.callerIds) === '["caller"]'),
  ).toBe(true);
});
