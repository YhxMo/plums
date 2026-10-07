import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  type Grant,
} from "@plums/core";
import {
  DesktopHost,
  type GrantApproval,
  type GrantChoice,
} from "../src/index.js";
import { engineManifest, connectorManifest } from "./platform-fixtures.js";
const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const engine = `import{createInterface}from'node:readline';import{writeFile,readFile}from'node:fs/promises';import{join}from'node:path';let context,next=0;const pending=new Map;const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));createInterface({input:process.stdin}).on('line',async l=>{const m=JSON.parse(l);if(m.method==='initialize'){context=m.params.context;send({id:m.id,result:{protocol:'jsonrpc-jsonl-v1'}});return;}const old=pending.get(m.id);if(old){pending.delete(m.id);send({id:old,result:m.error?{refused:true}:m.result});return;}if(m.method==='context'){send({id:m.id,result:context});return;}if(m.method==='remember'){await writeFile(join(context.dataDir,'fixture.txt'),m.params.text);send({id:m.id,result:true});return;}if(m.method==='recall'){let value;try{value=await readFile(join(context.dataDir,'fixture.txt'),'utf8');}catch{value=null;}send({id:m.id,result:value});return;}const id='callback-'+(++next);pending.set(id,m.id);send({id,method:m.method==='grant'?'host.grant':'host.invoke',params:m.params});});`;
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "plums-engine-grants-"));
  dirs.push(dir);
  const secrets = new Map<string, MemorySecretStore>(),
    egress = new RecordingEgressSink(),
    confirm = { ask: vi.fn(async () => true) };
  let approve: (r: GrantApproval) => Promise<GrantChoice | undefined> = async (
    r,
  ) => ({
    reads: r.reads.map((x) => x.id),
    outputs: r.outputs.map((x) => x.id),
    durationMs: 900000,
  });
  const requests: GrantApproval[] = [];
  const host = new DesktopHost({
    dataDir: dir,
    secretStore: (id) => {
      if (!secrets.has(id)) secrets.set(id, new MemorySecretStore());
      return secrets.get(id)!;
    },
    egress,
    confirm,
    grantConfirm: async (r) => {
      requests.push(r);
      return approve(r);
    },
  });
  hosts.push(host);
  await host.initialize();
  const manifests = [connectorManifest(), engineManifest()];
  const local = manifests[1];
  local.dependencies = [{ id: "model", kind: "connector", range: "^2.0.0" }];
  local.permissions.push({
    id: "model-access",
    kind: "service",
    target: "https",
    operations: ["request"],
    reason: "Use configured model",
  });
  local.payload.plumsDesktop.engines[0].grantResources = {
    reads: [
      { id: "conversation", title: "Conversations" },
      { id: "memory", title: "Memories" },
    ],
    outputs: [
      { id: "reply", title: "Replies" },
      { id: "memory", title: "Memories" },
    ],
  };
  const builder = createCore({
    dataDir: join(dir, "builder"),
    secrets: new MemorySecretStore(),
    egress,
  });
  const digests: string[] = [];
  for (const manifest of manifests) {
    const files =
      manifest.id === "model"
        ? {
            "runtime/main.js": Buffer.from(
              `export function activate(sdk){sdk.register('connectors','complete',async input=>{const b=await sdk.connection('api');return sdk.capability('model-api',{kind:'service',operation:'request',binding:b.binding,sources:[],input:{path:'/v1/messages',method:'POST',body:JSON.stringify(input)}});});}`,
            ),
          }
        : {
            "runtime/main.js": Buffer.from("export function activate(){}"),
            "engine/main.mjs": Buffer.from(engine),
            "ui/index.html": Buffer.from("<h1>Fixture</h1>"),
          };
    const bytes = await builder.exportPackage({ manifest, files });
    const p = (await host.preview(bytes)) as { token: string };
    digests.push((await host.importLibrary(p.token)).digest);
  }
  builder.close();
  const create = async () => {
    const r = await host.createAgent(
      "Grant fixture",
      digests,
      undefined,
      "engine-demo",
    );
    await host.setSettings(
      r.instanceId,
      "model",
      {
        protocol: "OpenAI Chat Completions",
        model: "fixture",
        endpoint: "https://model.example/v1",
      },
      { apiKey: "fake-engine-grant-key" },
    );
    await host.enable(r.instanceId, "model");
    await host.enable(r.instanceId, "engine-demo");
    return r.instanceId;
  };
  const id = await create();
  const call = (method: string, input: unknown, agent = id) =>
    host.engineCall(agent, "engine-demo", "request", {
      engineId: "local",
      method,
      input,
    });
  const use = {
    reads: ["conversation", "memory"],
    outputs: ["reply", "memory"],
  };
  const request = () =>
    call("grant", {
      action: "request",
      packageId: "model",
      connectionId: "api",
      ...use,
    }) as Promise<Grant>;
  return {
    host,
    id,
    dir,
    confirm,
    egress,
    requests,
    use,
    create,
    call,
    request,
    setApproval: (fn: typeof approve) => (approve = fn),
  };
}
it("resolves the configured model in a separate grant prompt and forwards authority through SDK", async () => {
  const f = await fixture();
  await f.host.startEngine(f.id, "engine-demo", "local");
  const g = await f.request();
  expect(g).toHaveProperty("id");
  expect(f.requests[0]).toMatchObject({
    targets: ["model.example（fixture）"],
  });
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  const result = await f.call("invoke", {
    packageId: "model",
    kind: "connectors",
    name: "complete",
    input: { text: "private user message" },
    grantId: g.id,
    grantScope: { reads: ["conversation"], outputs: ["reply"] },
  });
  expect(result).toHaveProperty("kind", "service");
  expect(f.egress.records).toHaveLength(1);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  const audit = JSON.stringify(await f.host.audit(f.id));
  expect(audit).toContain(g.id);
  expect(audit).not.toContain("private user message");
  expect(audit).not.toContain("fake-engine-grant-key");
  await f.call("grant", { action: "revoke", grantId: g.id });
  expect(
    await f.call("grant", { action: "check", grantId: g.id, ...f.use }),
  ).toBeNull();
});
it("binds persistent context to installation identity and Agent, across stop/start", async () => {
  const f = await fixture();
  await f.host.startEngine(f.id, "engine-demo", "local");
  const context = (await f.call("context", {})) as any;
  expect(context).toMatchObject({
    agentId: f.id,
    componentId: "engine-demo",
    engineId: "local",
  });
  expect(context.dataDir).not.toContain("/engines/");
  await f.call("remember", { text: "only in A" });
  const g = await f.request();
  await f.host.stopEngine(f.id, "engine-demo", "local");
  await f.host.startEngine(f.id, "engine-demo", "local");
  expect(await f.call("recall", {})).toBe("only in A");
  expect(await f.call("context", {})).toEqual(context);
  expect(
    await f.call("grant", { action: "check", grantId: g.id, ...f.use }),
  ).toMatchObject({ id: g.id });
  const b = await f.create();
  await f.host.startEngine(b, "engine-demo", "local");
  const other = (await f.call("context", {}, b)) as any;
  expect(other.dataDir).not.toBe(context.dataDir);
  expect(await f.call("recall", {}, b)).toBeNull();
  expect(
    await f.call("grant", { action: "check", grantId: g.id, ...f.use }, b),
  ).toBeNull();
});
it("rejects undeclared resources, out-of-scope callbacks and changed configuration while approving", async () => {
  const f = await fixture();
  await f.host.startEngine(f.id, "engine-demo", "local");
  expect(
    await f.call("grant", {
      action: "request",
      packageId: "model",
      connectionId: "api",
      reads: ["mail"],
      outputs: [],
    }),
  ).toMatchObject({ refused: true });
  expect(f.requests).toHaveLength(0);
  f.setApproval(async (r) => {
    await f.host.setSettings(
      f.id,
      "model",
      {
        protocol: "OpenAI Chat Completions",
        model: "changed",
        endpoint: "https://model.example/v1",
      },
      {},
    );
    return {
      reads: r.reads.map((x) => x.id),
      outputs: r.outputs.map((x) => x.id),
      durationMs: 900000,
    };
  });
  await expect(f.request()).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
  });
  await f.host.enable(f.id, "model");
  await f.host.startEngine(f.id, "engine-demo", "local");
  expect(await f.call("grant", { action: "list" })).toEqual([]);
});
it("propagates engine cancellation to an outstanding host callback", async () => {
  const { EngineManager } = await import("../src/engine-manager.js"),
    { writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "plums-callback-cancel-"));
  dirs.push(dir);
  const file = join(dir, "engine.mjs");
  await writeFile(
    file,
    `import{createInterface}from'node:readline';const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));let task;createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize')send({id:m.id,result:{protocol:'jsonrpc-jsonl-v1'}});else if(m.method==='work'){task=m.id;send({id:'callback',method:'host.invoke',params:{}});}else if(m.method==='$/cancelRequest'){send({method:'$/cancelRequest',params:{id:'callback'}});send({id:task,result:{cancelled:true}});}});`,
  );
  let callbackSignal: AbortSignal | undefined;
  const manager = new EngineManager(),
    hooks = {
      prepare: async () => ({ entry: file, cwd: dir }),
      active: async () => {},
      audit: async () => {},
      event: () => {},
      callback: async (_m: string, _a: unknown, signal: AbortSignal) => {
        callbackSignal = signal;
        await new Promise<void>((r) =>
          signal.addEventListener("abort", () => r(), { once: true }),
        );
        return null;
      },
    };
  try {
    await manager.start("cancel", hooks);
    const work = manager.request("cancel", hooks, "work", {}, "work-id");
    await vi.waitFor(() => expect(callbackSignal).toBeDefined());
    await manager.cancel("cancel", hooks, "work-id");
    expect(await work).toEqual({ cancelled: true });
    await vi.waitFor(() => expect(callbackSignal?.aborted).toBe(true));
  } finally {
    await manager.stop("cancel", hooks);
  }
});

it("keeps a granted engine model callback running when the frontend's temporary scope closes", async () => {
  const f = await fixture();
  await f.host.startEngine(f.id, "engine-demo", "local");
  const g = await f.request();
  let release!: () => void;
  const sink = vi.spyOn(f.egress, "send").mockImplementation(async () => {
    await new Promise<void>((r) => (release = r));
    return { status: 200, body: "fixture" };
  });
  const invocation = {
    packageId: "model",
    kind: "connectors",
    name: "complete",
    input: { text: "background" },
    grantId: g.id,
    grantScope: { reads: ["conversation"], outputs: ["reply"] },
  };
  const work = f.call("invoke", invocation);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await f.host.revokeTaskScope(f.id);
  release();
  expect(await work).toHaveProperty("kind", "service");
  expect(sink).toHaveBeenCalledTimes(1);
  await f.host.stopEngine(f.id, "engine-demo", "local");
  await f.host.startEngine(f.id, "engine-demo", "local");
  sink.mockResolvedValue({ status: 200, body: "fixture" });
  expect(await f.call("invoke", invocation)).toHaveProperty("kind", "service");
});
