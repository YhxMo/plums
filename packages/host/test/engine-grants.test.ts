import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  type Grant,
  type ManifestV2,
} from "@plumsjs/core";
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
const engine = `import{createInterface}from'node:readline';import{writeFile,readFile}from'node:fs/promises';import{join}from'node:path';let context,next=0;const pending=new Map;const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));createInterface({input:process.stdin}).on('line',async l=>{const m=JSON.parse(l);if(m.method==='initialize'){context=m.params.context;send({id:m.id,result:{protocol:'jsonrpc-jsonl-v1'}});return;}const old=pending.get(m.id);if(old){pending.delete(m.id);send({id:old,result:m.error?{refused:true}:m.result});return;}if(m.method==='pid'){send({id:m.id,result:process.pid});return;}if(m.method==='context'){send({id:m.id,result:context});return;}if(m.method==='remember'){await writeFile(join(context.dataDir,'fixture.txt'),m.params.text);send({id:m.id,result:true});return;}if(m.method==='recall'){let value;try{value=await readFile(join(context.dataDir,'fixture.txt'),'utf8');}catch{value=null;}send({id:m.id,result:value});return;}const id='callback-'+(++next);pending.set(id,m.id);send({id,parentRequestId:m.id,method:m.method==='grant'?'host.grant':'host.invoke',params:m.params});});`;
async function fixture(withOther = false, delegatedHttps?: boolean) {
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
  if (withOther) {
    const other = engineManifest();
    other.id = "engine-other";
    other.name = "Other boundary fixture";
    manifests.push(other);
  }
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
            "runtime/main.js": Buffer.from(
              "export function activate(s){s.register('commands','run',async v=>{await s.engine.start('local');return s.engine.request('local',v.method,v.input);});}",
            ),
            "engine/main.mjs": Buffer.from(engine),
            "ui/index.html": Buffer.from("<h1>Fixture</h1>"),
          };
    const bytes = await builder.exportPackage({ manifest, files });
    const p = (await host.preview(bytes)) as { token: string };
    digests.push((await host.importLibrary(p.token)).digest);
  }
  if (delegatedHttps !== undefined) {
    const caller: ManifestV2 = {
      formatVersion: "2.0",
      kind: "extension",
      id: "delegate",
      name: "Grant caller fixture",
      version: "1.0.0",
      description: "",
      dependencies: [{ id: "engine-demo", kind: "extension", range: "^1.0.0" }],
      permissions: delegatedHttps
        ? [
            {
              id: "model",
              kind: "service",
              target: "https",
              operations: ["request"],
              reason: "Fixture model",
            },
          ]
        : [],
      payload: {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          contributes: { commands: [{ name: "run", title: "Run" }] },
        },
      },
    };
    const bytes = await builder.exportPackage({
      manifest: caller,
      files: {
        "main.js": Buffer.from(
          "export function activate(s){s.register('commands','run',v=>s.invoke('engine-demo','commands','run',v));}",
        ),
      },
    });
    digests.push(
      (
        await host.importLibrary(
          ((await host.preview(bytes)) as { token: string }).token,
        )
      ).digest,
    );
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
    if (withOther) await host.enable(r.instanceId, "engine-other");
    if (delegatedHttps !== undefined)
      await host.enable(r.instanceId, "delegate");
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components: ["engine-demo"],
    };
    const plan = await host.tierPlan(r.instanceId, selection);
    await host.confirmTier(r.instanceId, plan.fingerprint, selection);
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
    delegated: (method: string, input: unknown) =>
      host.invoke(id, "delegate", "delegate", "commands", "run", {
        method,
        input,
      }),
    setApproval: (fn: typeof approve) => (approve = fn),
  };
}
it("keeps the original process and finite Grant across another installed component's confirmation and revoke", async () => {
  const f = await fixture(true);
  await f.host.startEngine(f.id, "engine-demo", "local");
  const g = await f.request(),
    before = await f.host.engineStatus(f.id, "engine-demo", "local");
  const selection = {
    ceiling: "machine" as const,
    projects: [],
    readOnly: [],
    components: ["engine-demo", "engine-other"],
  };
  const plan = await f.host.tierPlan(f.id, selection);
  await f.host.confirmTier(f.id, plan.fingerprint, selection);
  await f.host.startEngine(f.id, "engine-other", "local");
  expect(
    await f.call("grant", { action: "check", grantId: g.id, ...f.use }),
  ).toEqual(g);
  await f.host.revokeLocal(f.id, "engine-other");
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toEqual(
    before,
  );
  expect(
    await f.host.engineStatus(f.id, "engine-other", "local"),
  ).toMatchObject({ state: "stopped" });
  const invocation = {
    packageId: "model",
    kind: "connectors",
    name: "complete",
    input: { text: "still allowed" },
    grantId: g.id,
    grantScope: f.use,
  };
  expect(await f.call("invoke", invocation)).toHaveProperty("kind", "service");
  expect(f.egress.records).toHaveLength(1);
  // Only the initial and changed assembly summaries asked for local confirmation.
  expect(f.confirm.ask).toHaveBeenCalledTimes(2);
  await f.host.stopEngine(f.id, "engine-demo", "local");
  await f.host.startEngine(f.id, "engine-demo", "local");
  expect(
    await f.call("grant", { action: "check", grantId: g.id, ...f.use }),
  ).toEqual(g);
});
it("keeps the process, private data and finite Grant when an unrelated local component joins the assembly", async () => {
  const f = await fixture();
  await f.host.startEngine(f.id, "engine-demo", "local");
  const g = await f.request(),
    pid = await f.call("pid", {});
  await f.call("remember", { text: "private assembly fixture" });
  const added = engineManifest();
  added.id = "new-local";
  added.dependencies = [];
  const preview = (await f.host.preview(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(added)),
      "runtime/main.js": Buffer.from("export function activate(){}"),
      "engine/main.mjs": Buffer.from(engine),
      "ui/index.html": Buffer.from("<p>Fixture</p>"),
    }),
  )) as { token: string };
  await f.host.addLibraryComponent(
    f.id,
    (await f.host.importLibrary(preview.token)).digest,
  );
  expect(await f.call("pid", {})).toBe(pid);
  expect(await f.call("recall", {})).toBe("private assembly fixture");
  expect(
    await f.call("grant", { action: "check", grantId: g.id, ...f.use }),
  ).toEqual(g);
  await f.call("invoke", {
    packageId: "model",
    kind: "connectors",
    name: "complete",
    input: { text: "after addition" },
    grantId: g.id,
    grantScope: f.use,
  });
  expect(f.egress.records).toHaveLength(1);
  expect(f.requests).toHaveLength(1);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});
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
  let release!: () => void, entered!: () => void;
  const dispatched = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const sink = vi.spyOn(f.egress, "send").mockImplementation(async () => {
    await new Promise<void>((r) => {
      release = r;
      entered();
    });
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
  await Promise.race([dispatched, work]);
  expect(release).toBeTypeOf("function");
  await f.host.revokeTaskScope(f.id);
  release();
  expect(await work).toHaveProperty("kind", "service");
  expect(sink).toHaveBeenCalledTimes(1);
  await f.host.stopEngine(f.id, "engine-demo", "local");
  await f.host.startEngine(f.id, "engine-demo", "local");
  sink.mockResolvedValue({ status: 200, body: "fixture" });
  expect(await f.call("invoke", invocation)).toHaveProperty("kind", "service");
});

it.each([false, true])(
  "keeps upstream HTTPS authority in finite Grant callbacks with caller HTTPS=%s",
  async (callerHttps) => {
    const f = await fixture(false, callerHttps);
    const grant = (await f.delegated("grant", {
      action: "request",
      packageId: "model",
      connectionId: "api",
      ...f.use,
    })) as Grant;
    if (!callerHttps) {
      expect(grant).toMatchObject({ refused: true });
      expect(f.requests).toHaveLength(0);
      expect(f.egress.records).toHaveLength(0);
      return;
    }
    expect(grant.scope.services.map((s) => s.packageId).sort()).toEqual([
      "delegate",
      "engine-demo",
      "model",
    ]);
    expect(
      await f.delegated("invoke", {
        packageId: "model",
        kind: "connectors",
        name: "complete",
        input: { text: "private-delegated-body" },
        grantId: grant.id,
        grantScope: f.use,
      }),
    ).toHaveProperty("kind", "service");
    expect(f.egress.records).toHaveLength(1);
    expect(f.confirm.ask).toHaveBeenCalledTimes(1);
    // An owner-only call cannot drop the upstream member of the granted scope.
    expect(
      await f.call("invoke", {
        packageId: "model",
        kind: "connectors",
        name: "complete",
        input: {},
        grantId: grant.id,
        grantScope: f.use,
      }),
    ).toMatchObject({ refused: true });
    expect(f.egress.records).toHaveLength(1);
    expect(JSON.stringify(await f.host.audit(f.id))).not.toMatch(
      /private-delegated-body|fake-engine-grant-key/,
    );
  },
);
it("revokes a finite Grant if its upstream caller changes while the prompt is waiting", async () => {
  const f = await fixture(false, true);
  f.setApproval(async (r) => {
    await f.host.disable(f.id, "delegate");
    return {
      reads: r.reads.map((v) => v.id),
      outputs: r.outputs.map((v) => v.id),
      durationMs: 900000,
    };
  });
  await expect(
    f.delegated("grant", {
      action: "request",
      packageId: "model",
      connectionId: "api",
      ...f.use,
    }),
  ).rejects.toBeDefined();
  expect(f.egress.records).toHaveLength(0);
  const core = createCore({
    dataDir: join(f.dir, "instances", f.id, "core"),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
    audit: async () => {},
  });
  try {
    expect((await core.listGrants()).every((g) => !!g.revokedAt)).toBe(true);
  } finally {
    core.close();
  }
});
